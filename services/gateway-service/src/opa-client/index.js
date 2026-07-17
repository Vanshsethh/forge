const axios = require("axios");

const OPA_URL = process.env.OPA_URL || "http://localhost:8181";

// Calls OPA's decision endpoint for a given agent type (e.g. "payments").
// Returns { allow: boolean } or throws if OPA is unreachable — the caller
// is responsible for treating a thrown error as a fail-closed deny (§4, §8).
async function evaluatePolicy(agentType, action, amount, context = {}) {
  const url = `${OPA_URL}/v1/data/forge/${agentType}/allow`;
  const response = await axios.post(
    url,
    { input: { action, amount, ...context } },
    { timeout: 2000 } // fail fast — a slow OPA should not hang the whole gateway
  );
  // OPA returns { result: true } or { result: false }. If the policy package
  // doesn't exist at all, "result" is undefined — treat that as deny too.
  return response.data.result === true;
}

module.exports = { evaluatePolicy };
