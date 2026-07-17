# FORGE — Fleet Oversight & Real-time Governance Engine

> Single source of truth for FORGE's architecture and design decisions.
> **Rule:** decisions here are locked. They change only when a bug or real constraint forces it.
> Every entry includes *why*, so it can be defended in an interview without re-deriving the
> reasoning from scratch.

---

## 1. What FORGE Is

A real-time governance control plane for autonomous financial agents. Every action an AI agent
wants to take (spend money, adjust a limit, issue a refund) passes through FORGE first. FORGE
checks if the agent is allowed to do it, whether it's within budget, whether anything has revoked
it, and logs the decision permanently — before the action is allowed through.

**The problem:** banks are moving from single chatbots to fleets of autonomous agents acting in
milliseconds, 24/7. Humans can't oversee at that speed. One mis-scoped or compromised agent could
take thousands of harmful actions before anyone notices. There's no standard infrastructure to
scope, meter, halt, and audit agents the way IAM does for humans.

**Core interaction loop:**
1. Simulated agent (payments / servicing / travel) sends an action request to the FORGE gateway
2. Gateway checks: is this agent revoked? Is the fleet-wide kill switch on?
3. Gateway asks OPA: does this agent's policy allow this action?
4. Gateway checks Redis: is this agent within its spend caps?
5. Verdict (allow / deny / shadow-log-only) is appended to the hash-chained audit ledger
6. Operator dashboard shows the live fleet, spend burn-down, and can revoke or kill-switch instantly

---

## 2. Engineering Philosophy (locked mindset)

- **Governance, not another agent.** FORGE never decides *what* an agent should do — it only
  decides whether an already-decided action is *allowed to happen*. This distinction matters in
  interviews: FORGE is guardrail infrastructure, model-agnostic.
- **No ML/anomaly detection in v1.** Spend-cap tightening uses explicit, explainable rules (e.g.
  "if spend rate exceeds 2x the rolling average, halve the cap"), not a trained model. Honest
  scope beats an unverifiable ML claim.
- **Fail closed, not open.** If OPA, Redis, or MySQL is unreachable, the default verdict is
  **deny**. A governance layer that fails open is worse than no governance layer.
- **Audit everything, rewrite nothing.** The audit ledger is append-only and hash-chained — no
  update or delete operations exist on it, even for admins.
- **Services own their data.** gateway-service and admin-service never share a direct DB
  connection pool for writes to the same tables without going through defined contracts.

---

## 3. Final Service Map — LOCKED

| Service | Tech | Responsibility |
|---|---|---|
| **gateway-service** | Node.js — Express | Public-facing. Receives agent action requests, calls OPA, checks Redis (spend caps, kill switch, revocation), writes audit entries, returns allow/deny. |
| **admin-service** | Node.js — Express | REST API for the dashboard: agent/policy CRUD, spend cap config, kill switch trigger, audit log queries, operator auth (JWT). |
| **opa** | Open Policy Agent (Docker sidecar) | Evaluates Rego policies given agent + action + context. Called via HTTP by gateway-service. |
| **MySQL** | — | Agents, policies metadata, spend cap configs, hash-chained audit_log, operator accounts. |
| **Redis** | — | Real-time sliding-window spend counters, kill switch flags (global + per-agent), revocation flags. |
| **frontend** | React + TailwindCSS + Recharts | Operator dashboard: live fleet, spend burn-down, audit feed, kill switches. |
| **fleet-simulator** | Node.js script | Simulates 2-3 mock agents (payments, servicing, travel) firing requests at the gateway, including a "goes rogue and overspends" scenario for the demo. |

**Why split gateway vs. admin:** the gateway is the hot path — every agent action hits it, latency
matters, it should do one job only (evaluate + log). The admin API is for humans configuring
policy and watching the dashboard — different traffic pattern, different concerns. Splitting them
means the hot path never gets slowed down by a dashboard doing a heavy audit-log query.

**Why OPA as a sidecar, not embedded:** this is how OPA is used in real production systems —
services call it over HTTP as a decoupled policy engine, so policies can be updated without
redeploying the gateway. It's also an honest, defensible interview point: "I used OPA the way
Netflix/real companies do, not a toy reimplementation."

---

## 4. Data Flow — End to End (locked)

