// simulate.js -- FORGE Fleet Simulator (CLAUDE.md §3 / §13)
//
// Simulates 3 agents (payments, servicing, travel) firing signed requests
// at the gateway-service. Demonstrates:
//   1. Valid allowed actions.
//   2. Actions denied by OPA policies.
//   3. Actions denied by per-transaction caps.
//   4. A rogue agent overspending scenario (violates sliding window hourly cap).

const axios = require("axios");
const { signRequest } = require("./sign-request");

const ADMIN_URL = process.env.ADMIN_URL || "http://localhost:5050";
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:4000";

// Operator credentials for admin-service setup
const OPERATOR_EMAIL = "operator@forge.local";
const OPERATOR_PASSWORD = "forgepassword123";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Signs and sends an action request to the gateway
async function sendGatewayAction(agent, action, amount) {
  const method = "POST";
  const path = "/gateway/action";
  const body = { action, amount };
  
  const signed = signRequest(agent.secret, agent.id, method, path, body);

  try {
    const res = await axios.post(`${GATEWAY_URL}${path}`, body, {
      headers: signed.headers,
    });
    console.log(`  [ALLOW] Agent: ${agent.name} | Action: ${action} | Amount: $${amount} | Status: ${res.status}`);
    return { allowed: true, data: res.data };
  } catch (err) {
    if (err.response) {
      console.log(`  [DENY]  Agent: ${agent.name} | Action: ${action} | Amount: $${amount} | Status: ${err.response.status} | Reason: ${err.response.data.reason}`);
      return { allowed: false, reason: err.response.data.reason };
    } else {
      console.error(`  [ERROR] Failed to send action: ${err.message}`);
      return { allowed: false, error: err.message };
    }
  }
}

async function run() {
  console.log("=========================================================");
  console.log("FORGE -- Fleet Simulator & Demo");
  console.log("=========================================================\n");

  // Step 1: Operator signup / login
  console.log("[1] Authenticating operator with admin-service...");
  let token;
  try {
    // Attempt signup
    await axios.post(`${ADMIN_URL}/auth/signup`, {
      email: OPERATOR_EMAIL,
      password: OPERATOR_PASSWORD,
    });
    console.log("  Operator signed up successfully.");
  } catch (err) {
    if (err.response && err.response.status === 409) {
      console.log("  Operator already exists, proceeding to login.");
    } else {
      console.error(`  Signup error: ${err.message}`);
    }
  }

  try {
    const loginRes = await axios.post(`${ADMIN_URL}/auth/login`, {
      email: OPERATOR_EMAIL,
      password: OPERATOR_PASSWORD,
    });
    token = loginRes.data.token;
    console.log("  Operator logged in. Token acquired.");
  } catch (err) {
    console.error(`  Fatal: Login failed: ${err.message}`);
    process.exit(1);
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  // Step 2: Register 3 mock agents
  console.log("\n[2] Registering mock agents via admin-service...");
  const agentConfigs = [
    {
      name: "PaymentsBot-Sim",
      agentType: "payments",
      perTxnCap: 100.00,
      hourlyCap: 300.00,
      dailyCap: 1000.00,
    },
    {
      name: "ServicingBot-Sim",
      agentType: "servicing",
      perTxnCap: 50.00,
      hourlyCap: 200.00,
      dailyCap: 500.00,
    },
    {
      name: "TravelBot-Sim",
      agentType: "travel",
      perTxnCap: 200.00,
      hourlyCap: 500.00,
      dailyCap: 1500.00,
    },
  ];

  const agents = {};
  for (const config of agentConfigs) {
    try {
      const res = await axios.post(`${ADMIN_URL}/agents`, config, {
        headers: authHeaders,
      });
      agents[config.agentType] = {
        id: res.data.id,
        name: res.data.name,
        secret: res.data.secret,
      };
      console.log(`  Registered ${config.name} (ID: ${res.data.id})`);
    } catch (err) {
      console.error(`  Error registering agent ${config.name}: ${err.message}`);
      process.exit(1);
    }
  }

  // Step 3: Run normal valid actions
  console.log("\n[3] Simulating normal, policy-compliant actions...");
  await sendGatewayAction(agents.payments, "issue_refund", 45.00);
  await sendGatewayAction(agents.servicing, "reverse_fee", 15.00);
  await sendGatewayAction(agents.travel, "rebook_flight", 120.00);
  
  // Step 4: OPA Policy violations
  console.log("\n[4] Simulating actions that violate OPA Policies (should be denied)...");
  // PaymentsBot trying to reverse a fee (not in its allowed actions)
  await sendGatewayAction(agents.payments, "reverse_fee", 20.00);
  // TravelBot trying to rebook flight above its single action limit ($800)
  await sendGatewayAction(agents.travel, "rebook_flight", 950.00);

  // Step 5: Per-transaction cap violation
  console.log("\n[5] Simulating actions exceeding per-transaction cap (should be denied)...");
  // PaymentsBot txn cap is $100
  await sendGatewayAction(agents.payments, "issue_refund", 150.00);

  // Step 6: Rogue Agent Overspends Scenario (Sliding-window hourly cap violation)
  console.log("\n[6] DEMO: Scripted 'Rogue Agent Overspends' Scenario...");
  console.log("  PaymentsBot-Sim (hourly cap: $300) starts spamming transactions...");
  
  // Send 5 transactions of $80.00 each.
  // 1st: $80 (Allow) -> total $80
  // 2nd: $80 (Allow) -> total $160
  // 3rd: $80 (Allow) -> total $240
  // 4th: $80 (Allow) -> total $320 (exceeds $300 cap, should Deny!)
  // 5th: $80 (Deny)
  for (let i = 1; i <= 5; i++) {
    console.log(`  Attempt ${i}: Sending $80.00 refund request...`);
    const res = await sendGatewayAction(agents.payments, "issue_refund", 80.00);
    if (!res.allowed) {
      console.log(`  -> Rogue activity stopped successfully at attempt ${i}!`);
    }
    await sleep(200);
  }

  console.log("\n=========================================================");
  console.log("Demo Complete!");
  console.log("=========================================================");
}

run().catch((err) => {
  console.error("Simulator failed:", err);
});
