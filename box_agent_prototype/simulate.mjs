// simulate.mjs — Simulateur de la boucle agentique Box (sans matériel).
//   node simulate.mjs --mock [--case=p0299|p0300|p0420|battery|dpf]   → scripté + base mockée, AUCUN secret
//   node simulate.mjs [--case=...]                                    → vrai Dylan ($env:ANTHROPIC_API_KEY)

import { runDylanTurn, toolResultsMessage, execServerTool, isServerTool } from "./box_agent.mjs";
import { enrichLine } from "./dtc_enrich.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const MOCK = process.argv.includes("--mock");
const caseArg = (process.argv.find(a => a.startsWith("--case=")) || "--case=p0299").split("=")[1];
const S = SCENARIOS[caseArg];
if (!S) { console.error("Scénario inconnu. Choix : " + Object.keys(SCENARIOS).join(", ")); process.exit(1); }
const LEVEL = S.level || "v1";
const MAX_TOURS = 14;

let regenIdx = 0; // progression de la régé FAP

// ── OBD SIMULÉ (DEVICE V1 + UDS) ──────────────────────────────────────────────
function mockObd(name, input) {
  switch (name) {
    case "read_dtcs": return S.dtcs.length ? `Stockés: ${S.dtcs.join(", ")}. En attente: aucun. MIL: ALLUMÉ.` : "Aucun code stocké. MIL éteint.";
    case "read_freeze_frame": return `Freeze ${input.code}: contexte d'apparition — simulé.`;
    case "read_live_data": return (input.pids || []).map(p => `${p} = ${S.live?.[p] ?? "n/a"}`).join("\n");
    case "read_live_stream": return `Flux ${(input.pids || []).join("/")} sur ${input.duration_s}s [consigne: ${input.instruction || "—"}] : ${(input.pids || []).map(p => `${p}→${S.live?.[p] ?? "courbe simulée"}`).join(" ; ")}`;
    case "read_readiness_monitors": return "Moniteurs: majorité COMPLÈTE — simulé.";
    case "read_vin": return "VIN simulé.";
    case "clear_dtcs": return input.confirmed ? "Codes effacés, MIL éteint." : "REFUS: confirmation requise.";
    // ── UDS ──
    case "read_extended_data": {
      const r = input.request;
      const v = S.extended?.[r];
      if (Array.isArray(v)) { const out = v[Math.min(regenIdx, v.length - 1)]; regenIdx++; return `[UDS] ${r} : ${out}`; }
      return `[UDS] ${r} : ${v ?? "(donnée étendue non simulée)"}`;
    }
    case "service_reset":
      return (input.confirmed && input.preconditions_ok)
        ? `[UDS] Routine '${input.type}' DÉMARRÉE (session étendue + TesterPresent actif). L'opération tourne sur le boîtier — surveille le statut.`
        : "REFUS [UDS]: confirmation et/ou pré-conditions manquantes.";
    case "actuator_test":
      return (input.confirmed && input.preconditions_ok)
        ? `[UDS] ${input.component} → ${input.action}${input.duration_s ? " pendant " + input.duration_s + "s" : ""} (test exécuté, simulé).`
        : "REFUS [UDS]: confirmation et/ou pré-conditions manquantes.";
    default: return "Outil OBD inconnu (simulé).";
  }
}

// ── Base MOCKÉE (SERVER) ──────────────────────────────────────────────────────
function mockServer(name, input) {
  if (name === "lookup_dtc") return (input.codes || []).map(c => enrichLine(c, S.dtcDesc?.[c] || "libellé inconnu", S.dtcCauses?.[c])).join("\n");
  if (name === "search_similar_cases") return S.similar?.length ? "Cas similaires (anonymisés, base partielle):\n" + JSON.stringify(S.similar) : "Aucun cas similaire (base partielle).";
  if (name === "record_case") return "[mock] Cas mémorisé : " + JSON.stringify(input);
  return "Outil serveur inconnu (mock).";
}

