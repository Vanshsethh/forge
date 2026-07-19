# FORGE

FORGE is a governance control plane for autonomous financial agents. It evaluates each proposed action before execution, enforces policy and spend limits, supports immediate revocation, and records every decision in a tamper-evident MySQL audit ledger.

## What it does

- Verifies replay-resistant HMAC-signed agent requests.
- Fails closed when gateway dependencies cannot be reached.
- Applies OPA policies for payments, servicing, and travel agents.
- Enforces per-transaction, hourly, and daily Redis-backed spend caps.
- Provides fleet and per-agent kill switches through the admin API.
- Writes agent and operator actions to an append-only SHA-256 hash chain.
- Includes a three-agent simulator with a rogue overspend scenario.
- Provides a React dashboard that calls the admin service only.

## Local run

Prerequisites: Docker Desktop with Compose.

```bash
docker compose up --build
```

Services:

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:3000 |
| Admin API | http://localhost:5050 |
| Gateway API | http://localhost:4000 |
| OPA | http://localhost:8181 |

The dashboard lets an operator register, log in, view fleet spend, inspect the audit feed, and activate fleet or agent kill switches. For local development it is allowed to call only `admin-service` at `http://localhost:5050`.

## Demo simulator

With the stack running:

```bash
cd fleet-simulator
npm install
npm start
```

The simulator registers payments, servicing, and travel agents, sends allowed and denied actions, then has the payments agent exceed its hourly spend cap. Requests are signed using the same HMAC format the gateway verifies.

## Tamper-detection proof

```bash
cd services/gateway-service
npm test
```

The test writes five entries with the production ledger implementation, validates the intact chain, mutates one historical `audit_log` row through a MySQL root connection, asserts the verifier detects the exact altered row, and cleans up the temporary rows. The application MySQL user has no `UPDATE` or `DELETE` privilege on `audit_log`.

## Architecture

```text
Simulator -> gateway-service -> OPA / Redis / MySQL audit ledger
Dashboard -> admin-service -> Redis / MySQL audit ledger
```

`gateway-service` is the agent-facing hot path. `admin-service` is the authenticated operator API. Both append audit entries through a transaction that locks `ledger_head`, preserving the audit table's no-update/no-delete application privilege while serializing hash-chain writes.

## Current v1 limits

- Fleet agents are simulated; no real banking integration exists.
- Risk controls are rule-based only; no ML or anomaly detection is used.
- Policy bundle signing, gateway rate limiting, automatic risk-adaptive caps, and periodic external ledger anchoring are not implemented yet.
- A hash-chain page indicator confirms visible links; the full tamper proof is the database-backed verification test above.
