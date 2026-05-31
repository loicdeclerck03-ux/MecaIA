// ============================================
// MecaIA — Netlify Function (api.js)
// Emplacement : netlify/functions/api.js
// ============================================

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // === GET : retourner la config publique ===
  const action = event.queryStringParameters?.action;
  if (event.httpMethod === 'GET' && action === 'config') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_ANON: process.env.SUPABASE_ANON || ''
      })
    };
  }

  // === POST : toutes les actions ===
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    // Appel Claude IA
    async function claude(system, userMsg) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          system: system,
          messages: [{ role: 'user', content: userMsg }]
        })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      const txt = data.content.map(b => b.text || '').join('');
      return JSON.parse(txt.replace(/```json|```/g, '').trim());
    }

    // === DIAGNOSTIC ===
    if (action === 'diagnostic') {
      const { code, marque, modele, annee, carburant, km, symptomes } = body;
      const veh = [marque, modele, carburant, annee, km && km + 'km'].filter(Boolean).join(' ');
      const sys = 'Tu es un expert mécanicien automobile avec 20 ans d\'expérience. Diagnostics ultra précis. Réponds UNIQUEMENT en JSON valide sans markdown.';
      const pmt = 'Code OBD: ' + (code || 'non fourni') + '\nVéhicule: ' + veh + '\nSymptômes: ' + (symptomes || 'non précisés') + '\nJSON:\n{"code":"' + (code || 'SYMPTÔMES') + '","systeme":"système exact","titre":"titre précis","description":"explication 3-4 phrases","severite":"HAUTE","rouler":true,"causes":["c1","c2","c3","c4"],"etapes":["e1 avec valeurs","e2","e3","e4","e5"],"outils":["outil1","outil2","outil3"],"difficulte":2,"pieces":["p1","p2","p3"],"comment_tester":"comment tester","pannes_liees":"autres pannes liées","economie_diy":120,"temps":"estimation","mo_min":50,"mo_max":200,"pieces_min":30,"pieces_max":400,"conseil":"conseil expert spécifique","prevention":"prévention futur"}';
      const result = await claude(sys, pmt);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // === VIN ===
    if (action === 'vin') {
      const { vin } = body;
      const sys = 'Expert mondial décodage VIN. JSON uniquement sans markdown.';
      const pmt = 'Décode ce VIN: ' + vin + '\nWMI: ' + vin.substring(0, 3) + '\nCodes WMI connus: VF1=Renault,VF3=Peugeot,VF7=Citroën,WBA=BMW,WDB=Mercedes,WAU=Audi,WVW=VW,ZFA=Fiat,VSS=SEAT,TMB=Skoda\nJSON:\n{"pays":"","constructeur":"","modele":"","variante":"","annee":"","usine":"","moteur":"","carburant":"","transmission":"","serie":"' + vin.substring(9) + '"}';
      const result = await claude(sys, pmt);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // === PIÈCES ===
    if (action === 'pieces') {
      const { marque, modele, annee, carburant, piece } = body;
      const veh = [marque, modele, annee, carburant].filter(Boolean).join(' ');
      const sys = 'Expert pièces automobiles. Références précises. JSON uniquement sans markdown.';
      const pmt = 'Véhicule: ' + veh + '\nPièce: ' + piece + '\nJSON:\n{"pieces":[{"nom":"nom exact","marque":"NGK/Bosch/Valeo/Febi...","reference":"réf précise","prix_min":15,"prix_max":45,"compatibilite":"note","qualite":"OEM ou Aftermarket","conseil":"conseil montage","urgence":"Immédiat ou Sous 1000km ou Normal"}]}\n3-4 pièces de qualités différentes.';
      const result = await claude(sys, pmt);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // === ALERTES ===
    if (action === 'alertes') {
      const { marque, modele, annee, km } = body;
      const sys = 'Expert entretien automobile. JSON uniquement sans markdown.';
      const pmt = 'Véhicule: ' + [marque, modele, annee].filter(Boolean).join(' ') + ' à ' + km + ' km\nJSON:\n{"alertes":[{"icon":"🔧","titre":"intervention","desc":"description précise","km_next":170000,"urgence":"Immédiat ou Bientôt ou Préventif"}]}\n6-8 alertes basées sur le kilométrage réel.';
      const result = await claude(sys, pmt);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue: ' + action }) };

  } catch (error) {
    console.error('API Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
