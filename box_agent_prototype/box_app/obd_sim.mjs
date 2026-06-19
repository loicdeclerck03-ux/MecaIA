// obd_sim.mjs — "Voiture simulée" : exécute TOUS les outils (device + UDS + connaissance) à partir d'un scénario.
// Permet de tester le VRAI cerveau Dylan sans matériel. Plus tard, remplacé/complété par obd_serial.mjs.

import { SCENARIOS } from "../scenarios.mjs";
import { enrichLine } from "../dtc_enrich.mjs";

export function getScenario(id) { return SCENARIOS[id] || SCENARIOS.p0299; }
export function listScenarios() { return Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label, level: s.level || "v1", vehicle: s.vehicle })); }

export function simExecute(S, name, input = {}, state = {}) {
  switch (name) {
    // Connaissance (SERVER)
    case "lookup_dtc": return (input.codes || []).map(c => enrichLine(c, S.dtcDesc?.[c] || "libellé inconnu", S.dtcCauses?.[c])).join("\n");
    case "search_similar_cases": return S.similar?.length ? "Cas similaires (anonymisés):\n" + JSON.stringify(S.similar) : "Aucun cas similaire (base partielle).";
    case "record_case": return "Diagnostic mémorisé dans l'historique MecaIA (simulé).";

    // Lecture (DEVICE V1)
    case "read_dtcs": return S.dtcs?.length ? `Stockés: ${S.dtcs.join(", ")}. En attente: ${S.pending?.join(", ") || "aucun"}. MIL: ALLUMÉ.` : "Aucun code stocké. MIL éteint.";
    case "read_permanent_dtcs": return S.permanent?.length ? `Permanents: ${S.permanent.join(", ")}.` : "Aucun code permanent.";
    case "read_freeze_frame": return S.freeze?.[input.code] || `Freeze ${input.code}: contexte d'apparition (simulé).`;
    case "read_onboard_tests": return S.mode06?.[input.focus] || S.mode06?.all || "Tests embarqués (Mode 06) : pas d'anomalie notable (simulé).";
    case "read_live_data": return (input.pids || []).map(p => `${p} = ${S.live?.[p] ?? "n/a"}`).join("\n");
    case "read_live_stream": return `Flux ${(input.pids || []).join("/")} sur ${input.duration_s}s [consigne: ${input.instruction || "—"}] : ` + (input.pids || []).map(p => `${p}→${S.live?.[p] ?? "courbe simulée"}`).join(" ; ");
    case "read_readiness_monitors": return S.readiness || "Moniteurs: majorité COMPLÈTE (simulé).";
    case "read_vin": return S.vin || "VIN simulé.";
    case "clear_dtcs": return input.confirmed ? "Codes effacés, MIL éteint." : "REFUS: confirmation requise.";

    // UDS (DEVICE V2/V3)
    case "read_extended_data": {
      const v = S.extended?.[input.request];
      if (Array.isArray(v)) { const i = state.regenIdx || 0; state.regenIdx = i + 1; return `[UDS] ${input.request} : ${v[Math.min(i, v.length - 1)]}`; }
      return `[UDS] ${input.request} : ${v ?? "(donnée étendue non simulée)"}`;
    }
    case "service_reset": return (input.confirmed && input.preconditions_ok) ? `[UDS] Routine '${input.type}' DÉMARRÉE (session étendue + TesterPresent). Opération sur le boîtier — surveille le statut.` : "REFUS [UDS]: confirmation et/ou pré-conditions manquantes.";
    case "actuator_test": return (input.confirmed && input.preconditions_ok) ? `[UDS] ${input.component} → ${input.action}${input.duration_s ? " pendant " + input.duration_s + "s" : ""} (test exécuté, simulé).` : "REFUS [UDS]: confirmation et/ou pré-conditions manquantes.";

    default: return "Outil inconnu (simulé).";
  }
}
