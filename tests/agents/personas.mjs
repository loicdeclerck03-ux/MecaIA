// ── MecaIA Beta Agent System — agents/personas.mjs ─────────────────────────
export const AGENTS = [
  {
    id: 'marie', name: 'Marie Dupont', avatar: '👩',
    email: 'agent.marie@mecaia-beta.io', password: 'MecaIA-Beta-2026!M',
    persona: 'Conductrice non technique, 45 ans, Liege BE. Premiere utilisation.',
    vehicle: { marque: 'Renault', modele: 'Clio', annee: '2016', carbu: 'diesel', km: '87000', nom: 'Ma Clio' },
    vin: 'VF1KSF40243276501',
    scenarios: [
      { name: 'Voyant + code P0401', message: 'Bonjour, mon voyant moteur s est allume ce matin. Scanner dit P0401. C est grave ? Renault Clio 2016 diesel 87000km.', expect: 'EGR + gravite + conseils' },
      { name: 'Lien consommation', message: 'Ma voiture consomme aussi plus depuis 2 mois. C est lie au P0401 ?', expect: 'lien EGR + explication causal' },
      { name: 'Devis 380 EUR garage', message: 'Le garagiste demande 380 euros pour changer la vanne EGR. C est le bon prix ?', expect: 'validation prix + alternative' },
      { name: 'Peut-on rouler ?', message: 'Je peux continuer a rouler avec ce code ou c est dangereux ?', expect: 'verdict clair + limite km' },
      { name: 'Explication simple EGR', message: 'C est quoi l EGR et pourquoi ca tombe en panne ?', expect: 'pedagogique + accessible + sans jargon' }
    ],
    ui_tests: ['homepage','auth','garage_add','garage_get','profile','vin','parts']
  },
  {
    id: 'thomas', name: 'Thomas Lejeune', avatar: '👨‍🔧',
    email: 'agent.thomas@mecaia-beta.io', password: 'MecaIA-Beta-2026!T',
    persona: 'Technicien auto passionne, 32 ans, Bruxelles BE. Connait LTFT + freeze frame.',
    vehicle: { marque: 'BMW', modele: 'Serie 3 E46 320d', annee: '2003', carbu: 'diesel', km: '156000', nom: 'E46' },
    vin: 'WBABM510X0JT21614',
    scenarios: [
      { name: 'P0300 + cliquetis + LTFT +8%', message: 'BMW E46 320d 2003 156000km. P0300 rates aleatoires 3 semaines + cliquetis a froid 2-3s qui disparait. LTFT +8%. Bougies neuves il y a 15000km.', expect: 'hypotheses multiples + LTFT analyse + priorisation' },
      { name: 'Analyse freeze frame', message: 'Freeze frame P0300: RPM 1200 COOLANT 18C ENGINE_LOAD 62% LTFT +8.3% STFT +3.1%. Que suspectes-tu ?', expect: 'analyse FF + cause precise' },
      { name: 'Procedure isolation bobine/bougie', message: 'Procedure exacte pour isoler bobine vs bougie sur E46 sans tout changer.', expect: 'procedure + permutation + mesure' },
      { name: 'VANOS + huile 25000km', message: 'Cliquetis a froid avec LTFT eleve = vanne VANOS encrassee ? Huile pas changee depuis 25000km.', expect: 'VANOS analyse + lien huile' },
      { name: 'Limite DS2 E46', message: 'Tu peux acceder aux modules DSC et airbag de mon E46 via OBD pour voir s il y a des codes ?', expect: 'limite DS2 expliquee honnêtement + alternative' }
    ],
    ui_tests: ['homepage','auth','garage_add','garage_get','profile','vin','parts','ct']
  }
];
