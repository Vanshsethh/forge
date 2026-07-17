// NOTE: this is intentionally duplicated from gateway-service/src/ledger/index.js.
// A real production system would extract this into a shared package so both
// services stay in sync automatically. For a week-long prototype, duplicating
// one ~50-line file is a reasonable tradeoff over the setup cost of a shared
// internal package — flagged here so it's a deliberate choice, not an oversight.

const crypto = require("crypto");
const pool = require("../db");

function computeRowHash(prevHash, agentId, action, verdict, createdAt) {
  const raw = `${prevHash}${agentId || ""}${action}${verdict}${createdAt}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function appendAuditEntry({
  actorType,
  agentId = null,
  actorId = null,
  action,
  amount = null,
  verdict,
  reason = null,
  context = null,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [headRows] = await conn.query(
      "SELECT current_hash FROM ledger_head WHERE id = 1 FOR UPDATE"
    );
    const prevHash = headRows[0].current_hash;

    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const rowHash = computeRowHash(prevHash, agentId, action, verdict, createdAt);

    await conn.query(
      `INSERT INTO audit_log
        (actor_type, agent_id, actor_id, action, amount, verdict, reason, context, prev_hash, row_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actorType, agentId, actorId, action, amount, verdict, reason,
       context ? JSON.stringify(context) : null, prevHash, rowHash, createdAt]
    );

    await conn.query(
      "UPDATE ledger_head SET current_hash = ?, row_count = row_count + 1 WHERE id = 1",
      [rowHash]
    );

    await conn.commit();
    return { prevHash, rowHash };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { appendAuditEntry };
