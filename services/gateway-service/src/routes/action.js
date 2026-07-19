const express = require("express");
const router = express.Router();

const { isFleetKilled, isAgentRevoked, checkAndIncrementSpend } = require("../redis-client");
const { evaluatePolicy } = require("../opa-client");
const { appendAuditEntry } = require("../ledger");
const pool = require("../db");

// Fetches agent + its spend cap config from MySQL. Kept simple (no cache) for now —
// agent lookups aren't the hot path bottleneck compared to the OPA/Redis calls.
async function getAgent(agentId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.name, a.agent_type, a.status, s.per_txn_cap, s.hourly_cap, s.daily_cap
     FROM agents a JOIN spend_caps s ON a.id = s.agent_id
     WHERE a.id = ?`,
    [agentId]
  );
  return rows[0] || null;
}

router.post("/action", async (req, res) => {
  const agentId = req.verifiedAgentId; // set by verifyHmac middleware — trusted, not from req.body
  const { action, amount: requestedAmount } = req.body;

  if (!action || typeof requestedAmount !== "number" || !Number.isFinite(requestedAmount) || requestedAmount < 0) {
    return res.status(400).json({ error: "action and a non-negative numeric amount are required" });
  }
  const amount = requestedAmount;

  // Step 1 — fail-closed dependency wrapper. Any thrown error below this point
  // becomes a DENY, logged as a system-fault denial (CLAUDE.md §4, §8).
  try {
    // Step 2 — kill-switch checks, before anything else (cheapest checks first).
    const fleetKilled = await isFleetKilled();
    if (fleetKilled) {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "fleet_kill_switch_active",
      });
      return res.status(403).json({ allowed: false, reason: "fleet_kill_switch_active" });
    }

    const agentRevoked = await isAgentRevoked(agentId);
    if (agentRevoked) {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "agent_revoked",
      });
      return res.status(403).json({ allowed: false, reason: "agent_revoked" });
    }

    // Step 3 — look up the agent to get its type (for OPA) and spend caps.
    const agent = await getAgent(agentId);
    if (!agent || agent.status !== "active") {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "agent_not_found_or_inactive",
      });
      return res.status(404).json({ allowed: false, reason: "agent_not_found_or_inactive" });
    }

    // Step 4 — per-transaction cap ceiling (before even asking OPA — cheap check).
    if (amount > agent.per_txn_cap) {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "exceeds_per_transaction_cap",
      });
      return res.status(403).json({ allowed: false, reason: "exceeds_per_transaction_cap" });
    }

    // Step 5 — ask OPA whether this action is allowed for this agent type.
    const opaAllows = await evaluatePolicy(agent.agent_type, action, amount);
    if (!opaAllows) {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "policy_denied",
      });
      return res.status(403).json({ allowed: false, reason: "policy_denied" });
    }

    // Step 6 — spend cap checks (hourly, then daily). Both must pass.
    const hourly = await checkAndIncrementSpend(agentId, amount, 3600, agent.hourly_cap);
    if (!hourly.withinCap) {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "exceeds_hourly_cap",
        context: { currentTotal: hourly.currentTotal, cap: hourly.cap },
      });
      return res.status(403).json({ allowed: false, reason: "exceeds_hourly_cap" });
    }

    const daily = await checkAndIncrementSpend(agentId, amount, 86400, agent.daily_cap);
    if (!daily.withinCap) {
      await appendAuditEntry({
        actorType: "agent",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: "exceeds_daily_cap",
        context: { currentTotal: daily.currentTotal, cap: daily.cap },
      });
      return res.status(403).json({ allowed: false, reason: "exceeds_daily_cap" });
    }

    // Step 7 — everything passed. Log the allow, then "execute" (mocked — no
    // real bank integration exists; this just simulates a successful action).
    await appendAuditEntry({
      actorType: "agent",
      agentId,
      action,
      amount,
      verdict: "allow",
      reason: "all_checks_passed",
    });

    return res.status(200).json({ allowed: true, action, amount, executedAt: new Date().toISOString() });
  } catch (err) {
    // Fail closed — any unexpected error (OPA down, Redis down, MySQL down) is a DENY.
    console.error("Gateway error, failing closed:", err.message);
    try {
      await appendAuditEntry({
        actorType: "system",
        agentId,
        action,
        amount,
        verdict: "deny",
        reason: `system_fault: ${err.message}`,
      });
    } catch (ledgerErr) {
      // If even the ledger write fails, we can't log it — but we still deny.
      console.error("Ledger write also failed:", ledgerErr.message);
    }
    return res.status(503).json({ allowed: false, reason: "system_fault" });
  }
});

module.exports = router;
