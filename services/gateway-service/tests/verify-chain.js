// verify-chain.js -- FORGE tamper-detection test (CLAUDE.md §8 / §13)
//
// What this proves:
//   1. The hash chain is self-consistent after normal writes (PASS).
//   2. A direct row mutation in MySQL breaks the chain at the tampered row (FAIL).
//
// Run:  node tests/verify-chain.js
// Requires: MySQL running (docker compose up mysql).
//
// Two DB connections are used deliberately:
//   forge_app  -- application user (SELECT + INSERT only on audit_log)
//                 used to write test entries via the real appendAuditEntry()
//   root       -- used ONLY for the tamper UPDATE, because forge_app intentionally
//                 has no UPDATE on audit_log (that is the whole point)

require("dotenv").config({ path: "../../../.env" });

const mysql  = require("mysql2/promise");
const crypto = require("crypto");

const BASE_CONFIG = {
  host:     process.env.MYSQL_HOST     || "localhost",
  database: "forge",
  waitForConnections: true,
  connectionLimit: 5,
};

const appPool = mysql.createPool({ ...BASE_CONFIG, user: "forge_app",  password: "forgeapppass" });
const rootPool = mysql.createPool({ ...BASE_CONFIG, user: process.env.MYSQL_ROOT_USER || "root", password: process.env.MYSQL_ROOT_PASSWORD || "forgeroot" });

// Monkey-patch require() so ledger/index.js picks up our test pool instead of
// creating its own singleton. Test entries are written through the exact same
// appendAuditEntry() the gateway uses -- no test-only reimplementation.
const Module = require("module");
const originalLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename && parent.filename.includes("ledger") && request.includes("../db")) {
    return appPool;
  }
  return originalLoad(request, parent, isMain);
};

const { appendAuditEntry, computeRowHash } = require("../src/ledger");

// Restore immediately so nothing else in the process is affected.
Module._load = originalLoad;

// Genesis row_hash was produced by MySQL SHA2() in init.sql.
// Node recomputes the same value here so we can verify the genesis row
// without needing to re-run init.sql.
const GENESIS_KNOWN_HASH = crypto
  .createHash("sha256")
  .update("genesis-forge-ledger")
  .digest("hex");

// Walks every row in the audit_log in id order, recomputing hashes and
// verifying prev_hash linkage. Returns { ok, failedAtId, reason }.
async function walkChain(pool) {
  const [rows] = await pool.query(
    "SELECT id, agent_id, action, verdict, prev_hash, row_hash, " +
    "DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at_str " +
    "FROM audit_log ORDER BY id ASC"
  );
  if (rows.length === 0) return { ok: false, failedAtId: null, reason: "audit_log is empty" };

  // Genesis row: verify against the known constant (row_hash was created by MySQL SHA2, not computeRowHash).
  const genesis = rows[0];
  if (genesis.row_hash !== GENESIS_KNOWN_HASH) {
    return { ok: false, failedAtId: genesis.id,
      reason: "genesis row_hash mismatch: stored=" + genesis.row_hash + " expected=" + GENESIS_KNOWN_HASH };
  }

  let prevHash = genesis.row_hash;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.prev_hash !== prevHash) {
      return { ok: false, failedAtId: row.id,
        reason: "prev_hash broken at row " + row.id + ": stored=" + row.prev_hash + " expected=" + prevHash };
    }
    const expected = computeRowHash(row.prev_hash, row.agent_id, row.action, row.verdict, row.created_at_str);
    if (row.row_hash !== expected) {
      return { ok: false, failedAtId: row.id,
        reason: "row_hash mismatch at row " + row.id + ": stored=" + row.row_hash + " recomputed=" + expected };
    }
    prevHash = row.row_hash;
  }
  return { ok: true };
}

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log("  PASS  " + label); passed++; }
  else           { console.error("  FAIL  " + label); failed++; }
}

