require("dotenv").config({ path: "../../../.env" });
const express = require("express");
const actionRoute = require("./routes/action");
const { verifyHmac } = require("./routes/verifyHmac");

const app = express();
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
