// test/diag_10.mjs — 10 cas reels de panne, bout en bout, en PROD
// Utilise MECAIA_TOKEN (fourni par _minttest) sinon tente de minter lui-meme.
const RAW = process.env.SUPABASE_URL || "";
const SUPABASE_URL = RAW.replace(/\/+$/, "");
const SERVICE      = process.env.SUPABASE_SECRET;
const ANON         = process.env.SUPABASE_ANON;
const ENDPOINT     = "https://mecaiaauto.com/.netlify/functions/dylan_agents";
const EMAIL        = "loicdeclerck4020@gmail.com";

async function mintToken() {
  if (!SUPABASE_URL || !SERVICE || !ANON) throw new Error("ni MECAIA_TOKEN ni clefs Supabase disponibles");
  const gl = await fetch(SUPABASE_URL + "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL }),
  });
  const g = await gl.json();
  const otp = g.email_otp || (g.properties && g.properties.email_otp);
  if (!otp) throw new Error("OTP introuvable (" + gl.status + "): " + JSON.stringify(g).slice(0, 200));
  const vr = await fetch(SUPABASE_URL + "/auth/v1/verify", {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL, token: otp }),
  });
  const v = await vr.json();
  if (!v.access_token) throw new Error("access_token introuvable: " + JSON.stringify(v).slice(0, 200));
  return v.access_token;
}

const CASES = [
  { name: "1. Diesel perte puissance P0299 (turbo/VNT)",
    vehicle: { make: "Volkswagen", model: "Passat", fuel: "Diesel", year: 2015, mileage_km: 180000 },
    open: "Ma Passat diesel perd de la puissance et le voyant moteur est allume, code P0299",
    ctx: ["C'est permanent depuis 2 jours", "Surtout a chaud sur autoroute", "Pas de fumee"], ctrl: ["oui","oui","oui"] },
  { name: "2. Essence rates ralenti P0300",
    vehicle: { make: "Renault", model: "Clio", fuel: "Essence", year: 2016, mileage_km: 120000 },
    open: "Ma Clio essence a des rates au ralenti, ca vibre, code P0300",
    ctx: ["Intermittent", "Pire a froid au demarrage", "Le ralenti est instable"], ctrl: ["oui","non","oui"] },
  { name: "3. Diesel EGR P0401",
    vehicle: { make: "Peugeot", model: "308", fuel: "Diesel", year: 2014, mileage_km: 160000 },
    open: "Voyant moteur sur ma 308 diesel, code P0401, manque de reprise",
    ctx: ["Permanent", "A chaud surtout", "Fumee noire a l'acceleration"], ctrl: ["oui","oui"] },
  { name: "4. Demarrage difficile a froid (batterie/alternateur)",
    vehicle: { make: "Opel", model: "Astra", fuel: "Essence", year: 2013, mileage_km: 140000 },
    open: "Ma voiture demarre tres difficilement le matin, le demarreur tourne lentement",
    ctx: ["Surtout le matin a froid", "Intermittent, pire quand il fait froid", "Les phares faiblissent au demarrage"], ctrl: ["oui","oui"] },
  { name: "5. Voyant ABS + bruit roue",
    vehicle: { make: "Ford", model: "Focus", fuel: "Essence", year: 2015, mileage_km: 130000 },
    open: "Le voyant ABS s'allume et j'entends un bruit cote roue avant droite",
    ctx: ["Le voyant reste allume en permanence", "Bruit a basse vitesse", "Freinage qui semble normal sinon"], ctrl: ["oui","oui"] },
  { name: "6. Fumee blanche + perte liquide (joint culasse / SECURITE surchauffe)",
    vehicle: { make: "BMW", model: "Serie 3", fuel: "Essence", year: 2012, mileage_km: 175000 },
    open: "Grosse fumee blanche a l'echappement et je perds du liquide de refroidissement, la temperature monte",
    ctx: ["Permanent depuis ce matin", "Fumee blanche epaisse", "Le vase d'expansion se vide"], ctrl: ["oui","oui"] },
  { name: "7. A-coups boite auto",
    vehicle: { make: "Audi", model: "A4", fuel: "Diesel", year: 2014, mileage_km: 165000 },
    open: "Ma A4 boite auto fait des a-coups au passage des rapports",
    ctx: ["Intermittent", "Surtout a froid", "A-coups entre 2e et 3e"], ctrl: ["oui","oui"] },
  { name: "8. Clim ne refroidit plus",
    vehicle: { make: "Toyota", model: "Yaris", fuel: "Essence", year: 2017, mileage_km: 90000 },
    open: "La climatisation de ma Yaris ne refroidit plus, elle souffle de l'air tiede",
    ctx: ["Permanent", "Le compresseur ne semble pas s'enclencher", "Pas de bruit anormal"], ctrl: ["oui","oui"] },
  { name: "9. Essence catalyseur P0420",
    vehicle: { make: "Volkswagen", model: "Golf", fuel: "Essence", year: 2013, mileage_km: 155000 },
    open: "Voyant moteur sur ma Golf essence, code P0420, efficacite catalyseur",
    ctx: ["Permanent", "Pas de perte de puissance notable", "Conso un peu plus elevee"], ctrl: ["oui","oui"] },
  { name: "10. Claquement moteur a froid (URGENCE potentielle)",
    vehicle: { make: "Mercedes", model: "Classe A", fuel: "Diesel", year: 2015, mileage_km: 145000 },
    open: "Gros claquement metallique dans le moteur au demarrage a froid, ca m'inquiete",
    ctx: ["Au demarrage a froid surtout", "Ca s'attenue une fois chaud", "Bruit regulier rythme avec le moteur"], ctrl: ["oui","oui"] },
];

