// bmw_probe.mjs — EXPLORATION Phase 3 (lecture seule) : teste la lecture UDS 0x19 (ReadDTCInformation)
// sur les calculateurs physiques 7E0..7E7 d'une BMW (protocole CAN 11-bit). Affiche les réponses brutes.
// Service 19 02 AF = reportDTCByStatusMask, masque AF (confirmés + en attente + test échoué).
// AUCUNE écriture. Sûr.

import { ObdSerial } from "./obd_serial.mjs";

const PORT = process.argv[2] || "COM5";
const o = new ObdSerial(PORT);

function decodeUdsDtcs(resp) {
  const bytes = ((resp || "").toUpperCase().match(/[0-9A-F]{2}/g) || []).map(x => parseInt(x, 16));
  const i = bytes.indexOf(0x59); if (i < 0) return null;            // 59 = réponse positive à 0x19
  // 59 02 <mask> puis groupes de 4 octets : 3 octets DTC + 1 octet statut
  const data = bytes.slice(i + 3); const codes = [];
  for (let k = 0; k + 3 < data.length; k += 4) {
    const a = data[k], b = data[k + 1], c = data[k + 2], st = data[k + 3];
    if (a === 0 && b === 0 && c === 0) continue;
    const L = ["P", "C", "B", "U"][(a & 0xC0) >> 6];
    const code = L + ((a & 0x30) >> 4) + (a & 0x0F).toString(16) + b.toString(16).padStart(2, "0") + c.toString(16).padStart(2, "0");
    codes.push(code.toUpperCase() + "(st:" + st.toString(16) + ")");
  }
  return codes;
}

try {
  console.log(`Connexion ${PORT}...`); await o.open();
  console.log("Protocole :", o.proto, "\n");
  const targets = [["7E0", "7E8"], ["7E1", "7E9"], ["7E2", "7EA"], ["7E3", "7EB"], ["7E4", "7EC"], ["7E5", "7ED"], ["7E6", "7EE"], ["7E7", "7EF"]];
  for (const [req, rsp] of targets) {
    await o.cmd("ATSH" + req); await o.cmd("ATCRA" + rsp);
    const raw = await o.cmd("1902AF", 6000);
    const dec = decodeUdsDtcs(raw);
    console.log(`Module ${req}: ` + (dec === null ? "(pas de réponse UDS / " + JSON.stringify(raw) + ")" : (dec.length ? dec.join(", ") : "0 défaut")));
  }
  await o.cmd("ATCRA"); // reset filtre
  console.log("\nOK exploration UDS powertrain.");
} catch (e) { console.error("ECHEC :", e.message); }
finally { o.close(); }