```
1. Agent (simulated) → POST /gateway/action { agentId, action, amount, context }
2. gateway-service checks Redis:
     - agent revoked?          → if yes, DENY immediately, skip OPA
     - fleet kill switch on?   → if yes, DENY immediately, skip OPA
3. gateway-service → POST to OPA sidecar with agent's policy bundle + action context
     - OPA returns: allow | deny | shadow (log-only, don't enforce)
4. If OPA allows: gateway-service checks Redis spend counters
     (per-transaction cap, hourly cap, daily cap — sliding window)
     - within caps  → proceed
     - over cap     → DENY, note reason
5. Verdict + full context appended to audit_log (MySQL, hash-chained)
6. If allowed → mock-execute the action (no real bank integration — logged as executed)
   If denied  → return denial + reason to the agent
7. Dashboard (admin-service) polls/streams: live agents, spend vs. caps, audit feed
```

**Fail-closed rule (locked):** any unreachable dependency (OPA down, Redis down, MySQL down)
results in an automatic **DENY**, logged as a system-fault denial — never a silent allow.

---

## 5. Data Model

### MySQL — `agents`
```sql
CREATE TABLE agents (
  id            VARCHAR(36) PRIMARY KEY,      -- UUID
  name          VARCHAR(100) NOT NULL,        -- e.g. "PaymentsBot"
  agent_type    VARCHAR(50) NOT NULL,         -- payments | servicing | travel
  status        ENUM('active','revoked') DEFAULT 'active',
  policy_id     VARCHAR(36) NOT NULL,         -- FK to policies
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### MySQL — `spend_caps` (config; live counters live in Redis)
```sql
CREATE TABLE spend_caps (
  agent_id        VARCHAR(36) PRIMARY KEY,
  per_txn_cap     DECIMAL(12,2) NOT NULL,
  hourly_cap      DECIMAL(12,2) NOT NULL,
  daily_cap       DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### MySQL — `audit_log` (append-only, hash-chained)
```sql
CREATE TABLE audit_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  agent_id      VARCHAR(36) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  amount        DECIMAL(12,2),
  verdict       ENUM('allow','deny','shadow') NOT NULL,
  reason        VARCHAR(255),
  context       JSON,
  prev_hash     CHAR(64) NOT NULL,   -- hash of the previous row
  row_hash      CHAR(64) NOT NULL,   -- SHA-256(prev_hash + this row's content)
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- No UPDATE or DELETE permission granted on this table at the DB user level.
```

**Why hash-chaining:** each row's `row_hash` is `SHA256(prev_hash + agent_id + action + verdict +
timestamp)`. If any historical row is edited, every subsequent hash breaks — this is what makes
the ledger "tamper-evident" without needing a blockchain. A verification script can walk the
chain and prove nothing was altered. Cheap to build, strong interview differentiator.

**Concurrency fix (locked):** audit writes are wrapped in a DB transaction that locks the last row
(`SELECT ... FOR UPDATE`) before computing the next `prev_hash`. Without this, two concurrent
requests could both read the same "last row" and write two entries claiming the same `prev_hash`,
forking the chain. Serializing writes this way is cheap and closes a real correctness bug.

### Redis keys
```
kill:global                          → "1" if fleet-wide stop is active
kill:agent:{agentId}                 → "1" if this agent is individually revoked
spend:{agentId}:hourly               → sliding window counter
spend:{agentId}:daily                → sliding window counter
```

---

## 6. Policy Model (OPA / Rego) — LOCKED

```
Each agent has one policy bundle (Rego). Policy answers:
  - allowed_actions: []              e.g. ["issue_refund", "adjust_limit"]
  - max_single_action_amount
  - mode: "enforce" | "shadow"       shadow = evaluate + log, never block

Shadow mode use case: test a new/tightened policy against real traffic
without risking false denials in production — decision is logged as
verdict="shadow" and does not affect the actual allow/deny outcome.
```

**Why shadow mode matters for the story:** it's the same pattern real companies use to safely
roll out policy changes — you can prove a new policy's effect on real traffic before it's allowed
to block anything.

---

## 7. Risk-Adaptive Caps (rule-based, NOT ML) — LOCKED

```
No trained model. Explicit rule:
  IF agent's spend rate in the last 10 min > 2x its trailing 1-hour average
  THEN temporarily halve its hourly/daily cap until an operator reviews it
  AND log this auto-adjustment as its own audit_log entry (verdict="deny" going forward
      until cap is manually restored or window resets)
```

This is intentionally simple and fully explainable — no black box, no unverifiable accuracy
claims. Framed as "rule-based risk adjustment," not "anomaly detection."

---

## 8. Security — LOCKED

Governance logic alone isn't a security story — this section covers hardening the layer itself,
since "how strong is this" means "what stops someone from bypassing or attacking FORGE."

```
1. Agent request signing (HMAC, not static keys)
   - Each agent has a per-agent secret
   - Every request signed: HMAC(secret, method + path + timestamp + nonce + body)
   - Gateway verifies signature, timestamp within 30s window, nonce not reused
   - Why: a leaked static key = permanent full access forever. Signing + nonce
     stops replay attacks and makes a compromised secret rotatable without
     silently trusting old captured requests.

