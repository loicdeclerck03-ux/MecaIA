// ============================================================
// 🔍 MECAIA — AGENT SCOUT
// Collecte automatique de cas mécaniques depuis sources légales
// Lancé via cron 1h/jour (scheduled function)
// ============================================================

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json'
};

// Liste des codes OBD à enrichir progressivement
const COMMON_OBD_CODES = [
  'P0010', 'P0011', 'P0020', 'P0030', 'P0031', 'P0036', 'P0037', 'P0038',
  'P0100', 'P0101', 'P0102', 'P0103', 'P0107', 'P0108', 'P0111', 'P0112',
  'P0113', 'P0116', 'P0117', 'P0118', 'P0121', 'P0122', 'P0123', 'P0128',
  'P0131', 'P0132', 'P0133', 'P0134', 'P0135', 'P0140', 'P0171', 'P0172',
  'P0174', 'P0175', 'P0190', 'P0191', 'P0192', 'P0193', 'P0200', 'P0201',
  'P0202', 'P0203', 'P0204', 'P0234', 'P0235', 'P0236', 'P0238', 'P0240',
  'P0299', 'P0300', 'P0301', 'P0302', 'P0303', 'P0304', 'P0305', 'P0306',
  'P0335', 'P0336', 'P0340', 'P0341', 'P0380', 'P0381', 'P0400', 'P0401',
  'P0402', 'P0403', 'P0404', 'P0405', 'P0406', 'P0410', 'P0411', 'P0420',
  'P0421', 'P0430', 'P0440', 'P0441', 'P0442', 'P0455', 'P0500', 'P0501',
  'P0505', 'P0506', 'P0507', 'P0520', 'P0560', 'P0562', 'P0563', 'P0601',
  'P2002', 'P2003', 'P2032', 'P2033', 'P2453', 'P2454', 'P2459', 'P2463'
];

async function enrichOBDCode(code, anthropicKey) {
  const prompt = `Tu es un expert mécanicien automobile. Pour le code OBD ${code}, donne-moi en JSON strict :
{
  "titre": "titre court précis",
  "systeme": "système concerné (admission/injection/échappement/etc)",
  "description": "explication courte 2-3 phrases",
  "causes": ["cause 1", "cause 2", "cause 3", "cause 4"],
  "symptomes": ["symptôme 1", "symptôme 2", "symptôme 3"],
  "gravite": "HAUTE" ou "MOYENNE" ou "FAIBLE",
  "peut_rouler": true ou false,
  "energie": ["diesel"] ou ["essence"] ou ["diesel","essence"]
}

Réponds UNIQUEMENT en JSON valide, rien d'autre.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.log(`Failed to enrich ${code}:`, e.message);
    return null;
  }
}

async function saveOBDCode(code, info, supabaseUrl, supabaseKey) {
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/obd_codes`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=ignore-duplicates'
      },
      body: JSON.stringify({
        code,
        categorie: info.systeme,
        titre: info.titre,
        description: info.description,
        causes_probables: info.causes,
        symptomes: info.symptomes,
        gravite: info.gravite,
        peut_rouler: info.peut_rouler,
        energie: info.energie,
        sources: ['MecaIA Scout v1']
      })
    });
    
    return resp.ok;
  } catch (e) {
    console.error(`Save error ${code}:`, e);
    return false;
  }
}

async function getExistingCodes(supabaseUrl, supabaseKey) {
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/obd_codes?select=code`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const data = await resp.json();
    return new Set((data || []).map(x => x.code));
  } catch (e) {
    return new Set();
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET;
    const anthropicKey = process.env.ANTHROPIC_KEY;
    
    if (!supabaseUrl || !supabaseKey || !anthropicKey) {
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: 'Variables manquantes' }) 
      };
    }
    
    // Limite à 10 codes par exécution pour contrôler les coûts
    const MAX_PER_RUN = 10;
    
    // Récupérer les codes déjà enrichis
    const existing = await getExistingCodes(supabaseUrl, supabaseKey);
    
    // Filtrer les codes à enrichir
    const toEnrich = COMMON_OBD_CODES.filter(c => !existing.has(c)).slice(0, MAX_PER_RUN);
    
    if (toEnrich.length === 0) {
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          message: 'Tous les codes communs sont déjà enrichis', 
          total_existing: existing.size 
        }) 
      };
    }
    
    const results = { success: [], failed: [] };
    
    for (const code of toEnrich) {
      const info = await enrichOBDCode(code, anthropicKey);
      if (info) {
        const saved = await saveOBDCode(code, info, supabaseUrl, supabaseKey);
        if (saved) results.success.push(code);
        else results.failed.push(code);
      } else {
        results.failed.push(code);
      }
      // Petit délai entre les appels pour éviter rate limit
      await new Promise(r => setTimeout(r, 500));
    }
    
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        enriched: results.success.length,
        failed: results.failed.length,
        codes_enriched: results.success,
        total_in_db: existing.size + results.success.length
      }) 
    };
    
  } catch (error) {
    console.error('Scout error:', error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
