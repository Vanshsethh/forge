const crypto = require("crypto");
const pool = require("../db");

// Computes SHA-256 of the same fields used when creating a row, so a
// verification script can recompute this later and compare against what's stored.
function computeRowHash(prevHash, agentId, action, verdict, createdAtIso) {
  const raw = `${prevHash}${agentId || ""}${action}${verdict}${createdAtIso}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Writes one entry to the audit_log, chained to the previous row's hash.
// CLAUDE.md §8 concurrency fix: wraps the read-last-row + insert in a single
// transaction with SELECT ... FOR UPDATE, so two concurrent requests can't
// both read the same "last row" and fork the chain by writing conflicting
// prev_hash values.
async function appendAuditEntry({
  actorType, // "agent" | "operator" | "system"
  agentId = null,
  actorId = null,
  action,
  amount = null,
  verdict, // "allow" | "deny" | "shadow"
  reason = null,
  context = null,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the chain head (NOT audit_log itself) so no other transaction can
    // read/advance it until we commit. This is what keeps forge_app's
    // "no UPDATE on audit_log" privilege intact while still preventing forks.
    const [headRows] = await conn.query(
      "SELECT current_hash FROM ledger_head WHERE id = 1 FOR UPDATE"
    );
    const prevHash = headRows[0].current_hash;

    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " "); // MySQL DATETIME, second precision
    const rowHash = computeRowHash(prevHash, agentId, action, verdict, createdAt);

    await conn.query(
      `INSERT INTO audit_log
        (actor_type, agent_id, actor_id, action, amount, verdict, reason, context, prev_hash, row_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorType,
        agentId,
        actorId,
        action,
        amount,
        verdict,
        reason,
        context ? JSON.stringify(context) : null,
        prevHash,
        rowHash,
        createdAt,
      ]
    );

    // Advance the chain head to this row's hash.
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

module.exports = { appendAuditEntry, computeRowHash };
