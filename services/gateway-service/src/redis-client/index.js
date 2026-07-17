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

// Sliding-window spend check. Uses Redis INCRBYFLOAT + TTL as a simple sliding
// window: the counter resets automatically after `windowSeconds` of inactivity
// from the FIRST increment in that window. This is an approximation of a true
// sliding window (a sorted-set approach would be exact) but is far simpler and
// good enough for this prototype's demo scenarios.
async function checkAndIncrementSpend(agentId, amount, windowSeconds, cap) {
  const key = `spend:${agentId}:${windowSeconds}`;
  const current = await redis.get(key);
  const currentTotal = current ? parseFloat(current) : 0;

  if (currentTotal + amount > cap) {
    return { withinCap: false, currentTotal, cap };
  }

  const newTotal = await redis.incrbyfloat(key, amount);
  // Only set expiry if this is the first increment in the window (key was just created).
  if (currentTotal === 0) {
    await redis.expire(key, windowSeconds);
  }
  return { withinCap: true, currentTotal: parseFloat(newTotal), cap };
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
