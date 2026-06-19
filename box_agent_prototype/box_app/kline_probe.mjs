// kline_probe.mjs — TEST DE FAISABILITÉ ligne K (E46 / modules DS2). Lecture seule, sûr.
// Force les protocoles K-line (ISO 9141-2, KWP) et tente une init pour voir si la ligne K
// est VIVANTE et atteignable depuis la prise OBD. Si tout est muet → modules sur prise 20 broches (câble dédié).
// NE TUE AUCUN PROCESSUS. Ferme le port proprement en sortie.

import { SerialPort } from "serialport";

const PORT = process.argv[2] || "COM5";
let buf = "";
const sp = new SerialPort({ path: PORT, baudRate: Number(process.env.OBD_BAUD || 115200) }, e => { if (e) { console.error("Open err:", e.message); process.exit(1); } });
sp.on("data", d => { buf += d.toString("latin1"); });
const cmd = (c, t = 5000) => new Promise(res => { buf = ""; sp.write(c + "\r"); const t0 = Date.now(); const iv = setInterval(() => { if (buf.includes(">") || Date.now() - t0 > t) { clearInterval(iv); res(buf.replace(/>/g, "").trim()); } }, 40); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  await sleep(600);
  console.log("ATZ:", JSON.stringify(await cmd("ATZ", 3000)));
  await cmd("ATE0"); await cmd("ATL0");
  console.log("Adaptateur:", JSON.stringify(await cmd("ATI", 2000)));

  // Protocoles K-line à tester : 3=ISO9141-2, 4=KWP 5-baud, 5=KWP fast
  for (const [spn, label] of [["3", "ISO 9141-2"], ["4", "KWP2000 5-baud"], ["5", "KWP2000 fast"]]) {
    await cmd("ATSP" + spn);
    await cmd("ATSP" + spn); // confirme
    const init = await cmd("0100", 12000); // déclenche l'init du bus sur ce protocole
    console.log(`\n[SP${spn} ${label}]`);
    console.log("  0100 ->", JSON.stringify(init));
    if (/BUS INIT|OK|41 00|[0-9A-F]{2} /i.test(init) && !/UNABLE|ERROR|NO DATA|SEARCHING/i.test(init)) {
      console.log("  >>> Ligne K semble RÉPONDRE sur ce protocole !");
    }
  }

  // Bonus : tension batterie (confirme que l'adaptateur vit)
  console.log("\nTension:", JSON.stringify(await cmd("ATRV", 2000)));
  console.log("\nFin test K-line.");
} catch (e) { console.error("ERREUR:", e.message); }
finally { try { sp.close(); } catch {} setTimeout(() => process.exit(0), 300); }
