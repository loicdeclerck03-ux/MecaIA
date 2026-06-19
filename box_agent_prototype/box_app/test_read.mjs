// test_read.mjs — Validation chronometree de la couche de lecture reelle (sans VIN, point lent sur BMW).
import { ObdSerial } from "./obd_serial.mjs";
const t0 = Date.now();
const T = () => "[" + ((Date.now() - t0) / 1000).toFixed(1) + "s]";
const obd = new ObdSerial(process.argv[2] || "COM5");
(async () => {
  try {
    console.log(T(), "open...");
    await obd.open();
    console.log(T(), "proto verrouille:", obd.proto);
    console.log(T(), "DTC stockes:", (await obd.readDtcs("03")).join(", ") || "(aucun)");
    console.log(T(), "DTC pending:", (await obd.readDtcs("07")).join(", ") || "(aucun)");
    console.log(T(), await obd.readMonitors());
    console.log(T(), await obd.readPid("RPM"));
    console.log(T(), await obd.readPid("COOLANT"));
    console.log(T(), await obd.readPid("ENGINE_LOAD"));
    console.log(T(), await obd.readPid("INTAKE_TEMP"));
    console.log(T(), await obd.readPid("THROTTLE"));
    console.log(T(), "Tension:", await obd.readBattery());
    console.log(T(), "=== DONE ===");
  } catch (e) { console.log(T(), "ECHEC:", e.message); }
  finally { obd.close(); process.exit(0); }
})();
