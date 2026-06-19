import { SerialPort } from "serialport";
const PORT = process.argv[2] || "COM5";
let buf = "";
const sp = new SerialPort({ path: PORT, baudRate: 115200 }, e => { if (e) { console.error("Open err:", e.message); process.exit(1); } });
sp.on("data", d => { buf += d.toString("latin1"); });
const cmd = (c, t = 3000) => new Promise(res => { buf = ""; sp.write(c + "\r"); const t0 = Date.now(); const iv = setInterval(() => { if (buf.includes(">") || Date.now() - t0 > t) { clearInterval(iv); res(buf.replace(/>/g, "").trim()); } }, 40); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  await sleep(600);
  await cmd("ATZ", 3000); await cmd("ATE0"); await cmd("ATL0");
  console.log("ATI  :", JSON.stringify(await cmd("ATI")));
  console.log("STI  :", JSON.stringify(await cmd("STI")));
  console.log("STDI :", JSON.stringify(await cmd("STDI")));
  console.log("@1   :", JSON.stringify(await cmd("@1")));
  console.log("STPRS:", JSON.stringify(await cmd("STPRS")));
} catch (e) { console.error("ERREUR:", e.message); }
finally { try { sp.close(); } catch {} setTimeout(() => process.exit(0), 300); }
