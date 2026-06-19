// probe.mjs — Diagnostic bas niveau de la liaison OBD. Isole "adaptateur OK ?" de "voiture OK ?".
// Usage : node probe.mjs COM5   (option : OBD_BAUD=38400 node probe.mjs COM5)
import { SerialPort } from "serialport";

const PORT = process.argv[2] || "COM5";
const BAUD = Number(process.env.OBD_BAUD || 115200);
const HARD_KILL_MS = 22000;

const log = (...a) => { process.stdout.write(a.join(" ") + "\n"); };
const killer = setTimeout(() => { log("[KILL] timeout dur 22s atteint."); process.exit(7); }, HARD_KILL_MS);

let buf = "";
function cmd(sp, c, timeout = 4000) {
  return new Promise((resolve) => {
    buf = ""; sp.write(c + "\r");
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (buf.includes(">") || Date.now() - t0 > timeout) {
        clearInterval(iv);
        resolve(buf.replace(/\r/g, " ").replace(/>/g, "").trim());
      }
    }, 30);
  });
}

(async () => {
  log(`[OPEN] ${PORT} @ ${BAUD}...`);
  const sp = await new Promise((resolve, reject) => {
    const p = new SerialPort({ path: PORT, baudRate: BAUD }, err => err ? reject(err) : resolve(p));
  }).catch(e => { log("[ECHEC OPEN]", e.message); process.exit(1); });
  sp.on("data", d => { buf += d.toString("latin1"); });
  log("[OPEN] ok\n");

  log("--- NIVEAU ADAPTATEUR (sans la voiture) ---");
  log("ATZ  ->", JSON.stringify(await cmd(sp, "ATZ", 3000)));
  await cmd(sp, "ATE0", 1500);
  log("ATI  ->", JSON.stringify(await cmd(sp, "ATI", 1500)));
  log("ATRV ->", JSON.stringify(await cmd(sp, "ATRV", 1500)));

  log("\n--- NIVEAU VOITURE ---");
  await cmd(sp, "ATSP0", 1500);
  await cmd(sp, "ATAT1", 800);
  log("0100 ->", JSON.stringify(await cmd(sp, "0100", 9000)));
  log("ATDPN->", JSON.stringify(await cmd(sp, "ATDPN", 1200)));
  log("0101 ->", JSON.stringify(await cmd(sp, "0101", 5000)));
  log("03   ->", JSON.stringify(await cmd(sp, "03", 5000)));
  log("010C ->", JSON.stringify(await cmd(sp, "010C", 3000)));
  log("0105 ->", JSON.stringify(await cmd(sp, "0105", 3000)));
  log("0902 ->", JSON.stringify(await cmd(sp, "0902", 5000)));

  clearTimeout(killer);
  try { sp.close(); } catch {}
  log("\n[FIN] probe terminee proprement.");
  process.exit(0);
})();
