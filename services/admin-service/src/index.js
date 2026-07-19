require("dotenv").config({ path: "../../../.env" });
const express = require("express");
const authRoutes = require("./auth/routes");
const controlRoutes = require("./routes/control");
const auditRoutes = require("./routes/audit");
const agentRoutes = require("./routes/agents");
const { requireAuth } = require("./middleware/requireAuth");

const app = express();

// The dashboard is served from a different local origin during development.
// Keep the API as the only backend the browser talks to while explicitly
// allowing that dashboard origin to call authenticated admin endpoints.
const allowedFrontendOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedFrontendOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return origin && !allowedFrontendOrigins.includes(origin)
      ? res.sendStatus(403)
      : res.sendStatus(204);
  }
  next();
});
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/", controlRoutes);
app.use("/", auditRoutes);
app.use("/", agentRoutes);

// Example protected route — proves the middleware works before we build
// the real agent/kill-switch/audit endpoints on top of it.
app.get("/me", requireAuth, (req, res) => {
  res.json({ operatorId: req.operatorId, email: req.operatorEmail });
});

const PORT = process.env.PORT || 5050;

async function start() {
  await authRoutes.ensureDemoOperator();
  app.listen(PORT, () => {
    console.log(`admin-service listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("admin-service failed to start", error);
  process.exit(1);
});
