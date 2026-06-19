// test/diag_20.mjs — 20 pannes réelles, bout en bout, contre la PROD. Auth via env injectées (netlify dev:exec).
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SECRET, ANON = process.env.SUPABASE_ANON;
const ENDPOINT = "https://mecaiaauto.com/.netlify/functions/dylan_agents";
const EMAIL = "loicdeclerck4020@gmail.com";

async function mintToken() {
  const gl = await fetch(SUPABASE_URL + "/auth/v1/admin/generate_link", {
    method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL }) });
  const g = await gl.json();
  const otp = g.email_otp || (g.properties && g.properties.email_otp);
  if (!otp) throw new Error("OTP introuvable (" + gl.status + ")");
  const vr = await fetch(SUPABASE_URL + "/auth/v1/verify", { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL, token: otp }) });
  const v = await vr.json();
  if (!v.access_token) throw new Error("access_token introuvable");
  return v.access_token;
}

const C = (name, vehicle, open, ctx, ctrl) => ({ name, vehicle, open, ctx, ctrl });
const CASES = [
  C("01 Diesel perte puissance P0299 turbo", {make:"Volkswagen",model:"Passat",fuel:"Diesel",year:2015,mileage_km:180000}, "Ma Passat diesel perd de la puissance, voyant moteur, code P0299", ["permanent depuis 2 jours","a chaud sur autoroute","pas de fumee"], ["oui","oui","oui"]),
  C("02 Essence rates ralenti P0300", {make:"Renault",model:"Clio",fuel:"Essence",year:2016,mileage_km:120000}, "Ma Clio a des rates au ralenti ca vibre, code P0300", ["intermittent","pire a froid","ralenti instable"], ["oui","non","oui"]),
  C("03 Diesel EGR P0401", {make:"Peugeot",model:"308",fuel:"Diesel",year:2014,mileage_km:160000}, "Voyant moteur P0401 sur ma 308 diesel, manque de reprise", ["permanent","a chaud","fumee noire a l acceleration"], ["oui","oui"]),
  C("04 Demarrage difficile froid batterie", {make:"Opel",model:"Astra",fuel:"Essence",year:2013,mileage_km:140000}, "Ma voiture demarre tres difficilement le matin, demarreur lent", ["le matin a froid","pire quand il fait froid","les phares faiblissent"], ["oui","oui"]),
  C("05 Voyant ABS + bruit roue", {make:"Ford",model:"Focus",fuel:"Essence",year:2015,mileage_km:130000}, "Le voyant ABS s allume et bruit cote roue avant droite", ["voyant permanent","bruit a basse vitesse","freinage normal sinon"], ["oui","oui"]),
  C("06 Fumee blanche joint culasse", {make:"BMW",model:"Serie 3",fuel:"Essence",year:2012,mileage_km:175000}, "Grosse fumee blanche echappement, je perds du liquide, temperature monte", ["permanent depuis ce matin","fumee blanche epaisse","vase d expansion se vide"], ["oui","oui"]),
  C("07 A-coups boite auto", {make:"Audi",model:"A4",fuel:"Diesel",year:2014,mileage_km:165000}, "Ma A4 boite auto fait des a-coups au passage des rapports", ["intermittent","a froid","entre 2e et 3e"], ["oui","oui"]),
  C("08 Clim ne refroidit plus", {make:"Toyota",model:"Yaris",fuel:"Essence",year:2017,mileage_km:90000}, "La clim de ma Yaris souffle de l air tiede", ["permanent","compresseur ne s enclenche pas","pas de bruit anormal"], ["oui","oui"]),
  C("09 Catalyseur P0420", {make:"Volkswagen",model:"Golf",fuel:"Essence",year:2013,mileage_km:155000}, "Voyant moteur P0420 efficacite catalyseur sur ma Golf", ["permanent","pas de perte de puissance","conso un peu plus elevee"], ["oui","oui"]),
  C("10 Claquement moteur froid", {make:"Mercedes",model:"Classe A",fuel:"Diesel",year:2015,mileage_km:145000}, "Gros claquement metallique au demarrage a froid, ca m inquiete", ["a froid surtout","s attenue une fois chaud","bruit rythme avec le moteur"], ["oui","oui"]),
  C("11 Melange pauvre P0171", {make:"Citroen",model:"C3",fuel:"Essence",year:2016,mileage_km:110000}, "Voyant moteur P0171 melange trop pauvre, a-coups", ["intermittent","au ralenti et acceleration","odeur d essence parfois"], ["oui","non"]),
  C("12 Direction assistee dure", {make:"Peugeot",model:"207",fuel:"Essence",year:2011,mileage_km:150000}, "Le volant est tres dur a tourner surtout a basse vitesse", ["permanent","pire a froid","bruit de pompe parfois"], ["oui","oui"]),
  C("13 Surconso fumee noire diesel", {make:"Renault",model:"Megane",fuel:"Diesel",year:2013,mileage_km:170000}, "Ma Megane diesel fume noir et consomme beaucoup", ["a l acceleration","permanent","perte de puissance aussi"], ["oui","oui"]),
  C("14 Embrayage patine", {make:"Seat",model:"Ibiza",fuel:"Essence",year:2014,mileage_km:135000}, "L embrayage patine, le regime monte mais la voiture n accelere pas", ["en cote surtout","empire","odeur de brule parfois"], ["oui","oui"]),
  C("15 Voyant airbag allume", {make:"Fiat",model:"500",fuel:"Essence",year:2015,mileage_km:80000}, "Le voyant airbag reste allume sur mon tableau de bord", ["permanent depuis une semaine","apres avoir lave la voiture","aucun choc"], ["non","oui"]),
  C("16 Bruit roulement roue", {make:"Skoda",model:"Octavia",fuel:"Diesel",year:2016,mileage_km:160000}, "Bruit de grondement qui augmente avec la vitesse cote gauche", ["augmente avec la vitesse","change en tournant","permanent"], ["oui","oui"]),
  C("17 Ventilo refroidissement permanent", {make:"Nissan",model:"Qashqai",fuel:"Essence",year:2014,mileage_km:125000}, "Le ventilateur de refroidissement tourne tout le temps meme moteur froid", ["des le demarrage","permanent","temperature normale pourtant"], ["oui","non"]),
  C("18 Calage au ralenti", {make:"Dacia",model:"Sandero",fuel:"Essence",year:2017,mileage_km:95000}, "Ma voiture cale toute seule au ralenti aux feux", ["a chaud surtout","intermittent","ralenti qui chute avant de caler"], ["oui","oui"]),
  C("19 Pedale de frein spongieuse", {make:"Volvo",model:"V40",fuel:"Diesel",year:2015,mileage_km:140000}, "La pedale de frein est molle et s enfonce trop, freinage moins bon", ["empire depuis quelques jours","pedale qui descend","pas de fuite visible"], ["oui","oui"]),
  C("20 Prechauffage clignote diesel", {make:"Hyundai",model:"i30",fuel:"Diesel",year:2013,mileage_km:175000}, "Le voyant de prechauffage clignote et la voiture demarre mal a froid", ["a froid","clignote au tableau","fumee blanche au demarrage"], ["oui","oui"]),
];

