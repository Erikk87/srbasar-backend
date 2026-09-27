require("dotenv").config();

// sequelize-cli (db:migrate) nutzt dieselbe MySQL/MariaDB-Datenbank wie die App
// (src/config/database.js), unabhängig von NODE_ENV.
const mysql = {
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE,
  host: process.env.DATABASE_SERVER,
  port: parseInt(process.env.DATABASE_PORT, 10) || 3306,
  dialect: "mysql",
};

module.exports = {
  development: mysql,
  production: mysql,
};
