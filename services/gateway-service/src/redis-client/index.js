const Redis = require("ioredis");

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: 6379,
});

// Fleet-wide kill switch. Checked before anything else on every request.
async function isFleetKilled() {
  const val = await redis.get("kill:global");
  return val === "1";
}

// Per-agent revocation flag.
async function isAgentRevoked(agentId) {
  const val = await redis.get(`kill:agent:${agentId}`);
  return val === "1";
}

// Atomic Lua script for spend check-and-increment. Runs as a single Redis
// command so there is no TOCTOU window between the GET and INCRBYFLOAT.
// Returns ["ok", newTotal] if within cap, or ["over", currentTotal] if not.
// KEYS[1] = the spend counter key
// ARGV[1] = amount to add (as a string float)
// ARGV[2] = cap (as a string float)
// ARGV[3] = window TTL in seconds (used on first increment only)
const SPEND_CHECK_SCRIPT = `
local key    = KEYS[1]
local amount = tonumber(ARGV[1])
local cap    = tonumber(ARGV[2])
local ttl    = tonumber(ARGV[3])

local raw     = redis.call("GET", key)
local current = raw and tonumber(raw) or 0

if current + amount > cap then
  return {"over", tostring(current)}
end

local newTotal = redis.call("INCRBYFLOAT", key, amount)
-- Set expiry only on the first increment so the window starts from the
-- first spend, not from the last one (matches the original behaviour).
if current == 0 then
  redis.call("EXPIRE", key, ttl)
end
return {"ok", newTotal}
`;

// Sliding-window spend check. Uses an atomic Lua script (check + increment in
// one Redis round-trip) so two concurrent requests can never both pass the cap
// check before either has incremented. This is still an approximation of a true
// sliding window (a sorted-set approach would be exact) but is far simpler and
// good enough for this prototype's demo scenarios.
async function checkAndIncrementSpend(agentId, amount, windowSeconds, cap) {
  const key = `spend:${agentId}:${windowSeconds}`;
  const [status, totalStr] = await redis.eval(
    SPEND_CHECK_SCRIPT,
    1,          // number of KEYS arguments
    key,
    amount.toString(),
    cap.toString(),
    windowSeconds.toString()
  );

  if (status === "over") {
    return { withinCap: false, currentTotal: parseFloat(totalStr), cap };
  }
  return { withinCap: true, currentTotal: parseFloat(totalStr), cap };
}

// Replay protection: each signed request must include a unique nonce. We
// record nonces we've seen for a short window (must exceed the timestamp
// tolerance window used during verification) — if the same nonce shows up
// again inside that window, the request is a replay and gets rejected.
async function isNonceReused(agentId, nonce) {
  const key = `nonce:${agentId}:${nonce}`;
  // SET ... NX returns null if the key already existed (i.e. nonce seen before).
  const result = await redis.set(key, "1", "EX", 60, "NX");
  return result === null; // null = already existed = reused
}

module.exports = { redis, isFleetKilled, isAgentRevoked, checkAndIncrementSpend, isNonceReused };
