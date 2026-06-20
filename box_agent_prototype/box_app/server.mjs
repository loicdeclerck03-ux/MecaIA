// server.mjs — App locale "MecaIA Box". Boucle agentique complète côté serveur (clé API jamais exposée au navigateur).
//
//   node server.mjs                              → http://localhost:8123 (sim + Dylan réel si clé)
//   $env:ANTHROPIC_API_KEY="sk-ant-..." ; node server.mjs    → vrai Dylan
//   $env:MOCK_DYLAN="1" ; node server.mjs                    → démo sans clé
//   $env:SERIAL_PORT="COM5" ; node server.mjs                → lectures sur le VRAI adaptateur
//   $env:SUPABASE_URL=... ; $env:SUPABASE_SECRET=... ; node server.mjs  → vraie base 18k + specs EU
//
// MAJ 20/06/2026 : pre-load vehicle_specs EU au /start via fetchVehicleContext

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { runDylanTurn, toolResultsMessage, isServerTool, UDS_WRITE_TOOLS, execServerTool, fetchVehicleContext } from "../box_agent.mjs";
import { simExecute, getScenario, listScenarios } from "./obd_sim.mjs";
import { ObdSerial } from "./obd_serial.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8123;
const MOCK = process.env.MOCK_DYLAN === "1" || !process.env.ANTHROPIC_API_KEY;
const SERIAL_PORT = process.env.SERIAL_PORT || null;
const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET);
const MAX_TOURS = 18;
const sessions = new Map();

export const AUTO_PROMPT = "Fais un diagnostic COMPLET et AUTONOME de ma voiture. Lis tout ce qui est utile (codes défaut, données temps réel, tests embarqués), trouve la panne et donne-moi la conclusion claire (cause, pièces, prix). Ne me pose AUCUNE question pour les lectures — enchaîne les outils tout seul. Demande mon accord UNIQUEMENT avant une action qui écrit dans la voiture.";

let obd = null;
async function getObd() { if (!obd) { obd = new ObdSerial(SERIAL_PORT); await obd.open(); } return obd; }

async function execTool(S, tc, state) {
  const { name, input } = tc;
  if (isServerTool(name)) return HAS_DB ? await execServerTool(name, input, { brand: S.brand, vehicleMeta: { marque: S.brand, modele: S.modele } }) : simExecute(S, name, input, state);
  if (SERIAL_PORT) {
    if (UDS_WRITE_TOOLS.has(name) || name === "clear_dtcs")
      return "[adaptateur réel] Écriture non encore implémentée (sécurité). À coder ensemble en Phase 3 : séquences UDS + SecurityAccess par marque.";
    try {
      const o = await getObd();
      switch (name) {
        case "read_dtcs": { const c = await o.readDtcs("03"); return c.length ? "Stockés (réel): " + c.join(", ") + ". (MIL : voir read_readiness_monitors)" : "Aucun code stocké (réel)."; }
        case "read_permanent_dtcs": { const c = await o.readDtcs("0A"); return c.length ? "Permanents (réel): " + c.join(", ") : "Aucun code permanent (réel)."; }
        case "read_live_data": return await o.readLive(input.pids || []);
        case "read_live_stream": return "(flux temps réel continu = Phase 3 ; ici lecture ponctuelle réelle)\n" + await o.readLive(input.pids || []);
        case "read_readiness_monitors": return await o.readMonitors();
        case "read_vin": return await o.readVin();
        case "read_freeze_frame": return await o.readFreezeFrame(input.code);
        case "read_onboard_tests": return await o.readMode06();
        default: return `[adaptateur réel] '${name}' pas encore mappé — Phase 3.`;
      }
    } catch (e) { return `Erreur adaptateur: ${e.message} — repli simulé : ` + simExecute(S, name, input, state); }
  }
  return simExecute(S, name, input, state);
}

function buildScript(S) {
  let i = 0; const id = () => `toolu_${++i}`;
  const tool = (text, name, input) => ({ kind: "tool", text, toolCalls: [{ id: id(), name, input }] });
  if (S.script) return S.script.map(s => s.kind === "tool" ? tool(s.text, s.name, s.input) : s);
  const steps = [tool("Ok. Je lis les codes défaut.", "read_dtcs", {})];
  if (S.dtcs?.length) steps.push(tool("Je consulte la base MecaIA.", "lookup_dtc", { codes: S.dtcs }));
  steps.push(tool("Je regarde des cas similaires.", "search_similar_cases", { symptom: S.symptom, marque: S.brand, modele: S.modele }));
  steps.push(tool("Je mesure les bons paramètres.", "read_live_data", { pids: S.targetPids }));
  steps.push(tool(S.conclusion.text, "record_case", { symptom: S.symptom, ...S.conclusion.record }));
  steps.push({ kind: "end", text: "Diagnostic terminé et mémorisé. Bonne route !" });
  return steps;
}