async function postTurn(token, payload) {
  const t0 = Date.now();
  const r = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const ms = Date.now() - t0;
  let data = null; try { data = await r.json(); } catch { data = { _raw: "(non-json)" }; }
  return { status: r.status, ms, data };
}
async function runCase(token, c) {
  let sessionId = null, etat = null, turns = 0, maxMs = 0, ci = 0, ki = 0, conclusion = null, err = null;
  let res = await postTurn(token, { user_input: c.open, vehicle: c.vehicle });
  while (turns < 14) {
    turns++; if (res.ms > maxMs) maxMs = res.ms;
    if (res.status !== 200) { err = "HTTP " + res.status + " :: " + JSON.stringify(res.data).slice(0,120); break; }
    sessionId = res.data.session_id || sessionId; etat = res.data.etat;
    if (etat === "CONCLUSION") { conclusion = res.data.conclusion; break; }
    let payload;
    if (etat === "CONTROLE") payload = { session_id: sessionId, control_result: c.ctrl[ki++] || "oui", vehicle: c.vehicle };
    else payload = { session_id: sessionId, user_input: c.ctx[ci++] || c.open, vehicle: c.vehicle };
    res = await postTurn(token, payload);
  }
  return { name: c.name, turns, etat, maxMs, conclusion, err, sessionId };
}
(async () => {
  const token = process.env.MECAIA_TOKEN || await mintToken();
  console.log("Token OK\n");
  const FROM = parseInt(process.env.FROM || "0"), TO = parseInt(process.env.TO || String(CASES.length));
  const RUN = CASES.slice(FROM, TO);
  const results = [];
  for (const c of RUN) {
    try {
      const r = await runCase(token, c); results.push(r);
      const concl = r.conclusion ? (r.conclusion.cause + " [" + r.conclusion.bande + "] " + r.conclusion.cost_min + "-" + r.conclusion.cost_max + "EUR urgence:" + r.conclusion.urgency) : (r.err || "NON CONCLU (etat=" + r.etat + ")");
      console.log((r.etat === "CONCLUSION" ? "[OK] " : "[!!] ") + r.name + " | " + r.turns + "t | max" + r.maxMs + "ms | " + concl);
    } catch (e) { console.log("[ERR] " + c.name + " :: " + e.message); results.push({ name: c.name, err: e.message }); }
  }
  const ok = results.filter(r => r.etat === "CONCLUSION").length;
  const errs = results.filter(r => r.err).length;
  const maxAll = Math.max.apply(null, results.map(r => r.maxMs || 0));
  console.log("\n==================================================");
  console.log("CONCLUSIONS : " + ok + "/" + RUN.length + "  |  erreurs/timeouts : " + errs + "  |  latence max 1 appel : " + maxAll + "ms");
  console.log("==================================================");
  console.log("FIN_BATTERIE");
})().catch(e => { console.error("FATAL: " + e.message); console.log("FIN_BATTERIE"); });
