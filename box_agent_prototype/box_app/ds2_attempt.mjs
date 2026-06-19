import { SerialPort } from "serialport";
const PORT = process.argv[2] || "COM5";
let buf = "";
const sp = new SerialPort({ path: PORT, baudRate: 115200 }, e => { if (e) { console.error("Open err:", e.message); process.exit(1); } });
sp.on("data", d => { buf += d.toString("latin1"); });
const cmd = (c, t = 4000) => new Promise(res => { buf = ""; sp.write(c + "\r"); const t0 = Date.now(); const iv = setInterval(() => { if (buf.includes(">") || Date.now() - t0 > t) { clearInterval(iv); res(buf.replace(/>/g, "").trim()); } }, 40); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ds2 = (addr, data) => { const b=[addr, 2+data.length+1, ...data]; let c=0; for(const x of b)c^=x; b.push(c); return b.map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join(" "); };
try {
  await sleep(600);
  await cmd("ATZ", 3000); await cmd("ATE0"); await cmd("ATL0"); await cmd("ATH1");
  console.log("SP5(KWP):", JSON.stringify(await cmd("ATSP5")));
  console.log("ATBI bypass init:", JSON.stringify(await cmd("ATBI")));
  console.log("ATCAF0:", JSON.stringify(await cmd("ATCAF0")));
  // tentative custom baud 9600 (STN) — observe si accepte
  console.log("STSBR? / ATIB96:", JSON.stringify(await cmd("ATIB96")));
  for (const [name, addr] of [["IKE/tableau", 0x80], ["DSC/ABS a", 0x56], ["DSC/ABS b", 0x29], ["SRS/airbag", 0x00]]) {
    const frame = ds2(addr, [0x00]); // commande 0x00 = ident/statut
    const r = await cmd(frame, 4000);
    console.log(`\n[${name} 0x${addr.toString(16)}] envoi: ${frame}`);
    console.log("  reponse:", JSON.stringify(r));
  }
  console.log("\nTension:", JSON.stringify(await cmd("ATRV", 2000)));
} catch (e) { console.error("ERREUR:", e.message); }
finally { try { sp.close(); } catch {} setTimeout(() => process.exit(0), 300); }
