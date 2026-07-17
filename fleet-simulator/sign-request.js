const crypto = require("crypto");
const { randomUUID } = require("crypto");

// Signs a request the exact same way gateway-service's verifyHmac middleware
// expects: HMAC-SHA256 over method + path + timestamp + nonce + raw JSON body.
function signRequest(secret, agentId, method, path, bodyObj) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const rawBody = JSON.stringify(bodyObj);

  const payload = `${method}${path}${timestamp}${nonce}${rawBody}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return {
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": agentId,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
    rawBody,
  };
}

module.exports = { signRequest };
