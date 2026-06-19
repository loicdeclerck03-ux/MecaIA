// scenarios.mjs — Bancs d'essai pour la boucle Box. Chaque scénario = symptôme + jeu de données OBD simulé.
// Scénarios "simples" (script générique) + scénarios à script explicite (UDS / confirmation).

export const SCENARIOS = {
  // 1) Turbo diesel — suralimentation insuffisante
  p0299: {
    label: "Diesel perte de puissance (P0299)", level: "v1",
    vehicle: "Volkswagen Golf 7 2.0 TDI 150ch (2016)", brand: "Volkswagen", modele: "Golf",
    symptom: "Perte de puissance surtout en côte, voyant moteur allumé.",
    dtcs: ["P0299"], dtcDesc: { P0299: "Turbocharger/Supercharger A Underboost Condition" },
    dtcCauses: { P0299: "fuite durite/intercooler, géométrie variable (VNT) grippée, capteur MAP" },
    targetPids: ["MAP", "BOOST", "RAIL_PRESSURE", "MAF"],
    live: { MAP: "1.04 bar (commande 1.55 → ÉCART)", BOOST: "0.08 bar (attendu ~0.55 → FAIBLE)", RAIL_PRESSURE: "correcte (~300 bar)", MAF: "11.8 g/s (attendu ~28 → FAIBLE)" },
    similar: [{ vehicle_marque: "Volkswagen", primary_diagnosis: "Durite d'intercooler défectueuse (fuite d'air)", urgency: "bientôt", can_drive: true, estimated_cost_min: 150, estimated_cost_max: 400, parts_needed: ["Durite intercooler", "Colliers"] }],
    conclusion: { text: "Suralim trop basse mais rail correcte → problème d'AIR. Le plus probable : fuite durite/intercooler, sinon VNT grippée. Confiance élevée. Vérifier durites/intercooler (cas réel 150-400€) puis actionneur VNT.",
      record: { obd_code: "P0299", primary_diagnosis: "Fuite durite/intercooler ou VNT grippée", parts_needed: ["Durite intercooler", "Actionneur VNT"], estimated_cost_min: 150, estimated_cost_max: 600, urgency: "bientôt", can_drive: true, confidence_percent: 85 } },
  },

  // 2) Ratés essence
  p0300: {
    label: "Essence à-coups / ralenti instable (P0300+P0302)", level: "v1",
    vehicle: "Peugeot 308 1.6 THP 156ch (2015)", brand: "Peugeot", modele: "308",
    symptom: "Ralenti qui tremble, à-coups à l'accélération, voyant moteur clignote parfois.",
    dtcs: ["P0300", "P0302"], dtcDesc: { P0300: "Random/Multiple Cylinder Misfire Detected", P0302: "Cylinder 2 Misfire Detected" },
    dtcCauses: { P0300: "Worn out spark plugs, ignition wires, coils, vacuum leak", P0302: "bobine/bougie cylindre 2, injecteur" },
    targetPids: ["FUEL_TRIM_SHORT", "FUEL_TRIM_LONG", "COOLANT", "ENGINE_LOAD", "RPM"],
    live: { FUEL_TRIM_SHORT: "+11% (élevé)", FUEL_TRIM_LONG: "+14% (mélange pauvre)", COOLANT: "89 C", ENGINE_LOAD: "26%", RPM: "ralenti instable 720-880" },
    mode06: { misfire: "Mode 06 — Ratés : cyl.2 = 47 ratés/1000 (les autres < 3). Concentré cylindre 2.", all: "Mode 06 — Ratés concentrés cylindre 2." },
    similar: [{ vehicle_marque: "Peugeot", primary_diagnosis: "Bobine d'allumage cylindre 2 défaillante", urgency: "bientôt", can_drive: true, estimated_cost_min: 60, estimated_cost_max: 180, parts_needed: ["Bobine d'allumage", "Bougies (jeu)"] }],
    conclusion: { text: "Ratés concentrés cylindre 2 (P0302 + Mode 06) → allumage cyl.2 (bobine/bougie). Voyant clignotant = ne pas rouler longtemps (risque catalyseur). Confiance élevée.",
      record: { obd_code: "P0302", primary_diagnosis: "Ratés cylindre 2 — bobine/bougie", parts_needed: ["Bobine d'allumage", "Bougie"], estimated_cost_min: 60, estimated_cost_max: 200, urgency: "urgent", can_drive: false, confidence_percent: 80 } },
  },

  // 3) Catalyseur
  p0420: {
    label: "Voyant moteur — catalyseur (P0420)", level: "v1",
    vehicle: "Toyota Corolla 1.8 (2014)", brand: "Toyota", modele: "Corolla",
    symptom: "Voyant moteur fixe, pas de perte de puissance ressentie.",
    dtcs: ["P0420"], dtcDesc: { P0420: "Catalyst System Efficiency Below Threshold Bank 1" },
    dtcCauses: { P0420: "catalyseur fatigué, sonde lambda aval, fuite d'échappement" },
    targetPids: ["O2_VOLTAGE", "COOLANT", "ENGINE_LOAD"],
    live: { O2_VOLTAGE: "aval qui suit l'amont (oscille → cat inefficace)", COOLANT: "90 C", ENGINE_LOAD: "21%" },
    mode06: { catalyst: "Mode 06 — Rendement catalyseur banc 1 : 0.42 (seuil 0.75) → sous le seuil.", all: "Mode 06 — Rendement cata sous seuil." },
    similar: [{ vehicle_marque: "Toyota", primary_diagnosis: "Catalyseur usé", urgency: "préventif", can_drive: true, estimated_cost_min: 200, estimated_cost_max: 900, parts_needed: ["Catalyseur", "Sonde lambda aval"] }],
    conclusion: { text: "Sonde aval qui copie l'amont + Mode 06 sous seuil = catalyseur HS. Avant de changer le cat (cher), vérifier sonde lambda aval et fuites d'échappement. Pas urgent mais bloque le contrôle technique. Confiance modérée à élevée.",
      record: { obd_code: "P0420", primary_diagnosis: "Catalyseur inefficace / sonde lambda aval", parts_needed: ["Sonde lambda aval", "Catalyseur"], estimated_cost_min: 80, estimated_cost_max: 900, urgency: "préventif", can_drive: true, confidence_percent: 70 } },
  },

  // 4) Batterie
  battery: {
    label: "Démarrage difficile, aucun code", level: "v1",
    vehicle: "Renault Clio IV 0.9 TCe (2017)", brand: "Renault", modele: "Clio",
    symptom: "Le matin elle démarre mal, parfois juste un clic. Aucun voyant particulier.",
    dtcs: [], dtcDesc: {}, dtcCauses: {},
    targetPids: ["BATTERY", "CONTROL_MODULE_VOLTAGE", "RPM"],
    live: { BATTERY: "11.4 V au repos (faible), chute à 9.1 V au démarrage (TRÈS faible)", CONTROL_MODULE_VOLTAGE: "13.9 V moteur tournant (alternateur OK)", RPM: "démarreur peine" },
    similar: [{ vehicle_marque: "Renault", primary_diagnosis: "Batterie en fin de vie", urgency: "bientôt", can_drive: true, estimated_cost_min: 90, estimated_cost_max: 180, parts_needed: ["Batterie"] }],
    conclusion: { text: "Pas de code (normal). Tension repos basse + grosse chute au démarrage, mais charge alternateur OK (13.9V) = batterie en fin de vie. Confiance élevée.",
      record: { obd_code: null, primary_diagnosis: "Batterie en fin de vie", parts_needed: ["Batterie"], estimated_cost_min: 90, estimated_cost_max: 200, urgency: "bientôt", can_drive: true, confidence_percent: 85 } },
  },

  // 5) Prise d'air / mélange pauvre
  p0171: {
    label: "Mélange pauvre (P0171)", level: "v1",
    vehicle: "Ford Focus 1.6 EcoBoost (2015)", brand: "Ford", modele: "Focus",
    symptom: "Ralenti un peu instable, consommation en hausse, voyant moteur.",
    dtcs: ["P0171"], dtcDesc: { P0171: "System Too Lean Bank 1" }, dtcCauses: { P0171: "Vacuum leaks, Mass air flow sensor, Plugged fuel filter or weak fuel pump" },
    targetPids: ["FUEL_TRIM_SHORT", "FUEL_TRIM_LONG", "MAF", "MAP", "RPM"],
    live: { FUEL_TRIM_SHORT: "+9%", FUEL_TRIM_LONG: "+22% (très pauvre)", MAF: "2.1 g/s au ralenti (un peu bas)", MAP: "0.38 bar (un peu haut au ralenti → prise d'air ?)", RPM: "ralenti 780-850" },
    similar: [{ vehicle_marque: "Ford", primary_diagnosis: "Prise d'air admission (durite/joint)", urgency: "bientôt", can_drive: true, estimated_cost_min: 40, estimated_cost_max: 250, parts_needed: ["Durite admission", "Joint"] }],
    conclusion: { text: "Trims très positifs (le moteur ajoute du carburant) = il rentre de l'air non mesuré → prise d'air admission la plus probable (sinon MAF encrassé). Test fumée admission recommandé. Confiance élevée.",
      record: { obd_code: "P0171", primary_diagnosis: "Prise d'air admission (ou MAF encrassé)", parts_needed: ["Durite/joint admission", "Nettoyant MAF"], estimated_cost_min: 20, estimated_cost_max: 250, urgency: "bientôt", can_drive: true, confidence_percent: 75 } },
  },

  // 6) EGR
  p0401: {
    label: "EGR débit insuffisant (P0401)", level: "v1",
    vehicle: "BMW Série 1 118d (2014)", brand: "BMW", modele: "Série 1",
    symptom: "Voyant moteur, parfois fumée et perte de pep's en ville.",
    dtcs: ["P0401"], dtcDesc: { P0401: "EGR A Flow Insufficient Detected" }, dtcCauses: { P0401: "Restriction in the EGR passages (carbon buildup), EGR valve defective" },
    targetPids: ["EGR_CMD", "COMMANDED_EGR", "MAF", "INTAKE_TEMP"],
    live: { EGR_CMD: "commande 35% mais débit mesuré ~5% (n'ouvre pas)", COMMANDED_EGR: "35%", MAF: "ne chute pas quand l'EGR est commandée (anormal)", INTAKE_TEMP: "34 C" },
    similar: [{ vehicle_marque: "BMW", primary_diagnosis: "Vanne EGR encrassée/grippée", urgency: "bientôt", can_drive: true, estimated_cost_min: 80, estimated_cost_max: 450, parts_needed: ["Vanne EGR", "Nettoyage admission"] }],
    conclusion: { text: "L'EGR est commandée mais le débit ne suit pas (MAF ne bouge pas) → vanne EGR encrassée/grippée. Nettoyage à tenter avant remplacement. Confiance élevée.",
      record: { obd_code: "P0401", primary_diagnosis: "Vanne EGR encrassée/grippée", parts_needed: ["Vanne EGR", "Nettoyant admission"], estimated_cost_min: 50, estimated_cost_max: 450, urgency: "bientôt", can_drive: true, confidence_percent: 80 } },
  },

  // 7) ABS / frein — SÉCURITÉ (Dylan avertit, n'actionne rien)
  abs: {
    label: "Voyant ABS + frein (C0035) — sécurité", level: "v1",
    vehicle: "Opel Astra J 1.4T (2013)", brand: "Opel", modele: "Astra",
    symptom: "Voyants ABS et frein allumés, la pédale est normale mais ça m'inquiète.",
    dtcs: ["C0035"], dtcDesc: { C0035: "Left Front Wheel Speed Sensor Circuit" }, dtcCauses: { C0035: "capteur de vitesse roue avant gauche, câblage, bague ABS encrassée" },
    targetPids: ["ABS_WHEEL_SPEED", "SPEED"],
    live: { ABS_WHEEL_SPEED: "roue AVG = 0 km/h en roulant alors que les 3 autres lisent 30 (capteur muet)", SPEED: "30 km/h" },
    similar: [{ vehicle_marque: "Opel", primary_diagnosis: "Capteur de vitesse roue AVG défaillant", urgency: "bientôt", can_drive: true, estimated_cost_min: 40, estimated_cost_max: 150, parts_needed: ["Capteur ABS AVG"] }],
    conclusion: { text: "⚠️ Sécurité : l'ABS est désactivé tant que le défaut est là (le freinage classique fonctionne, mais pas l'anti-blocage). Code C0035 + roue AVG muette = capteur de vitesse roue avant gauche (ou sa bague encrassée). Confiance élevée. Je n'actionne rien sur le système de freinage à distance, c'est un point de sécurité.",
      record: { obd_code: "C0035", primary_diagnosis: "Capteur de vitesse roue AVG (ABS)", parts_needed: ["Capteur ABS AVG"], estimated_cost_min: 40, estimated_cost_max: 150, urgency: "bientôt", can_drive: true, confidence_percent: 85 } },
  },

  // 8) EVAP — petite cause, quick win
  p0455: {
    label: "EVAP grosse fuite (P0455) — bouchon", level: "v1",
    vehicle: "Dacia Sandero 1.0 (2018)", brand: "Dacia", modele: "Sandero",
    symptom: "Voyant moteur allumé, aucune perte de puissance, ça roule normal.",
    dtcs: ["P0455"], dtcDesc: { P0455: "Evaporative Emission System Leak Detected (large leak)" }, dtcCauses: { P0455: "bouchon de réservoir mal serré/défectueux, durite EVAP, électrovanne purge" },
    targetPids: ["EVAP_PRESSURE", "FUEL_LEVEL"],
    live: { EVAP_PRESSURE: "pas de tenue de pression (grosse fuite confirmée)", FUEL_LEVEL: "62%" },
    similar: [{ vehicle_marque: "Dacia", primary_diagnosis: "Bouchon de réservoir défectueux", urgency: "préventif", can_drive: true, estimated_cost_min: 0, estimated_cost_max: 30, parts_needed: ["Bouchon de réservoir"] }],
    conclusion: { text: "Grosse fuite EVAP : 9 fois sur 10 c'est le bouchon de réservoir mal serré ou son joint. Commence par bien le revisser (ou le remplacer ~15€), roule quelques cycles, le voyant doit s'éteindre. Pas grave pour rouler. Confiance élevée.",
      record: { obd_code: "P0455", primary_diagnosis: "Bouchon de réservoir / fuite EVAP", parts_needed: ["Bouchon de réservoir"], estimated_cost_min: 0, estimated_cost_max: 40, urgency: "préventif", can_drive: true, confidence_percent: 75 } },
  },

  // 9) Surchauffe — DANGER (Dylan avertit STOP en premier)
  overheat: {
    label: "Surchauffe moteur — DANGER", level: "v1",
    vehicle: "Citroën C3 1.4 (2012)", brand: "Citroën", modele: "C3",
    symptom: "L'aiguille de température est dans le rouge et un voyant rouge s'est allumé, je roule encore.",
    dtcs: ["P0217"], dtcDesc: { P0217: "Engine Over Temperature Condition" }, dtcCauses: { P0217: "manque de liquide, thermostat, pompe à eau, ventilateur, joint de culasse" },
    targetPids: ["COOLANT", "RPM"],
    live: { COOLANT: "114 °C (DANGER, surchauffe)", RPM: "ralenti" },
    similar: [{ vehicle_marque: "Citroën", primary_diagnosis: "Surchauffe — thermostat/pompe à eau/ventilateur", urgency: "urgent", can_drive: false, estimated_cost_min: 60, estimated_cost_max: 800, parts_needed: ["Thermostat", "Pompe à eau"] }],
    conclusion: { text: "🛑 STOP : 114°C c'est de la surchauffe, continue de rouler peut DÉTRUIRE le moteur (joint de culasse). Gare-toi en sécurité, coupe le moteur, laisse refroidir, n'ouvre PAS le vase chaud. Causes : niveau liquide, thermostat, pompe à eau, ventilateur. Confiance élevée sur le danger. À diagnostiquer une fois refroidi.",
      record: { obd_code: "P0217", primary_diagnosis: "Surchauffe moteur (thermostat/pompe/ventilateur)", parts_needed: ["Thermostat", "Pompe à eau", "Liquide de refroidissement"], estimated_cost_min: 60, estimated_cost_max: 800, urgency: "urgent", can_drive: false, confidence_percent: 90 } },
  },

  // 10) Reset vidange — entretien propre (UDS, pas un défaut)
  oil: {
    label: "Reset vidange après entretien (UDS)", level: "v2",
    vehicle: "Mercedes Classe A 180d (2017)", brand: "Mercedes", modele: "Classe A",
    symptom: "Je viens de faire ma vidange moi-même, je veux éteindre le rappel d'entretien.",
    dtcs: [], dtcDesc: {}, dtcCauses: {},
    extended: { oil_quality: "rappel d'entretien ACTIF (échéance dépassée)" },
    similar: [{ vehicle_marque: "Mercedes", primary_diagnosis: "Réinitialisation indicateur d'entretien après vidange", urgency: "préventif", can_drive: true, estimated_cost_min: 0, estimated_cost_max: 0, parts_needed: [] }],
    script: [
      { kind: "tool", text: "Ok, vidange faite. Je vérifie d'abord qu'il n'y a pas de défaut.", name: "read_dtcs", input: {} },
      { kind: "tool", text: "Aucun code, parfait. Je regarde l'état du rappel d'entretien.", name: "read_extended_data", input: { request: "oil_quality" } },
      { kind: "ask", text: "Le rappel d'entretien est actif. Je peux le réinitialiser. ⚠️ À ne faire QUE si la vidange (huile + filtre) est réellement faite — sinon le compteur repart à zéro pour rien. Tu confirmes que c'est fait ?", userReply: "oui huile et filtre changés, vas-y" },
      { kind: "tool", text: "Je réinitialise l'indicateur d'entretien.", name: "service_reset", input: { type: "oil", confirmed: true, preconditions_ok: true } },
      { kind: "tool", text: "C'est fait, je note l'entretien.", name: "record_case", input: { symptom: "Reset vidange", obd_code: null, primary_diagnosis: "Réinitialisation indicateur d'entretien (vidange)", parts_needed: [], estimated_cost_min: 0, estimated_cost_max: 0, urgency: "préventif", can_drive: true, confidence_percent: 95 } },
      { kind: "end", text: "Rappel d'entretien réinitialisé ✅ Pense à noter le kilométrage de cette vidange. Bonne route !" },
    ],
  },

  // 11) UDS — Régénération FAP forcée
  dpf: {
    label: "FAP encrassé — régénération forcée (UDS, P2002)", level: "v2",
    vehicle: "Citroën C4 1.6 BlueHDi (2016)", brand: "Citroën", modele: "C4",
    symptom: "Voyant FAP allumé, fumée, beaucoup de trajets courts en ville.",
    dtcs: ["P2002"], dtcDesc: { P2002: "Diesel Particulate Filter Efficiency Below Threshold Bank 1" }, dtcCauses: { P2002: "FAP saturé de suie (trajets courts), capteur de pression différentielle, additif Eolys" },
    extended: { dpf_soot_load: "92 % (TRÈS encrassé — régénération nécessaire)", dpf_regen_status: ["en cours — 580°C, 35 %", "en cours — 610°C, 78 %", "TERMINÉE — suie redescendue à 6 %"] },
    similar: [{ vehicle_marque: "Citroën", primary_diagnosis: "FAP saturé (trajets courts) — régénération forcée", urgency: "bientôt", can_drive: true, estimated_cost_min: 0, estimated_cost_max: 150, parts_needed: ["(régénération, pas de pièce si réussie)"] }],
    script: [
      { kind: "tool", text: "Ok, voyant FAP. Je lis les codes.", name: "read_dtcs", input: {} },
      { kind: "tool", text: "P2002 = efficacité FAP basse. Je consulte la base.", name: "lookup_dtc", input: { codes: ["P2002"] } },
      { kind: "tool", text: "Avant de décider, je mesure le taux de suie réel.", name: "read_extended_data", input: { request: "dpf_soot_load" } },
      { kind: "ask", text: "Le FAP est à 92 % de suie. Je peux lancer une RÉGÉNÉRATION FORCÉE. ⚠️ Conditions : voiture DEHORS (gaz ~600°C), rien d'inflammable derrière, réservoir > 1/4, on NE COUPE PAS le moteur ~20-25 min. Tu es dehors et tu confirmes ?", userReply: "oui je suis dehors, réservoir à moitié, vas-y" },
      { kind: "tool", text: "Parfait, je lance la régénération. Reste à côté, ne coupe pas le moteur.", name: "service_reset", input: { type: "dpf_forced_regen", confirmed: true, preconditions_ok: true } },
      { kind: "tool", text: "C'est parti. Je surveille la progression.", name: "read_extended_data", input: { request: "dpf_regen_status" } },
      { kind: "tool", text: "Ça monte en température, je continue à surveiller.", name: "read_extended_data", input: { request: "dpf_regen_status" } },
      { kind: "tool", text: "Dernière vérif du statut.", name: "read_extended_data", input: { request: "dpf_regen_status" } },
      { kind: "tool", text: "Régénération terminée, suie à 6 %. Je note le diagnostic.", name: "record_case", input: { symptom: "Voyant FAP, trajets courts", obd_code: "P2002", primary_diagnosis: "FAP saturé — régénération forcée réussie", parts_needed: [], estimated_cost_min: 0, estimated_cost_max: 0, urgency: "préventif", can_drive: true, confidence_percent: 90 } },
      { kind: "end", text: "C'est réglé ✅ Conseil : roule ~20 min sur route/autoroute de temps en temps pour éviter que le FAP se re-sature. Bonne route !" },
    ],
  },
};
