// nexus_recall_radar.mjs — NEXUS Recall Radar (ADR-027 extension)
// Rappels constructeurs multi-sources :
//   - NHTSA API (US, gratuit, bonne couverture EU)
//   - GPT-4.1-mini web_search_preview (EU RAPEX + FR DREAL)
// Retourne liste priorisée par gravité. Auth requise. Sans débit crédit.
// ============================================================

import { getUser, json, preflight } from "../lib/auth.mjs";

const MODEL_SEARCH = "gpt-4.1-mini";
const RECALL_TIMEOUT_MS = 16000;

const MAKE_NORMALIZE = {
  "citroën": "CITROEN", "citroen": "CITROEN", "peugeot": "PEUGEOT",
  "renault": "RENAULT", "volkswagen": "VOLKSWAGEN", "vw": "VOLKSWAGEN",
  "bmw": "BMW", "mercedes-benz": "MERCEDES BENZ", "mercedes": "MERCEDES BENZ",
  "audi": "AUDI", "ford": "FORD", "opel": "OPEL", "vauxhall": "OPEL",
  "fiat": "FIAT", "toyota": "TOYOTA", "honda": "HONDA", "nissan": "NISSAN",
  "skoda": "SKODA", "seat": "SEAT", "hyundai": "HYUNDAI", "kia": "KIA",
  "dacia": "DACIA", "volvo": "VOLVO", "mini": "MINI", "alfa romeo": "ALFA ROMEO",
  "land rover": "LAND ROVER", "jaguar": "JAGUAR", "mazda": "MAZDA",
  "subaru": "SUBARU", "lexus": "LEXUS",
};

function scoreSeverity(component, summary) {
  const t = (component + " " + summary).toLowerCase();
  if (t.match(/frein|brake|incendie|fire|airbag|steering|direction|fuel leak|fuite carburant/)) return "critique";
  if (t.match(/moteur|engine|transmission|boite|suspension|acceleration/)) return "haute";
  if (t.match(/electrique|electric|capteur|sensor|lumiere|light/)) return "moyenne";
  return "basse";
}

async function fetchNHTSA(make, model, year) {
  if (!make) return [];
  try {
    const makeNorm = MAKE_NORMALIZE[make.toLowerCase()] || make.toUpperCase();
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(makeNorm)}&model=${encodeURIComponent((model || "").toUpperCase())}&modelYear=${year}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.results || []).map(r => ({
      source: "NHTSA", id: r.NHTSACampaignNumber || "",
      component: r.Component || "",
      summary: (r.Summary || "").substring(0, 300),
      remedy: (r.Remedy || "").substring(0, 200),
      severity: scoreSeverity(r.Component || "", r.Summary || ""),
      date: r.ReportReceivedDate || null,
    }));
  } catch { return []; }
}

async function fetchEURecalls(make, model, year, signal) {
  if (!make || !process.env.OPENAI_API_KEY) return [];
  try {
    const vehicleStr = [year, make, model].filter(Boolean).join(" ");
    const prompt = `Cherche des rappels constructeur officiels pour : ${vehicleStr}.
Sources : Safety Gate EU (RAPEX), DREAL France, constructeur officiel.
Retourne UNIQUEMENT un JSON valide (tableau, peut être vide) :
[{"source":"RAPEX","id":null,"component":"composant","summary":"défaut en français","remedy":"action","severity":"critique|haute|moyenne|basse"}]
Ne jamais inventer un rappel non officiel.`;
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL_SEARCH, tools: [{ type: "web_search_preview" }], input: prompt }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
    const outputText = data.output_text || (Array.isArray(data.output)
      ? data.output.filter(i => i.type === "message").flatMap(i => (i.content || []).filter(c => c.type === "output_text").map(c => c.text)).join("\n")
      : "");
    try {
      const cleaned = outputText.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      const m = outputText.match(/\[[\s\S]*\]/);
      if (m) return JSON.parse(m[0]);
      return [];
    }
  } catch (e) { console.error("[nexus_recall_radar] EU:", e.message); return []; }
}

function deduplicateRecalls(recalls) {
  const seen = new Set();
  return recalls.filter(r => {
    const key = `${(r.component || "").toLowerCase().substring(0, 20)}|${(r.summary || "").toLowerCase().substring(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SEV_ORDER = { critique: 0, haute: 1, moyenne: 2, basse: 3 };
function sortRecalls(r) { return r.sort((a, b) => (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2)); }

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }
  const { make, model, year } = body;
  if (!make) return json(400, { error: "make requis" });
  if (!year || isNaN(parseInt(year))) return json(400, { error: "year requis" });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RECALL_TIMEOUT_MS);
  const startTs = Date.now();
  let nhtsaRecalls = [], euRecalls = [];
  try {
    const [nhR, euR] = await Promise.allSettled([
      fetchNHTSA(make, model, parseInt(year)),
      fetchEURecalls(make, model, year, ctrl.signal),
    ]);
    nhtsaRecalls = nhR.status === "fulfilled" ? (nhR.value || []) : [];
    euRecalls = euR.status === "fulfilled" ? (euR.value || []) : [];
    if (nhR.status === "rejected") console.error("[nexus_recall_radar] NHTSA:", nhR.reason?.message);
    if (euR.status === "rejected") console.error("[nexus_recall_radar] EU:", euR.reason?.message);
  } catch (e) { console.error("[nexus_recall_radar] parallel:", e.message); }
  finally { clearTimeout(timer); }
  const allRecalls = sortRecalls(deduplicateRecalls([...nhtsaRecalls, ...euRecalls]));
  const elapsed = Date.now() - startTs;
  console.log(`[nexus_recall_radar] elapsed=${elapsed}ms nhtsa=${nhtsaRecalls.length} eu=${euRecalls.length} total=${allRecalls.length}`);
  return json(200, {
    success: true, vehicle: { make, model: model || null, year: parseInt(year) },
    recalls: allRecalls, total: allRecalls.length,
    critical_count: allRecalls.filter(r => r.severity === "critique").length,
    sources: { nhtsa: nhtsaRecalls.length, eu: euRecalls.length },
    elapsed_ms: elapsed, queried_at: new Date().toISOString(),
  });
}
