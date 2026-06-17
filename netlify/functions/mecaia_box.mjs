// ============================================================
// MECAIA_BOX.MJS — Agent Dylan OBD2 Autonome v2
// 17/06/2026 — Dylan comprend le langage naturel et exécute
// les actions OBD2 automatiquement via des [CMD:xxx] tags.
//
// Architecture agent :
//   1. User parle en langage naturel
//   2. Dylan répond avec texte + [CMD:xxx] optionnels
//   3. Frontend parse les CMD, exécute via IPC Electron
//   4. Résultats renvoyés à Dylan pour la suite
//   5. Boucle jusqu'à résolution complète
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Connaissance des véhicules et leurs capacités ─────────────────────────────
const VEHICLE_KNOWLEDGE = {
  vw:        { name: "Volkswagen",    resets: ["huile","dpf","frein","batt","papillon","injecteur"], actuators: ["ventilateur","purge_evap","egr","injecteur_test","frein_parking"], options: ["feux_journee","essuie_pluie","confort_fermeture","demarrage_sans_cle","lane_assist"] },
  audi:      { name: "Audi",          resets: ["huile","dpf","frein","batt","papillon","injecteur","boite"], actuators: ["ventilateur","purge_evap","egr","injecteur_test","frein_parking"], options: ["feux_journee","essuie_pluie","lane_assist"] },
  seat:      { name: "SEAT",          resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr","frein_parking"], options: ["feux_journee"] },
  skoda:     { name: "Škoda",         resets: ["huile","dpf","frein","batt","papillon"], actuators: ["ventilateur","egr","frein_parking"], options: ["feux_journee"] },
  peugeot:   { name: "Peugeot",       resets: ["huile","dpf","frein","batt","papillon"], actuators: ["ventilateur","egr","purge_evap","frein_parking"], options: ["feux_journee"] },
  citroen:   { name: "Citroën",       resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr","frein_parking"], options: ["feux_journee"] },
  opel:      { name: "Opel",          resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr"], options: ["feux_journee"] },
  renault:   { name: "Renault",       resets: ["huile","dpf","frein","batt","papillon"], actuators: ["ventilateur","egr","purge_evap"], options: ["feux_journee","essuie_pluie"] },
  dacia:     { name: "Dacia",         resets: ["huile","dpf","frein"], actuators: ["ventilateur","egr"], options: [] },
  bmw:       { name: "BMW",           resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr","frein_parking"], options: ["feux_journee","lane_assist","sport_display"] },
  mini:      { name: "MINI",          resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","frein_parking"], options: ["feux_journee"] },
  mercedes:  { name: "Mercedes",      resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr"], options: ["feux_journee"] },
  ford:      { name: "Ford",          resets: ["huile","dpf","frein","batt","papillon"], actuators: ["ventilateur","egr","purge_evap"], options: ["feux_journee"] },
  toyota:    { name: "Toyota",        resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr"], options: ["feux_journee"] },
  honda:     { name: "Honda",         resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur"], options: [] },
  hyundai:   { name: "Hyundai",       resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr","frein_parking"], options: ["feux_journee"] },
  kia:       { name: "Kia",           resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr","frein_parking"], options: ["feux_journee"] },
  fiat:      { name: "Fiat",          resets: ["huile","dpf","frein"], actuators: ["ventilateur","egr"], options: [] },
  alfa:      { name: "Alfa Romeo",    resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr"], options: ["feux_journee"] },
  volvo:     { name: "Volvo",         resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr","frein_parking"], options: [] },
  mazda:     { name: "Mazda",         resets: ["huile","dpf","frein"], actuators: ["ventilateur","egr"], options: ["feux_journee"] },
  nissan:    { name: "Nissan",        resets: ["huile","dpf","frein","batt"], actuators: ["ventilateur","egr"], options: [] },
  subaru:    { name: "Subaru",        resets: ["huile","dpf","frein"], actuators: ["ventilateur"], options: [] },
  suzuki:    { name: "Suzuki",        resets: ["huile","frein"], actuators: ["ventilateur"], options: [] },
  mitsubishi:{ name: "Mitsubishi",    resets: ["huile","dpf","frein"], actuators: ["ventilateur","egr"], options: [] },
  default:   { name: "Véhicule",      resets: ["huile","dpf","frein"], actuators: ["ventilateur","egr","purge_evap"], options: [] },
};

// ── Labels lisibles pour les CMD ────────────────────────────────────────────────
const RESET_LABELS = {
  huile: "remise à zéro vidange huile", dpf: "régénération/reset FAP/DPF",
  frein: "remise à zéro usure freins", batt: "adaptation batterie (BMS reset)",
  papillon: "adaptation corps papillon", injecteur: "calibration injecteurs", boite: "adaptation boîte auto",
};
const ACTUATOR_LABELS = {
  ventilateur: "ventilateur de refroidissement", purge_evap: "vanne purge EVAP",
  egr: "vanne EGR", injecteur_test: "test injecteurs par cylindre",
  frein_parking: "frein de parking électronique (EPB)", pompe_eau: "pompe à eau",
  lambda_chauffage: "chauffage sonde lambda", klaxon_test: "klaxon",
};
const OPTION_LABELS = {
  feux_journee: "feux de jour (DRL)", essuie_pluie: "essuie-glace auto pluie",
  confort_fermeture: "fermeture vitres par télécommande", demarrage_sans_cle: "démarrage sans clé (Keyless)",
  lane_assist: "aide au maintien de voie", sport_display: "affichage sportif tableau de bord",
};

// ── DTC database (codes les plus communs en français) ─────────────────────────
const DTC_DESC = {
  P0300:"Ratés d'allumage aléatoires",P0301:"Raté allumage cyl.1",P0302:"Raté allumage cyl.2",P0303:"Raté allumage cyl.3",P0304:"Raté allumage cyl.4",
  P0171:"Mélange trop pauvre banque 1",P0172:"Mélange trop riche banque 1",P0174:"Mélange trop pauvre banque 2",
  P0420:"Catalyseur sous seuil banque 1",P0421:"Catalyseur peu efficace",
  P0440:"Fuite système évaporation EVAP",P0441:"Débit incorrect EVAP",P0442:"Petite fuite EVAP",P0455:"Grande fuite EVAP",
  P0401:"Débit EGR insuffisant",P0402:"Débit EGR excessif",P0403:"Circuit EGR",
  P0100:"Capteur MAF — circuit",P0101:"Débit MAF hors plage",P0102:"Signal MAF faible",P0103:"Signal MAF élevé",
  P0113:"Capteur temp. admission — signal haut",P0112:"Capteur temp. admission — signal bas",
  P0116:"Capteur temp. refroidissement hors plage",P0117:"Temp. refr. signal bas",P0118:"Temp. refr. signal haut",
  P0130:"Sonde O2 B1S1 — circuit",P0131:"Sonde O2 B1S1 — tension faible",P0132:"Sonde O2 B1S1 — tension haute",
  P0134:"Sonde O2 B1S1 — inactivité",P0135:"Sonde O2 B1S1 — chauffage",
  P0340:"Capteur position arbre cames — circuit",P0335:"Capteur position vilebrequin",
  P0011:"Phase arbre cames A — trop avancée B1",P0012:"Phase arbre cames A — trop retardée B1",
  P0261:"Injecteur cyl.1 — court-circuit bas",P0262:"Injecteur cyl.1 — court-circuit haut",
  P0500:"Capteur vitesse véhicule",P0505:"Ralenti — contrôle système",
  P0600:"Communication CAN bus",P0605:"ECU — mémoire ROM",
  P0700:"Défaut boîte automatique (voir codes T)",P0715:"Vitesse turbine boîte auto",
  P2177:"Mélange trop pauvre à charge nulle B1",P2187:"Mélange trop pauvre au ralenti B1",
};

// ── Prompt système de l'agent Dylan ─────────────────────────────────────────────
function buildSystemPrompt(vehicleInfo, brand) {
  const veh = VEHICLE_KNOWLEDGE[brand] || VEHICLE_KNOWLEDGE.default;
  const resetsAvail  = veh.resets.map(k => `${k} (${RESET_LABELS[k]||k})`).join(", ");
  const actuatorsAvail = veh.actuators.map(k => `${k} (${ACTUATOR_LABELS[k]||k})`).join(", ");
  const optionsAvail = veh.options.length ? veh.options.map(k => `${k} (${OPTION_LABELS[k]||k})`).join(", ") : "aucune connue via OBD2 standard";

  return `Tu es Dylan, expert mécanicien automobile IA de MecaIA.
Tu es connecté à un boitier OBD2 branché sur la voiture de l'utilisateur.
Tu peux RÉELLEMENT agir sur la voiture en envoyant des commandes OBD2.

## VÉHICULE CONNECTÉ
Marque : ${veh.name}${vehicleInfo.vin ? `\nVIN : ${vehicleInfo.vin}` : ""}${vehicleInfo.ecuName ? `\nECU : ${vehicleInfo.ecuName}` : ""}

## TON RÔLE
Tu es comme un mécanicien qui a accès à la valise diagnostic. Tu expliques tout simplement, sans jargon technique.
L'utilisateur n'a peut-être jamais ouvert un capot de sa vie — adapte ton langage en conséquence.
Tu guises l'utilisateur étape par étape, tu confirmes avant les actions importantes, tu rassures.

## TES OUTILS OBD2 (tu peux les utiliser en écrivant [CMD:xxx])

### LECTURE DE DONNÉES
- [CMD:scan_full] → Scan complet : VIN, codes défauts, paramètres moteur, moniteurs, freeze frame
- [CMD:read_dtcs] → Lire les codes défauts actuels
- [CMD:read_live] → Lire les paramètres moteur en temps réel (RPM, temp, etc.)
- [CMD:read_monitors] → Vérifier quels systèmes sont prêts (contrôle technique)
- [CMD:read_freeze] → Données moteur au moment du dernier défaut

### OPTIONS VÉHICULE (coding)
- [CMD:read_options:${brand}] → Vérifier les options disponibles/activées sur ce véhicule
- [CMD:activate_option:feux_journee:${brand}] → Activer les feux de jour
- [CMD:deactivate_option:feux_journee:${brand}] → Désactiver les feux de jour
- (idem pour : essuie_pluie, confort_fermeture, demarrage_sans_cle, lane_assist)
- Options disponibles sur ce véhicule : ${optionsAvail}

### TESTS D'ACTIONNEURS (tu actives un composant pour le tester)
- [CMD:activate:ventilateur:${brand}] → Démarrer le ventilateur électrique
- [CMD:deactivate:ventilateur:${brand}] → Arrêter le ventilateur
- [CMD:activate:egr:${brand}] → Ouvrir la vanne EGR
- [CMD:deactivate:egr:${brand}] → Fermer la vanne EGR
- [CMD:activate:purge_evap:${brand}] → Ouvrir la vanne EVAP
- [CMD:activate:injecteur_test:${brand}] → Tester les injecteurs
- Actionneurs disponibles sur ce véhicule : ${actuatorsAvail}

### MAINTENANCE FREINS (mode entretien EPB)
- [CMD:epb_open:${brand}] → Ouvrir les étriers de frein électronique (mode entretien)
- [CMD:epb_close:${brand}] → Refermer les étriers (mode normal, pistons sortis)
⚠️ TOUJOURS demander confirmation avant epb_open/epb_close

### RESETS SERVICE
- [CMD:reset:huile:${brand}] → Remettre à zéro le compteur de vidange
- [CMD:reset:dpf:${brand}] → Régénération/reset filtre à particules (diesel uniquement)
- [CMD:reset:frein:${brand}] → Remettre à zéro l'usure des plaquettes
- [CMD:reset:batt:${brand}] → Adaptation nouvelle batterie
- [CMD:reset:papillon:${brand}] → Recalibrer le corps papillon
- Resets disponibles sur ce véhicule : ${resetsAvail}

### EFFACEMENT DES CODES
- [CMD:clear_dtcs] → Effacer tous les codes défauts (seulement si tu es sûr que le problème est résolu)

## RÈGLES ABSOLUES DE SÉCURITÉ
1. TOUJOURS annoncer ce que tu vas faire AVANT d'envoyer un [CMD]
2. TOUJOURS demander confirmation avant : clear_dtcs, epb_open, epb_close, tout reset service
3. NE JAMAIS effacer les codes si l'utilisateur veut aller chez le garagiste (les codes servent de preuve)
4. Pour les actionneurs : prévenir l'utilisateur de ce qu'il va entendre/voir ("tu vas entendre le ventilateur démarrer")
5. TOUJOURS conseiller un garage pour les codes P0 complexes si tu n'es pas sûr
6. Si tu ne sais pas : dis-le honnêtement, propose d'aller chez un pro

## STYLE DE COMMUNICATION
- Langage simple, comme un ami mécanicien bienveillant
- Emojis modérés (🔧 ✅ ⚠️ 🔴 🟡 🟢)
- Toujours rassurer l'utilisateur : "pas de panique", "c'est simple", "je m'en occupe"
- Explique POURQUOI tu fais ce que tu fais
- Donne une estimation de coût réparation si tu peux
- Quand tu actives un composant : "dis-moi ce que tu entends/vois"

## FORMAT DE RÉPONSE
Écris du texte normal + ajoute les [CMD:xxx] quand tu veux agir.
Les CMD sont exécutés automatiquement, tu recevras les résultats ensuite.
Exemple : "Je vais d'abord lire tes codes défauts. [CMD:read_dtcs] Dis-moi ce que tu ressens en conduisant..."

IMPORTANT : Ne génère jamais de [CMD] en dehors de ta réponse principale. Un seul [CMD:scan_full] suffit pour démarrer.`;
}

// ── Handler principal ──────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      messages = [],
      is_obd2_scan = false,
      vehicle_context = {},
      brand = "default",
      language = "fr",
    } = body;

    // Construire le contexte véhicule
    const vehicleInfo = vehicle_context || {};

    // Construire les messages pour Claude
    const systemPrompt = buildSystemPrompt(vehicleInfo, brand);

    // Si c'est un scan OBD2, enrichir le dernier message avec les données
    let enrichedMessages = messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    // Enrichissement du contexte si des données OBD2 sont présentes
    if (is_obd2_scan && vehicleInfo.dtcs !== undefined) {
      const dtcList = (vehicleInfo.dtcs || []).map(d => {
        const desc = DTC_DESC[d.code] || "code constructeur";
        return `${d.code} (${desc})${d.pending ? " [EN ATTENTE]" : ""}${d.permanent ? " [PERMANENT]" : ""}`;
      });

      const pidSummary = vehicleInfo.pids ? Object.values(vehicleInfo.pids)
        .filter(p => p.value !== null && !isNaN(p.value))
        .map(p => `${p.label}: ${p.value} ${p.unit}`)
        .slice(0, 12)
        .join(" | ") : "";

      const monSummary = vehicleInfo.monitors?.monitors
        ?.filter(m => !m.ready)
        ?.map(m => m.name)
        ?.join(", ") || "tous prêts";

      const scanContext = `
=== RÉSULTATS DU SCAN OBD2 ===
VIN : ${vehicleInfo.vin || "non lu"}
Codes défauts confirmés : ${dtcList.length ? dtcList.join(", ") : "AUCUN ✅"}
Codes en attente : ${(vehicleInfo.pendingDtcs||[]).length || "aucun"}
Codes permanents : ${(vehicleInfo.permanentDtcs||[]).length || "aucun"}
Voyant moteur (MIL) : ${vehicleInfo.monitors?.milOn ? "🔴 ALLUMÉ" : "🟢 ÉTEINT"}
Moniteurs non prêts : ${monSummary}
Paramètres moteur : ${pidSummary || "non disponibles"}
${vehicleInfo.freezeFrame && Object.keys(vehicleInfo.freezeFrame).length ? `Freeze Frame (données au défaut) : ${Object.entries(vehicleInfo.freezeFrame).map(([k,v])=>`${k}: ${v.value}${v.unit}`).join(" | ")}` : ""}
=== FIN SCAN ===`;

      // Remplacer ou enrichir le dernier message utilisateur
      if (enrichedMessages.length > 0 && enrichedMessages[enrichedMessages.length - 1].role === "user") {
        enrichedMessages[enrichedMessages.length - 1].content += "\n" + scanContext;
      } else {
        enrichedMessages.push({
          role: "user",
          content: "Résultats du scan OBD2 complet :\n" + scanContext + "\nAnalyse ces résultats et dis-moi ce qui ne va pas sur ma voiture.",
        });
      }
    }

    // Appel Claude Haiku
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: enrichedMessages.length > 0 ? enrichedMessages : [
        { role: "user", content: "Bonjour Dylan !" },
      ],
    });

    const message = response.content[0]?.text || "Je suis là pour vous aider !";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message,
        usage: response.usage,
      }),
    };

  } catch (error) {
    console.error("[MECAIA_BOX] error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: "Dylan est momentanément indisponible. Vérifiez votre connexion internet.",
        error: error.message,
      }),
    };
  }
};
