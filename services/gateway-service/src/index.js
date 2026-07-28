require("dotenv").config({ path: "../../../.env" });
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const actionRoute = require("./routes/action");
const { verifyHmac } = require("./routes/verifyHmac");

const app = express();

app.use(helmet());

const gatewayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.headers["x-agent-id"] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded", retryAfter: "60s" },
});
app.use(gatewayLimiter);

app.use(
  express.json({
    // Capture the exact raw bytes the client sent — needed because HMAC must be
    // verified against exactly what was transmitted, not a re-serialized copy
    // (JSON.stringify(req.body) can differ in key order/spacing from the original).
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

app.use("/gateway", verifyHmac, actionRoute);

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`gateway-service listening on port ${PORT}`);
});
