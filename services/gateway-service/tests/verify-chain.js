const { createPool } = require("mysql2/promise");
const { createHash } = require("crypto");
require("dotenv").config({ path: "../../../.env" });

const pool = createPool({
  host: process.env.MYSQL_HOST || process.env.DB_HOST || "localhost",
  user: process.env.MYSQL_USER || process.env.DB_USER || "forge_app",
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "forgeapppass",
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || "forge",
});

const GENESIS_KNOWN_HASH = createHash("sha256")
  .update("genesis-forge-ledger")
  .digest("hex");

function computeRowHash(prevHash, agentId, action, verdict, createdAtStr) {
  const raw = `${prevHash}${agentId || ""}${action}${verdict}${createdAtStr}`;
  return createHash("sha256").update(raw).digest("hex");
}

async function walkChain() {
  const [rows] = await pool.query(
    "SELECT id, agent_id, action, verdict, prev_hash, row_hash, " +
    "DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at_str " +
    "FROM audit_log ORDER BY id ASC"
  );

  if (rows.length === 0) {
    console.log("audit_log is empty — nothing to verify");
    await pool.end();
    return;
  }

  let errors = 0;

  // Genesis row check
  const genesis = rows[0];
  if (genesis.row_hash !== GENESIS_KNOWN_HASH) {
    console.error(`CHAIN BROKEN at genesis row id=${genesis.id}`);
    console.error(`  stored:     ${genesis.row_hash}`);
    console.error(`  expected:   ${GENESIS_KNOWN_HASH}`);
    errors++;
  }

  let prevHash = genesis.row_hash;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (row.prev_hash !== prevHash) {
      console.error(
        `PREV_HASH MISMATCH at row id=${row.id} — does not link to row id=${rows[i - 1].id}`
      );
      errors++;
    }

    const expected = computeRowHash(
      row.prev_hash,
      row.agent_id,
      row.action,
      row.verdict,
      row.created_at_str
    );

    if (row.row_hash !== expected) {
      console.error(`CHAIN BROKEN at row id=${row.id} (index ${i})`);
      console.error(`  stored:     ${row.row_hash}`);
      console.error(`  recomputed: ${expected}`);
      errors++;
    }

    prevHash = row.row_hash;
  }

  await pool.end();

  if (errors === 0) {
    console.log(`Chain intact — ${rows.length} rows verified.`);
    process.exit(0);
  } else {
    console.error(`Chain FAILED — ${errors} error(s) found.`);
    process.exit(1);
  }
}

walkChain().catch((err) => {
  console.error("verify-chain crashed:", err);
  process.exit(1);
});
