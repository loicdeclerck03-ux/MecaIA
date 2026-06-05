// ============================================================
// CONSOLIDATOR.MJS — Agent 3 V3 Pipeline
// Merge doublons à 70% de similarité
// Input: array de cleaned_data
// Output: consolidated cases (1 au lieu de 10)
// ============================================================

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const MODEL = 'claude-sonnet-4-20250514';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const { cases } = JSON.parse(event.body);
    if (!Array.isArray(cases) || cases.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cases array required' }) };
    }

    const prompt = `Tu es un expert consolidation automotive. Merge ces ${cases.length} cas similaires (70%+ match) en UN seul cas cohérent.

Cas à merger:
${cases.map((c, i) => `
${i + 1}. ${c.vehicle_marque} ${c.vehicle_modele} (${c.vehicle_km}km)
   Symptôme: ${c.initial_symptom}
   Codes: ${c.obd_codes_clean?.join(', ') || 'N/A'}
   Causes possibles: ${c.causes_clean?.join(', ') || 'N/A'}
`).join('')}

Output JSON (SANS MARKDOWN):
{
  "vehicle_marque": "marque",
  "vehicle_modele": "modele",
  "vehicle_annee": "2018",
  "vehicle_km_avg": "moyenne",
  "initial_symptom": "symptôme consolidé",
  "symptoms_merged": ["symptoms"],
  "obd_codes_merged": ["P0087"],
  "causes_merged": ["causes probables"],
  "most_likely_cause": "cause la plus probable",
  "confidence_consolidated": "0-100",
  "sources_merged": ${cases.length},
  "duplicates_merged": ${Math.max(0, cases.length - 1)}
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
        max_tokens: 800,
        system: 'Expert consolidation. Merge duplicate cases intelligently. Output ONLY valid JSON, no markdown.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const consolidated = JSON.parse(
      data.content[0].text.replace(/```json|```/g, '').trim()
    );

    const merge_ratio = ((consolidated.sources_merged - consolidated.duplicates_merged) / consolidated.sources_merged * 100).toFixed(1);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        consolidated_case: consolidated,
        original_count: cases.length,
        merged_to: 1,
        merge_efficiency_percent: merge_ratio,
        tokens: data.usage.input_tokens + data.usage.output_tokens,
        cost_usd: ((data.usage.input_tokens * 3 + data.usage.output_tokens * 15) / 1000000).toFixed(6)
      })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
