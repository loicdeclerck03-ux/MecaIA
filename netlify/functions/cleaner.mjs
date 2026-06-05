// ============================================================
// CLEANER.MJS — Agent 2 V3 Pipeline
// Nettoie et structure les données JSON
// Input: raw_data de scraper
// Output: structured_data prêt pour consolidator
// ============================================================

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const { raw_data } = JSON.parse(event.body);
    if (!raw_data) return { statusCode: 400, body: JSON.stringify({ error: 'raw_data required' }) };

    const prompt = `Nettoie et structure cette data automobile en JSON strict:

Raw: ${JSON.stringify(raw_data, null, 2)}

Output JSON (SANS MARKDOWN):
{
  "vehicle_marque": "string",
  "vehicle_modele": "string",
  "vehicle_annee": "integer ou null",
  "vehicle_km": "integer ou null",
  "initial_symptom": "string descriptiif",
  "symptoms_clean": ["array","de","symptomes"],
  "obd_codes_clean": ["P0087"],
  "causes_clean": ["cause1","cause2"],
  "confidence": 0-100,
  "quality_score": 0-100
}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: 'Data cleaner expert. Output ONLY valid JSON, no markdown, no explanations.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const cleaned = JSON.parse(
      data.content[0].text.replace(/```json|```/g, '').trim()
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        cleaned_data: cleaned,
        quality_score: cleaned.quality_score || 0,
        confidence: cleaned.confidence || 0,
        tokens: data.usage.input_tokens + data.usage.output_tokens,
        cost_usd: ((data.usage.input_tokens * 0.80 + data.usage.output_tokens * 2.40) / 1000000).toFixed(6)
      })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
