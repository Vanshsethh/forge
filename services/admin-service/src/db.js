const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  user: "forge_app",
  password: "forgeapppass",
  database: "forge",
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
