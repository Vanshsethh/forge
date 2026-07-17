require("dotenv").config({ path: "../../../.env" });
const express = require("express");
const authRoutes = require("./auth/routes");
const controlRoutes = require("./routes/control");
const auditRoutes = require("./routes/audit");
const agentRoutes = require("./routes/agents");
const { requireAuth } = require("./middleware/requireAuth");

const app = express();
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/", controlRoutes);
app.use("/", auditRoutes);
app.use("/", agentRoutes);

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Example protected route — proves the middleware works before we build
// the real agent/kill-switch/audit endpoints on top of it.
app.get("/me", requireAuth, (req, res) => {
  res.json({ operatorId: req.operatorId, email: req.operatorEmail });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`admin-service listening on port ${PORT}`);
});
