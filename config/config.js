require("dotenv").config();

module.exports = {
  development: {
    dialect: "sqlite",
    storage: "db/database.sqlite",
  },
  production: {
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE,
    host: process.env.DATABASE_SERVER,
    port: parseInt(process.env.DATABASE_PORT, 10) || 3306,
    dialect: "mysql",
  },
};