async function cleanup(insertedIds) {
  if (insertedIds.length === 0) return;
  console.log("\n[cleanup] Removing test rows and rewinding ledger_head...");
  const [[firstRow]] = await appPool.query("SELECT prev_hash FROM audit_log WHERE id = ?", [insertedIds[0]]);
  const newHead = firstRow ? firstRow.prev_hash : null;
  const placeholders = insertedIds.map(() => "?").join(",");
  await rootPool.query("DELETE FROM audit_log WHERE id IN (" + placeholders + ")", insertedIds);
  if (newHead) {
    await rootPool.query(
      "UPDATE ledger_head SET current_hash = ?, row_count = GREATEST(1, row_count - ?) WHERE id = 1",
      [newHead, insertedIds.length]
    );
  }
  console.log("  Test rows removed, ledger_head rewound.");
}

async function run() {
  console.log("---------------------------------------------------------");
  console.log("FORGE -- hash-chain tamper-detection test");
  console.log("---------------------------------------------------------");

  const [[{ beforeCount }]] = await appPool.query("SELECT COUNT(*) AS beforeCount FROM audit_log");
  console.log("Rows in audit_log before test: " + beforeCount);

  // Phase 1: write 5 real audit entries.
  console.log("\n[1] Writing 5 test audit entries via appendAuditEntry()...");
  const testAgentId = "11111111-2222-3333-4444-555555555555";
  const entries = [
    { action: "issue_refund",  amount:  50.00, verdict: "allow",  reason: "test_entry_1" },
    { action: "adjust_limit",  amount: 100.00, verdict: "allow",  reason: "test_entry_2" },
    { action: "issue_refund",  amount: 200.00, verdict: "deny",   reason: "test_entry_3" },
    { action: "adjust_limit",  amount:  75.50, verdict: "allow",  reason: "test_entry_4" },
    { action: "issue_refund",  amount:  10.00, verdict: "shadow", reason: "test_entry_5" },
  ];
  for (const e of entries) {
    await appendAuditEntry({ actorType: "agent", agentId: testAgentId,
      action: e.action, amount: e.amount, verdict: e.verdict, reason: e.reason });
  }
  const [inserted] = await appPool.query(
    "SELECT id FROM audit_log WHERE agent_id = ? AND reason LIKE 'test_entry_%' ORDER BY id ASC",
    [testAgentId]
  );
  const insertedIds = inserted.map(r => r.id);
  assert(insertedIds.length === 5, "Inserted 5 rows (got " + insertedIds.length + ")");
  console.log("  Row ids: " + insertedIds.join(", "));

  // Phase 2: chain must pass before tampering.
  console.log("\n[2] Verifying chain integrity (should PASS)...");
  const before = await walkChain(appPool);
  assert(before.ok === true, "Chain verification passes on untampered data");
  if (!before.ok) {
    console.error("  " + before.reason);
    console.error("  Chain already broken. Aborting.");
    await cleanup(insertedIds);
    process.exit(1);
  }

  // Phase 3: tamper -- mutate a middle row directly using root connection.
  const tamperedId = insertedIds[2];
  console.log("\n[3] Tampering: UPDATE audit_log SET action='tampered' WHERE id=" + tamperedId);
  console.log("    (root connection -- forge_app has no UPDATE on audit_log by design)");
  await rootPool.query("UPDATE audit_log SET action = 'tampered' WHERE id = ?", [tamperedId]);
  console.log("  Row mutated directly in MySQL.");

  // Phase 4: re-walk -- must detect tamper at the right row.
  console.log("\n[4] Verifying chain integrity (should FAIL)...");
  const after = await walkChain(appPool);
  assert(after.ok === false, "Chain verification detects the tamper");
  assert(after.failedAtId === tamperedId, "Failure detected at tampered row id=" + tamperedId + " (got id=" + after.failedAtId + ")");
  if (!after.ok) {
    console.log("  Failure detail (expected):");
    console.log("  -> " + after.reason);
  }

  await cleanup(insertedIds);

  console.log("\n---------------------------------------------------------");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  console.log("---------------------------------------------------------");

  await appPool.end();
  await rootPool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error("Fatal error:", err); process.exit(1); });
