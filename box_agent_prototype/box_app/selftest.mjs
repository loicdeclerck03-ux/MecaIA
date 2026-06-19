// selftest.mjs — Valide les décodeurs OBD avec des trames ELM327 simulées (aucun matériel requis).
import { decodePid, decodeDtcs, decodeMonitors } from "./obd_pids.mjs";

let ok = 0, ko = 0;
const eq = (label, got, exp) => { const pass = got === exp; console.log(`${pass ? "✅" : "❌"} ${label} → ${got}${pass ? "" : "  (attendu: " + exp + ")"}`); pass ? ok++ : ko++; };

eq("RPM 41 0C 1A F8", decodePid("RPM", "41 0C 1A F8"), "RPM = 1726 tr/min");
eq("SPEED 41 0D 50", decodePid("SPEED", "41 0D 50"), "SPEED = 80 km/h");
eq("COOLANT 41 05 5A", decodePid("COOLANT", "41 05 5A"), "COOLANT = 50 °C");
eq("MAF 41 10 07 D0", decodePid("MAF", "41 10 07 D0"), "MAF = 20.0 g/s");
eq("LOAD 41 04 7F", decodePid("ENGINE_LOAD", "41 04 7F"), "ENGINE_LOAD = 50 %");
eq("FT_LONG 41 07 90", decodePid("FUEL_TRIM_LONG", "41 07 90"), "FUEL_TRIM_LONG = 12.5 %");
eq("THROTTLE 41 11 33", decodePid("THROTTLE", "41 11 33"), "THROTTLE = 20 %");
eq("CMV 41 42 39 D0", decodePid("CONTROL_MODULE_VOLTAGE", "41 42 39 D0"), "CONTROL_MODULE_VOLTAGE = 14.80 V");
eq("BOOST (mfr)", decodePid("BOOST", "x"), "BOOST = (donnée constructeur — UDS Mode 0x22, Phase 3)");
eq("DTC 03", decodeDtcs("43 01 33 01 71").join(","), "P0133,P0171");
eq("DTC 07 pending", decodeDtcs("47 03 00", 0x47).join(","), "P0300");
eq("DTC 0A vide", decodeDtcs("4A 00 00", 0x4A).join(","), "");
eq("Monitors MIL on", decodeMonitors("41 01 83 07 65 00"), "MIL : ALLUMÉ · 3 défaut(s) confirmé(s). (détail readiness brut: 7 65 0)");

console.log(`\n${ok} OK / ${ko} KO`);
process.exit(ko ? 1 : 0);
