/**
 * MecaIA Desktop — Module OBD2 ELM327 — v2 (17/06/2026)
 * Modes OBD2 couverts :
 *   Mode 01 — Données temps réel (30+ PIDs)
 *   Mode 02 — Freeze Frame (données au moment du défaut)
 *   Mode 03 — Codes défauts confirmés (DTC)
 *   Mode 04 — Effacer codes défauts
 *   Mode 07 — Codes défauts en attente (Pending DTC)
 *   Mode 09 — Informations véhicule (VIN, ECU, Calibration)
 *   Mode 0A — Codes défauts permanents
 * Moniteurs d'émissions — readiness checks
 * Analyse automatique — diagnostics combinés
 */

const { SerialPort }    = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { EventEmitter }  = require('events');

// ─── INIT ELM327 ─────────────────────────────────────────────────────────────
// Séquence init ELM327/STN1110 (OBDLink MX+, Vgate, etc.)
const INIT_CMDS = [
  'ATZ',    // Reset complet
  'ATE0',   // Echo off
  'ATL0',   // Linefeeds off
  'ATS0',   // Spaces off
  'ATH0',   // Headers off
  'ATAL',   // Allow Long messages
];

// Protocoles à essayer si ATSP0 échoue (véhicules problématiques)
const FALLBACK_PROTOCOLS = [
  'ATSP6',  // ISO 15765-4 CAN 11bit 500kbaud (le plus commun, VW/Audi/Peugeot/Renault)
  'ATSP5',  // ISO 15765-4 CAN 11bit 250kbaud (certains diesels, Ford US)
  'ATSP4',  // ISO 14230-4 KWP 5baud init
  'ATSP3',  // ISO 9141-2 (vieux véhicules pre-2001)
  'ATSPA',  // SAE J1939 (poids lourds/utilitaires)
];

