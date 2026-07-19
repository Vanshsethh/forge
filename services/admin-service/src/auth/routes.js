const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const pool = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRY = "15m"; // matches LOGPULSE's short-lived access token pattern

// Used only when explicitly configured by the local Docker Compose setup.
// Do not set these variables in a deployed environment.
async function ensureDemoOperator() {
  const email = process.env.DEMO_OPERATOR_EMAIL;
  const password = process.env.DEMO_OPERATOR_PASSWORD;
  if (!email || !password) return;

  const [existing] = await pool.query("SELECT id FROM operators WHERE email = ?", [email]);
  if (existing.length > 0) return;

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    "INSERT INTO operators (id, email, password_hash) VALUES (?, ?, ?)",
    [randomUUID(), email, passwordHash]
  );
  console.log(`created local demo operator: ${email}`);
}

router.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const [existing] = await pool.query("SELECT id FROM operators WHERE email = ?", [email]);
  if (existing.length > 0) {
    return res.status(409).json({ error: "operator already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = randomUUID();

  await pool.query(
    "INSERT INTO operators (id, email, password_hash) VALUES (?, ?, ?)",
    [id, email, passwordHash]
  );

  return res.status(201).json({ id, email });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const [rows] = await pool.query("SELECT id, password_hash FROM operators WHERE email = ?", [email]);
  const operator = rows[0];

  // Same generic error whether the email doesn't exist or the password is wrong —
  // prevents leaking which emails are registered.
  if (!operator) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const valid = await bcrypt.compare(password, operator.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const token = jwt.sign({ operatorId: operator.id, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return res.status(200).json({ token, expiresIn: JWT_EXPIRY });
});

module.exports = router;
module.exports.ensureDemoOperator = ensureDemoOperator;
