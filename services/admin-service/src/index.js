require("dotenv").config({ path: "../../../.env" });
const express = require("express");
const authRoutes = require("./auth/routes");
const controlRoutes = require("./routes/control");
const auditRoutes = require("./routes/audit");
const agentRoutes = require("./routes/agents");
const { requireAuth } = require("./middleware/requireAuth");

const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

app.use(helmet());

const allowedFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        origin === allowedFrontendUrl ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded", retryAfter: "60s" },
});

app.use(adminLimiter);

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