async function runTurns(session) {
  const steps = [];
  if (MOCK) {
    if (session.mockDone) { steps.push({ role: "dylan", text: "(Démo sans clé : recharge la page pour relancer, ou mets ta clé API pour discuter librement.)" }); return steps; }
    for (const r of buildScript(session.S)) {
      if (r.text) steps.push({ role: "dylan", text: r.text });
      if (r.kind === "ask") { steps.push({ role: "user", text: r.userReply }); continue; }
      for (const tc of (r.toolCalls || [])) { steps.push({ role: "tool", text: `${tc.name}(${JSON.stringify(tc.input)})` }); steps.push({ role: "obd", text: await execTool(session.S, tc, session.state) }); }
    }
    session.mockDone = true; return steps;
  }
  for (let i = 0; i < MAX_TOURS; i++) {
    let r;
    try {
      r = await runDylanTurn({
        messages: session.messages,
        vehicle: session.vehicle,
        brand: session.brand,
        level: session.level,
        vehicleContext: session.vehicleContext || null   // ← specs EU pré-chargées
      });
    }
    catch (e) { steps.push({ role: "error", text: "Erreur Dylan : " + e.message }); return steps; }
    if (r.text) steps.push({ role: "dylan", text: r.text });
    session.messages.push({ role: "assistant", content: r.assistantContent });
    if (!r.toolCalls.length) break;
    const results = [];
    for (const tc of r.toolCalls) {
      steps.push({ role: "tool", text: `${tc.name}(${JSON.stringify(tc.input)})` });
      const out = await execTool(session.S, tc, session.state);
      steps.push({ role: "obd", text: out });
      results.push({ id: tc.id, content: out });
    }
    session.messages.push(toolResultsMessage(results));
  }
  return steps;
}

function vehicleString(S, ov) {
  if (ov && (ov.brand || ov.model)) return [ov.brand, ov.model, ov.year, ov.fuel].filter(Boolean).join(" ");
  return S.vehicle;
}

const send = (res, code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
const readBody = async (req) => { let b = ""; for await (const c of req) b += c; return JSON.parse(b || "{}"); };

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") return send(res, 200, "text/html; charset=utf-8", await readFile(join(HERE, "index.html")));
    if (req.method === "GET" && req.url === "/scenarios")
      return send(res, 200, "application/json", JSON.stringify({ scenarios: listScenarios(), mock: MOCK, serial: SERIAL_PORT, db: HAS_DB, autoPrompt: AUTO_PROMPT }));

    if (req.method === "POST" && req.url === "/start") {
      const { scenarioId, vehicleOverride } = await readBody(req);
      const S = getScenario(scenarioId);
      const id = randomUUID();
      const vehicle = vehicleString(S, vehicleOverride);
      const brand = (vehicleOverride && vehicleOverride.brand) || S.brand;
      const model = (vehicleOverride && vehicleOverride.model) || S.modele || "";
      const year = vehicleOverride?.year ? parseInt(vehicleOverride.year) : null;

      // ── Pré-chargement specs EU (vehicle_specs + TSBs + recalls) ──
      let vehicleContext = null;
      if (HAS_DB && brand) {
        try {
          vehicleContext = await fetchVehicleContext({ make: brand, model, year });
          if (vehicleContext) console.log(`[EU] Specs chargées : ${brand} ${model} ${year || ""}`.trim());
          else console.log(`[EU] Aucun specs trouvés pour ${brand} ${model} ${year || ""}`.trim());
        } catch (e) { console.warn("[EU] fetchVehicleContext échoué:", e.message); }
      }

      sessions.set(id, { S, level: S.level || "v1", vehicle, brand, modele: model, messages: [], state: { regenIdx: 0 }, mockDone: false, vehicleContext });
      return send(res, 200, "application/json", JSON.stringify({ sessionId: id, vehicle, level: S.level || "v1", defaultSymptom: S.symptom, hasVehicleContext: !!vehicleContext }));
    }

    if (req.method === "POST" && req.url === "/message") {
      const { sessionId, text } = await readBody(req);
      const session = sessions.get(sessionId);
      if (!session) return send(res, 404, "application/json", JSON.stringify({ error: "session inconnue" }));
      session.messages.push({ role: "user", content: text });
      const steps = await runTurns(session);
      return send(res, 200, "application/json", JSON.stringify({ steps }));
    }
    send(res, 404, "text/plain", "Not found");
  } catch (e) { send(res, 500, "application/json", JSON.stringify({ error: e.message })); }
});
server.listen(PORT, () => console.log(`MecaIA Box → http://localhost:${PORT}  [Dylan: ${MOCK ? "SCRIPTÉ" : "RÉEL"} | OBD: ${SERIAL_PORT ? "ADAPTATEUR " + SERIAL_PORT : "simulé"} | base: ${HAS_DB ? "réelle (18k + EU)" : "simulée"}]`));
