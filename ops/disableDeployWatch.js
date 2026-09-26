const pm2 = require("pm2");

async function disableDeploymentWatch(client = pm2) {
  await new Promise((resolve, reject) => client.connect((error) => error ? reject(error) : resolve()));
  try {
    const processes = await new Promise((resolve, reject) => client.list((error, apps) => error ? reject(error) : resolve(apps)));
    for (const app of processes.filter((entry) => entry.name === "srbasar-backend")) {
      // Ein alter Watcher kann trotz watch:false im Prozess-Eintrag weiterlaufen.
      // Nur den Watcher schließen; keine Anwendung stoppen oder neu starten.
      await new Promise((resolve, reject) => {
        client.Client.client.call("stopWatch", "stopProcessId", app.pm_id, (error) => error ? reject(error) : resolve());
      });
    }
    console.log("Datei-Wächter für srbasar-backend deaktiviert; Prozesse laufen weiter.");
  } finally {
    client.disconnect();
  }
}

if (require.main === module || process.argv[1] === "-") {
  disableDeploymentWatch().catch(() => {
    console.error("Datei-Wächter konnten nicht deaktiviert werden; Deployment abgebrochen.");
    process.exitCode = 1;
  });
}

module.exports = { disableDeploymentWatch };