2. Key rotation
   - Agents can have 2 active secrets during a rotation window (old + new)
   - Old secret expires after rotation window closes
   - Why: a credential that can never rotate is a standing liability.

3. Gateway-level rate limiting (Redis, per agent-key AND per IP)
   - Independent of OPA's allow/deny decision
   - Why: even a request OPA would deny still costs CPU/DB time to evaluate.
     A compromised or buggy agent hammering the gateway is a DoS risk on FORGE
     itself, not just a policy violation.

4. Policy bundle integrity check
   - OPA policy bundle is signed; gateway verifies the signature/hash on load
     and on each reload
   - Why: if an attacker gets write access to the policy files, they could
     quietly grant themselves permissions. This detects tampering before a
     bad policy is ever evaluated.

5. Operator action audit (not just agent decisions)
   - Every kill-switch trigger, agent revoke, and policy change is written to
     the SAME hash-chained audit_log, tagged actor_type = "operator"
   - Why: "who changed the rules" must be as provable as "what did the agent do."

6. Periodic hash-chain anchoring
   - Every N audit entries (e.g. 100), the current row_hash is written to an
     external, operator-controlled location (signed log file / emailed digest)
   - Why: hash-chaining alone only proves rows weren't edited in place. A full
     DB compromise could regenerate an entirely new, self-consistent chain from
     scratch. External anchoring is the honest answer to "what stops that."

7. Fail-closed (already locked in §4) reinforced here:
   - OPA, Redis, or MySQL unreachable → deny by default, logged as a
     system-fault denial, never a silent allow.
```

**Interview answer for "how strong is this":** *"The governance logic itself — permissions,
caps, kill switch, audit — is only half the story. I also hardened the layer against attacks on
itself: signed, replay-resistant agent requests with rotation, rate limiting so a compromised
agent can't DoS the gateway, integrity checks on the policies themselves, operator actions logged
in the same tamper-evident ledger as agent actions, and periodic external anchoring so even a
full database compromise can't silently rewrite history."*

### Testing (locked)
At least one test per service (same philosophy as LOGPULSE). Non-negotiable test: a script that
tampers with a historical audit_log row and asserts the hash-chain verification fails — this is
the proof the tamper-evidence claim is real, not just asserted.

### Known limitations (state these upfront, don't get caught by them)
```
- Risk-adaptive caps are rule-based, not a trained model — explicitly out of scope for v1.
- Fleet is simulated (script-fired requests), not real LangChain agents or bank APIs.
- Hash-chain anchoring happens every N entries — rows between anchors have a narrower
  (not zero) tamper-evidence window until the next anchor.
- Single gateway instance assumed; OPA sidecar scaling beyond one instance not addressed.
- Agent secret bootstrapping/distribution is out of scope — simulator hardcodes secrets.
```
Naming these clearly is a strength, not a weakness — it shows you know exactly where the
prototype's edges are.

---

## 9. Frontend — Operator Dashboard (locked)

| Page | Shows |
|---|---|
| Fleet overview | All agents, status (active/revoked), live spend vs. cap per agent |
| Agent detail | Policy summary, spend burn-down chart (Recharts), per-agent kill switch |
| Audit feed | Live-scrolling verdict log, filterable by agent/verdict |
| Fleet control | The big "emergency stop" button (fleet-wide kill switch) |

Tech: React + TailwindCSS + Recharts, Zustand for state (same choices as LOGPULSE, reused
knowledge).

---

## 10. Auth (locked)

```
Operator login  → Email + password, JWT (15 min access token), same pattern as LOGPULSE
Agent auth      → HMAC-signed requests using a per-agent secret (see §8) — not a
                   static bearer key. Secret supports 2-key rotation window.
