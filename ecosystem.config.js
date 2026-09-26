const path = require('path');

// ops/deploy.sh setzt beide Pfade explizit; ohne Umgebungsvariablen läuft
// die App direkt aus diesem Verzeichnis (z. B. bei Forks mit eigenem Deployment).
const applicationRoot = process.env.SRBASAR_BACKEND_ROOT || __dirname;
const currentDirectory = process.env.SRBASAR_BACKEND_CURRENT || __dirname;

module.exports = {
  apps: [{
    name: 'srbasar-backend',
    cwd: currentDirectory,
    script: path.join(applicationRoot, 'src/app.js'),
    instances: 2,
    exec_mode: 'cluster',
    watch: false,
    wait_ready: true,
    listen_timeout: 10000,
    kill_timeout: 10000,
    ignore_watch: ['node_modules', 'logs', 'database.sqlite'],
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