async function postTurn(token, payload) {
  const t0 = Date.now();
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const ms = Date.now() - t0;
  let data = null; try { data = await r.json(); } catch { data = { _raw: "(non-json)" }; }
  return { status: r.status, ms, data };
}

async function runCase(token, c) {
  let sessionId = null, etat = null, turns = 0, maxMs = 0, totalMs = 0;
  let ci = 0, ki = 0, conclusion = null, lastMsg = "", err = null;
  let res = await postTurn(token, { user_input: c.open, vehicle: c.vehicle });
  while (turns < 12) {
    turns++;
    totalMs += res.ms; if (res.ms > maxMs) maxMs = res.ms;
    if (res.status !== 200) { err = "HTTP " + res.status + " :: " + JSON.stringify(res.data).slice(0,160); break; }
    sessionId = res.data.session_id || sessionId;
    etat = res.data.etat;
    lastMsg = res.data.message || "";
    if (etat === "CONCLUSION") { conclusion = res.data.conclusion; break; }
    let payload;
    if (etat === "CONTROLE") {
      const cr = c.ctrl[ki++] || "oui";
      payload = { session_id: sessionId, control_result: cr, vehicle: c.vehicle };
    } else {
      const ans = c.ctx[ci++] || c.open;
      payload = { session_id: sessionId, user_input: ans, vehicle: c.vehicle };
    }
    res = await postTurn(token, payload);
  }
  return { name: c.name, turns, etat, maxMs, totalMs, conclusion, lastMsg, err };
}

(async () => {
  let token = process.env.MECAIA_TOKEN;
  if (!token) { console.log("Pas de MECAIA_TOKEN, tentative de mint local..."); token = await mintToken(); }
  console.log("Token OK (len " + token.length + ")");
  console.log("");
  const results = [];
  for (const c of CASES) {
    console.log(">> " + c.name);
    try {
      const r = await runCase(token, c);
      results.push(r);
      const concl = r.conclusion ? (r.conclusion.cause + " [" + r.conclusion.bande + "] " + r.conclusion.cost_min + "-" + r.conclusion.cost_max + " EUR") : (r.err || "non conclu");
      console.log("   -> " + r.etat + " | " + r.turns + " tours | max " + r.maxMs + "ms tot " + r.totalMs + "ms");
      console.log("   -> " + concl);
      if (r.conclusion && r.conclusion.urgency) console.log("   -> urgence: " + r.conclusion.urgency + " | roulable: " + r.conclusion.can_drive);
      if (r.lastMsg) console.log("   -> msg: " + r.lastMsg.slice(0,160).replace(/\r?\n/g," "));
      console.log("");
    } catch (e) { console.log("   ERREUR " + e.message); console.log(""); results.push({ name: c.name, err: e.message }); }
  }
  const ok = results.filter(r => r.etat === "CONCLUSION").length;
  const t504 = results.filter(r => (r.err||"").includes("504")).length;
  const maxAll = Math.max.apply(null, results.map(r => r.maxMs || 0));
  console.log("====================================");
  console.log("CONCLUSIONS atteintes : " + ok + "/" + CASES.length);
  console.log("504 (timeout)         : " + t504);
  console.log("Latence max 1 appel   : " + maxAll + " ms");
  console.log("====================================");
  process.exit(0);
})().catch(e => { console.error("FATAL: " + e.message); process.exit(1); });