```

---

## 11. Deployment — LOCKED

```
frontend        → Vercel
admin-service   → Render
gateway-service → Render
opa (sidecar)   → Render (separate service, internal networking)
MySQL           → Render or PlanetScale free tier
Redis           → Upstash free tier
```

Docker Compose used for local dev (all 6 pieces: gateway, admin, opa, mysql, redis, frontend);
same containers deploy to the above free-tier hosts.

### Monorepo structure
```
forge/
├── services/
│   ├── gateway-service/   (Node)   src/{routes,opa-client,redis-client,ledger}
│   └── admin-service/     (Node)   src/{routes,middleware,models,auth}
├── policies/              (Rego)   per-agent-type.rego
├── frontend/               (React) see §8
├── fleet-simulator/         (Node) simulate.js — the "agent goes rogue" demo script
├── infra/
│   ├── docker-compose.yml
│   └── opa/ (policy bundle mount)
├── .env.example
└── README.md
```

---

## 12. Decision Log Summary

| # | Area | Decision |
|---|---|---|
| 1 | Service split | gateway-service (hot path) + admin-service (dashboard API) |
| 2 | Policy engine | OPA as Docker sidecar, called over HTTP |
| 3 | Audit storage | MySQL, hash-chained append-only ledger |
| 4 | Live counters | Redis, sliding window per agent |
| 5 | ML/anomaly detection | Explicitly excluded — rule-based risk adjustment only |
| 6 | Failure mode | Fail closed on any dependency outage |
| 7 | Shadow mode | Policies can run in evaluate-only mode before enforcement |
| 8 | Kill switch | Per-agent + fleet-wide, both via Redis flags checked pre-OPA |
| 9 | Auth | JWT for operators; HMAC-signed, rotatable requests for agents |
| 10 | Agent request security | HMAC signing + timestamp/nonce — replay-resistant |
| 11 | Gateway self-protection | Redis rate limiting per agent-key + IP, independent of OPA verdict |
| 12 | Policy integrity | Signed OPA policy bundle, verified on load/reload |
| 13 | Operator audit | Kill-switch/revoke/policy-change actions logged in same ledger as agent actions |
| 14 | Ledger tamper-proofing | Hash-chained rows + periodic external anchoring every N entries |
| 15 | Deployment | Vercel (frontend) + Render (services/OPA) + Upstash (Redis) |
| 16 | Demo | Fleet simulator scripts a rogue agent → auto cap-tighten → operator kill switch → audit replay |

---

## 13. Current Progress

```
[x] Repo scaffolded, Docker Compose skeleton
[x] MySQL schema + migrations (incl. audit_log hash-chain columns + ledger_head table)
[x] OPA policies written (payments, servicing, travel agent types) — bundle signing deferred
[x] gateway-service: HMAC verification, OPA call, Redis checks, audit write — rate limiting deferred
[x] admin-service: agent CRUD, auth, audit query API, kill-switch/revoke endpoints, operator-action logging
[ ] fleet-simulator: 3 mock agents + rogue-agent demo script
[ ] frontend: fleet overview, agent detail, audit feed, kill switch
[ ] Hash-chain verification script + periodic anchoring job
[ ] Deploy to Vercel/Render/Upstash
[ ] README + demo video
```

**Suggested build order:** MySQL schema → OPA policies (Rego basics) + bundle signing →
gateway-service core loop (HMAC verify → kill-switch check → OPA → Redis caps → audit write) →
rate limiting → admin-service CRUD + auth + operator audit → fleet-simulator → frontend →
hash-chain verification/anchoring script → deploy → demo video.

### What's actually built and tested so far (as of Day 2)
- **gateway-service**: full request loop (kill-switch → agent lookup → per-txn cap → OPA →
  hourly/daily spend caps → hash-chained audit write) — verified end-to-end for all 3 agent
  types with real signed requests, not just unit-level checks.
- **HMAC signing**: request signing, replay protection (nonce + timestamp window), signature
  verification against current/previous secret — all verified with real attack-scenario tests
  (replay, wrong secret).
- **admin-service**: operator signup/login (JWT), fleet kill switch + resume, per-agent
  revoke/restore, paginated audit query with filters, agent CRUD (list/detail/create with
  server-generated secrets). Verified working cross-service with gateway-service via shared
  Redis — an operator action in admin-service was proven to immediately affect gateway-service
  behavior, running as a fully separate process.
- **Ledger concurrency fix**: `ledger_head` table added (not in the original sketch) to resolve
  a real privilege conflict — `SELECT ... FOR UPDATE` on `audit_log` requires MySQL's UPDATE
  privilege, which would have broken the "no UPDATE on audit_log" tamper-evidence guarantee.
  Locking a separate mutable `ledger_head` row instead preserves both guarantees.

### Known environment gotchas (Mac-specific, worth remembering)
- **Port 5000 conflicts with macOS AirPlay Receiver** (`Server: AirTunes` in response headers is
  the tell). admin-service uses port **5050** instead, everywhere (code, .env, docker-compose).
- **A local Homebrew Redis on port 6379 can silently shadow the Docker Redis container** — both
  bind to `localhost:6379`, and whichever started first wins. Run `brew services stop redis`
  once, permanently, to avoid this. This caused a real debugging session (Node client saw `null`
  for keys that `redis-cli` confirmed existed) before being traced to two separate Redis servers.

All decisions above are locked. Flag anything that needs to change so it can be re-locked with
the same precision.
