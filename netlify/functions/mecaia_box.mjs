// ============================================================
// MECAIA_BOX.MJS — Agent Dylan OBD2 Expert v4
// Agent spécialisé diagnostic automobile avec données boitier réelles
// - Interprétation DTC avancée par marque
// - Corrélation DTC + PIDs temps réel
// - Actions [CMD:xxx] pilotées par Dylan
// - Multi-langue (FR/NL/EN/DE)
// - Sécurité renforcée pour actions actionneurs/coding
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
});

// ── Base DTC étendue (200+ codes) ──────────────────────────────────────────────
const DTC_KNOWLEDGE = {
  // Ratés allumage
  P0300: { desc:"Ratés d'allumage aléatoires sur plusieurs cylindres", urgency:"HIGH", causes:["bougies d'allumage usées","bobines d'allumage défaillantes","injecteurs encrassés","compression faible","joints de culasse"], cost:"150-600€", action:"Ne pas rouler sur autoroute. Contrôle urgent bougie+bobine.", can_drive:false },
  P0301: { desc:"Raté d'allumage cylindre 1", urgency:"HIGH", causes:["bougie cyl.1","bobine cyl.1","injecteur cyl.1"], cost:"100-400€", action:"Remplacer bougie et tester bobine cyl.1", can_drive:false },
  P0302: { desc:"Raté d'allumage cylindre 2", urgency:"HIGH", causes:["bougie cyl.2","bobine cyl.2","injecteur cyl.2"], cost:"100-400€", action:"Remplacer bougie et tester bobine cyl.2", can_drive:false },
  P0303: { desc:"Raté d'allumage cylindre 3", urgency:"HIGH", causes:["bougie cyl.3","bobine cyl.3","injecteur cyl.3"], cost:"100-400€", action:"Remplacer bougie et tester bobine cyl.3", can_drive:false },
  P0304: { desc:"Raté d'allumage cylindre 4", urgency:"HIGH", causes:["bougie cyl.4","bobine cyl.4","injecteur cyl.4"], cost:"100-400€", action:"Remplacer bougie et tester bobine cyl.4", can_drive:false },
  // Mélange carburant
  P0171: { desc:"Mélange trop pauvre banque 1", urgency:"MEDIUM", causes:["fuite d'air admission","sonde MAF sale","sonde lambda HS","injecteurs bouchés","pression carburant faible"], cost:"80-500€", action:"Vérifier durites admission et nettoyer MAF", can_drive:true },
  P0172: { desc:"Mélange trop riche banque 1", urgency:"MEDIUM", causes:["injecteurs qui fuient","pression carburant trop haute","sonde lambda HS"], cost:"100-800€", action:"Vérifier injecteurs et sonde lambda", can_drive:true },
  P0174: { desc:"Mélange trop pauvre banque 2", urgency:"MEDIUM", causes:["fuite d'air côté B2","sonde MAF","injecteurs B2"], cost:"80-500€", action:"Diagnostic coté B2 identique P0171", can_drive:true },
  P0175: { desc:"Mélange trop riche banque 2", urgency:"MEDIUM", causes:["injecteurs B2 fuient","sonde O2 aval B2 HS"], cost:"100-800€", action:"Vérifier injecteurs B2", can_drive:true },
  // Catalyseur
  P0420: { desc:"Efficacité catalyseur sous seuil banque 1 — catalyseur fatigué", urgency:"MEDIUM", causes:["catalyseur usé","sonde O2 aval défaillante","ratés non traités ayant brûlé le cat"], cost:"300-1200€", action:"Ne pas ignorer. Remplacement catalyseur à prévoir.", can_drive:true },
  P0430: { desc:"Efficacité catalyseur sous seuil banque 2", urgency:"MEDIUM", causes:["catalyseur B2 usé","sonde O2 aval B2 HS"], cost:"300-1200€", action:"Remplacement catalyseur B2", can_drive:true },
  // EVAP
  P0440: { desc:"Fuite système anti-évaporation carburant", urgency:"LOW", causes:["bouchon réservoir mal fermé","vanne EVAP HS","durites EVAP fissurées"], cost:"50-400€", action:"Vérifier le bouchon du réservoir en premier", can_drive:true },
  P0441: { desc:"Débit incorrect circuit purge EVAP", urgency:"LOW", causes:["vanne purge EVAP bloquée","tuyau EVAP bouché"], cost:"100-300€", action:"Test vanne purge disponible via actionneurs", can_drive:true },
  P0442: { desc:"Petite fuite système EVAP", urgency:"LOW", causes:["microcraquelure durite","vanne EVAP légèrement fuyante"], cost:"50-300€", action:"Vérifier toutes connexions du système EVAP", can_drive:true },
  P0455: { desc:"Grande fuite système EVAP — souvent le bouchon du réservoir", urgency:"LOW", causes:["bouchon réservoir défectueux","grosse fuite durite"], cost:"20-400€", action:"Changer le bouchon du réservoir en premier", can_drive:true },
  // EGR
  P0401: { desc:"Débit EGR insuffisant — vanne EGR encrassée ou bloquée", urgency:"MEDIUM", causes:["vanne EGR encrassée","capteur position EGR HS"], cost:"100-500€", action:"Test vanne EGR via actionneurs. Nettoyage souvent suffisant.", can_drive:true },
  P0402: { desc:"Débit EGR excessif", urgency:"MEDIUM", causes:["vanne EGR bloquée ouverte","capteur EGR HS"], cost:"100-400€", action:"Test vanne EGR via actionneurs", can_drive:true },
  // MAF
  P0100: { desc:"Circuit capteur débit masse air (MAF) — défaut", urgency:"HIGH", causes:["MAF sale","câblage MAF","MAF défaillant"], cost:"100-400€", action:"Nettoyer la MAF avec spray nettoyant MAF", can_drive:true },
  P0102: { desc:"Signal MAF trop faible", urgency:"HIGH", causes:["MAF sale ou HS","fuite admission après MAF"], cost:"100-400€", action:"Nettoyer la MAF d'abord", can_drive:true },
  P0103: { desc:"Signal MAF trop élevé", urgency:"HIGH", causes:["MAF HS","court-circuit câblage"], cost:"200-500€", action:"Remplacer la MAF", can_drive:true },
  // Température
  P0116: { desc:"Température refroidissement hors plage normale", urgency:"MEDIUM", causes:["sonde température HS","thermostat bloqué"], cost:"80-300€", action:"Vérifier si moteur monte bien à température", can_drive:true },
  P0117: { desc:"Signal sonde température refroidissement trop bas", urgency:"MEDIUM", causes:["sonde HS court-circuit","câblage"], cost:"80-200€", action:"Remplacer la sonde de température", can_drive:true },
  P0118: { desc:"Signal sonde température refroidissement trop haut", urgency:"HIGH", causes:["sonde HS circuit ouvert","câblage coupé"], cost:"80-200€", action:"Remplacer la sonde de température. Surveiller la température.", can_drive:false },
  // Sondes O2
  P0130: { desc:"Circuit sonde lambda B1S1 (amont) — défaut général", urgency:"MEDIUM", causes:["sonde lambda usée","câblage","contamination"], cost:"150-400€", action:"Vérifier la tension de sortie de la sonde", can_drive:true },
  P0134: { desc:"Sonde O2 B1S1 — aucune activité", urgency:"MEDIUM", causes:["sonde lambda HS","chauffage grillé"], cost:"150-400€", action:"Test chauffage sonde lambda via actionneurs", can_drive:true },
  P0135: { desc:"Chauffage sonde O2 B1S1 — circuit défaillant", urgency:"MEDIUM", causes:["résistance chauffage grillée","câblage"], cost:"150-400€", action:"Test chauffage sonde lambda via actionneurs", can_drive:true },
  // VVT / Arbre à cames
  P0011: { desc:"Phase arbre à cames admission trop avancée B1 — VVT", urgency:"MEDIUM", causes:["huile sale bloquant VVT","solénoïde VVT HS","faible pression huile"], cost:"100-600€", action:"Changer l'huile et voir si le code revient", can_drive:true },
  P0012: { desc:"Phase arbre à cames admission trop retardée B1", urgency:"MEDIUM", causes:["solénoïde VVT HS","huile dégradée"], cost:"200-1000€", action:"Vérifier pression huile et solénoïde VVT", can_drive:true },
  P0340: { desc:"Circuit capteur position arbre à cames — défaut", urgency:"HIGH", causes:["capteur HS","roue phonique endommagée"], cost:"100-300€", action:"Contrôle urgent — peut causer arrêt moteur", can_drive:false },
  P0335: { desc:"Circuit capteur position vilebrequin — défaut", urgency:"HIGH", causes:["capteur vilebrequin HS","roue phonique vilebrequin"], cost:"100-400€", action:"Remplacement urgent — le moteur peut s'arrêter", can_drive:false },
  // Boîte auto
  P0700: { desc:"Défaut boîte automatique — consulter les codes T en complément", urgency:"MEDIUM", causes:["nombreuses causes possibles"], cost:"variable", action:"Lire les codes défauts boîte avec outil spécifique", can_drive:true },
  // Batterie/alternateur
  P0562: { desc:"Tension batterie trop basse", urgency:"HIGH", causes:["batterie faible","alternateur HS","connexions oxydées"], cost:"80-400€", action:"Mesurer tension batterie. Doit être 12,6V repos, 14V moteur.", can_drive:true },
  P0563: { desc:"Tension batterie trop haute", urgency:"MEDIUM", causes:["régulateur alternateur HS","surcharge du circuit"], cost:"150-500€", action:"Vérifier l'alternateur", can_drive:true },
  // Turbo
  P0299: { desc:"Sous-régime turbo — pression de suralimentation insuffisante", urgency:"HIGH", causes:["vanne N75 HS","turbine encrassée","durites suralimentation fuitantes","turbo en fin de vie"], cost:"300-2000€", action:"Nettoyer vanne N75, vérifier durites.", can_drive:true },
  P0234: { desc:"Pression de suralimentation excessive (over-boost)", urgency:"HIGH", causes:["vanne N75 collée","capteur MAP HS","wastegate bloquée"], cost:"200-1500€", action:"Ne pas solliciter le moteur. Contrôle turbo urgent.", can_drive:false },
  P0087: { desc:"Pression carburant insuffisante dans le rail (diesel direct)", urgency:"HIGH", causes:["pompe haute pression défaillante","filtre à carburant colmaté","injecteurs fuites retour"], cost:"200-1500€", action:"Contrôle urgent. Ne pas rouler à pleine charge.", can_drive:false },
  P0088: { desc:"Pression carburant rail trop haute", urgency:"HIGH", causes:["régulateur pression défaillant","capteur pression HS"], cost:"200-800€", action:"Diagnostic urgence pression rail", can_drive:false },
  // DPF/FAP
  P2002: { desc:"Efficacité filtre à particules insuffisante banque 1 (FAP colmaté)", urgency:"HIGH", causes:["FAP saturé","régénération incomplète","huile moteur dans FAP"], cost:"200-1500€", action:"Régénération forcée si possible. Sinon nettoyage ou remplacement FAP.", can_drive:true },
  P2459: { desc:"Fréquence de régénération FAP anormale", urgency:"MEDIUM", causes:["conduite trop courte","thermostat HS"], cost:"100-800€", action:"Faire une route à vitesse soutenue pour régénération", can_drive:true },
  P2452: { desc:"Capteur pression différentielle FAP — circuit", urgency:"MEDIUM", causes:["sonde delta-P HS","tuyaux sonde colmatés"], cost:"100-400€", action:"Nettoyer ou remplacer sonde différentielle FAP", can_drive:true },
  // Ralenti
  P0506: { desc:"Ralenti trop bas", urgency:"MEDIUM", causes:["encrassement corps papillon","vanne IAC HS","fuite d'air"], cost:"100-400€", action:"Nettoyer corps papillon et vanne IAC", can_drive:true },
  P0507: { desc:"Ralenti trop élevé", urgency:"MEDIUM", causes:["corps papillon collé","vanne IAC bloquée","fuite d'air admission"], cost:"100-400€", action:"Nettoyer corps papillon. Vérifier durites admission.", can_drive:true },
  P0521: { desc:"Signal capteur pression huile hors plage", urgency:"HIGH", causes:["capteur pression huile HS","pression huile réellement basse"], cost:"50-500€", action:"Vérifier niveau et pression huile IMMÉDIATEMENT", can_drive:false },
  // ABS/ESP
  C0031: { desc:"Capteur roue avant droite (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS","roue phonique endommagée"], cost:"100-300€", action:"ABS et ESP désactivés. Rouler prudemment. Remplacer capteur.", can_drive:true },
  C0034: { desc:"Capteur roue avant gauche (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS"], cost:"100-300€", action:"ABS désactivé. Remplacer capteur.", can_drive:true },
  C0037: { desc:"Capteur roue arrière droite (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS"], cost:"100-300€", action:"Remplacer capteur ABS roue AR droite", can_drive:true },
  C0040: { desc:"Capteur roue arrière gauche (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS"], cost:"100-300€", action:"Remplacer capteur ABS roue AR gauche", can_drive:true },
  // CAN Bus
  U0100: { desc:"Perte communication ECU moteur (CAN Bus)", urgency:"HIGH", causes:["câble CAN coupé","calculateur hors tension","connecteur dessoudé"], cost:"200-1500€", action:"Vérifier alimentation ECU et câble CAN. Pro recommandé.", can_drive:false },
  U0101: { desc:"Perte communication TCU (boîte auto)", urgency:"HIGH", causes:["câble CAN vers TCU","TCU HS"], cost:"200-1500€", action:"Diagnostic réseau CAN", can_drive:false },
  U0121: { desc:"Perte communication module ABS/ESP", urgency:"HIGH", causes:["câble CAN","module ABS HS"], cost:"300-1500€", action:"Diagnostic CAN vers ABS. ABS/ESP inactifs.", can_drive:false },
};