async function execTool(tc) {
  if (isServerTool(tc.name)) return MOCK ? mockServer(tc.name, tc.input) : await execServerTool(tc.name, tc.input, { brand: S.brand, vehicleMeta: { marque: S.brand, modele: S.modele } });
  return mockObd(tc.name, tc.input);
}

// ── Dylan SCRIPTÉ ─────────────────────────────────────────────────────────────
function buildScript() {
  let i = 0; const id = () => `toolu_${++i}`;
  const tool = (text, name, input) => { const x = id(); return { stop_reason: "tool_use", text, toolCalls: [{ id: x, name, input }], assistantContent: [{ type: "text", text }, { type: "tool_use", id: x, name, input }] }; };
  const ask = (text, userReply) => ({ kind: "ask", text, userReply, toolCalls: [], assistantContent: [{ type: "text", text }] });
  const end = (text) => ({ kind: "end", stop_reason: "end_turn", text, toolCalls: [], assistantContent: [{ type: "text", text }] });

  if (S.script) return S.script.map(s => s.kind === "ask" ? ask(s.text, s.userReply) : s.kind === "end" ? end(s.text) : tool(s.text, s.name, s.input));

  // script générique (scénarios simples)
  const steps = [tool("Ok. Je lis les codes défaut.", "read_dtcs", {})];
  if (S.dtcs.length) steps.push(tool("Je consulte la base MecaIA.", "lookup_dtc", { codes: S.dtcs }));
  steps.push(tool("Je regarde des cas similaires.", "search_similar_cases", { symptom: S.symptom, marque: S.brand, modele: S.modele }));
  steps.push(tool("Je mesure les bons paramètres.", "read_live_data", { pids: S.targetPids }));
  steps.push(tool(S.conclusion.text, "record_case", { symptom: S.symptom, ...S.conclusion.record }));
  steps.push(end("Diagnostic terminé et mémorisé. Bonne route !"));
  return steps;
}

// ── BOUCLE ────────────────────────────────────────────────────────────────────
const line = (s) => console.log(s);
async function main() {
  line(`\n=== SIMULATION BOX — ${MOCK ? "Dylan SCRIPTÉ" : "Dylan RÉEL"} — niveau ${LEVEL} — [${caseArg}] ${S.label} ===`);
  line(`Véhicule : ${S.vehicle}\n`);
  const script = MOCK ? buildScript() : null;
  let messages = [{ role: "user", content: S.symptom }];
  line("CONDUCTEUR: " + S.symptom + "\n");

  for (let turn = 0; turn < MAX_TOURS; turn++) {
    let r;
    try { r = MOCK ? (script[turn] || { stop_reason: "end_turn", text: "(fin)", toolCalls: [], assistantContent: [{ type: "text", text: "(fin)" }] })
                   : await runDylanTurn({ messages, vehicle: S.vehicle, brand: S.brand, level: LEVEL }); }
    catch (e) { line("ERREUR appel IA: " + e.message); return; }

    if (r.text) line("DYLAN: " + r.text);
    messages.push({ role: "assistant", content: r.assistantContent });

    if (r.kind === "ask") { messages.push({ role: "user", content: r.userReply }); line("CONDUCTEUR: " + r.userReply + "\n"); continue; }
    if (!r.toolCalls.length) { line(`\n[FIN — en ${turn + 1} tours]`); return; }

    const results = [];
    for (const tc of r.toolCalls) {
      const tier = isServerTool(tc.name) ? "BASE" : "OBD ";
      line(`   -> ${tier} ${tc.name}(${JSON.stringify(tc.input)})`);
      const out = await execTool(tc);
      line(`   <- ${out.replace(/\n/g, " | ")}`);
      results.push({ id: tc.id, content: out });
    }
    messages.push(toolResultsMessage(results));
    line("");
  }
  line("\n[STOP — max tours atteint]");
}
main();
