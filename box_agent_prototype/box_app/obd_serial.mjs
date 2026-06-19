// obd_serial.mjs — Connexion RÉELLE à un adaptateur OBD (ELM327 / OBDLink MX+) via port COM Bluetooth.
// Couche de LECTURE complète (norme J1979). Connexion robuste (warm-up multi-essais). Écritures UDS = Phase 3.

import { PID_TABLE, decodePid, decodeDtcs, decodeMonitors } from "./obd_pids.mjs";

function decodeVin(raw) {
  const ascii = ((raw || "").toUpperCase().match(/[0-9A-F]{2}/g) || []).map(h => String.fromCharCode(parseInt(h, 16))).join("");
  const m = ascii.match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : null;
}

export class ObdSerial {
  constructor(path, baudRate = Number(process.env.OBD_BAUD || 115200)) { this.path = path; this.baudRate = baudRate; this.buf = ""; this.proto = null; }
  async open() {
    let SerialPort;
    try { ({ SerialPort } = await import("serialport")); }
    catch { throw new Error("Module 'serialport' absent — lance : npm i serialport"); }
    await new Promise((resolve, reject) => {
      this.sp = new SerialPort({ path: this.path, baudRate: this.baudRate }, err => err ? reject(err) : resolve());
      this.sp.on("data", d => { this.buf += d.toString("latin1"); });
    });
    await this.init();
  }
  cmd(c, timeout = 5000) {
    return new Promise((resolve) => {
      this.buf = ""; this.sp.write(c + "\r");
      const t0 = Date.now();
      const iv = setInterval(() => { if (this.buf.includes(">") || Date.now() - t0 > timeout) { clearInterval(iv); resolve(this.buf.replace(/>/g, "").trim()); } }, 40);
    });
  }
  async init() {
    await this.cmd("ATZ", 3000); await this.cmd("ATE0"); await this.cmd("ATL0");
    await this.cmd("ATSP0"); await this.cmd("ATAT1");
    // Warm-up : sur bus lent (K-line ISO 9141 / KWP, ex. BMW E46) la 1re requete declenche la
    // recherche de protocole et renvoie souvent SEARCHING/UNABLE alors que la voiture repond bien.
    await this.cmd("0100", 9000);
    // Detection robuste : connexion validee des qu'UNE requete mode 01 renvoie une trame "41 0x".
    for (let i = 0; i < 6; i++) {
      for (const probe of ["0100", "0101"]) {
        const r = await this.cmd(probe, 7000);
        if (/41\s*0[01]/i.test(r)) { this.proto = (await this.cmd("ATDPN")).replace(/[\r\n>]/g, "").trim(); return; }
      }
    }
    throw new Error("Pas de reponse du vehicule (0100/0101 -> UNABLE). Verifie : CONTACT MIS / moteur tournant, adaptateur bien enfonce, MX+ non utilise par une autre app.");
  }

  async readVin() {
    let r = await this.cmd("0902", 6000);
    if (/SEARCHING|UNABLE|NO DATA|ERROR/i.test(r) || !decodeVin(r)) { await this.cmd("0100", 9000); r = await this.cmd("0902", 6000); }
    const vin = decodeVin(r);
    return vin ? "VIN: " + vin : "VIN: non dispo en generique (sur BMW, lecture par module - Phase 3)";
  }
  async readBattery() { return decodePid("BATTERY", await this.cmd("ATRV")); }
  async readPid(name) {
    const p = PID_TABLE[name];
    if (!p) return `${name} = (PID inconnu)`;
    if (p.mfr) return decodePid(name, "");
    if (name === "BATTERY") return this.readBattery();
    return decodePid(name, await this.cmd(p.cmd));
  }
  async readLive(pids = []) { const out = []; for (const p of pids) out.push(await this.readPid(p)); return out.join("\n"); }
  async readDtcs(mode = "03") { const mb = { "03": 0x43, "07": 0x47, "0A": 0x4A }[mode] || 0x43; return decodeDtcs(await this.cmd(mode), mb); }
  async readMonitors() { return decodeMonitors(await this.cmd("0101")); }
  async readMode06() { const r = await this.cmd("06"); return "Mode 06 (brut): " + r.replace(/[\r\n]+/g, " "); }
  async readFreezeFrame(code) { const r = await this.cmd("0202"); return `Freeze frame ${code || ""} (brut): ` + r.replace(/[\r\n]+/g, " "); }
  // Lecture brute d'un module specifique (base de la Phase 3 BMW) : set header puis requete UDS.
  async rawModule(headerHex, request, timeout = 6000) {
    await this.cmd("ATSH" + headerHex);
    const r = await this.cmd(request, timeout);
    return r.replace(/[\r\n]+/g, " ");
  }
  close() { try { this.sp?.close(); } catch {} }
}

const directRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("obd_serial.mjs");
if (directRun) {
  const PORT = process.argv[2] || process.env.SERIAL_PORT;
  if (!PORT) { console.error("Usage : node obd_serial.mjs COM5"); process.exit(1); }
  const obd = new ObdSerial(PORT);
  try {
    console.log(`Connexion ${PORT}...`); await obd.open();
    console.log("Protocole verrouille :", obd.proto);
    console.log(await obd.readVin());
    console.log("Codes moteur stockes :", (await obd.readDtcs("03")).join(", ") || "(aucun)");
    console.log("Codes en attente :", (await obd.readDtcs("07")).join(", ") || "(aucun)");
    console.log(await obd.readMonitors());
    console.log("Tension :", await obd.readBattery());
    console.log("Live :\n" + await obd.readLive(["RPM", "COOLANT", "MAF", "ENGINE_LOAD", "INTAKE_TEMP"]));
    console.log("OK adaptateur.");
  } catch (e) { console.error("ECHEC :", e.message); }
  finally { obd.close(); }
}
