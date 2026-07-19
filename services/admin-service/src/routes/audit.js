const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const pool = require("../db");

const router = express.Router();
router.use(requireAuth);

// GET /audit?page=1&limit=50&agentId=...&verdict=...
// Returns newest-first, with optional filters. Pagination is required here —
// this table grows without bound by design (append-only ledger).
router.get("/audit", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const filters = [];
  const params = [];
  if (req.query.agentId) {
    filters.push("agent_id = ?");
    params.push(req.query.agentId);
  }
  if (req.query.verdict) {
    filters.push("verdict = ?");
    params.push(req.query.verdict);
  }
  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT id, actor_type, agent_id, actor_id, action, amount, verdict, reason, context,
            prev_hash, row_hash, created_at
     FROM audit_log ${whereClause}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM audit_log ${whereClause}`,
    params
  );

  return res.json({
    page,
    limit,
    total: countRows[0].total,
    entries: rows,
  });
});

module.exports = router;
