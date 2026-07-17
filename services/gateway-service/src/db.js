const mysql = require("mysql2/promise");

// A pool (not a single connection) so multiple concurrent requests don't
// block each other waiting for one connection. mysql2 handles queueing.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  user: "forge_app",
  password: "forgeapppass",
  database: "forge",
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
