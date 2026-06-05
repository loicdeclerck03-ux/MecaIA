// ============================================================
// SCRAPER.MJS — Agent 1 V3 Pipeline
// Collecte data depuis forums, Reddit, YouTube
// Input: topic (string)
// Output: raw_data avec vehicle_marque, symptoms, obd_codes
// ============================================================

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const { topic } = JSON.parse(event.body);
    if (!topic) return { statusCode: 400, body: JSON.stringify({ error: 'topic required' }) };

    // Simulated scraped data (in real world: forums/reddit/youtube API)
    const raw_posts = [
      {
        source: 'forum_caritech',
        text: 'Mon Peugeot 308 2018 Diesel perd de la puissance et fume noir. Code OBD P0087. FAP bouché ?'
      },
      {
        source: 'reddit_cartalk',
        text: 'Same issue with my 308. Mechanic said FAP cleaning needed. Cost 300-400€.'
      },
      {
        source: 'facebook_group',
        text: 'Symptômes: fumée noire, perte puissance, voyant moteur. 140k km.'
      }
    ];

    const prompt = `Extrais les données automotive de ces posts en JSON pur (pas de markdown):

${raw_posts.map(p => `[${p.source}] ${p.text}`).join('\n')}

JSON attendu:
{"vehicle_marque":"Peugeot","vehicle_modele":"308","vehicle_annee":2018,"vehicle_moteur":"Diesel","vehicle_km":140000,"initial_symptom":"perte puissance + fumée noire","symptoms":["perte puissance","fumée noire","voyant moteur"],"obd_codes":["P0087"],"possible_causes":["FAP encrassé","EGR défaillante"],"source":"consolidated_forum"}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: 'Expert automotive data extraction. Return ONLY valid JSON, no markdown.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const extracted = JSON.parse(
      data.content[0].text.replace(/```json|```/g, '').trim()
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        extracted_data: extracted,
        sources_count: raw_posts.length,
        tokens: data.usage.input_tokens + data.usage.output_tokens,
        cost_usd: ((data.usage.input_tokens * 0.80 + data.usage.output_tokens * 2.40) / 1000000).toFixed(6)
      })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