// ─── TOUS LES PIDs MODE 01 ────────────────────────────────────────────────────
const PIDS = {
  // Moteur
  RPM:          { cmd:'010C', label:'Régime moteur',        unit:'tr/min', parse:(d)=>Math.round(parseInt(d,16)/4) },
  SPEED:        { cmd:'010D', label:'Vitesse',              unit:'km/h',   parse:(d)=>parseInt(d,16) },
  COOLANT:      { cmd:'0105', label:'Temp. liquide refr.',  unit:'°C',     parse:(d)=>parseInt(d,16)-40 },
  ENGINE_LOAD:  { cmd:'0104', label:'Charge moteur',        unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  THROTTLE:     { cmd:'0111', label:'Position papillon',    unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  TIMING:       { cmd:'010E', label:'Avance allumage',      unit:'°',      parse:(d)=>parseInt(d,16)/2-64 },
  MAF:          { cmd:'0110', label:'Débit masse air (MAF)',unit:'g/s',    parse:(d)=>parseInt(d,16)/100 },
  INTAKE_MAP:   { cmd:'010B', label:'Pression admission',   unit:'kPa',    parse:(d)=>parseInt(d,16) },
  INTAKE_TEMP:  { cmd:'010F', label:'Temp. admission',      unit:'°C',     parse:(d)=>parseInt(d,16)-40 },
  OIL_TEMP:     { cmd:'015C', label:'Temp. huile moteur',   unit:'°C',     parse:(d)=>parseInt(d,16)-40 },
  // Carburant
  FUEL_LEVEL:   { cmd:'012F', label:'Niveau carburant',     unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  FUEL_PRESSURE:{ cmd:'010A', label:'Pression carburant',   unit:'kPa',    parse:(d)=>parseInt(d,16)*3 },
  FUEL_RAIL:    { cmd:'0122', label:'Pression rampe inj.',  unit:'kPa',    parse:(d)=>parseInt(d,16)*0.079 },
  FUEL_TRIM_ST: { cmd:'0106', label:'Correction carb. CT',  unit:'%',      parse:(d)=>(parseInt(d,16)-128)*100/128 },
  FUEL_TRIM_LT: { cmd:'0107', label:'Correction carb. LT',  unit:'%',      parse:(d)=>(parseInt(d,16)-128)*100/128 },
  ETHANOL:      { cmd:'0152', label:'Teneur éthanol',       unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  // Sonde lambda
  O2_B1S1:      { cmd:'0114', label:'Sonde O2 B1S1 (amont)',unit:'V',      parse:(d)=>parseInt(d,16)*0.005 },
  O2_B1S2:      { cmd:'0115', label:'Sonde O2 B1S2 (aval)', unit:'V',      parse:(d)=>parseInt(d,16)*0.005 },
  // Électricité
  BATTERY:      { cmd:'0142', label:'Tension batterie',     unit:'V',      parse:(d)=>parseInt(d,16)/1000 },
  // Émissions
  BARO:         { cmd:'0133', label:'Pression baro.',       unit:'kPa',    parse:(d)=>parseInt(d,16) },
  CATALYST_TEMP:{ cmd:'013C', label:'Temp. catalyseur',     unit:'°C',     parse:(d)=>parseInt(d,16)*0.1-40 },
  EVAP_PURGE:   { cmd:'012E', label:'Purge EVAP',           unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  // Pédale/conducteur
  ACCEL_POS:    { cmd:'0149', label:'Pédale accélérateur',  unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  AMBIENT_TEMP: { cmd:'0146', label:'Temp. ambiante',       unit:'°C',     parse:(d)=>parseInt(d,16)-40 },
  // Contrôle moteur
  EGR_ERROR:    { cmd:'002D', label:'Erreur EGR',           unit:'%',      parse:(d)=>(parseInt(d,16)-128)*100/128 },
  RUN_TIME:     { cmd:'011F', label:'Temps moteur démarré', unit:'s',      parse:(d)=>parseInt(d,16) },
  MIL_DISTANCE: { cmd:'0121', label:'Distance avec MIL ON', unit:'km',     parse:(d)=>parseInt(d,16) },
  WARM_UPS:     { cmd:'0130', label:'Chauffe-moteur cycles',unit:'',       parse:(d)=>parseInt(d,16) },
  // Diesel specifiques (eOBD)
  FUEL_RAIL_HP: { cmd:'0123', label:'Pression rampe HP',    unit:'kPa',    parse:(d)=>parseInt(d,16)*10 },
  EGR_CMD:      { cmd:'012C', label:'EGR commandé',         unit:'%',      parse:(d)=>Math.round(parseInt(d,16)*100/255) },
  INJ_TIMING:   { cmd:'015D', label:'Timing injection',     unit:'°',      parse:(d)=>((parseInt(d,16)-26880)/128).toFixed(2) },
  FUEL_RATE:    { cmd:'015E', label:'Consommation',         unit:'L/h',    parse:(d)=>parseInt(d,16)*0.05 },
  TORQUE_DRV:   { cmd:'0161', label:'Couple demandé',       unit:'%',      parse:(d)=>parseInt(d,16)-125 },
  TORQUE_ACT:   { cmd:'0162', label:'Couple réel',          unit:'%',      parse:(d)=>parseInt(d,16)-125 },
  ABS_LOAD:     { cmd:'0143', label:'Charge absolue',       unit:'%',      parse:(d)=>parseInt(d,16)*100/255 },
  COMMANDED_AF: { cmd:'0144', label:'Richesse commandée',   unit:'λ',      parse:(d)=>(parseInt(d,16)*2/65536).toFixed(3) },
  TIME_MIL_ON:  { cmd:'014D', label:'Durée MIL allumé',     unit:'min',    parse:(d)=>parseInt(d,16) },
  TIME_CLR:     { cmd:'014E', label:'Durée depuis effacé',  unit:'min',    parse:(d)=>parseInt(d,16) },
};

// Monitoring léger (PIDs rapides)
const MONITOR_PIDS = [
  // Priorité 1 - vitaux
  'RPM','SPEED','COOLANT','ENGINE_LOAD','BATTERY','THROTTLE',
  // Priorité 2 - moteur + turbo diesel
  'MAF','INTAKE_MAP','INTAKE_TEMP','OIL_TEMP',
  // Priorité 3 - carburant + corrections
  'FUEL_TRIM_ST','FUEL_TRIM_LT','FUEL_RAIL_HP','INJ_TIMING',
  // Priorité 4 - émissions + sondes
  'O2_B1S1','O2_B1S2','BARO','AMBIENT_TEMP',
  // Priorité 5 - conducteur + divers
  'ACCEL_POS','EGR_CMD','FUEL_RATE','ABS_LOAD','RUN_TIME'
];

// Décodage préfixe DTC
const DTC_PREFIX = {
  '0':'P0','1':'P1','2':'P2','3':'P3',
  '4':'C0','5':'C1','6':'C2','7':'C3',
  '8':'B0','9':'B1','A':'B2','B':'B3',
  'C':'U0','D':'U1','E':'U2','F':'U3',
};

// Moniteurs d'émissions (Mode 01 PID 01)
const MONITOR_NAMES = [
  'Raté allumage','Système carburant','Composants',
  'Catalyseur','Catalyseur chauffé','Évaporation','Air secondaire',
  'Climatisation','Sonde O2','Sonde O2 chauffée','EGR'
];


// ===== VEHICULES COMPATIBLES (26 marques, 300+ modeles) =====================
const VEHICLES_DB = {
  vw:        {name:'Volkswagen',    ecu:'7E0', models:['Golf','Polo','Passat','Tiguan','T-Roc','T-Cross','Touran','Arteon','ID.3','ID.4','Caddy','Transporter'], resets:['huile','dpf','frein','batt','papillon','injecteur'], options:['feux_journee','essuie_pluie','confort_fermeture','demarrage_sans_cle','lane_assist','retros_rabattables','feux_bienvenue','feux_virage','klaxon_verrouillage','mode_sport_auto']},
  audi:      {name:'Audi',          ecu:'7E0', models:['A1','A3','A4','A5','A6','A7','A8','Q2','Q3','Q5','Q7','Q8','TT','R8','e-tron'], resets:['huile','dpf','frein','batt','papillon','injecteur','boite'], options:['feux_journee','essuie_pluie','lane_assist','retros_rabattables','feux_bienvenue']},
  seat:      {name:'SEAT',          ecu:'7E0', models:['Ibiza','Leon','Arona','Ateca','Tarraco','Mii'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  skoda:     {name:'Skoda',         ecu:'7E0', models:['Fabia','Octavia','Superb','Karoq','Kodiaq','Kamiq','Enyaq','Scala'], resets:['huile','dpf','frein','batt','papillon'], options:['feux_journee']},
  peugeot:   {name:'Peugeot',       ecu:'7A0', models:['108','208','308','408','508','2008','3008','5008','Partner','Expert','Boxer','e-208'], resets:['huile','dpf','frein','batt','papillon'], options:['feux_journee','lane_assist','retros_rabattables']},
  citroen:   {name:'Citroen',       ecu:'7A0', models:['C1','C3','C4','C5','C5X','Berlingo','SpaceTourer','C3 Aircross','C5 Aircross'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  opel:      {name:'Opel',          ecu:'7E0', models:['Corsa','Astra','Insignia','Mokka','Crossland','Grandland','Combo','Vivaro'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  renault:   {name:'Renault',       ecu:'7C0', models:['Clio','Megane','Captur','Kadjar','Talisman','Koleos','Twingo','Zoe','Arkana','Austral','Scenic','Master','Trafic'], resets:['huile','dpf','frein','batt','papillon'], options:['feux_journee','essuie_pluie']},
  dacia:     {name:'Dacia',         ecu:'7C0', models:['Sandero','Logan','Duster','Jogger','Lodgy','Spring'], resets:['huile','dpf','frein'], options:[]},
  bmw:       {name:'BMW',           ecu:'7E0', models:['Serie 1','Serie 2','Serie 3','Serie 4','Serie 5','X1','X2','X3','X4','X5','X6','X7','Z4','M2','M3','M4','M5','i3','i4','iX'], resets:['huile','dpf','frein','batt'], options:['feux_journee','lane_assist','sport_display','feux_bienvenue','affichage_tete_haute','mode_sport_auto']},
  mini:      {name:'MINI',          ecu:'7E0', models:['One','Cooper','Cooper S','JCW','Clubman','Countryman','Convertible'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  mercedes:  {name:'Mercedes-Benz', ecu:'7E0', models:['Classe A','Classe B','Classe C','Classe E','Classe S','CLA','CLS','GLA','GLB','GLC','GLE','GLS','EQA','EQC','Vito','Sprinter'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  ford:      {name:'Ford',          ecu:'7E0', models:['Fiesta','Focus','Mondeo','Mustang','Puma','Kuga','Transit','Ranger','Galaxy','S-Max'], resets:['huile','dpf','frein','batt','papillon'], options:['feux_journee']},
  toyota:    {name:'Toyota',        ecu:'7E0', models:['Yaris','Corolla','Camry','Prius','RAV4','C-HR','Yaris Cross','GR86','Supra','Land Cruiser','Hilux','Proace'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  lexus:     {name:'Lexus',         ecu:'7E0', models:['IS','ES','LS','UX','NX','RX','GX','LX','LC','RC'], resets:['huile','frein','batt'], options:[]},
  honda:     {name:'Honda',         ecu:'7E0', models:['Jazz','Civic','Accord','HR-V','CR-V','ZR-V'], resets:['huile','dpf','frein','batt'], options:[]},
  hyundai:   {name:'Hyundai',       ecu:'7E0', models:['i10','i20','i30','Ioniq','Ioniq 5','Ioniq 6','Kona','Tucson','Santa Fe','Nexo'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  kia:       {name:'Kia',           ecu:'7E0', models:['Picanto','Rio','Ceed','ProCeed','Stinger','EV6','Niro','Sportage','Sorento','EV9'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  fiat:      {name:'Fiat',          ecu:'7A0', models:['500','Panda','Punto','Tipo','Doblo','Ducato','500X','500L'], resets:['huile','dpf','frein'], options:[]},
  alfa:      {name:'Alfa Romeo',    ecu:'7A0', models:['Giulia','Stelvio','Tonale','Giulietta'], resets:['huile','dpf','frein','batt'], options:['feux_journee']},
  volvo:     {name:'Volvo',         ecu:'7E0', models:['V40','V60','V90','S60','S90','XC40','XC60','XC90','C40','EX30','EX90'], resets:['huile','dpf','frein','batt'], options:[]},
  mazda:     {name:'Mazda',         ecu:'7E0', models:['2','3','6','CX-3','CX-30','CX-5','CX-60','MX-5','MX-30'], resets:['huile','dpf','frein'], options:['feux_journee']},
  nissan:    {name:'Nissan',        ecu:'7E0', models:['Micra','Juke','Qashqai','X-Trail','Ariya','Leaf','Navara','Interstar'], resets:['huile','dpf','frein','batt'], options:[]},
  subaru:    {name:'Subaru',        ecu:'7E0', models:['Impreza','Legacy','Outback','Forester','XV','BRZ','WRX'], resets:['huile','dpf','frein'], options:[]},
  suzuki:    {name:'Suzuki',        ecu:'7E0', models:['Swift','Ignis','Baleno','Vitara','SX4','Across'], resets:['huile','frein'], options:[]},
  mitsubishi:{name:'Mitsubishi',    ecu:'7E0', models:['Colt','Eclipse Cross','Outlander','L200','Space Star'], resets:['huile','dpf','frein'], options:[]},
};

const SERVICE_RESETS = {
  huile:    {label:'Reset vidange huile',   icon:'🛢️', desc:"Remet compteur vidange a zero. APRES vidange.", warn:"Changez l\'huile AVANT.", uds:{vw:[['ATSH7E0'],['1003'],['3E00'],['2E FD 52 01 01']],peugeot:[['ATSH7A0'],['1003'],['2E A0 00 40 00']],renault:[['ATSH7C0'],['1003'],['2E 15 9E 01']],bmw:[['ATSH7E0'],['1003'],['10 02'],['28 83 03']],default:[['0101']]}},
  dpf:      {label:'Reset FAP/DPF diesel',  icon:'🔥', desc:'Regeneration forcee filtre particules.',         warn:'Diesel uniquement. Moteur chaud >80C.',    uds:{vw:[['ATSH7E0'],['1003'],['2E F1 2F 01']],peugeot:[['ATSH7A0'],['1003'],['31 01 E2 00']],renault:[['ATSH7C0'],['1003'],['31 01 02 00']],default:[['04']]}},
  frein:    {label:'Reset usure freins',    icon:'🛑', desc:'Remet a zero usure plaquettes.',                 warn:'Apres remplacement plaquettes uniquement.',  uds:{vw:[['ATSH7E0'],['1003'],['2E FA 07 00']],peugeot:[['ATSH7A0'],['1003'],['2E A2 00 00']],default:[['0101']]}},
  batt:     {label:'Adaptation batterie',   icon:'🔋', desc:'Enregistre nouvelle batterie dans ECU.',         warn:'Necessaire AGM/EFB. Moteur eteint.',         uds:{vw:[['ATSH7E0'],['1003'],['2E F1 A0 00 00 00 00 00 00']],bmw:[['ATSH7E0'],['10 02'],['31 01 00 14']],default:[['0101']]}},
  papillon: {label:'Adaptation papillon',   icon:'⚙️', desc:'Recalibre corps papillon. Supprime a-coups.',    warn:'Moteur chaud >60C. Ne pas accelerer.',       uds:{vw:[['ATSH7E0'],['1003'],['31 01 06 B0']],renault:[['ATSH7C0'],['1003'],['31 01 01 B8']],default:[['0104']]}},
  injecteur:{label:'Calibration injecteurs',icon:'💉', desc:'Code corrections injecteurs dans ECU.',          warn:'Codes IMA sur corps injecteur. Diesel direct.',uds:{vw:[['ATSH7E0'],['1003'],['31 01 02 13 00 00 00 00']],default:[['0101']]}},
  boite:    {label:'Adaptation boite auto', icon:'🔧', desc:'Reset adaptation DSG/automatique.',              warn:'A froid. Comportement different pendant apprentissage.',uds:{vw:[['ATSH7E1'],['1003'],['31 01 08 09']],default:[['0101']]}},
};

const COMPONENT_TESTS = {
  ventilateur:     {label:'Ventilateur refroidissement',icon:'🌀',desc:'Active ventilateur 100%', safe:true,  uds:{vw:{on:['ATSH7E0','1003','2F 10 01 03 64'],off:['2F 10 01 00 00','1001']},peugeot:{on:['ATSH7A0','1003','2F 20 01 03 64'],off:['2F 20 01 00 00']},default:{on:['08 01 01'],off:['08 02 01']}}},
  purge_evap:      {label:'Vanne purge EVAP',           icon:'🫧',desc:'Teste circuit vapeur carburant', safe:true,  uds:{vw:{on:['ATSH7E0','1003','2F 10 0A 03 64'],off:['2F 10 0A 00 00']},default:{on:['08 01 08'],off:['08 02 08']}}},
  egr:             {label:'Vanne EGR',                  icon:'♻️',desc:'Teste ouverture/fermeture EGR', safe:true,  uds:{vw:{on:['ATSH7E0','1003','2F 10 05 03 50'],off:['2F 10 05 00 00']},peugeot:{on:['ATSH7A0','1003','2F 21 01 03 50'],off:['2F 21 01 00 00']},default:{on:['08 01 0A'],off:['08 02 0A']}}},
  injecteur_test:  {label:'Test injecteurs',            icon:'💉',desc:'Balance injecteurs par cylindre', safe:true,  uds:{vw:{on:['ATSH7E0','1003','31 01 02 13 00 00 00 00'],off:['31 02 02 13']},default:{on:['08 01 06'],off:['08 02 06']}}},
  frein_parking:   {label:'Frein parking EPB',          icon:'🅿️',desc:"Ouvre etrier pour changer plaquettes", safe:true,  uds:{vw:{on:['ATSH7E0','1003','31 01 03 02'],off:['31 01 03 01']},default:{on:['08 01 11'],off:['08 02 11']}}},
  pompe_eau:       {label:'Pompe eau electrique',       icon:'💧',desc:'Active pompe eau hybrides', safe:true,  uds:{vw:{on:['ATSH7E0','1003','2F 10 04 03 64'],off:['2F 10 04 00 00']},default:{on:['08 01 02'],off:['08 02 02']}}},
  lambda_chauffage:{label:'Sonde lambda chauffage',     icon:'🌡️',desc:'Test resistance chauffage O2', safe:true,  uds:{default:{on:['08 01 0C'],off:['08 02 0C']}}},
  klaxon_test:     {label:'Test klaxon',                icon:'📢',desc:'Active klaxon brievement', safe:false, uds:{default:{on:['08 01 0B'],off:['08 02 0B']}}},
};

const VEHICLE_OPTIONS = {
  feux_journee:      {label:'Feux de jour (DRL)',            icon:'💡',risk:'faible',desc:'Active/desactive feux diurnes', uds:{vw:{read:['ATSH7E0','1003','22 F1 25'],on:['2E F1 25 01'],off:['2E F1 25 00']}}},
  essuie_pluie:      {label:'Essuie-glace auto pluie',       icon:'🌧️',risk:'faible',desc:'Active/desactive capteur pluie', uds:{vw:{read:['ATSH7E0','1003','22 F1 27'],on:['2E F1 27 01'],off:['2E F1 27 00']}}},
  confort_fermeture: {label:'Fermeture vitres telecommande', icon:'🪟',risk:'faible',desc:'Fermer vitres maintenant verrouillage', uds:{vw:{read:['ATSH7E0','1003','22 F1 00'],on:['2E F1 00 09'],off:['2E F1 00 01']}}},
  demarrage_sans_cle:{label:'Demarrage sans cle (Keyless)',  icon:'🔑',risk:'moyen', desc:'Demarrage sans inserer cle', uds:{vw:{read:['ATSH7E0','1003','22 F1 60'],on:['2E F1 60 01'],off:['2E F1 60 00']}}},
  lane_assist:       {label:'Aide maintien de voie',         icon:'🛣️',risk:'faible',desc:'Alerte franchissement ligne', uds:{vw:{read:['ATSH7E0','1003','22 F4 01'],on:['2E F4 01 01'],off:['2E F4 01 00']}}},
  sport_display:     {label:'Affichage sportif bord',        icon:'🏎️',risk:'faible',desc:'Chrono et donnees sport', uds:{bmw:{read:['ATSH7E0','1003','22 E0 04'],on:['2E E0 04 01'],off:['2E E0 04 00']}}},

  retros_rabattables: {
    label: 'Rétroviseurs rabattables automatiques',
    icon: '🪞',
    risk: 'faible',
    desc: 'Rabat automatiquement les rétroviseurs en verrouillant la voiture',
    uds: {
      vw: { read: ['ATSH7E0','1003','22 F1 30'], on: ['2E F1 30 03'], off: ['2E F1 30 00'] },
      peugeot: { read: ['ATSH7A0','1003','22 B0 10'], on: ['2E B0 10 01'], off: ['2E B0 10 00'] },
    },
  },
  feux_bienvenue: {
    label: 'Feux de bienvenue (Coming Home / Leaving Home)',
    icon: '🏠',
    risk: 'faible',
    desc: 'Les phares s\'allument en approchant/quittant la voiture',
    uds: {
      vw: { read: ['ATSH7E0','1003','22 F1 40'], on: ['2E F1 40 01'], off: ['2E F1 40 00'] },
    },
  },
  feux_virage: {
    label: 'Phares de virage (Cornering lights)',
    icon: '↪️',
    risk: 'faible',
    desc: 'Les antibrouillards s\'activent en tournant pour éclairer le virage',
    uds: {
      vw: { read: ['ATSH7E0','1003','22 F1 45'], on: ['2E F1 45 01'], off: ['2E F1 45 00'] },
    },
  },
  klaxon_verrouillage: {
    label: 'Bip klaxon à la fermeture',
    icon: '📢',
    risk: 'faible',
    desc: 'Confirme la fermeture avec un bip de klaxon',
    uds: {
      vw: { read: ['ATSH7E0','1003','22 F1 05'], on: ['2E F1 05 03'], off: ['2E F1 05 01'] },
      skoda: { read: ['ATSH7E0','1003','22 F1 05'], on: ['2E F1 05 03'], off: ['2E F1 05 01'] },
    },
  },
  demarrage_distance: {
    label: 'Démarrage à distance',
    icon: '🔄',
    risk: 'moyen',
    desc: 'Démarrage du moteur via la télécommande (si équipement présent)',
    uds: {
      vw: { read: ['ATSH7E0','1003','22 F1 70'], on: ['2E F1 70 01'], off: ['2E F1 70 00'] },
    },
  },
  recuperation_energie: {
    label: 'Niveau récupération énergie (hybrides)',
    icon: '⚡',
    risk: 'moyen',
    desc: 'Niveau de freinage régénératif (faible/moyen/fort)',
    uds: {
      default: { read: ['ATSH7E0','1003','22 D0 01'], on: ['2E D0 01 03'], off: ['2E D0 01 01'] },
    },
  },
  affichage_tete_haute: {
    label: 'Head-Up Display (HUD) niveau',
    icon: '🖥️',
    risk: 'faible',
    desc: 'Active ou désactive l\'affichage tête haute',
    uds: {
      bmw: { read: ['ATSH7E0','1003','22 E0 10'], on: ['2E E0 10 01'], off: ['2E E0 10 00'] },
    },
  },
  mode_sport_auto: {
    label: 'Mode Sport automatique au démarrage',
    icon: '🏎️',
    risk: 'moyen',
    desc: 'La voiture démarre directement en mode Sport',
    uds: {
      vw: { read: ['ATSH7E0','1003','22 F5 00'], on: ['2E F5 00 02'], off: ['2E F5 00 01'] },
      bmw: { read: ['ATSH7E0','1003','22 E0 20'], on: ['2E E0 20 01'], off: ['2E E0 20 00'] },
    },
  },
};

// ─── CLASSE OBD2 ──────────────────────────────────────────────────────────────
class OBD2 extends EventEmitter {
  constructor() {
    super();
    this.port        = null;
    this.parser      = null;
    this.connected   = false;
    this.portPath    = null;
    this._resolve    = null;
    this._timeout    = null;
    this._monitorInterval = null;
    this.lastScan    = null; // Cache du dernier scan complet
  }

  // ── Lister les ports COM ───────────────────────────────────────────────────
  // ── AUTO-CONNECT : probe tous les ports BT, prend le premier qui repond ATZ ──────────
  // Pattern utilise par Torque Pro, FIXD, OBDLink app : probe-all-ATZ-winner
  // Le frontend n'a plus JAMAIS besoin de connaitre le numero COM
  static async _probePort(portPath) {
    return new Promise(resolve => {
      const port = new SerialPort({ path: portPath, baudRate: 38400, autoOpen: false });
      const parser = port.pipe(new ReadlineParser({ delimiter: '\r' }));
      let done = false;
      const finish = (result) => {
        if (done) return; done = true;
        try { port.close(() => {}); } catch(_) {}
        resolve(result);
      };
      const timer = setTimeout(() => finish(null), 8000);
      parser.on('data', line => {
        const c = line.trim();
        if (!c) return;
        // Toute reponse non-vide = chip present (SEARCHING/STOPPED/ELM327/>OK/? = c'est lui)
        // '?' seul peut venir d'un port fantome, on l'accepte aussi (mieux un faux positif)
        clearTimeout(timer);
        finish({ port: portPath, hint: c });
      });
      port.open(err => {
        if (err) { clearTimeout(timer); finish(null); return; }
        port.write('\r');                               // flush tout buffer precedent
        setTimeout(() => { if (!done) port.write('ATZ\r'); }, 600); // ATZ apres 600ms
      });
      port.on('error', () => finish(null));
    });
  }

  static async autoConnect() {
    // 1. Lister tous les ports systeme
    const allPorts = await SerialPort.list();
    // 2. Filtre NEGATIF = exclure SEULEMENT les ports systeme connus comme non-OBD
    // On probe TOUT le reste — parallel donc toujours 5s max peu importe le nombre
    // Fonctionne sur nimporte quel PC, nimporte quel driver BT, nimporte quel adaptateur
    const SYSTEM_BLACKLIST = [
      'intel', 'active management', ' sol',  // Intel AMT
      'gps receiver', 'prolific gps',         // GPS
      'modem', 'fax', 'voice',                // Telecom
      'irda', 'infrared',                     // Infrarouge
      'debug', 'console', 'jtag',             // Dev tools
    ];
    const candidates = allPorts.filter(p => {
      const fn = (p.friendlyName || '').toLowerCase();
      const mn = (p.manufacturer  || '').toLowerCase();
      // Exclure si port systeme connu
      if (SYSTEM_BLACKLIST.some(kw => fn.includes(kw) || mn.includes(kw))) return false;
      // CRITIQUE : exclure port fantome BT Windows (MAC nul = jamais un ELM327)
      if (/&0&000000000000_/i.test(p.pnpId || '')) return false;
      // Garder TOUT le reste
      return true;
    });
    if (!candidates.length) return null;
    // 3. Probe PARALLELE : tous les ports en meme temps, le premier qui repond gagne
    // Promise.any = prend le premier resolve, ignore les null (reject = timeout)
    try {
      const winner = await Promise.any(
        candidates.map(cand => new Promise((res, rej) => {
          OBD2._probePort(cand.path).then(r => r ? res(r) : rej(null)).catch(() => rej(null));
        }))
      );
      return winner;
    } catch(_) {
      return null; // Tous ont timeout = aucun boitier connecte/alimente
    }
  }

  // ── AUTO-CONNECT : probe tous les ports BT, prend le premier qui repond ATZ ──────────
  // Pattern utilise par Torque Pro, FIXD, OBDLink app : probe-all-ATZ-winner
  // Le frontend n'a plus JAMAIS besoin de connaitre le numero COM

  static async listPorts() {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path:         p.path,
      manufacturer: p.manufacturer || 'Inconnu',
      serialNumber: p.serialNumber || '',
      friendlyName: p.friendlyName || p.path,
      isOBD2: (
               // Port Bluetooth standard (OBDLink MX+, Vgate, etc.)
               (p.manufacturer||'').toLowerCase().includes('bluetooth') ||
               (p.friendlyName||'').toLowerCase().includes('bluetooth') ||
               (p.pnpId||'').toLowerCase().includes('bluetooth') ||
               // Noms connus adaptateurs OBD
               (p.friendlyName||'').toLowerCase().includes('obd') ||
               (p.friendlyName||'').toLowerCase().includes('elm') ||
               (p.friendlyName||'').toLowerCase().includes('vgate') ||
               (p.friendlyName||'').toLowerCase().includes('obdlink') ||
               (p.friendlyName||'').toLowerCase().includes('standard serial over bluetooth') ||
               (p.friendlyName||'').toLowerCase().includes('lien série') ||
               // Exclure explicitement Intel AMT / ports systeme
               false
             ) && !(
               (p.manufacturer||'').toLowerCase().includes('intel') ||
               (p.friendlyName||'').toLowerCase().includes('active management') ||
               (p.friendlyName||'').toLowerCase().includes(' sol') ||
               (p.path === 'COM3' && ((p.manufacturer||'').toLowerCase().includes('intel') || (p.friendlyName||'').toLowerCase().includes('intel'))) ||
               // Port BT local outgoing Windows (MAC nul = fantome, pas un vrai device OBD)
               /&0&000000000000_/i.test(p.pnpId || '')
             ),
    }));
  }

  // ── Connexion ──────────────────────────────────────────────────────────────
  // connect() — connexion directe 38400 (Bluetooth Windows ignore le baud)
  async _forceClose() {
    // Fermeture forcee avant reconnect (evite COM5 Access Denied sur retry)
    try {
      if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
      this._resolve = null;
      if (this.port) {
        if (this.port.isOpen) {
          await new Promise(r => { try { this.port.close(r); } catch(_) { r(); } });
        }
        try { this.port.destroy(); } catch(_) {}
        this.port = null;
      }
      if (this.parser) { try { this.parser.removeAllListeners(); } catch(_) {} this.parser = null; }
      await this._delay(300);
    } catch(_) {}
    this.connected = false;
  }

  async connect(portPath, baudRate) {
    // TOUJOURS forcer la fermeture avant de se connecter (evite Access Denied COM5)
    await this._forceClose();
    this.portPath = portPath;
    this.emit('status', { type: 'connecting', port: portPath });

    // Sur Bluetooth SPP Windows, le baud rate est transparent (ignore par le stack BT)
    // On utilise 38400 standard ELM327
    var baud = baudRate || 38400;
    try {
      await this._tryConnect(portPath, baud);
      return { connected: true, port: portPath, version: this.elmVersion, vehicleReady: this.vehicleReady };
    } catch(e) {
      this.emit('status', { type: 'error', message: e.message });
      throw e;
    }
  }

  async _tryConnect(portPath, baudRate) {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r' }));

      this.port.open((err) => {
        if (err) return reject(new Error('Port ' + portPath + ': ' + err.message));

        this.parser.on('data', (line) => {
          const clean = line.trim().replace(/\s+/g,' ');
          if (clean && this._resolve) {
            clearTimeout(this._timeout);
            this._resolve(clean);
            this._resolve = null;
          }
        });

        this.port.on('error', (e) => {
          this.emit('log', 'SerialError: ' + e.message);
        });
        this.port.on('close', () => {
          this.connected = false;
          this.emit('status', { type: 'disconnected' });
        });

        this._initELM327()
          .then((version) => {
            // Verifier que le port est encore ouvert apres l'init (Bluetooth peut dropper pendant vehiclePing)
            if (!this.port || !this.port.isOpen) {
              return reject(new Error('Port ferme pendant initialisation (Bluetooth timeout)'));
            }
            this.connected = true;
            this.elmVersion = version;
            this.emit('log', 'Connected baud=' + baudRate + ' version=' + version + ' vehicleReady=' + this.vehicleReady);
            const msg = version + (this.vehicleReady ? '' : ' | mettez le contact pour scanner');
            this.emit('status', {
              type: 'connected',
              port: portPath,
              version: msg,
              vehicleReady: this.vehicleReady,
              baud: baudRate,
            });
            resolve({ connected: true });
          })
          .catch((e) => {
            try { if (this.port && this.port.isOpen) this.port.close(); } catch(_) {}
            reject(e);
          });
      });
    });
  }

  async _initELM327() {
    let version = 'ELM327';

    // ETAPE 1 : Stabilisation BT SPP (le stack Windows a besoin de temps)
    await this._delay(1000);

    // ETAPE 2 : Flush buffer — envoyer CR pour vider ce que le MX+ a en attente
    // OBD Wiz et tous les drivers pro font ca avant ATZ
    this.port.write('\r');
    await this._delay(1500); // attendre SEARCHING/STOPPED du cycle precedent

    // Vider tout ce qui est arrive pendant l attente (prompt >, ancien state, etc.)
    // En drainant _resolve pour ignorer les donnees fantomes
    this._resolve = null;
    if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }

    // ETAPE 3 : ATZ avec gestion echo
    // L ELM327 echo la commande avant de repondre quand echo=ON (defaut apres reset)
    // On envoie ATZ et on accepte TOUT ce qui arrive comme "connecte"
    let atzOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this.emit('log', 'ATZ attempt ' + (attempt+1));
        const resp = await this._send('ATZ', 12000);
        // resp peut etre l echo "ATZ", "ELM327 v2.2", "STOPPED" (chip K-line en cours)
        if (resp) {
          const r = resp.trim();
          if (r && r !== '?' && r !== 'ERROR') {
            // STOPPED = ATZ reçu pendant K-line search — chip en cours de reset (~8s)
            if (r === 'STOPPED' || r.includes('SEARCHING')) {
              this.emit('log', 'ATZ: chip occupé K-line (STOPPED), attente reset complet 9s...');
              await this._delay(9000); // laisser le chip finir son reset
            }
            // Extraire version si c est la vraie reponse ELM
            if (r.toUpperCase().includes('ELM') || r.toUpperCase().includes('STN') || r.toUpperCase().includes('OBD')) {
              version = r.split('\n')[0].trim();
            }
            atzOk = true;
            this.emit('log', 'ATZ OK: ' + r);
            break;
          }
        }
      } catch(e) {
        this.emit('log', 'ATZ attempt ' + (attempt+1) + ' failed: ' + e.message);
        if (attempt < 2) {
          await this._delay(1500);
          // Nouveau flush avant retry
          this.port.write('\r');
          await this._delay(300);
          this._resolve = null;
        }
      }
    }

    if (!atzOk) {
      throw new Error('Boitier OBD non repond \u2014 branchez le boitier dans la voiture et mettez le contact');
    }

    // Attendre que le chip finisse son reset interne
    // 2000ms : laisse ELM327 v1.4b arriver et etre ignore avant d'envoyer ATE0
    // (le version string arrive ~920ms apres ATZ, le delay doit couvrir ca)
    await this._delay(2000);

    // ETAPE 4 : Commandes de configuration (ATE0, ATL0, etc.) — ignorer les erreurs
    const CONFIG_CMDS = ['ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATAL']; // ATS1=espaces ON, ATS0 cassait le parser K-line
    for (const cmd of CONFIG_CMDS) {
      try {
        const resp = await this._send(cmd, 2000);
        this.emit('log', cmd + ' -> ' + (resp || 'OK'));
      } catch(e) {
        this.emit('log', 'CONFIG WARN ' + cmd + ': ' + e.message + ' (ignore)');
      }
      await this._delay(100);
    }

    this.vehicleReady = false;
    return version;
  }

  async _checkVehiclePing() {
    // Ping rapide : 1 essai, 5s max — ne pas bloquer la connexion
    // Le vrai diagnostic de protocole se fait au moment du scan
    if (!this.port || !this.port.isOpen) return false;
    try {
      const resp = await this._send('0100', 5000);
      const ok = !!(resp &&
        !resp.includes('NO DATA') &&
        !resp.includes('UNABLE') &&
        !resp.includes('ERROR') &&
        !resp.includes('SEARCHING') &&
        !resp.includes('?'));
      this.emit('log', 'VehiclePing: ' + (ok ? 'OK — vehicule repond' : 'NO RESPONSE (normal si contact vient etre mis)'));
      return ok;
    } catch(e) {
      this.emit('log', 'VehiclePing: timeout (vehicule pas encore pret)');
      return false;
    }
  }


  _send(cmd, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) return reject(new Error('Port fermé'));
      this._timeout = setTimeout(() => { this._resolve = null; reject(new Error(`Timeout: ${cmd}`)); }, timeoutMs);
      this._resolve = resolve;
      this.port.write(cmd + '\r');
    });
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Mode 01 : Lire un PID ─────────────────────────────────────────────────
  async readPID(pidKey) {
    const pid = PIDS[pidKey];
    if (!pid || !this.connected) return { key: pidKey, value: null };

    // BATTERY : ATRV en premier (chip direct, toujours dispo) - PID 0142 souvent absent sur K-line
    if (pidKey === 'BATTERY') {
      try {
        const atrv = await this._send('ATRV', 2000);
        if (atrv) {
          const m = atrv.match(/(\d+\.?\d*)/);
          if (m) {
            const v = parseFloat(m[1]);
            if (v > 6 && v < 20) return { key: 'BATTERY', label: pid.label, unit: pid.unit, value: v, raw: atrv };
          }
        }
      } catch(_) {}
      return { key: pidKey, label: pid.label, unit: pid.unit, value: null };
    }

    try {
      const resp = await this._send(pid.cmd, 3000);
      if (!resp || resp === 'NO DATA' || resp === 'ERROR' || resp === '?') {
        return { key: pidKey, label: pid.label, unit: pid.unit, value: null, raw: resp };
      }
      const parts = resp.split(' ').filter(x => x && x !== '>');
      // Trouver l'offset correct : chercher le byte de mode reponse (4x = mode 01 response)
      // Réponse standard : [41, PID, D1, D2...] = slice(2)
      // Réponse avec header : [7E8, 03, 41, PID, D1...] = slice(4)
      let dataOffset = 2;
      if (parts.length > 3 && parts[0].length === 3 && /^7[EF][0-9A-F]$/i.test(parts[0])) {
        dataOffset = 4; // Header CAN présent (7E8 03 41 xx dd dd)
      }
      const dataBytes = parts.slice(dataOffset).join('');
      const value = dataBytes ? pid.parse(dataBytes) : null;
      return { key: pidKey, label: pid.label, unit: pid.unit, value, raw: resp };
    } catch (e) {
      return { key: pidKey, label: pid.label, unit: pid.unit, value: null, error: e.message };
    }
  }

  // ── Mode 01 : Lire tous les PIDs ─────────────────────────────────────────
  async readAllPIDs() {
    const results = {};
    for (const key of Object.keys(PIDS)) {
      results[key] = await this.readPID(key);
      await this._delay(30);
    }
    return results;
  }

  // ── Mode 01 PID 01 : Moniteurs de diagnostic (readiness) ─────────────────
  async readReadinessMonitors() {
    if (!this.connected) throw new Error('Non connecté');
    try {
      const resp = await this._send('0101', 5000);
      this.emit('log', `0101 → ${resp}`);

      const parts = resp.split(' ').filter(x => x && x !== '>');
      if (parts.length < 6) return { milOn: false, dtcCount: 0, monitors: [] };

      const b1 = parseInt(parts[2], 16);
      const b3 = parseInt(parts[4], 16);
      const b4 = parseInt(parts[5], 16);

      const milOn    = !!(b1 & 0x80);
      const dtcCount = b1 & 0x7F;

      // Décodage moniteurs (bits b3/b4)
      const monitors = MONITOR_NAMES.map((name, i) => {
        const supported = i < 8 ? !!(b3 & (1 << i)) : !!(b4 & (1 << (i - 8)));
        const ready     = i < 8 ? !(b4 & (1 << i))   : !(b4 & (1 << (i - 8)));
        return { name, supported, ready: supported ? ready : null };
      }).filter(m => m.supported);

      return { milOn, dtcCount, monitors };
    } catch (e) {
      return { milOn: false, dtcCount: 0, monitors: [], error: e.message };
    }
  }

  // ── Mode 01 PID 00 : PIDs supportés par le véhicule ──────────────────────
  async readSupportedPIDs() {
    if (!this.connected) return [];
    const supported = [];
    for (const range of ['0100','0120','0140','0160']) {
      try {
        const resp = await this._send(range, 3000);
        if (resp && resp !== 'NO DATA' && resp !== '?' && resp !== 'ERROR') {
          const parts = resp.split(' ').filter(x => x && x !== '>').slice(2);
          const bits  = parts.join('');
          const base  = parseInt(range.slice(2), 16);
          for (let i = 0; i < 32; i++) {
            const byteIdx = Math.floor(i / 8);
            const bitPos  = 7 - (i % 8);
            if (bits[byteIdx] && (parseInt(bits[byteIdx], 16) >> bitPos) & 1) {
              supported.push('01' + (base + i + 1).toString(16).toUpperCase().padStart(2,'0'));
            }
          }
        }
        await this._delay(100);
      } catch (_) {}
    }
    return supported;
  }
  // Auto-decouverte des PIDs supportes par ce vehicule
  // Retourne la liste des cles PIDS qui repondent OK
  async discoverSupportedPIDsList() {
    if (!this.connected) return Object.keys(PIDS).slice(0, 6);
    this.emit('log', 'Auto-decouverte PIDs eOBD...');
    const supported = [];
    // D abord lecture des bitmaps supportes
    const supportedCmds = [];
    for (const range of ['0100','0120','0140','0160']) {
      try {
        const r = await this._send(range, 3000);
        if (!r || r === 'NO DATA' || r === '?' || r === 'ERROR') continue;
        const parts = r.split(' ').filter(x => x && x !== '>').slice(2);
        const bits  = parts.join('');
        const base  = parseInt(range.slice(2), 16);
        for (let i = 0; i < 32; i++) {
          const byteIdx = Math.floor(i / 8);
          const bitPos  = 7 - (i % 8);
          if (byteIdx < bits.length / 2) {
            const byteVal = parseInt(bits.slice(byteIdx * 2, byteIdx * 2 + 2), 16);
            if ((byteVal >> bitPos) & 1) {
              supportedCmds.push(('01' + (base + i + 1).toString(16).padStart(2,'0').toUpperCase()));
            }
          }
        }
      } catch(e) { /* range non supportee */ }
    }
    this.emit('log', `Bitmap PIDs: ${supportedCmds.length} PIDs detectes`);
    // Filtrer PIDS par ce que le vehicule supporte
    for (const [key, def] of Object.entries(PIDS)) {
      const cmdHex = def.cmd.toUpperCase();
      if (supportedCmds.includes(cmdHex) || supportedCmds.includes(cmdHex.replace('0X',''))) {
        supported.push(key);
      }
    }
    // Toujours inclure BATTERY (ATRV) qui ne passe pas par le bitmap
    if (!supported.includes('BATTERY')) supported.unshift('BATTERY');
    this.emit('log', `PIDs confirmes: ${supported.join(',')}`);
    this._supportedPIDs = supported;
    return supported;
  }

  // ── Mode 02 : Freeze Frame (données au moment du défaut) ─────────────────
  async readFreezeFrame(dtcIndex = 0) {
    if (!this.connected) throw new Error('Non connecté');

    const freezePids = ['0C','0D','05','04','11','10','0E','0B','0F'];
    const pidLabels  = ['RPM','Vitesse','Temp. refr.','Charge','Papillon','MAF','Allumage','Pression adm.','Temp. adm.'];
    const pidUnits   = ['tr/min','km/h','°C','%','%','g/s','°','kPa','°C'];
    const pidParsers = [
      (d)=>Math.round(parseInt(d,16)/4),
      (d)=>parseInt(d,16),
      (d)=>parseInt(d,16)-40,
      (d)=>Math.round(parseInt(d,16)*100/255),
      (d)=>Math.round(parseInt(d,16)*100/255),
      (d)=>parseInt(d,16)/100,
      (d)=>parseInt(d,16)/2-64,
      (d)=>parseInt(d,16),
      (d)=>parseInt(d,16)-40,
    ];

    const frame = {};
    const frameNum = dtcIndex.toString(16).padStart(2,'0').toUpperCase();

    for (let i = 0; i < freezePids.length; i++) {
      try {
        const cmd  = '02' + freezePids[i] + ' ' + frameNum;
        const resp = await this._send(cmd, 6000);
        if (resp && resp !== 'NO DATA' && resp !== '?' && resp !== 'ERROR') {
          const parts = resp.split(' ').filter(x => x && x !== '>');
          const dataBytes = parts.slice(3).join(''); // Mode02 = skip 3 bytes (mode+PID+frame#)
          if (dataBytes) {
            const value = pidParsers[i](dataBytes.slice(0,4));
            frame[pidLabels[i]] = { value, unit: pidUnits[i] };
          }
        }
        await this._delay(80);
      } catch (_) {}
    }

    return frame;
  }

  // ── Voltage batterie via ATRV (fallback pour véhicules sans PID 0142) ──────
  async readMode06() {
    if (!this.connected) return {};
    const results = {};
    try {
      const resp = await this._send('0600', 10000);
      if (!resp || resp.includes('NO DATA') || resp.includes('?') || resp.includes('ERROR')) return {};
      const lines = resp.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const bytes = line.trim().replace(/>/g,'').split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/.test(b));
        if (bytes.length < 8) continue;
        if (bytes[0] === '46') {
          const tid = bytes[1], cid = bytes[2], key = 'T'+tid+'_C'+cid;
          const val  = parseInt((bytes[3]||'0')+(bytes[4]||'0'), 16);
          const minL = parseInt((bytes[5]||'0')+(bytes[6]||'0'), 16);
          const maxL = parseInt((bytes[7]||'0')+(bytes[8]||'0'), 16);
          const pct  = maxL > 0 ? Math.round(val/maxL*100) : null;
          const status = (val > maxL || val < minL) ? 'ECHEC' : pct >= 90 ? 'LIMITE' : 'OK';
          results[key] = { tid, cid, value: val, min: minL, max: maxL, pct, status };
        }
      }
    } catch(e) {}
    return results;
  }

  async readMisfireCounts() {
    if (!this.connected) return {};
    const counts = {};
    try {
      const resp41 = await this._send('0141', 3000);
      if (resp41 && !resp41.includes('NO DATA') && !resp41.includes('?')) {
        const bytes = resp41.trim().split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/.test(b));
        if (bytes.length >= 4) {
          const byteA = parseInt(bytes[2]||'00', 16);
          const byteB = parseInt(bytes[3]||'00', 16);
          counts.misfire_monitor = (byteA & 0x01) ? 'SUPPORTE' : 'NON_SUPPORTE';
          counts.misfire_complete = (byteB & 0x01) ? 'OUI' : 'EN_COURS';
          counts.o2_monitor = (byteA & 0x20) ? 'SUPPORTE' : 'NON_SUPPORTE';
        }
      }
      const respM = await this._send('0149', 3000);
      if (respM && !respM.includes('NO DATA') && !respM.includes('?') && !respM.includes('ERROR')) {
        const bytes = respM.trim().split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/.test(b));
        if (bytes.length >= 4) counts.total = parseInt((bytes[2]||'0')+(bytes[3]||'0'), 16);
      }
    } catch(e) {}
    return counts;
  }

  async readBatteryHealth() {
    if (!this.connected) return {};
    const h = {};
    try {
      const vr = await this._send('ATRV', 3000);
      if (vr && !vr.includes('?') && !vr.includes('ERROR')) {
        const m = vr.match(/([\d.]+)\s*V/i);
        if (m) {
          const v = parseFloat(m[1]); h.voltage = v;
          h.status = v<11.5?'CRITIQUE':v<12.0?'FAIBLE':v<12.4?'NORMAL':v<13.0?'BON':'EXCELLENT';
          h.diagnostic = v<11.5?'Batterie a remplacer immediatement':
            v<12.4?'Batterie partiellement decharge — verifier la charge':
            v>=13.5?'Alternateur fonctionnel — tension de charge normale':'Tension normale arret';
        }
      }
    } catch(e) {}
    return h;
  }

  async readBatteryVoltage() {
    if (!this.connected) return null;
    try {
      // 1. Essayer PID standard 0142
      const resp0142 = await this._send('0142', 3000);
      if (resp0142 && !resp0142.includes('NO DATA') && !resp0142.includes('?') && !resp0142.includes('ERROR')) {
        const parts = resp0142.split(' ').filter(x => x && x !== '>');
        let offset = (parts.length > 3 && /^7[EF]/i.test(parts[0])) ? 4 : 2;
        const hex = parts.slice(offset).join('');
        if (hex.length >= 4) {
          const v = parseInt(hex.slice(0, 4), 16) / 1000;
          if (v > 6 && v < 20) return v; // Plage valide 6-20V
        }
      }
      // 2. Fallback : ATRV (tension lue par l'ELM327 directement, toujours disponible)
      const atrv = await this._send('ATRV', 2000);
      if (atrv) {
        const match = atrv.match(/(\d+\.?\d*)/);
        if (match) {
          const v = parseFloat(match[1]);
          if (v > 6 && v < 20) return v;
        }
      }
    } catch(_) {}
    return null;
  }

  // ── Mode 03 : Codes défauts confirmés ─────────────────────────────────────
  async readDTCs() {
    if (!this.connected) throw new Error('Non connecté');
    return this._readDTCsByMode('03', '43');
  }

  // ── Mode 07 : Codes défauts en attente (pas encore confirmés) ─────────────
  async readPendingDTCs() {
    if (!this.connected) throw new Error('Non connecté');
    return this._readDTCsByMode('07', '47');
  }

  // ── Mode 0A : Codes défauts permanents (non effaçables) ───────────────────
  async readPermanentDTCs() {
    if (!this.connected) throw new Error('Non connecté');
    return this._readDTCsByMode('0A', '4A');
  }

  // Parsing commun des DTCs (tous modes)
  async _readDTCsByMode(sendCmd, expectPrefix) {
    try {
      const resp = await this._send(sendCmd, 8000);
      this.emit('log', `${sendCmd} → ${resp}`);

      if (!resp || resp === 'NO DATA' || resp.includes('00 00 00')) return [];

      const dtcs = [];
      const clean = resp.replace(/\s/g,'');
      const data  = clean.startsWith(expectPrefix.replace(/\s/g,''))
        ? clean.slice(expectPrefix.replace(/\s/g,'').length)
        : clean;

      for (let i = 0; i < data.length - 3; i += 4) {
        const chunk = data.slice(i, i+4);
        if (chunk.length < 4 || chunk === '0000') continue;
        // Ignorer tout chunk contenant des caracteres non-hex (texte ELM327 : STOPPED, SEARCHING...)
        if (!/^[0-9A-Fa-f]{4}$/.test(chunk)) continue;
        const prefix = DTC_PREFIX[chunk[0].toUpperCase()] || 'P0';
        const code   = prefix + chunk.slice(1).toUpperCase();
        if (code !== 'P0000' && !dtcs.find(d => d.code === code)) {
          dtcs.push({ code, raw: chunk, system: code[0], pending: sendCmd === '07', permanent: sendCmd === '0A' });
        }
      }
      return dtcs;
    } catch (_) {
      return [];
    }
  }

  // ── Mode 04 : Effacer les codes défauts ───────────────────────────────────
  async clearDTCs() {
    if (!this.connected) throw new Error('Non connecté');
    const resp = await this._send('04', 8000);
    this.emit('log', `04 → ${resp}`);
    return !!(resp.includes('44') || resp === 'OK' || resp === '');
  }

  // ── Mode 09 : Infos véhicule ──────────────────────────────────────────────
  async readVIN() {
    if (!this.connected) return null;
    try {
      const resp = await this._send('0902', 8000);
      this.emit('log', `0902 → ${resp}`);

      // Réponses multi-ligne possibles — parser proprement
      const hexStr = resp
        .split('\n').join(' ')
        .replace(/49\s?02\s?[0-9A-Fa-f]{2}\s?/g, '')
        .replace(/>/g,'')
        .replace(/\s+/g,'')
        .trim();

      const vin = hexStr.match(/.{2}/g)
        ?.map(b => String.fromCharCode(parseInt(b, 16)))
        .join('')
        .replace(/[^\x20-\x7E]/g,'')
        .replace(/^[\s0]+/, '')
        .trim();

      return vin && vin.length >= 10 ? vin.toUpperCase() : null;
    } catch (_) { return null; }
  }

  async readCalibrationID() {
    if (!this.connected) return null;
    try {
      const resp = await this._send('0904', 5000);
      const hex = resp.replace(/49\s?04\s?/g,'').replace(/\s+/g,'').replace(/>/g,'');
      return hex.match(/.{2}/g)?.map(b => String.fromCharCode(parseInt(b,16))).join('').replace(/[^\x20-\x7E]/g,'').trim() || null;
    } catch (_) { return null; }
  }

  async readECUName() {
    if (!this.connected) return null;
    try {
      const resp = await this._send('090A', 5000);
      const hex = resp.replace(/49\s?0A\s?/g,'').replace(/\s+/g,'').replace(/>/g,'');
      return hex.match(/.{2}/g)?.map(b => String.fromCharCode(parseInt(b,16))).join('').replace(/[^\x20-\x7E]/g,'').trim() || null;
    } catch (_) { return null; }
  }

  // ── SCAN COMPLET UNIFIÉ ────────────────────────────────────────────────────
  async fullDiagScan(onStep) {
    const step = (msg, pct) => { this.emit('scan-step', { msg, pct }); if (onStep) onStep(msg, pct); };
    const result = { timestamp: Date.now(), port: this.portPath };

    step('Lecture VIN du véhicule…', 5);
    result.vin = await this.readVIN();

    step('Identification ECU…', 12);
    result.calibrationId = await this.readCalibrationID();
    result.ecuName = await this.readECUName();

    step('Lecture codes défauts confirmés…', 25);
    result.dtcs = await this.readDTCs();

    step('Lecture codes défauts en attente…', 35);
    result.pendingDtcs = await this.readPendingDTCs();

    step('Lecture codes défauts permanents…', 42);
    result.permanentDtcs = await this.readPermanentDTCs();

    step('Vérification moniteurs émissions…', 55);
    result.monitors = await this.readReadinessMonitors();

    step('Lecture paramètres moteur en temps réel…', 70);
    result.pids = await this.readAllPIDs();
    // Voltage batterie via ATRV (plus fiable que PID 0142 sur BMW/Mercedes)
    const batt = await this.readBatteryVoltage();
    if (batt !== null) {
      result.pids['BATTERY'] = { key: 'BATTERY', label: 'Tension batterie', unit: 'V', value: batt };
    }

    // Freeze frames pour chaque code DTC (max 3 pour ne pas allonger le scan)
    if (result.dtcs.length > 0) {
      step('Lecture Freeze Frames (données au moment des défauts)…', 82);
      result.freezeFrames = {};
      for (let i = 0; i < Math.min(result.dtcs.length, 3); i++) {
        const code = (result.dtcs[i] || {}).code || '';
        if (code) {
          result.freezeFrames[code] = await this.readFreezeFrame(i);
          await this._delay(100);
        }
      }
      result.freezeFrame = Object.values(result.freezeFrames)[0] || {};
    }

    // Mode $06 — tests embarqués (pré-pannes)
    step('Lecture Mode $06 (tests embarqués)…', 88);
    result.mode06 = await this.readMode06();

    // Compteurs de ratés par cylindre
    step('Analyse ratees - compteurs par cylindre...', 92);
    result.misfireCounts = await this.readMisfireCounts();

    // Test batterie approfondi
    step('Test batterie et alternateur…', 95);
    result.batteryHealth = await this.readBatteryHealth();

    step('Analyse terminée ✓', 100);
    // LIVE PIDs a la fin du scan (monitoring stoppe = pas de conflit)
    const _LP=['RPM','SPEED','COOLANT','ENGINE_LOAD','BATTERY'];
    for(const _k of _LP){try{const _d=await this.readPID(_k);if(_d&&_d.value!=null){result.pids=result.pids||{};result.pids[_k]=_d;}await this._delay(80);}catch(_){} }

    this.lastScan = result;
    return result;
  }

  // ── Monitoring temps réel ─────────────────────────────────────────────────
  startMonitoring(pids = MONITOR_PIDS, intervalMs = 1200) {
    if (this._monitorInterval) this.stopMonitoring();
    this._monitorInterval = setInterval(async () => {
      if (!this.connected) return;
      for (const key of pids) {
        try {
          const data = await this.readPID(key);
          this.emit('data', data);
          await this._delay(40);
        } catch (_) {}
      }
    }, intervalMs);
  }


  // Keep-alive: envoie un ping toutes les 20s pour maintenir le Bluetooth actif
  startKeepAlive() {
    var self = this;
    if (this._keepAliveInterval) clearInterval(this._keepAliveInterval);
    this._keepAliveInterval = setInterval(function() {
      if (!self.connected || self._monitorBusy) return; // Eviter race avec monitoring
      self._monitorBusy = true; // Bloquer monitoring pendant keep-alive
      self._send('ATRV', 2000)
        .then(function(resp) {
          self.emit('log', 'KeepAlive: ' + (resp || 'OK'));
        })
        .catch(function(e) {
          self.emit('log', 'KeepAlive echec: ' + e.message);
          // Ne pas emettre disconnect sur 1 echec — laisser le monitoring gerer
        })
        .finally(function() {
          self._monitorBusy = false;
        });
    }, 25000); // Toutes les 25 secondes (pas de conflit avec monitoring 3s)
  }

  stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
  }

  stopMonitoring() {
    if (this._monitorInterval) { clearInterval(this._monitorInterval); this._monitorInterval = null; }
  }


  async openDiagSession(ecu) {
    ecu = ecu||'7DF';
    if (!this.connected) throw new Error('Non connecte');
    try {
      await this._send('ATSH '+ecu,2000); await this._delay(100);
      var r1 = await this._send('1003',3000);
      this.emit('log','[UDS] Session->'+r1);
      await this._send('3E 00',2000);
      var self=this;
      this._keepAlive=setInterval(function(){if(self.connected)self._send('3E 00',1000).catch(function(){});},2000);
      return !r1.startsWith('7F');
    } catch(e){this.emit('log','[UDS] Err:'+e.message);return false;}
  }
  async closeDiagSession() {
    if(this._keepAlive){clearInterval(this._keepAlive);this._keepAlive=null;}
    try{await this._send('1001',1000);}catch(_){}
    try{await this._send('ATSH 7DF',1000);}catch(_){}
  }
  async _sendUDS(cmds) {
    var results=[];
    for(var i=0;i<cmds.length;i++){
      var cmd=Array.isArray(cmds[i])?cmds[i][0]:cmds[i];
      if(!cmd||!cmd.trim()){await this._delay(80);continue;}
      try{
        var r=await this._send(cmd.trim(),3000);
        results.push({cmd:cmd.trim(),resp:r});
        this.emit('log','[UDS] '+cmd.trim()+'->'+r);
        await this._delay(120);
      }catch(e){results.push({cmd:cmd.trim(),resp:'ERR:'+e.message});}
    }
    return results;
  }
  async doServiceReset(key,brand) {
    brand=brand||'default';
    if(!this.connected) throw new Error('Non connecte');
    var reset=SERVICE_RESETS[key];if(!reset)throw new Error('Reset:'+key);
    this.emit('log','[RESET] '+reset.label);
    var cmds=(reset.uds[brand]||reset.uds.default)||[];
    var results=await this._sendUDS(cmds);
    var last=results.length?results[results.length-1].resp:'';
    var ok=last.startsWith('44')||last.startsWith('71')||last.startsWith('6E')||last.startsWith('50')||last==='OK';
    await this.closeDiagSession();
    return {success:ok,results:results,label:reset.label};
  }
  async doComponentTest(key,activate,brand) {
    if(activate===undefined)activate=true;
    brand=brand||'default';
    if(!this.connected) throw new Error('Non connecte');
    var comp=COMPONENT_TESTS[key];if(!comp)throw new Error('Composant:'+key);
    var seq=comp.uds[brand]||comp.uds.default;
    var cmds=activate?seq.on:seq.off;
    var results=await this._sendUDS(Array.isArray(cmds)?cmds:[cmds]);
    var last=results.length?results[results.length-1].resp:'';
    return {success:!last.includes('7F')&&!last.includes('ERR'),component:comp.label,state:activate?'ON':'OFF',results:results};
  }
  async readVehicleOption(key,brand) {
    if(!this.connected)return{supported:false};
    var opt=VEHICLE_OPTIONS[key];if(!opt)return{supported:false};
    var u=brand?(opt.uds[brand]||opt.uds.default):null;if(!u)return{supported:false};
    try{
      var res=await this._sendUDS(u.read||[]);
      var last=res.length?res[res.length-1].resp:'';
      return{supported:true,raw:last,enabled:last.includes('01')};
    }catch(e){return{supported:false,error:e.message};}
  }
  async writeVehicleOption(key,enable,brand) {
    if(!this.connected)return{success:false};
    var opt=VEHICLE_OPTIONS[key];if(!opt)return{success:false};
    var u=brand?(opt.uds[brand]||opt.uds.default):null;if(!u)return{success:false,error:'Non supporte'};
    await this.openDiagSession();
    var cmds=enable?u.on:u.off;
    var res=await this._sendUDS(Array.isArray(cmds)?cmds:[cmds]);
    await this.closeDiagSession();
    var last=res.length?res[res.length-1].resp:'';
    return{success:last.startsWith('6E')||last.startsWith('7E'),enabled:enable,raw:last};
  }
  startMonitoringWithAlerts(pids, intervalMs, extra) {
    pids = pids || MONITOR_PIDS;
    intervalMs = intervalMs || 2000; // 2s entre cycles (pas 1,2s)
    extra = extra || {};
    if (this._monitorInterval) this.stopMonitoring();
    var thresh = Object.assign({
      COOLANT:    { max: 105, label: 'Surchauffe moteur', sev: 'critical' },
      OIL_TEMP:   { max: 140, label: 'Huile surchauffee', sev: 'warn' },
      BATTERY:    { min: 11.5, label: 'Batterie faible', sev: 'warn' },
      FUEL_LEVEL: { min: 10, label: 'Carburant bas', sev: 'info' },
    }, extra);
    var self = this;
    self._monitorBusy = false; // Flag anti-race

    this._monitorInterval = setInterval(function() {
      if (!self.connected || self._monitorBusy) return; // Eviter les cycles concurrents
      self._monitorBusy = true;
      (async function() {
        try {
          for (var k of pids) {
            if (!self.connected) break;
            try {
              var d = await self.readPID(k);
              if (d && d.value != null) {
                self.emit('data', d);
                var t = thresh[k];
                if (t && ((t.max && d.value > t.max) || (t.min && d.value < t.min))) {
                  self.emit('alert', Object.assign({ key: k, value: d.value }, t));
                }
              }
            } catch(e) {
              // PID echec = normal si vehicule ne repond pas encore
            }
            await self._delay(50); // 50ms entre PIDs
          }
        } finally {
          self._monitorBusy = false;
        }
      })();
    }, intervalMs);
  }
  startDataLog(){this._dataLog=[];var self=this;this.on('data',function(d){if(self._dataLog){self._dataLog.push(Object.assign({ts:Date.now()},d));if(self._dataLog.length>5000)self._dataLog.shift();}});}
  stopDataLog(){var l=this._dataLog;this._dataLog=null;return l||[];}
  exportDataLog(){if(!this._dataLog||!this._dataLog.length)return'';return 'Timestamp,PID,Valeur,Unite\n'+(this._dataLog.map(function(d){return new Date(d.ts).toISOString()+','+d.key+','+d.value+','+(d.unit||'');}).join('\n'));}

  // ── Déconnexion ────────────────────────────────────────────────────────────
  async disconnect() {
    this.stopMonitoring();
    this.stopKeepAlive();
    if (this.port && this.port.isOpen) { try { await new Promise(r => this.port.close(r)); } catch(_) {} }
    this.connected = false; this.port = null; this.parser = null;
    this.emit('status', { type: 'disconnected' });
  }
}

module.exports = { OBD2, PIDS, MONITOR_PIDS, MONITOR_NAMES, VEHICLES_DB, SERVICE_RESETS, COMPONENT_TESTS, VEHICLE_OPTIONS };
