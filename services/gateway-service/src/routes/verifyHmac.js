const crypto = require("crypto");
const pool = require("../db");
const { isNonceReused } = require("../redis-client");

const TIMESTAMP_TOLERANCE_SECONDS = 30;

// Computes HMAC-SHA256 the same way both the agent (client) and this
// middleware (server) must, so they arrive at matching signatures.
function computeSignature(secret, method, path, timestamp, nonce, rawBody) {
  const payload = `${method}${path}${timestamp}${nonce}${rawBody}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Fetches both the current and previous secret for an agent, so a request
// signed during a key-rotation window (with either key) still verifies.
async function getAgentSecrets(agentId) {
  const [rows] = await pool.query(
    "SELECT secret_current, secret_previous FROM agents WHERE id = ?",
    [agentId]
  );
  return rows[0] || null;
}

// Safe signature comparison — checks length FIRST, since crypto.timingSafeEqual
// throws (rather than returning false) if the two buffers differ in length.
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function verifyHmac(req, res, next) {
  const agentId = req.header("X-Agent-Id");
  const timestamp = req.header("X-Timestamp");
  const nonce = req.header("X-Nonce");
  const signature = req.header("X-Signature");

  if (!agentId || !timestamp || !nonce || !signature) {
    return res.status(401).json({ allowed: false, reason: "missing_auth_headers" });
  }

  // Timestamp freshness check — rejects requests that are too old (or from a
  // clock too far in the future), independent of the nonce check below.
  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);
  if (Number.isNaN(reqTime) || Math.abs(now - reqTime) > TIMESTAMP_TOLERANCE_SECONDS) {
    return res.status(401).json({ allowed: false, reason: "stale_timestamp" });
  }

  // Replay check — same nonce seen before within the tolerance window = reject.
  const reused = await isNonceReused(agentId, nonce);
  if (reused) {
    return res.status(401).json({ allowed: false, reason: "replayed_request" });
  }

  const secrets = await getAgentSecrets(agentId);
  if (!secrets) {
    return res.status(401).json({ allowed: false, reason: "unknown_agent" });
  }

  const rawBody = req.rawBody || "";
  const expectedCurrent = computeSignature(
    secrets.secret_current, req.method, req.originalUrl, timestamp, nonce, rawBody
  );
  const matchesCurrent = safeEqual(signature, expectedCurrent);

  let matchesPrevious = false;
  if (!matchesCurrent && secrets.secret_previous) {
    const expectedPrevious = computeSignature(
      secrets.secret_previous, req.method, req.originalUrl, timestamp, nonce, rawBody
    );
    matchesPrevious = safeEqual(signature, expectedPrevious);
  }

  if (!matchesCurrent && !matchesPrevious) {
    return res.status(401).json({ allowed: false, reason: "invalid_signature" });
  }

  // Verified — attach the authenticated agentId so downstream code trusts
  // THIS value, not whatever was in the request body.
  req.verifiedAgentId = agentId;
  next();
}

module.exports = { verifyHmac };
