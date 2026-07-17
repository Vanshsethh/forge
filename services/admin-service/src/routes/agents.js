const express = require("express");
const crypto = require("crypto");
const { randomUUID } = require("crypto");
const { requireAuth } = require("../middleware/requireAuth");
const pool = require("../db");

const router = express.Router();
router.use(requireAuth);

// List all agents with their spend caps and current status.
router.get("/agents", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, a.name, a.agent_type, a.status, a.created_at,
            s.per_txn_cap, s.hourly_cap, s.daily_cap
     FROM agents a
     JOIN spend_caps s ON a.id = s.agent_id
     ORDER BY a.created_at DESC`
  );
  return res.json({ agents: rows });
});

// Single agent detail — secret is never returned here, even to an operator,
// since it should only ever be shown once, at creation time.
router.get("/agents/:id", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, a.name, a.agent_type, a.status, a.created_at,
            s.per_txn_cap, s.hourly_cap, s.daily_cap
     FROM agents a
     JOIN spend_caps s ON a.id = s.agent_id
     WHERE a.id = ?`,
    [req.params.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "agent not found" });
  }
  return res.json({ agent: rows[0] });
});

// Create a new agent. Generates a random HMAC secret server-side — the
// operator never chooses it, and it's returned exactly once in this response.
// If it's lost, the only recovery path is issuing a new one (out of scope for v1).
router.post("/agents", async (req, res) => {
  const { name, agentType, perTxnCap, hourlyCap, dailyCap } = req.body;

  if (!name || !agentType || !perTxnCap || !hourlyCap || !dailyCap) {
    return res.status(400).json({
      error: "name, agentType, perTxnCap, hourlyCap, and dailyCap are required",
    });
  }

  const validTypes = ["payments", "servicing", "travel"];
  if (!validTypes.includes(agentType)) {
    return res.status(400).json({ error: `agentType must be one of: ${validTypes.join(", ")}` });
  }

  const id = randomUUID();
  const secret = crypto.randomBytes(32).toString("hex");
  const policyId = `policy-${agentType}-v1`;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "INSERT INTO agents (id, name, agent_type, status, policy_id, secret_current) VALUES (?, ?, ?, 'active', ?, ?)",
      [id, name, agentType, policyId, secret]
    );
    await conn.query(
      "INSERT INTO spend_caps (agent_id, per_txn_cap, hourly_cap, daily_cap) VALUES (?, ?, ?, ?)",
      [id, perTxnCap, hourlyCap, dailyCap]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return res.status(201).json({
    id,
    name,
    agentType,
    secret, // shown exactly once — the operator must save this now
    warning: "This secret will not be shown again. Store it securely.",
  });
});

module.exports = router;
