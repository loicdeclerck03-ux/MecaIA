// ============================================================
// MECAIA_BOX.MJS — Agent Dylan OBD2 Autonome v3 FINAL
// 17/06/2026 — Version complète avec :
//   - Diagnostic autonome complet
//   - Options découverte et activation
//   - Tests actionneurs guidés
//   - Mode entretien freins (EPB)
//   - Génération de rapports
//   - Multi-langue (FR/NL/EN/DE)
//   - Sécurité renforcée (confirmation, contraintes par marque)
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Capacités par marque ────────────────────────────────────────────────────
const BRAND_CAPABILITIES = {
  vw:        { name:"Volkswagen", resets:["huile","dpf","frein","batt","papillon","injecteur"], actuators:["ventilateur","purge_evap","egr","injecteur_test","frein_parking"], options:['feux_journee','essuie_pluie','confort_fermeture','demarrage_sans_cle','lane_assist','retros_rabattables','feux_bienvenue','feux_virage','klaxon_verrouillage'], coding_level:"élevé" },
  audi:      { name:"Audi", resets:["huile","dpf","frein","batt","papillon","injecteur","boite"], actuators:["ventilateur","purge_evap","egr","injecteur_test","frein_parking"], options:["feux_journee","essuie_pluie","lane_assist"], coding_level:"élevé" },
  seat:      { name:"SEAT", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"], coding_level:"moyen" },
  skoda:     { name:"Škoda", resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"], coding_level:"moyen" },
  peugeot:   { name:"Peugeot", resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","purge_evap","frein_parking"], options:["feux_journee"], coding_level:"moyen" },
  citroen:   { name:"Citroën", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"], coding_level:"faible" },
  opel:      { name:"Opel", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"], coding_level:"faible" },
  renault:   { name:"Renault", resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","purge_evap"], options:["feux_journee","essuie_pluie"], coding_level:"moyen" },
  dacia:     { name:"Dacia", resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[], coding_level:"faible" },
  bmw:       { name:"BMW", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee","lane_assist","sport_display"], coding_level:"moyen" },
  mini:      { name:"MINI", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","frein_parking"], options:["feux_journee"], coding_level:"moyen" },
  mercedes:  { name:"Mercedes-Benz", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"], coding_level:"faible" },
  ford:      { name:"Ford", resets:["huile","dpf","frein","batt","papillon"], actuators:["ventilateur","egr","purge_evap"], options:["feux_journee"], coding_level:"moyen" },
  toyota:    { name:"Toyota", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"], coding_level:"faible" },
  honda:     { name:"Honda", resets:["huile","dpf","frein","batt"], actuators:["ventilateur"], options:[], coding_level:"faible" },
  hyundai:   { name:"Hyundai", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"], coding_level:"moyen" },
  kia:       { name:"Kia", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:["feux_journee"], coding_level:"moyen" },
  fiat:      { name:"Fiat", resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[], coding_level:"faible" },
  alfa:      { name:"Alfa Romeo", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:["feux_journee"], coding_level:"faible" },
  volvo:     { name:"Volvo", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr","frein_parking"], options:[], coding_level:"faible" },
  mazda:     { name:"Mazda", resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:["feux_journee"], coding_level:"faible" },
  nissan:    { name:"Nissan", resets:["huile","dpf","frein","batt"], actuators:["ventilateur","egr"], options:[], coding_level:"faible" },
  subaru:    { name:"Subaru", resets:["huile","dpf","frein"], actuators:["ventilateur"], options:[], coding_level:"faible" },
  suzuki:    { name:"Suzuki", resets:["huile","frein"], actuators:["ventilateur"], options:[], coding_level:"faible" },
  mitsubishi:{ name:"Mitsubishi", resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[], coding_level:"faible" },
  default:   { name:"Véhicule OBD2", resets:["huile","dpf","frein"], actuators:["ventilateur","egr"], options:[], coding_level:"inconnu" },
};

// ── Labels utilisateur ──────────────────────────────────────────────────────
const OPTION_NAMES = {
  feux_journee: "feux de jour (DRL)",
  essuie_pluie: "essuie-glace automatique pluie",
  confort_fermeture: "fermeture vitres par télécommande",
  demarrage_sans_cle: "démarrage sans clé (Keyless)",
  lane_assist: "aide au maintien de voie",
  sport_display: "affichage sportif tableau de bord",
  retros_rabattables: "rétroviseurs rabattables automatiques",
  feux_bienvenue: "feux de bienvenue (Coming Home)",
  feux_virage: "phares de virage (Cornering lights)",
  klaxon_verrouillage: "bip klaxon confirmation verrouillage",
  mode_sport_auto: "mode Sport automatique au démarrage",
};

const ACTUATOR_NAMES = {
  ventilateur: "ventilateur de refroidissement",
  purge_evap: "vanne purge circuit EVAP",
  egr: "vanne EGR (recirculation gaz)",
  injecteur_test: "test cylindre par cylindre des injecteurs",
  frein_parking: "frein de parking électronique (EPB)",
  pompe_eau: "pompe à eau électrique",
  lambda_chauffage: "chauffage sonde lambda",
};

const RESET_NAMES = {
  huile: "compteur de vidange huile",
  dpf: "données filtre à particules FAP/DPF",
  frein: "usure plaquettes de frein",
  batt: "adaptation batterie (BMS)",
  papillon: "position corps de papillon",
  injecteur: "calibration injecteurs",
  boite: "adaptation boîte automatique",
};

// ── Base DTC complète ──────────────────────────────────────────────────────
const DTC_KNOWLEDGE = {
  // Ratés allumage
  P0300: { desc:"Ratés d'allumage aléatoires sur plusieurs cylindres", urgency:"HIGH", causes:["bougies d'allumage usées","bobines d'allumage défaillantes","injecteurs encrassés","compression faible"], cost_estimate:"150-600€", action:"Ne pas rouler sur autoroute. Contrôle urgent." },
  P0301: { desc:"Raté d'allumage cylindre 1", urgency:"HIGH", causes:["bougie cyl.1","bobine cyl.1","injecteur cyl.1"], cost_estimate:"100-400€", action:"Remplacer bougie et tester la bobine du cyl.1" },
  P0302: { desc:"Raté d'allumage cylindre 2", urgency:"HIGH", causes:["bougie cyl.2","bobine cyl.2","injecteur cyl.2"], cost_estimate:"100-400€", action:"Remplacer bougie et tester la bobine du cyl.2" },
  P0303: { desc:"Raté d'allumage cylindre 3", urgency:"HIGH", causes:["bougie cyl.3","bobine cyl.3","injecteur cyl.3"], cost_estimate:"100-400€", action:"Remplacer bougie et tester la bobine du cyl.3" },
  P0304: { desc:"Raté d'allumage cylindre 4", urgency:"HIGH", causes:["bougie cyl.4","bobine cyl.4","injecteur cyl.4"], cost_estimate:"100-400€", action:"Remplacer bougie et tester la bobine du cyl.4" },
  // Mélange carburant
  P0171: { desc:"Mélange trop pauvre banque 1 (trop d'air, pas assez de carburant)", urgency:"MEDIUM", causes:["fuite d'air admission","sonde MAF sale","sonde lambda HS","injecteurs bouchés","pression carburant faible"], cost_estimate:"80-500€", action:"Vérifier les durites d'admission et nettoyer la MAF" },
  P0172: { desc:"Mélange trop riche banque 1 (trop de carburant)", urgency:"MEDIUM", causes:["injecteurs qui fuient","pression carburant trop haute","sonde lambda HS"], cost_estimate:"100-800€", action:"Vérifier les injecteurs au banc d'essai" },
  P0174: { desc:"Mélange trop pauvre banque 2", urgency:"MEDIUM", causes:["fuite d'air côté B2","sonde MAF","injecteurs B2"], cost_estimate:"80-500€", action:"Même diagnostic que P0171 côté B2" },
  // Catalyseur
  P0420: { desc:"Efficacité catalyseur sous le seuil banque 1 — catalyseur fatigué", urgency:"MEDIUM", causes:["catalyseur usé","sonde O2 aval défaillante","ratés non traités qui ont brûlé le cat"], cost_estimate:"300-1200€", action:"Ne pas ignorer longtemps. Remplacement catalyseur à prévoir." },
  P0421: { desc:"Efficacité catalyseur faible banque 1", urgency:"MEDIUM", causes:["catalyseur début de fatigue"], cost_estimate:"300-1200€", action:"Surveiller, vérifier sondes O2" },
  // EVAP
  P0440: { desc:"Fuite détectée dans le système anti-évaporation carburant", urgency:"LOW", causes:["bouchon réservoir mal fermé","vanne EVAP HS","durites EVAP fissurées"], cost_estimate:"50-400€", action:"Commencer par vérifier que le bouchon du réservoir est bien fermé" },
  P0441: { desc:"Débit incorrect circuit purge EVAP", urgency:"LOW", causes:["vanne purge EVAP bloquée","tuyau EVAP bouché"], cost_estimate:"100-300€", action:"Test vanne purge disponible via les actionneurs" },
  P0442: { desc:"Petite fuite système EVAP", urgency:"LOW", causes:["microcraquelure durite","vanne EVAP légèrement fuyante"], cost_estimate:"50-300€", action:"Vérifier toutes les connexions du système EVAP" },
  P0455: { desc:"Grande fuite système EVAP — souvent le bouchon du réservoir", urgency:"LOW", causes:["bouchon réservoir défectueux","grosse fuite durite","vanne EVAP ouverte en permanence"], cost_estimate:"20-400€", action:"Commencer par changer le bouchon du réservoir" },
  // EGR
  P0401: { desc:"Débit EGR insuffisant — vanne EGR encrassée ou bloquée", urgency:"MEDIUM", causes:["vanne EGR encrassée","capteur position EGR HS","durites EGR bouchées"], cost_estimate:"100-500€", action:"Test vanne EGR via actionneurs. Nettoyage souvent suffisant." },
  P0402: { desc:"Débit EGR excessif", urgency:"MEDIUM", causes:["vanne EGR bloquée ouverte","capteur EGR HS"], cost_estimate:"100-400€", action:"Test vanne EGR via actionneurs" },
  // MAF
  P0100: { desc:"Circuit capteur débit masse air (MAF) — défaut", urgency:"HIGH", causes:["MAF sale","câblage MAF","MAF défaillant"], cost_estimate:"100-400€", action:"Nettoyer la MAF avec spray nettoyant MAF" },
  P0102: { desc:"Signal MAF trop faible", urgency:"HIGH", causes:["MAF sale ou HS","fuite admission après MAF"], cost_estimate:"100-400€", action:"Nettoyer la MAF d'abord" },
  P0103: { desc:"Signal MAF trop élevé", urgency:"HIGH", causes:["MAF HS","court-circuit câblage"], cost_estimate:"200-500€", action:"Remplacer la MAF" },
  // Température refroidissement
  P0116: { desc:"Température de refroidissement hors plage normale", urgency:"MEDIUM", causes:["sonde température HS","thermostat bloqué"], cost_estimate:"80-300€", action:"Vérifier si moteur monte bien à température" },
  P0117: { desc:"Signal sonde température refroidissement trop bas", urgency:"MEDIUM", causes:["sonde HS (court-circuit)","câblage"], cost_estimate:"80-200€", action:"Remplacer la sonde de température" },
  P0118: { desc:"Signal sonde température refroidissement trop haut", urgency:"HIGH", causes:["sonde HS (circuit ouvert)","câblage coupé"], cost_estimate:"80-200€", action:"Remplacer la sonde de température" },
  // Sondes O2
  P0130: { desc:"Circuit sonde lambda B1S1 (amont) — défaut général", urgency:"MEDIUM", causes:["sonde lambda usée","câblage","contamination au plomb"], cost_estimate:"150-400€", action:"Vérifier la tension de sortie de la sonde" },
  P0134: { desc:"Sonde O2 B1S1 — aucune activité", urgency:"MEDIUM", causes:["sonde lambda HS","chauffage grillé"], cost_estimate:"150-400€", action:"Test chauffage sonde lambda via actionneurs" },
  P0135: { desc:"Chauffage sonde O2 B1S1 — circuit défaillant", urgency:"MEDIUM", causes:["résistance chauffage grillée","câblage"], cost_estimate:"150-400€", action:"Test chauffage sonde lambda disponible via actionneurs" },
  // Arbre à cames
  P0011: { desc:"Phase arbre à cames admission trop avancée (banque 1) — VVT", urgency:"MEDIUM", causes:["huile sale bloquant VVT","solénoïde VVT HS","faible pression huile"], cost_estimate:"100-600€", action:"Changer l'huile et voir si le code revient. Filtrer les solénoïdes VVT." },
  P0012: { desc:"Phase arbre à cames admission trop retardée (banque 1)", urgency:"MEDIUM", causes:["solénoïde VVT HS","huile de mauvaise qualité","calage chaîne distribution"], cost_estimate:"200-1000€", action:"Vérifier pression huile et solénoïde VVT" },
  P0340: { desc:"Circuit capteur position arbre à cames — défaut", urgency:"HIGH", causes:["capteur HS","roue phonique endommagée","câblage"], cost_estimate:"100-300€", action:"Contrôle urgent — peut causer arrêt moteur" },
  P0335: { desc:"Circuit capteur position vilebrequin — défaut", urgency:"HIGH", causes:["capteur vilebrequin HS","roue phonique vilebrequin","câblage"], cost_estimate:"100-400€", action:"Remplacement urgent — le moteur peut s'arrêter" },
  // Boîte auto
  P0700: { desc:"Défaut boîte automatique — consulter les codes T en complément", urgency:"MEDIUM", causes:["nombreuses causes possibles","voir codes T07xx T08xx"], cost_estimate:"variable", action:"Lire les codes défauts boîte avec un outil spécifique" },
  // Batterie/alternateur
  P0562: { desc:"Tension batterie trop basse", urgency:"HIGH", causes:["batterie faible","alternateur HS","connexions batterie oxydées"], cost_estimate:"80-400€", action:"Mesurer tension batterie. Devrait être 12,6V repos, 14V moteur en marche." },
  P0563: { desc:"Tension batterie trop haute", urgency:"MEDIUM", causes:["régulateur alternateur HS","surcharge du circuit"], cost_estimate:"150-500€", action:"Vérifier l'alternateur" },
// ── Système d'admission / Turbo ────────────────────────────────────────────
  P0087: { desc:"Pression carburant insuffisante dans le rail (diesel direct)", urgency:"HIGH", causes:["pompe haute pression défaillante","filtre à carburant colmaté","injecteurs fuites retour","régulateur pression HS"], cost_estimate:"200-1500€", action:"Contrôle urgent — ne pas rouler à pleine charge. Vérifier filtre carburant en premier." },
  P0088: { desc:"Pression carburant rail trop haute", urgency:"HIGH", causes:["régulateur pression défaillant","vanne limiteur HS","capteur pression HS"], cost_estimate:"200-800€", action:"Diagnostic urgence pression rail nécessaire" },
  P0182: { desc:"Capteur température carburant — signal bas", urgency:"LOW", causes:["capteur HS","câblage"], cost_estimate:"50-200€", action:"Remplacer capteur température carburant" },
  P0183: { desc:"Capteur température carburant — signal haut", urgency:"LOW", causes:["capteur HS","câblage court-circuit"], cost_estimate:"50-200€", action:"Remplacer capteur température carburant" },
  P0299: { desc:"Sous-régime turbo — pression de suralimentation insuffisante", urgency:"HIGH", causes:["vanne N75 (régulation VNT) HS","turbine encrassée","durites suralimentation fuitantes","capteur pression turbo HS","turbo en fin de vie"], cost_estimate:"300-2000€", action:"Nettoyer vanne N75, vérifier durites. Si turbo bruyant, remplacement imminent." },
  P0234: { desc:"Pression de suralimentation excessive (over-boost)", urgency:"HIGH", causes:["vanne N75 collée","capteur MAP HS","wastegate bloquée"], cost_estimate:"200-1500€", action:"Ne pas solliciter le moteur. Contrôle turbo urgent." },
  P0238: { desc:"Signal capteur pression turbo trop élevé", urgency:"MEDIUM", causes:["capteur MAP HS","court-circuit câblage"], cost_estimate:"100-300€", action:"Remplacer capteur MAP/pression turbo" },
  P0237: { desc:"Signal capteur pression turbo trop bas", urgency:"MEDIUM", causes:["capteur MAP HS","durite dépression bouchée"], cost_estimate:"100-300€", action:"Vérifier durite dépression + capteur MAP" },
  // ── DPF / FAP (Filtre à Particules) ────────────────────────────────────────
  P2002: { desc:"Efficacité filtre à particules insuffisante banque 1 (FAP colmaté)", urgency:"HIGH", causes:["FAP saturé (conduite urbaine trop fréquente)","voyant FAP ignoré trop longtemps","régénération incomplète","huile moteur dans FAP"], cost_estimate:"200-1500€", action:"Régénération forcée si possible. Si inefficace, nettoyage ou remplacement FAP." },
  P2459: { desc:"Fréquence de régénération FAP anormale", urgency:"MEDIUM", causes:["conduite trop courte","thermostat HS (température insuffisante)","sonde différentielle FAP HS"], cost_estimate:"100-800€", action:"Faire une route à vitesse soutenue pour déclencher régénération" },
  P2452: { desc:"Capteur pression différentielle FAP — circuit", urgency:"MEDIUM", causes:["sonde delta-P HS","tuyaux sonde colmatés","sonde encrassée"], cost_estimate:"100-400€", action:"Nettoyer ou remplacer la sonde différentielle FAP" },
  P2453: { desc:"Signal capteur pression différentielle FAP trop bas", urgency:"MEDIUM", causes:["sonde HS","tuyau sonde bouché"], cost_estimate:"100-350€", action:"Remplacer sonde différentielle" },
  P2454: { desc:"Signal capteur pression différentielle FAP trop haut", urgency:"MEDIUM", causes:["sonde HS","tuyau sonde percé"], cost_estimate:"100-350€", action:"Vérifier circuit sonde différentielle" },
  // ── Système de refroidissement ─────────────────────────────────────────────
  P0215: { desc:"Arrêt moteur commandé par ECU — sécurité", urgency:"HIGH", causes:["surchauffe moteur","capteur température HS","pression huile trop basse"], cost_estimate:"variable", action:"Ne pas redémarrer sans diagnostic. Vérifier niveaux refroidissement et huile." },
  P0219: { desc:"Régime moteur excessif — survitesse", urgency:"HIGH", causes:["embrayage HS","calculateur défaillant"], cost_estimate:"variable", action:"Ne pas rouler — risque moteur" },
  P0480: { desc:"Circuit ventilateur refroidissement — relais 1", urgency:"MEDIUM", causes:["relais ventilateur HS","câblage","motoventilateur HS"], cost_estimate:"80-300€", action:"Tester le relais ventilateur et le motoventilateur" },
  P0481: { desc:"Circuit ventilateur refroidissement — relais 2", urgency:"MEDIUM", causes:["relais 2 HS","câblage"], cost_estimate:"80-300€", action:"Tester relais 2 et câblage" },
  P0483: { desc:"Défaut validation motoventilateur — logique incohérente", urgency:"MEDIUM", causes:["motoventilateur court-circuit","câblage","relais HS"], cost_estimate:"100-400€", action:"Vérifier câblage motoventilateur et résistances" },
  // ── Injection directe diesel ────────────────────────────────────────────────
  P0200: { desc:"Circuit injecteurs — défaut général", urgency:"HIGH", causes:["injecteur(s) HS","câblage injecteurs","calculateur"], cost_estimate:"150-2000€", action:"Tester les injecteurs un par un (Actuator test)" },
  P0261: { desc:"Injecteur cylindre 1 — tension faible", urgency:"HIGH", causes:["injecteur cyl.1 court-circuit","câblage"], cost_estimate:"200-600€", action:"Remplacer injecteur cyl.1" },
  P0264: { desc:"Injecteur cylindre 2 — tension faible", urgency:"HIGH", causes:["injecteur cyl.2 HS"], cost_estimate:"200-600€", action:"Remplacer injecteur cyl.2" },
  P0267: { desc:"Injecteur cylindre 3 — tension faible", urgency:"HIGH", causes:["injecteur cyl.3 HS"], cost_estimate:"200-600€", action:"Remplacer injecteur cyl.3" },
  P0270: { desc:"Injecteur cylindre 4 — tension faible", urgency:"HIGH", causes:["injecteur cyl.4 HS"], cost_estimate:"200-600€", action:"Remplacer injecteur cyl.4" },
  // ── Gestion du ralenti ─────────────────────────────────────────────────────
  P0506: { desc:"Ralenti trop bas", urgency:"MEDIUM", causes:["encrassement corps papillon","vanne IAC HS","fuite d'air admission","injecteurs sales"], cost_estimate:"100-400€", action:"Nettoyer corps papillon et vanne IAC" },
  P0507: { desc:"Ralenti trop élevé", urgency:"MEDIUM", causes:["corps papillon collé","vanne IAC bloquée ouverte","fuite d'air admission après MAF"], cost_estimate:"100-400€", action:"Nettoyer corps papillon. Vérifier durites admission." },
  P0521: { desc:"Signal capteur pression huile hors plage", urgency:"HIGH", causes:["capteur pression huile HS","pression huile réellement basse","câblage"], cost_estimate:"50-500€", action:"Vérifier niveau et pression huile IMMÉDIATEMENT avant de rouler" },
  P0522: { desc:"Signal capteur pression huile trop bas", urgency:"HIGH", causes:["pression huile insuffisante","capteur HS","filtre huile colmaté"], cost_estimate:"50-2000€", action:"ARRÊT IMMÉDIAT — risque de casse moteur si pression réellement basse" },
  // ── Système électrique ─────────────────────────────────────────────────────
  P0600: { desc:"Communication bus CAN — défaut général", urgency:"MEDIUM", causes:["câble CAN endommagé","calculateur défaillant","interférence électrique"], cost_estimate:"200-1000€", action:"Diagnostic réseau CAN nécessaire chez un professionnel" },
  P0601: { desc:"Mémoire ROM calculateur moteur (ECU) corrompue", urgency:"HIGH", causes:["ECU défaillant","coupure tension pendant programmation"], cost_estimate:"500-2000€", action:"Recoding ou remplacement ECU nécessaire" },
  P0605: { desc:"Erreur mémoire ROM interne ECU", urgency:"HIGH", causes:["ECU HS"], cost_estimate:"500-2000€", action:"Remplacement ou réparation ECU nécessaire" },
  P0606: { desc:"ECU — processeur principal en défaut", urgency:"HIGH", causes:["ECU HS"], cost_estimate:"500-2000€", action:"Professionnel requis — ECU défaillant" },
  P0642: { desc:"Tension référence capteur A trop basse (5V reference)", urgency:"MEDIUM", causes:["court-circuit sur circuit 5V","capteur HS court-circuit"], cost_estimate:"100-500€", action:"Identifier quel capteur tire le 5V à la masse" },
  P0643: { desc:"Tension référence capteur A trop haute", urgency:"MEDIUM", causes:["câblage court-circuit alimentation","ECU HS"], cost_estimate:"100-500€", action:"Vérifier câblage 5V référence" },
  // ── Système d'échappement / Lambda ─────────────────────────────────────────
  P0136: { desc:"Circuit sonde lambda B1S2 (aval catalyseur) — défaut", urgency:"LOW", causes:["sonde lambda aval HS","câblage"], cost_estimate:"150-400€", action:"Remplacer sonde lambda aval banque 1" },
  P0141: { desc:"Chauffage sonde lambda B1S2 — circuit défaillant", urgency:"LOW", causes:["résistance chauffage grillée"], cost_estimate:"150-400€", action:"Remplacer sonde lambda B1S2" },
  P0156: { desc:"Circuit sonde lambda B2S2 — défaut", urgency:"LOW", causes:["sonde lambda aval B2 HS","câblage"], cost_estimate:"150-400€", action:"Remplacer sonde lambda aval banque 2" },
  P0420_ALT: { desc:"Catalyseur B1 sous seuil — version aggravée", urgency:"MEDIUM", causes:["catalyseur HS — casse confirmée par sondes"], cost_estimate:"400-1500€", action:"Remplacement catalyseur" },
  // ── Boîte automatique ──────────────────────────────────────────────────────
  P0711: { desc:"Capteur température fluide boîte auto — signal incorrect", urgency:"MEDIUM", causes:["capteur HS","câblage","niveau ATF bas"], cost_estimate:"100-400€", action:"Vérifier niveau fluide boîte auto (ATF)" },
  P0712: { desc:"Température fluide boîte auto — signal trop bas", urgency:"MEDIUM", causes:["capteur HS","court-circuit"], cost_estimate:"100-300€", action:"Vérifier capteur et câblage" },
  P0713: { desc:"Température fluide boîte auto — signal trop haut", urgency:"HIGH", causes:["surchauffe boîte auto","manque ATF","radiateur ATF bouché"], cost_estimate:"200-2000€", action:"Vérifier niveau ATF. Surchauffe = danger pour la boîte." },
  P0731: { desc:"Rapport 1 boîte auto — glissement", urgency:"HIGH", causes:["ATF dégradé","embrayage 1ère HS","solénoïde HS"], cost_estimate:"500-3000€", action:"Vidange ATF urgente. Si persiste, boîte en défaut mécanique." },
  P0732: { desc:"Rapport 2 boîte auto — glissement", urgency:"HIGH", causes:["ATF dégradé","embrayage 2e HS"], cost_estimate:"500-3000€", action:"Vidange ATF. Diagnostic boîte auto." },
  // ── Systèmes actifs sécurité ───────────────────────────────────────────────
  C0031: { desc:"Capteur roue avant droite (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS","roue phonique endommagée","câblage"], cost_estimate:"100-300€", action:"ABS et ESP désactivés. Rouler prudemment. Remplacer capteur." },
  C0034: { desc:"Capteur roue avant gauche (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS","roue phonique"], cost_estimate:"100-300€", action:"ABS et ESP désactivés. Remplacer capteur." },
  C0037: { desc:"Capteur roue arrière droite (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS","roue phonique"], cost_estimate:"100-300€", action:"Remplacer capteur ABS roue arrière droite" },
  C0040: { desc:"Capteur roue arrière gauche (ABS/ESP) — défaut", urgency:"MEDIUM", causes:["capteur ABS HS"], cost_estimate:"100-300€", action:"Remplacer capteur ABS roue arrière gauche" },
  // ── Système air conditionné ────────────────────────────────────────────────
  B1000: { desc:"ECU module carrosserie — erreur interne", urgency:"LOW", causes:["module BCM HS","tension","câblage"], cost_estimate:"200-800€", action:"Diagnostic module BCM" },
  P0532: { desc:"Capteur pression réfrigérant A/C — signal bas", urgency:"LOW", causes:["capteur pression A/C HS","fuite réfrigérant (R134a/R1234yf vide)"], cost_estimate:"100-500€", action:"Vérifier niveau réfrigérant A/C" },
  P0533: { desc:"Capteur pression réfrigérant A/C — signal haut", urgency:"LOW", causes:["surpression circuit A/C","capteur HS"], cost_estimate:"100-400€", action:"Diagnostic circuit A/C" },
  // ── Système de direction assistée électrique ───────────────────────────────
  C0700: { desc:"Défaut système de direction assistée électrique (EPS)", urgency:"MEDIUM", causes:["moteur EPS HS","capteur angle volant","câblage"], cost_estimate:"300-1500€", action:"Direction plus lourde mais fonctionnelle. Diagnostic EPS." },
  U0100: { desc:"Perte communication avec ECU moteur (CAN Bus)", urgency:"HIGH", causes:["câble CAN coupé","calculateur hors tension","connecteur dessoudé"], cost_estimate:"200-1500€", action:"Vérifier alimentation ECU et câble CAN. Professionnel recommandé." },
  U0101: { desc:"Perte communication avec TCU (boîte auto)", urgency:"HIGH", causes:["câble CAN vers TCU","TCU HS"], cost_estimate:"200-1500€", action:"Diagnostic réseau CAN" },
  U0121: { desc:"Perte communication avec module ABS/ESP", urgency:"HIGH", causes:["câble CAN","module ABS HS"], cost_estimate:"300-1500€", action:"Diagnostic CAN vers ABS. ABS/ESP inactifs." },
};

// ── Prompt système agent Dylan ──────────────────────────────────────────────
function buildSystemPrompt(vehicleCtx, brand, language) {
  const veh = BRAND_CAPABILITIES[brand] || BRAND_CAPABILITIES.default;
  const lang = language || "fr";

  const resetsStr  = veh.resets.map(k => `${k} → ${RESET_NAMES[k]||k}`).join(", ");
  const actStr     = veh.actuators.map(k => `${k} → ${ACTUATOR_NAMES[k]||k}`).join(", ");
  const optionsStr = veh.options.length
    ? veh.options.map(k => `${k} → ${OPTION_NAMES[k]||k}`).join(", ")
    : "aucune option disponible via OBD2 standard (niveau coding: " + veh.coding_level + ")";

  const vinLine  = vehicleCtx.vin  ? `VIN : ${vehicleCtx.vin}`  : "VIN : non lu";
  const ecuLine  = vehicleCtx.ecuName ? `ECU : ${vehicleCtx.ecuName}` : "";

  return `Tu es Dylan, expert mécanicien automobile IA de MecaIA — un vrai ami mécanicien dans la poche.

## CONTEXTE VÉHICULE
Marque : ${veh.name}
${vinLine}
${ecuLine}
Niveau de coding : ${veh.coding_level}

## TON CARACTÈRE
Tu es bienveillant, simple, rassurant. Tu parles comme un ami mécanicien — pas comme un technicien.
Jamais de jargon incompréhensible. Si tu dois utiliser un terme technique, tu l'expliques.
Tu guides étape par étape. Tu confirmes TOUJOURS avant d'agir.
Tu rassures : "pas de panique", "c'est courant", "c'est réparable".
Quand tu ne sais pas ou que c'est hors ta portée : tu le dis et tu envoies chez le pro.

## TES OUTILS OBD2 — Utilise [CMD:xxx] dans tes messages pour agir

### LECTURES
[CMD:scan_full]           → Scan complet (VIN + codes + PIDs + moniteurs + freeze frame)
[CMD:read_dtcs]           → Lire les codes défauts
[CMD:read_live]           → Voir paramètres moteur temps réel
[CMD:read_monitors]       → Moniteurs émissions (contrôle technique)
[CMD:read_freeze]         → Données au moment du dernier défaut

### OPTIONS VÉHICULE
[CMD:read_options:${brand}]  → Lire les options disponibles sur ce véhicule
[CMD:activate_option:feux_journee:${brand}]        → Activer feux de jour
[CMD:deactivate_option:feux_journee:${brand}]      → Désactiver feux de jour
[CMD:activate_option:essuie_pluie:${brand}]        → Activer essuie-glace pluie auto
[CMD:deactivate_option:essuie_pluie:${brand}]      → Désactiver
[CMD:activate_option:confort_fermeture:${brand}]   → Activer fermeture vitres télécommande
[CMD:deactivate_option:confort_fermeture:${brand}] → Désactiver
[CMD:activate_option:demarrage_sans_cle:${brand}]  → Activer Keyless Go
[CMD:deactivate_option:lane_assist:${brand}]       → Activer aide maintien de voie
Options disponibles : ${optionsStr}

### TESTS ACTIONNEURS (activer un composant pour le tester)
[CMD:activate:ventilateur:${brand}]    → Démarrer ventilateur (l'utilisateur l'entend tourner)
[CMD:deactivate:ventilateur:${brand}] → Arrêter ventilateur
[CMD:activate:egr:${brand}]           → Ouvrir vanne EGR
[CMD:deactivate:egr:${brand}]         → Fermer vanne EGR
[CMD:activate:purge_evap:${brand}]    → Ouvrir vanne purge EVAP
[CMD:deactivate:purge_evap:${brand}]  → Fermer
[CMD:activate:injecteur_test:${brand}] → Tester injecteurs cylindre par cylindre
[CMD:deactivate:injecteur_test:${brand}] → Arrêter test
Actionneurs disponibles : ${actStr}

### MODE ENTRETIEN FREINS
[CMD:epb_open:${brand}]   → OUVRE les étriers (pistons rentrent = espace pour nouvelles plaquettes)
[CMD:epb_close:${brand}]  → FERME les étriers (pistons sortent = mode normal)
⚠️ TOUJOURS demander confirmation + expliquer ce qui va se passer

### RESETS SERVICE
[CMD:reset:huile:${brand}]      → Remettre compteur vidange à zéro
[CMD:reset:dpf:${brand}]        → Forcer regen FAP (diesel moteur chaud)
[CMD:reset:frein:${brand}]      → Remettre usure plaquettes à zéro
[CMD:reset:batt:${brand}]       → Adapter nouvelle batterie
[CMD:reset:papillon:${brand}]   → Recalibrer corps de papillon
[CMD:reset:injecteur:${brand}]  → Coder les injecteurs (diesel direct)
Resets disponibles : ${resetsStr}

### EFFACEMENT
[CMD:clear_dtcs]  → Effacer tous les codes défauts

## RÈGLES DE SÉCURITÉ ABSOLUES
1. TOUJOURS annoncer ce que tu fais avant un [CMD]
2. TOUJOURS demander confirmation explicite avant : clear_dtcs, epb_open, epb_close, tout reset service
3. Ne JAMAIS effacer les codes si l'utilisateur va chez le garagiste (les codes = preuve pour le tech)
4. Pour les actionneurs : prévenir de ce que l'utilisateur va entendre/voir/ressentir
5. Pour l'EPB (mode entretien freins) : IMPÉRATIVEMENT confirmer que la voiture est sur cric et roue arrière démontée AVANT d'ouvrir
6. Ne JAMAIS recommander de rouler en sécurité si codes HIGH urgency
7. Si code inconnu ou symptôme complexe : toujours recommander un vrai garagiste

## SCÉNARIOS TYPES (comment réagir)

### "Trouve la panne" / "Scan complet"
→ Dis que tu vas scanner, envoie [CMD:scan_full], attends les résultats, puis analyse tout

### "Quelles options puis-je débloquer ?"
→ Annonce que tu vas vérifier, envoie [CMD:read_options:${brand}], présente les résultats clairement
   Dis quelles sont activées et lesquelles peuvent être activées
   Propose : "Laquelle voulez-vous activer ?" (feux jour, essuie-pluie, rétros rabattables, feux bienvenue, bip fermeture, sport auto, keyless...)

### "Je veux les feux de jour" / "Active les DRL"
→ Confirme l'action : "Je vais activer les feux de jour. Après, ils s'allumeront automatiquement au démarrage. C'est bon ?"
   Si oui → [CMD:activate_option:feux_journee:${brand}]
   Après → annonce que la modification est faite, éventuellement redémarrer le véhicule

### "Je veux changer mes plaquettes arrière"
→ Explique la procédure : "Pour changer les plaquettes arrière avec un frein électronique, je dois mettre les étriers en mode entretien (pistons rentrés). Étapes : 1. Levez la voiture, 2. Démontez la roue, 3. Je mets le mode entretien..."
→ Demande confirmation que la voiture est sécurisée
→ [CMD:epb_open:${brand}]
→ Guide pour le remplacement
→ Quand terminé → [CMD:epb_close:${brand}]
→ "Les pistons sont ressortis. Testez le frein à main et faites quelques freinages doux."

### "Le ventilateur tourne-t-il ?"
→ "Je vais activer le ventilateur. Dans 3 secondes vous devriez l'entendre tourner." [CMD:activate:ventilateur:${brand}]
→ "Vous l'entendez ?"

### "J'ai fait la vidange, remets l'huile à zéro"
→ Confirmer : "Je vais remettre à zéro le compteur de vidange. C'est bien l'huile qui a été changée, pas juste complétée ?" → Attendre OUI
→ [CMD:reset:huile:${brand}]

## CONNAISSANCE DES CODES DTC
${JSON.stringify(Object.entries(DTC_KNOWLEDGE).slice(0, 10).reduce((acc, [k, v]) => ({ ...acc, [k]: { desc: v.desc, urgency: v.urgency, action: v.action, cost: v.cost_estimate } }), {}), null, 0)}

Quand tu analyses des codes : donne l'urgence (HAUTE/MOYENNE/FAIBLE), les causes probables, le coût estimé, et ce qu'il faut faire.

## FORMAT RÉPONSE
Texte conversationnel simple + [CMD:xxx] quand nécessaire.
Jamais plus de 2 CMD dans la même réponse (évite de submerger l'utilisateur).
Langue de réponse : ${lang === "fr" ? "Français" : lang === "nl" ? "Nederlands" : lang === "en" ? "English" : "Deutsch"}.`;
}

// ── Handler principal ────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const body = JSON.parse(event.body || "{}");
    const { messages = [], is_obd2_scan = false, vehicle_context = {}, brand = "default", language = "fr" } = body;

    const systemPrompt = buildSystemPrompt(vehicle_context, brand, language);

    let enrichedMessages = messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    // Enrichissement avec les données OBD2 du scan
    if (is_obd2_scan && vehicle_context.dtcs !== undefined) {
      const dtcs = vehicle_context.dtcs || [];
      const pendingDtcs = vehicle_context.pendingDtcs || [];

      // Enrichir les codes avec la knowledge base
      const dtcDetails = dtcs.map(d => {
        const k = DTC_KNOWLEDGE[d.code];
        if (k) return `${d.code} [${k.urgency}]: ${k.desc} — ${k.action} (coût estimé: ${k.cost_estimate})`;
        return `${d.code}: ${d.code.startsWith("P1") || d.code.startsWith("U") || d.code.startsWith("B") || d.code.startsWith("C") ? "code constructeur — voir manuel" : "code non reconnu"}`;
      });

      const pidSummary = vehicle_context.pids
        ? Object.values(vehicle_context.pids).filter(p => p.value != null && !isNaN(p.value)).map(p => `${p.label}: ${p.value}${p.unit}`).join(" | ")
        : "";

      const monsNotReady = vehicle_context.monitors?.monitors?.filter(m => !m.ready)?.map(m => m.name)?.join(", ") || "tous prêts ✅";

      // Alertes sur les PIDs critiques
      const alerts = [];
      const pids = vehicle_context.pids || {};
      if (pids.COOLANT?.value > 100) alerts.push("⚠️ TEMPÉRATURE MOTEUR ÉLEVÉE: " + pids.COOLANT.value + "°C");
      if (pids.BATTERY?.value < 12) alerts.push("⚠️ BATTERIE FAIBLE: " + pids.BATTERY.value + "V");
      if (pids.OIL_TEMP?.value > 135) alerts.push("⚠️ HUILE SURCHAUFFÉE: " + pids.OIL_TEMP.value + "°C");

      const scanBlock = [
        "=== RÉSULTATS SCAN OBD2 ===",
        "VIN: " + (vehicle_context.vin || "non disponible"),
        "Voyant moteur (MIL): " + (vehicle_context.monitors?.milOn ? "🔴 ALLUMÉ — " + vehicle_context.monitors.dtcCount + " défaut(s)" : "🟢 ÉTEINT"),
        dtcDetails.length ? "Codes défauts confirmés (" + dtcDetails.length + "): " + dtcDetails.join(" | ") : "Codes défauts: AUCUN ✅",
        pendingDtcs.length ? "Codes en attente: " + pendingDtcs.map(d => d.code).join(", ") : "Codes en attente: aucun",
        (vehicle_context.permanentDtcs||[]).length ? "Codes permanents: " + vehicle_context.permanentDtcs.map(d => d.code).join(", ") : "",
        "Moniteurs non prêts: " + monsNotReady,
        pidSummary ? "Paramètres moteur: " + pidSummary : "",
        alerts.length ? "ALERTES: " + alerts.join(" | ") : "",
        vehicle_context.freezeFrame && Object.keys(vehicle_context.freezeFrame).length
          ? "Freeze Frame: " + Object.entries(vehicle_context.freezeFrame).map(([k,v]) => k + ":" + v.value + v.unit).join(" | ")
          : "",
        "=== FIN SCAN ===",
      ].filter(Boolean).join("\n");

      if (enrichedMessages.length > 0 && enrichedMessages[enrichedMessages.length-1].role === "user") {
        enrichedMessages[enrichedMessages.length-1].content += "\n\n" + scanBlock;
      } else {
        enrichedMessages.push({ role: "user", content: "Analyse le scan complet de ma voiture :\n" + scanBlock });
      }
    }

    if (enrichedMessages.length === 0) {
      enrichedMessages = [{ role: "user", content: "Bonjour Dylan !" }];
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
      body: JSON.stringify({ message, usage: response.usage }),
    };
  } catch (error) {
    console.error("[MECAIA_BOX] error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Dylan est momentanément indisponible. Réessayez dans quelques secondes.", error: error.message }),
    };
  }
};
