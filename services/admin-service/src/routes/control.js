const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { setFleetKill, setAgentRevoked, isFleetKilled } = require("../redis-client");
const { appendAuditEntry } = require("../ledger");
const pool = require("../db");

const router = express.Router();
router.use(requireAuth); // every route below requires a valid operator JWT

// Get current control plane status (fleet kill switch state).
router.get("/status", async (req, res) => {
  try {
    const globalKillActive = await isFleetKilled();
    return res.json({ globalKillActive });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Fleet-wide emergency stop — halts every agent instantly.
router.post("/fleet/kill", async (req, res) => {
  await setFleetKill(true);
  await appendAuditEntry({
    actorType: "operator",
    actorId: req.operatorId,
    action: "fleet_kill_switch_activated",
    verdict: "deny", // "deny" here represents "this action blocks future agent actions"
    reason: `triggered by operator ${req.operatorEmail}`,
  });
  return res.json({ status: "fleet_killed" });
});

router.post("/fleet/resume", async (req, res) => {
  await setFleetKill(false);
  await appendAuditEntry({
    actorType: "operator",
    actorId: req.operatorId,
    action: "fleet_kill_switch_deactivated",
    verdict: "allow",
    reason: `resumed by operator ${req.operatorEmail}`,
  });
  return res.json({ status: "fleet_resumed" });
});

// Per-agent revoke — sets the Redis flag (checked instantly by the gateway)
// AND updates the persistent status in MySQL, so the two stay consistent.
router.post("/agents/:id/revoke", async (req, res) => {
  const agentId = req.params.id;

  const [rows] = await pool.query("SELECT id FROM agents WHERE id = ?", [agentId]);
  if (rows.length === 0) {
    return res.status(404).json({ error: "agent not found" });
  }

  await setAgentRevoked(agentId, true);
  await pool.query("UPDATE agents SET status = 'revoked' WHERE id = ?", [agentId]);
  await appendAuditEntry({
    actorType: "operator",
    agentId,
    actorId: req.operatorId,
    action: "agent_revoked",
    verdict: "deny",
    reason: `revoked by operator ${req.operatorEmail}`,
  });

  return res.json({ status: "agent_revoked", agentId });
});

router.post("/agents/:id/restore", async (req, res) => {
  const agentId = req.params.id;

  const [rows] = await pool.query("SELECT id FROM agents WHERE id = ?", [agentId]);
  if (rows.length === 0) {
    return res.status(404).json({ error: "agent not found" });
  }

  await setAgentRevoked(agentId, false);
  await pool.query("UPDATE agents SET status = 'active' WHERE id = ?", [agentId]);
  await appendAuditEntry({
    actorType: "operator",
    agentId,
    actorId: req.operatorId,
    action: "agent_restored",
    verdict: "allow",
    reason: `restored by operator ${req.operatorEmail}`,
  });

  return res.json({ status: "agent_restored", agentId });
});

module.exports = router;
