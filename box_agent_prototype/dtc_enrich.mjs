// dtc_enrich.mjs — Enrichissement DÉTERMINISTE d'un code DTC (catégorie + gravité estimée).
// Calculé à la volée → pas besoin de muter les 18k lignes (colonnes severity/fault_category vides en base).
// Sert à box_agent.mjs (lookup_dtc) ET au script de backfill SQL (enrich_dtc.sql) si on veut peupler la base.

// Catégorie fonctionnelle déduite de la structure OBD-II (P b c d d).
export function faultCategory(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  const sys = c[0];
  if (sys === "B") return "Carrosserie";
  if (sys === "C") return "Châssis";
  if (sys === "U") return "Réseau / Communication";
  if (sys === "P") {
    const sub = c[2]; // chiffre de sous-système
    const map = {
      "0": "Carburant / Air (dosage & émissions)",
      "1": "Carburant / Air (dosage)",
      "2": "Carburant / Air (injection)",
      "3": "Allumage / Ratés de combustion",
      "4": "Émissions auxiliaires (EGR, catalyseur, EVAP)",
      "5": "Régime / Ralenti / Entrées auxiliaires",
      "6": "Calculateur / Circuits de sortie",
      "7": "Transmission",
      "8": "Transmission",
      "9": "Transmission / SAE",
      "A": "Propulsion hybride",
      "B": "Propulsion hybride",
      "C": "Propulsion hybride",
    };
    return map[sub] || "Moteur / Transmission";
  }
  return null;
}

// Gravité ESTIMÉE (heuristique, 3 niveaux). Indice pour prioriser, PAS une vérité absolue.
export function severityHint(code, description = "") {
  const c = String(code || "").toUpperCase();
  const d = String(description || "").toLowerCase();
  const sys = c[0], sub = c[2];
  const HIGH = /misfire|rat[ée]|overheat|surchauff|oil pressure|huile.*pression|brake|frein|airbag|steering|direction|knock|cliquetis|head gasket|joint de culasse|timing|distribution/;
  const LOW = /evap|small leak|petite fuite|purge|gas cap|bouchon|readiness|ambient|lamp|voyant|comfort|confort/;
  if (sys === "C" && /brake|abs|frein|stability|esp/.test(d)) return "élevée";
  if (sys === "P" && sub === "3") return "élevée";   // allumage / ratés
  if (HIGH.test(d)) return "élevée";
  if (LOW.test(d)) return "faible";
  return "modérée";
}

// Libellé compact prêt pour le prompt.
export function enrichLine(code, description, brandCauses) {
  const cat = faultCategory(code);
  const sev = severityHint(code, description);
  const causes = brandCauses && brandCauses !== description ? ` | Causes fréquentes : ${brandCauses}` : "";
  return `${code}: ${description || "libellé inconnu"}${causes} [catégorie : ${cat} · gravité estimée : ${sev}]`;
}
