// obd_pids.mjs — Table des PIDs OBD-II (Mode 01) + décodeurs DTC / PID / readiness.
// Norme SAE J1979. Fonctions PURES (testables sans matériel — voir selftest.mjs).
// Les PIDs marqués mfr:true ne sont PAS en OBD générique → UDS Mode 0x22 propre à la marque (Phase 3).

const u16 = (b, i = 0) => b[i] * 256 + b[i + 1];

// name → { cmd, hdr (octets d'entête réponse "41 XX"), n (octets data), fn(data)->valeur+unité }
export const PID_TABLE = {
  RPM:            { cmd: "010C", hdr: "410C", n: 2, fn: b => (u16(b) / 4).toFixed(0) + " tr/min" },
  SPEED:          { cmd: "010D", hdr: "410D", n: 1, fn: b => b[0] + " km/h" },
  COOLANT:        { cmd: "0105", hdr: "4105", n: 1, fn: b => (b[0] - 40) + " °C" },
  INTAKE_TEMP:    { cmd: "010F", hdr: "410F", n: 1, fn: b => (b[0] - 40) + " °C" },
  AMBIENT_TEMP:   { cmd: "0146", hdr: "4146", n: 1, fn: b => (b[0] - 40) + " °C" },
  OIL_TEMP:       { cmd: "015C", hdr: "415C", n: 1, fn: b => (b[0] - 40) + " °C" },
  ENGINE_LOAD:    { cmd: "0104", hdr: "4104", n: 1, fn: b => (b[0] * 100 / 255).toFixed(0) + " %" },
  THROTTLE:       { cmd: "0111", hdr: "4111", n: 1, fn: b => (b[0] * 100 / 255).toFixed(0) + " %" },
  MAF:            { cmd: "0110", hdr: "4110", n: 2, fn: b => (u16(b) / 100).toFixed(1) + " g/s" },
  MAP:            { cmd: "010B", hdr: "410B", n: 1, fn: b => b[0] + " kPa" },
  FUEL_TRIM_SHORT:{ cmd: "0106", hdr: "4106", n: 1, fn: b => (((b[0] - 128) * 100) / 128).toFixed(1) + " %" },
  FUEL_TRIM_LONG: { cmd: "0107", hdr: "4107", n: 1, fn: b => (((b[0] - 128) * 100) / 128).toFixed(1) + " %" },
  FUEL_LEVEL:     { cmd: "012F", hdr: "412F", n: 1, fn: b => (b[0] * 100 / 255).toFixed(0) + " %" },
  FUEL_PRESSURE:  { cmd: "010A", hdr: "410A", n: 1, fn: b => (b[0] * 3) + " kPa" },
  RAIL_PRESSURE:  { cmd: "0123", hdr: "4123", n: 2, fn: b => (u16(b) * 10) + " kPa" },
  O2_VOLTAGE:     { cmd: "0114", hdr: "4114", n: 2, fn: b => (b[0] / 200).toFixed(2) + " V" },
  LAMBDA:         { cmd: "0124", hdr: "4124", n: 4, fn: b => ((u16(b) / 65536) * 2).toFixed(3) + " λ" },
  TIMING_ADVANCE: { cmd: "010E", hdr: "410E", n: 1, fn: b => (b[0] / 2 - 64).toFixed(1) + " °" },
  COMMANDED_EGR:  { cmd: "012C", hdr: "412C", n: 1, fn: b => (b[0] * 100 / 255).toFixed(0) + " %" },
  EGR_CMD:        { cmd: "012C", hdr: "412C", n: 1, fn: b => (b[0] * 100 / 255).toFixed(0) + " %" },
  CATALYST_TEMP:  { cmd: "013C", hdr: "413C", n: 2, fn: b => (u16(b) / 10 - 40).toFixed(0) + " °C" },
  CONTROL_MODULE_VOLTAGE: { cmd: "0142", hdr: "4142", n: 2, fn: b => (u16(b) / 1000).toFixed(2) + " V" },
  BATTERY:        { cmd: "ATRV", hdr: "", n: 0, fn: () => "(tension via ATRV)" }, // lecture spéciale
  DISTANCE_WITH_MIL: { cmd: "0121", hdr: "4121", n: 2, fn: b => u16(b) + " km" },
  EVAP_PRESSURE:  { cmd: "0132", hdr: "4132", n: 2, fn: b => { let v = u16(b); if (v > 32767) v -= 65536; return (v / 4).toFixed(0) + " Pa"; } },
  // Manufacturer / module — pas en générique → UDS Mode 0x22 par marque (Phase 3)
  BOOST:          { mfr: true }, EGT: { mfr: true }, DPF_DIFF_PRESSURE: { mfr: true },
  KNOCK_RETARD:   { mfr: true }, ABS_WHEEL_SPEED: { mfr: true },
};

// Extrait les octets de données d'une réponse ELM (ex "41 0C 1A F8" + hdr "410C" → [0x1A,0xF8]).
function dataBytes(resp, hdr) {
  const hex = (resp || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  const i = hex.indexOf(hdr.toUpperCase());
  if (i < 0) return null;
  const after = hex.slice(i + hdr.length);
  const out = []; for (let k = 0; k + 1 < after.length; k += 2) out.push(parseInt(after.substr(k, 2), 16));
  return out;
}

export function decodePid(name, resp) {
  const p = PID_TABLE[name];
  if (!p) return `${name} = (PID inconnu)`;
  if (p.mfr) return `${name} = (donnée constructeur — UDS Mode 0x22, Phase 3)`;
  if (name === "BATTERY") { const m = (resp || "").match(/([0-9]+\.[0-9]+)V/i); return "BATTERY = " + (m ? m[1] + " V" : "(ATRV: " + resp + ")"); }
  const b = dataBytes(resp, p.hdr);
  if (!b || b.length < p.n) return `${name} = n/a (${resp})`;
  return `${name} = ${p.fn(b)}`;
}

// Décode une réponse DTC (mode 03 → 0x43, 07 → 0x47, 0A → 0x4A).
export function decodeDtcs(resp, modeByte = 0x43) {
  const bytes = ((resp || "").toUpperCase().match(/[0-9A-F]{2}/g) || []).map(x => parseInt(x, 16));
  const i = bytes.indexOf(modeByte); if (i < 0) return [];
  const data = bytes.slice(i + 1); const codes = [];
  for (let k = 0; k + 1 < data.length; k += 2) {
    const a = data[k], b = data[k + 1]; if (a === 0 && b === 0) continue;
    const L = ["P", "C", "B", "U"][(a & 0xC0) >> 6];
    codes.push((L + ((a & 0x30) >> 4) + (a & 0x0F).toString(16) + ((b & 0xF0) >> 4).toString(16) + (b & 0x0F).toString(16)).toUpperCase());
  }
  return codes;
}

// Décode 0101 (état MIL + nb DTC + monitors).
export function decodeMonitors(resp) {
  const b = dataBytes(resp, "4101");
  if (!b || b.length < 4) return "Moniteurs : réponse illisible (" + resp + ")";
  const mil = (b[0] & 0x80) ? "ALLUMÉ" : "éteint";
  const count = b[0] & 0x7F;
  return `MIL : ${mil} · ${count} défaut(s) confirmé(s). (détail readiness brut: ${b.slice(1).map(x => x.toString(16)).join(" ")})`;
}