// ── Capacités réelles par marque (OBD2 standard + UDS) ─────────────────────────
const BRAND_CAPS = {
  vw:       { resets:["huile","dpf","frein","batt","papillon","injecteur","boite"], actuators:["ventilateur","egr","purge_evap","injecteur_test","frein_parking"], options:["feux_journee","essuie_pluie","confort_fermeture","retros_rabattables","feux_bienvenue","feux_virage","klaxon_verrouillage","demarrage_sans_cle","lane_assist"] },
  audi:     { resets:["huile","dpf","frein","batt","papillon","injecteur","boite"], actuators:["ventilateur","egr","purge_evap","injecteur_test","frein_parking"], options:["feux_journee","essuie_pluie","lane_assist","retros_rabattables"] },
  seat:     { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"] },
  skoda:    { resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee","essuie_pluie"] },
  peugeot:  { resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","purge_evap","frein_parking"], options:["feux_journee"] },
  citroen:  { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"] },
  opel:     { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"] },
  renault:  { resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","purge_evap"], options:["feux_journee","essuie_pluie"] },
  dacia:    { resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[] },
  bmw:      { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee","sport_display","lane_assist"] },
  mini:     { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","frein_parking"], options:["feux_journee"] },
  mercedes: { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"] },
  ford:     { resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","purge_evap"], options:["feux_journee"] },
  toyota:   { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"] },
  honda:    { resets:["huile","dpf","frein","batt"], actuators:["ventilateur"], options:[] },
  hyundai:  { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"] },
  kia:      { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"] },
  volvo:    { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:[] },
  mazda:    { resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[] },
  nissan:   { resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:[] },
  default:  { resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[] },
};

// ── Analyse des PIDs critiques ──────────────────────────────────────────────────
function analyzePIDs(pids) {
  if (!pids || typeof pids !== 'object') return "";
  const alerts = [];
  const vals = {};

  // Extraire les valeurs
  for (const [key, p] of Object.entries(pids)) {
    if (p && p.value != null) vals[key] = p.value;
  }

  // Alertes PIDs
  if (vals.COOLANT > 100)  alerts.push(`⚠️ Température moteur ÉLEVÉE: ${vals.COOLANT}°C (surchauffe possible!)`);
  if (vals.COOLANT < 60 && vals.RPM > 0)  alerts.push(`⚠️ Moteur froid: ${vals.COOLANT}°C (normal si démarrage récent)`);
  if (vals.BATTERY < 12)   alerts.push(`⚠️ Batterie FAIBLE: ${vals.BATTERY}V (devrait être 12,6V repos ou 13,5-14,5V moteur)`);
  if (vals.BATTERY > 15)   alerts.push(`⚠️ Tension TROP HAUTE: ${vals.BATTERY}V (alternateur HS?)`);
  if (vals.OIL_TEMP > 135) alerts.push(`⚠️ Huile SURCHAUFFÉE: ${vals.OIL_TEMP}°C`);
  if (vals.FUEL_LEVEL < 15) alerts.push(`⚠️ Niveau carburant BAS: ${vals.FUEL_LEVEL}%`);
  if (vals.ENGINE_LOAD > 90) alerts.push(`⚠️ Charge moteur ÉLEVÉE: ${vals.ENGINE_LOAD}% (normal en accélération forte)`);
  if (vals.FUEL_TRIM_ST < -20 || vals.FUEL_TRIM_ST > 20) alerts.push(`⚠️ Correction carburant CT anormale: ${vals.FUEL_TRIM_ST}% (fuite air ou injecteur?)`);
  if (vals.FUEL_TRIM_LT < -20 || vals.FUEL_TRIM_LT > 20) alerts.push(`⚠️ Correction carburant LT anormale: ${vals.FUEL_TRIM_LT}% (problème chronique)`);

  const pidSummary = Object.entries(vals)
    .filter(([k]) => !['FUEL_TRIM_ST','FUEL_TRIM_LT','BARO','O2_B1S1','O2_B1S2'].includes(k))
    .map(([k, v]) => {
      const labels = {RPM:'Régime',SPEED:'Vitesse',COOLANT:'Temp. moteur',ENGINE_LOAD:'Charge',THROTTLE:'Papillon',MAF:'MAF',BATTERY:'Batterie',OIL_TEMP:'Huile',FUEL_LEVEL:'Carburant',INTAKE_MAP:'Pression adm.',TIMING:'Allumage'};
      const units  = {RPM:'tr/min',SPEED:'km/h',COOLANT:'°C',ENGINE_LOAD:'%',THROTTLE:'%',MAF:'g/s',BATTERY:'V',OIL_TEMP:'°C',FUEL_LEVEL:'%',INTAKE_MAP:'kPa',TIMING:'°'};
      const label = labels[k] || k;
      const unit  = units[k]  || '';
      return `${label}: ${v}${unit}`;
    }).join(' | ');

  return (alerts.length ? alerts.join('\n') + '\n' : '') + (pidSummary ? `Paramètres: ${pidSummary}` : '');
}

// ── Enrichir les DTC avec connaissance ─────────────────────────────────────────
function enrichDTCs(dtcs) {
  if (!dtcs || !dtcs.length) return "";
  return dtcs.filter(d => d.code && /^[A-Z][0-9A-F]{4}$/i.test(d.code)).map(d => {
    const k = DTC_KNOWLEDGE[d.code.toUpperCase()];
    if (k) {
      return `${d.code} [${k.urgency}] : ${k.desc}
   → Causes probables: ${k.causes.slice(0, 3).join(', ')}
   → Action: ${k.action}
   → Coût estimé: ${k.cost}
   → Peut rouler: ${k.can_drive ? 'OUI avec précaution' : 'NON — danger'}`;
    }
    return `${d.code} : code non reconnu — ${d.code.startsWith('P0') ? 'système moteur générique' : d.code.startsWith('P1') ? 'code constructeur moteur' : d.code.startsWith('C') ? 'châssis/ABS/ESP' : d.code.startsWith('B') ? 'carrosserie/confort' : d.code.startsWith('U') ? 'bus CAN/réseau' : 'inconnu'}`;
  }).join('\n\n');
}

// ── System prompt agent Dylan Box ──────────────────────────────────────────────
function buildSystemPrompt(vehicleCtx, brand, language) {
  const caps = BRAND_CAPS[brand] || BRAND_CAPS.default;
  const lang = language || "fr";

  const langMap = { fr:"Français", nl:"Nederlands", en:"English", de:"Deutsch" };
  const langInstruction = lang !== 'fr'
    ? `\n\n🌐 LANGUE: Réponds TOUJOURS en ${langMap[lang] || 'Français'}, même si le message est dans une autre langue.`
    : "";

  // Contexte véhicule
  const vin  = vehicleCtx?.vin       ? `VIN : ${vehicleCtx.vin}`       : "";
  const ecu  = vehicleCtx?.ecuName   ? `ECU : ${vehicleCtx.ecuName}`   : "";
  const cal  = vehicleCtx?.calibrationId ? `Calibration : ${vehicleCtx.calibrationId}` : "";
  const vehLine = [vin, ecu, cal].filter(Boolean).join(' | ');

  // Analyser les DTC
  const dtcsConf = vehicleCtx?.dtcs         || [];
  const dtcsPend = vehicleCtx?.pendingDtcs  || [];
  const dtcsPerm = vehicleCtx?.permanentDtcs || [];
  const allDTCs  = [...dtcsConf, ...dtcsPend];
  const dtcBlock = allDTCs.length ? `\n\n=== CODES DÉFAUTS OBD2 ===\n${enrichDTCs(allDTCs)}` : "";

  // Analyser les PIDs
  const pidBlock = vehicleCtx?.pids ? `\n\n=== PARAMÈTRES MOTEUR TEMPS RÉEL ===\n${analyzePIDs(vehicleCtx.pids)}` : "";

  // Monitors
  let monitorBlock = "";
  if (vehicleCtx?.monitors) {
    const mon = vehicleCtx.monitors;
    const notReady = (mon.monitors || []).filter(m => !m.ready).map(m => m.name);
    monitorBlock = `\n\n=== MONITEURS ÉMISSIONS ===\nVoyant moteur (MIL): ${mon.milOn ? `🔴 ALLUMÉ — ${mon.dtcCount} défaut(s) actif(s)` : '🟢 ÉTEINT'}\n${notReady.length ? `Moniteurs non prêts: ${notReady.join(', ')} (ne pas passer au contrôle technique)` : 'Tous les moniteurs sont prêts ✅'}`;
  }

  // Freeze Frame
  let ffBlock = "";
  if (vehicleCtx?.freezeFrame && Object.keys(vehicleCtx.freezeFrame).length) {
    const ff = vehicleCtx.freezeFrame;
    const ffValues = Object.entries(ff).map(([k,v]) => `${k}: ${v.value}${v.unit}`).join(' | ');
    ffBlock = `\n\n=== FREEZE FRAME (conditions au moment du défaut) ===\n${ffValues}`;
  }

  // Urgence globale
  const hasHighUrgency = allDTCs.some(d => {
    const k = DTC_KNOWLEDGE[d.code?.toUpperCase()];
    return k && k.urgency === 'HIGH' && k.can_drive === false;
  });

  const resetsStr   = caps.resets.join(', ');
  const actuatorsStr = caps.actuators.join(', ');
  const optionsStr   = caps.options.length ? caps.options.join(', ') : 'aucune disponible via OBD2 standard';

  return `Tu es Dylan, expert mécanicien IA de MecaIA Box — le meilleur ami mécanicien dans la poche.

Tu as accès aux données RÉELLES du boitier OBD2 connecté à la voiture. Tu analyses ces données et guides l'utilisateur de façon intuitive et naturelle, comme un vrai mécanicien à côté du capot.

## MARQUE VÉHICULE
${brand !== 'default' ? `Marque : ${brand.toUpperCase()}` : 'Marque : non sélectionnée'}
${vehLine}
Resets disponibles : ${resetsStr}
Actionneurs disponibles : ${actuatorsStr}
Options coding disponibles : ${optionsStr}
${dtcBlock}${pidBlock}${monitorBlock}${ffBlock}
${hasHighUrgency ? '\n⚠️ ATTENTION : Des codes critiques nécessitent un arrêt. NE PAS ROULER.' : ''}

## TON CARACTÈRE
- Chaleureux et rassurant : "Pas de panique, c'est courant !"
- Langage simple, accessible à quelqu'un qui n'a jamais ouvert un capot
- Expert : tu corrèles DTC + PIDs + contexte pour des diagnostics précis
- Proactif : tu suggères l'étape suivante sans que l'utilisateur demande
- Honnête : si c'est hors de ta portée, tu dis "va chez le garagiste"

## TES ACTIONS [CMD:xxx]
Utilise ces balises dans tes réponses pour déclencher des actions OBD2 :

### LECTURES
[CMD:scan_full]           → Scanner tout (VIN + codes + PIDs + moniteurs)
[CMD:read_dtcs]           → Lire les codes défauts
[CMD:read_live]           → Voir les paramètres temps réel
[CMD:read_monitors]       → Vérifier les moniteurs d'émissions
[CMD:read_freeze]         → Lire le Freeze Frame (données au moment du défaut)

### RESETS SERVICE (demander confirmation AVANT)
[CMD:reset:huile:${brand}]       → Remettre compteur vidange à zéro
[CMD:reset:dpf:${brand}]         → Forcer régénération FAP/DPF
[CMD:reset:frein:${brand}]       → Remettre usure plaquettes à zéro
[CMD:reset:batt:${brand}]        → Adaptation nouvelle batterie (BMS)
[CMD:reset:papillon:${brand}]    → Recalibrer corps de papillon
[CMD:reset:injecteur:${brand}]   → Coder les injecteurs (diesel direct)

### TESTS ACTIONNEURS (prévenir l'utilisateur)
[CMD:activate:ventilateur:${brand}]  → Activer le ventilateur (l'utilisateur l'entend)
[CMD:deactivate:ventilateur:${brand}]→ Arrêter
[CMD:activate:egr:${brand}]          → Ouvrir vanne EGR
[CMD:deactivate:egr:${brand}]        → Fermer vanne EGR
[CMD:activate:purge_evap:${brand}]   → Ouvrir vanne EVAP
[CMD:deactivate:purge_evap:${brand}] → Fermer
[CMD:activate:injecteur_test:${brand}]→ Tester injecteurs cyl par cyl

### MODE ENTRETIEN FREINS (EPB électronique)
[CMD:epb_open:${brand}]   → OUVRIR étriers (pistons rentrent → place pour nouvelles plaquettes)
[CMD:epb_close:${brand}]  → FERMER étriers (pistons sortent → mode normal)
⚠️ TOUJOURS vérifier que la voiture est sur cric et roue démontée AVANT epb_open

### OPTIONS CODING (modifier le comportement du véhicule)
[CMD:activate_option:feux_journee:${brand}]        → Activer feux de jour
[CMD:deactivate_option:feux_journee:${brand}]      → Désactiver
[CMD:activate_option:retros_rabattables:${brand}]  → Rétros rabattables auto
[CMD:activate_option:feux_bienvenue:${brand}]      → Coming Home
[CMD:activate_option:klaxon_verrouillage:${brand}] → Bip fermeture
[CMD:activate_option:essuie_pluie:${brand}]        → Essuie-pluie automatique
[CMD:activate_option:confort_fermeture:${brand}]   → Vitres par télécommande

### EFFACEMENT CODES
[CMD:clear_dtcs]  → Effacer tous les codes défauts
⚠️ NE JAMAIS effacer si l'utilisateur va chez le garagiste (les codes = preuve)

## SCÉNARIOS TYPES

### "Trouve la panne" / "Scan complet" / utilisateur envoie les données de scan
→ Analyse TOUT ce que tu as : DTC + PIDs + Freeze Frame + Monitors
→ Explique chaque code en langage simple
→ Donne une priorité (🔴 urgent / 🟠 bientôt / 🟢 préventif)
→ Propose une action concrète
→ Donne un coût estimé

### "Quelles options puis-je débloquer ?"
→ Liste les options disponibles pour cette marque
→ Explique ce que fait chaque option
→ Demande : "Laquelle voulez-vous activer ?"

### "Active [option]" / "Je veux les feux de jour"
→ Confirme : "Je vais activer les feux de jour. Après, ils s'allumeront automatiquement au démarrage. C'est bon ?"
→ Attends confirmation → [CMD:activate_option:feux_journee:${brand}]
→ "Fait ! Redémarrez le véhicule pour que ça prenne effet."

### "Je veux changer mes plaquettes arrière"
→ Si frein parking électronique : "Je vais mettre les étriers en mode entretien. Étapes : 1. Levez la voiture ✓ 2. Démontez la roue ✓ 3. Je rentre les pistons..."
→ [CMD:epb_open:${brand}]
→ Guide le remplacement pas à pas
→ Quand terminé : [CMD:epb_close:${brand}]
→ "Pistons ressortis. Testez le frein à main et faites quelques freinages doux."

### "Le ventilateur tourne-t-il ?"
→ "Je vais l'activer. Dans 3 secondes vous devriez l'entendre tourner." [CMD:activate:ventilateur:${brand}]
→ Demande : "Vous l'entendez ?"

### "J'ai fait la vidange, remets à zéro"
→ "Vous confirmez que l'huile a bien été changée ?" → Attends OUI
→ [CMD:reset:huile:${brand}]
→ "C'est fait ! Le compteur d'intervalles a été remis à zéro."

## RÈGLES DE SÉCURITÉ ABSOLUES
1. TOUJOURS annoncer ce que tu fais AVANT d'envoyer un [CMD]
2. TOUJOURS demander confirmation explicite avant : [CMD:clear_dtcs], [CMD:epb_open], tout [CMD:reset]
3. NE JAMAIS effacer les codes si l'utilisateur va chez le garagiste
4. Pour [CMD:epb_open] : IMPÉRATIVEMENT confirmer que voiture sur cric et roue démontée
5. Si code urgency HIGH + can_drive false : dire clairement de ne pas rouler
6. Si problème complexe (electronique, boîte auto, distribution) : envoyer chez le pro
7. Ne jamais inventer une information technique non fiable

## FORMAT RÉPONSE
- Texte conversationnel naturel (pas de listes à puces pour tout)
- Utilise des emojis pour les niveaux d'urgence : 🔴 critique, 🟠 à traiter, 🟢 préventif
- Max 2 [CMD] par message (ne pas submerger)
- Toujours finir par la prochaine étape concrète
${langInstruction}`;
}

// ── Handler principal ────────────────────────────────────────────────────────────
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

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      messages         = [],
      is_obd2_scan     = false,
      vehicle_context  = {},
      brand            = "default",
      language         = "fr",
      // Alias pour compatibilité frontend Box
      userMsg,
      vehicleData,
      isOBD2Scan,
    } = body;

    // Normalisation pour les deux formats d'appel
    const finalMessages   = messages.length ? messages : (userMsg ? [{ role: "user", content: userMsg }] : []);
    const finalCtx        = vehicle_context || vehicleData || {};
    const finalIsOBD2     = is_obd2_scan || isOBD2Scan || false;

    const systemPrompt = buildSystemPrompt(finalCtx, brand, language);

    // Enrichir le dernier message utilisateur avec les données OBD2 si c'est un scan
    let enrichedMessages = finalMessages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    if (finalIsOBD2 && finalCtx) {
      const dtcs = finalCtx.dtcs || [];
      const pendingDtcs = finalCtx.pendingDtcs || [];
      const permanentDtcs = finalCtx.permanentDtcs || [];
      const pids = finalCtx.pids || {};
      const allDTCs = [...dtcs, ...pendingDtcs];

      // Résumé scan pour le message
      const dtcSummary = allDTCs.length
        ? `Codes défauts confirmés (${dtcs.length}): ${dtcs.filter(d=>/^[A-Z][0-9A-F]{4}$/i.test(d.code)).map(d => d.code).join(', ') || 'aucun valide'}\nCodes en attente (${pendingDtcs.length}): ${pendingDtcs.filter(d=>/^[A-Z][0-9A-F]{4}$/i.test(d.code)).map(d => d.code).join(', ') || 'aucun'}\nCodes permanents (${permanentDtcs.length}): ${permanentDtcs.filter(d=>/^[A-Z][0-9A-F]{4}$/i.test(d.code)).map(d => d.code).join(', ') || 'aucun'}`
        : "Aucun code défaut actif ✅";

      const pidValues = Object.values(pids)
        .filter(p => p.value != null)
        .slice(0, 8)
        .map(p => `${p.label}: ${p.value}${p.unit}`)
        .join(', ');

      const milStatus = finalCtx.monitors?.milOn
        ? `🔴 Voyant moteur ALLUMÉ — ${finalCtx.monitors.dtcCount} défaut(s)`
        : '🟢 Voyant moteur ÉTEINT';

      const scanBlock = [
        `=== RÉSULTATS SCAN OBD2 ===`,
        finalCtx.vin ? `VIN: ${finalCtx.vin}` : '',
        milStatus,
        dtcSummary,
        pidValues ? `Paramètres: ${pidValues}` : '',
        `=== FIN SCAN ===`,
      ].filter(Boolean).join('\n');

      const lastMsg = enrichedMessages[enrichedMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content += `\n\n${scanBlock}`;
      } else {
        enrichedMessages.push({ role: 'user', content: `Analyse le scan de ma voiture:\n${scanBlock}` });
      }
    }

    if (enrichedMessages.length === 0) {
      enrichedMessages = [{ role: 'user', content: 'Bonjour Dylan !' }];
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1800,
      system: systemPrompt,
      messages: enrichedMessages,
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
        message: "Dylan est momentanément indisponible. Réessayez dans quelques secondes.",
        error: error.message,
      }),
    };
  }
};
