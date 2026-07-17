-- FORGE schema — matches CLAUDE.md §5 (Data Model)
-- This file auto-runs once, on first MySQL container startup only.

CREATE TABLE agents (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  agent_type    VARCHAR(50) NOT NULL,          -- payments | servicing | travel
  status        ENUM('active','revoked') DEFAULT 'active',
  policy_id     VARCHAR(36) NOT NULL,
  secret_current VARCHAR(255) NOT NULL,        -- HMAC secret, current key
  secret_previous VARCHAR(255) DEFAULT NULL,    -- HMAC secret, rotation window
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE spend_caps (
  agent_id        VARCHAR(36) PRIMARY KEY,
  per_txn_cap     DECIMAL(12,2) NOT NULL,
  hourly_cap      DECIMAL(12,2) NOT NULL,
  daily_cap       DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Append-only, hash-chained ledger. No UPDATE/DELETE grants at the app-user level (see below).
CREATE TABLE audit_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_type    ENUM('agent','operator','system') NOT NULL DEFAULT 'agent',
  agent_id      VARCHAR(36) DEFAULT NULL,       -- null when actor_type = operator/system
  actor_id      VARCHAR(36) DEFAULT NULL,       -- operator id, when actor_type = operator
  action        VARCHAR(100) NOT NULL,
  amount        DECIMAL(12,2) DEFAULT NULL,
  verdict       ENUM('allow','deny','shadow') NOT NULL,
  reason        VARCHAR(255) DEFAULT NULL,
  context        JSON DEFAULT NULL,
  prev_hash     CHAR(64) NOT NULL,
  row_hash      CHAR(64) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE operators (
  id            VARCHAR(36) PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tracks only the current chain head (latest row_hash). Separated from audit_log
-- so the app can safely SELECT ... FOR UPDATE here (requires UPDATE privilege)
-- without ever needing UPDATE privilege on audit_log itself. This keeps the
-- "no UPDATE/DELETE on audit_log" guarantee intact while still allowing safe
-- concurrent writes (see CLAUDE.md §8 concurrency fix).
CREATE TABLE ledger_head (
  id            TINYINT PRIMARY KEY DEFAULT 1,
  current_hash  CHAR(64) NOT NULL,
  row_count     BIGINT NOT NULL DEFAULT 1
);

-- Genesis row for the hash chain — every real row's prev_hash traces back to this.
INSERT INTO audit_log (actor_type, action, verdict, prev_hash, row_hash)
VALUES ('system', 'genesis', 'allow', REPEAT('0', 64), SHA2('genesis-forge-ledger', 256));

-- Seed the chain head to match the genesis row's hash.
INSERT INTO ledger_head (id, current_hash, row_count)
VALUES (1, SHA2('genesis-forge-ledger', 256), 1);

-- Lock down the audit_log table at the DB-user level: create an app user that
-- can INSERT and SELECT on audit_log, but never UPDATE or DELETE.
CREATE USER IF NOT EXISTS 'forge_app'@'%' IDENTIFIED BY 'forgeapppass';
GRANT SELECT, INSERT, UPDATE, DELETE ON forge.agents TO 'forge_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON forge.spend_caps TO 'forge_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON forge.operators TO 'forge_app'@'%';
GRANT SELECT, INSERT, UPDATE ON forge.ledger_head TO 'forge_app'@'%';  -- needed for FOR UPDATE lock
GRANT SELECT, INSERT ON forge.audit_log TO 'forge_app'@'%';  -- no UPDATE, no DELETE — enforced here
FLUSH PRIVILEGES;
