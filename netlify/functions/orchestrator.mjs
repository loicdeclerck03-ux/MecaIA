// ============================================================
// ORCHESTRATOR.MJS — Pipeline complète (V3)
// Chaîne: Scraper → Cleaner → Consolidator → DB
// Input: topic (string)
// Output: consolidated_cases insérées en BD
// ============================================================

import { createClient } from "@supabase/supabase-js";

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET; // clé service (opération système)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 1️⃣ STEP 1: SCRAPER (simulated pour POC)
// ============================================================
async function stepScraper(topic) {
  console.log(`[SCRAPER] Scraping topic: ${topic}`);
  
  // Simulated data (en prod: vraies API)
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
    },
    {
      source: 'youtube_comments',
      text: 'Peugeot 308 moteur fume noir après 150000 km. Probablement FAP ou turbo'
    }
  ];

  const prompt = `Extrais les données automotive de ces posts en JSON pur (pas de markdown):

${raw_posts.map(p => `[${p.source}] ${p.text}`).join('\n')}

JSON attendu (SANS MARKDOWN):
{"vehicle_marque":"Peugeot","vehicle_modele":"308","vehicle_annee":2018,"vehicle_moteur":"Diesel","vehicle_km":140000,"initial_symptom":"perte puissance + fumée noire","symptoms":["perte puissance","fumée noire","voyant moteur"],"obd_codes":["P0087"],"possible_causes":["FAP encrassé","EGR défaillante"],"source":"consolidated_forum"}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
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

    console.log(`[SCRAPER] ✅ Extracted ${raw_posts.length} posts`);
    return { success: true, extracted_data: extracted, sources_count: raw_posts.length };
  } catch (error) {
    console.error('[SCRAPER] ❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// 2️⃣ STEP 2: CLEANER (nettoie le JSON du scraper)
// ============================================================
async function stepCleaner(raw_data) {
  console.log('[CLEANER] Cleaning data...');

  const prompt = `Nettoie et structure cette data automobile en JSON strict (SANS MARKDOWN):

Raw: ${JSON.stringify(raw_data, null, 2)}

Output JSON:
{
  "vehicle_marque": "string",
  "vehicle_modele": "string",
  "vehicle_annee": "integer ou null",
  "vehicle_km": "integer ou null",
  "initial_symptom": "string descriptif",
  "symptoms_clean": ["array","de","symptomes"],
  "obd_codes_clean": ["P0087"],
  "causes_clean": ["cause1","cause2"],
  "confidence": 0-100,
  "quality_score": 0-100
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
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

    console.log(`[CLEANER] ✅ Data cleaned (quality: ${cleaned.quality_score}%)`);
    return { success: true, cleaned_data: cleaned };
  } catch (error) {
    console.error('[CLEANER] ❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// 3️⃣ STEP 3: CONSOLIDATOR (merge doublons)
// ============================================================
async function stepConsolidator(cases_array) {
  console.log(`[CONSOLIDATOR] Consolidating ${cases_array.length} cases...`);

  if (!Array.isArray(cases_array) || cases_array.length === 0) {
    return { success: false, error: 'No cases to consolidate' };
  }

  const prompt = `Tu es un expert consolidation automotive. Merge ces ${cases_array.length} cas similaires (70%+ match) en UN seul cas cohérent.

Cas à merger:
${cases_array.map((c, i) => `
${i + 1}. ${c.vehicle_marque} ${c.vehicle_modele} (${c.vehicle_km}km)
   Symptôme: ${c.initial_symptom}
   Codes: ${c.obd_codes_clean?.join(', ') || 'N/A'}
   Causes possibles: ${c.causes_clean?.join(', ') || 'N/A'}
   Confiance: ${c.confidence}%
`).join('')}

Output JSON (SANS MARKDOWN):
{
  "vehicle_marque": "marque",
  "vehicle_modele": "modele",
  "vehicle_annee": 2018,
  "vehicle_km_avg": "moyenne km",
  "initial_symptom": "symptôme consolidé",
  "symptoms_merged": ["symptoms"],
  "obd_codes_merged": ["P0087"],
  "causes_merged": ["causes probables"],
  "most_likely_cause": "cause la plus probable",
  "confidence_consolidated": 0-100,
  "sources_merged": ${cases_array.length},
  "duplicates_merged": ${Math.max(0, cases_array.length - 1)},
  "estimated_cost_min": 150,
  "estimated_cost_max": 500
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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

    console.log(`[CONSOLIDATOR] ✅ Consolidated ${cases_array.length} → 1 case`);
    return { success: true, consolidated_case: consolidated };
  } catch (error) {
    console.error('[CONSOLIDATOR] ❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// 4️⃣ STEP 4: INSERT INTO DB (using Supabase function)
// ============================================================
async function stepInsertDB(consolidated_case, source_topic) {
  console.log('[DB] Inserting consolidated case (with deduplication)...');

  try {
    // Appeler la fonction Supabase pour insertion intelligente
    const { data, error } = await supabase
      .rpc('insert_consolidated_case', {
        p_vehicle_marque: consolidated_case.vehicle_marque,
        p_vehicle_modele: consolidated_case.vehicle_modele,
        p_vehicle_annee: consolidated_case.vehicle_annee,
        p_vehicle_km: consolidated_case.vehicle_km_avg,
        p_primary_diagnosis: consolidated_case.most_likely_cause,
        p_symptoms: consolidated_case.symptoms_merged || [],
        p_obd_codes: consolidated_case.obd_codes_merged || [],
        p_parts_needed: consolidated_case.causes_merged || [],
        p_confidence_percent: consolidated_case.confidence_consolidated,
        p_urgency: consolidated_case.confidence_consolidated > 80 ? 'immédiat' : 'bientôt',
        p_can_drive: consolidated_case.confidence_consolidated < 70,
        p_estimated_cost_min: consolidated_case.estimated_cost_min,
        p_estimated_cost_max: consolidated_case.estimated_cost_max,
        p_source: `scraper_${source_topic}`
      });

    if (error) throw error;

    if (data && data.length > 0) {
      const result = data[0];
      const action = result.is_new ? 'NEW' : 'MERGED';
      console.log(`[DB] ✅ Case ${action} (ID: ${result.inserted_id})`);
      console.log(`[DB] Message: ${result.message}`);
      if (result.duplicate_count > 0) {
        console.log(`[DB] Found ${result.duplicate_count} similar cases`);
      }
      return { success: true, inserted: true, ...result };
    } else {
      throw new Error('No response from insert_consolidated_case function');
    }
  } catch (error) {
    console.error('[DB] ❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// 5️⃣ MAIN: ORCHESTRATE THE PIPELINE
// ============================================================
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  const startTime = Date.now();

  try {
    const { topic = 'peugeot_308_diesel' } = JSON.parse(event.body || '{}');

    console.log('\n========================================');
    console.log('🚀 PIPELINE ORCHESTRATOR V3 STARTED');
    console.log('========================================\n');

    // Step 1: Scraper
    const scraperResult = await stepScraper(topic);
    if (!scraperResult.success) {
      return { statusCode: 500, body: JSON.stringify(scraperResult) };
    }

    // Step 2: Cleaner (pour ce POC, on nettoie une seule case)
    const cleanerResult = await stepCleaner(scraperResult.extracted_data);
    if (!cleanerResult.success) {
      return { statusCode: 500, body: JSON.stringify(cleanerResult) };
    }

    // Step 3: Consolidator (on passe un array avec la case nettoyée)
    const consolidatorResult = await stepConsolidator([cleanerResult.cleaned_data]);
    if (!consolidatorResult.success) {
      return { statusCode: 500, body: JSON.stringify(consolidatorResult) };
    }

    // Step 4: Insert into DB
    const dbResult = await stepInsertDB(consolidatorResult.consolidated_case, topic);
    if (!dbResult.success) {
      return { statusCode: 500, body: JSON.stringify(dbResult) };
    }

    const elapsedMs = Date.now() - startTime;

    console.log('\n========================================');
    console.log('✅ PIPELINE COMPLETED SUCCESSFULLY');
    console.log('========================================\n');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        pipeline_status: 'COMPLETED',
        steps: {
          scraper: scraperResult,
          cleaner: cleanerResult,
          consolidator: consolidatorResult,
          database: dbResult
        },
        metadata: {
          topic,
          elapsed_ms: elapsedMs,
          consolidated_case: consolidatorResult.consolidated_case
        }
      })
    };
  } catch (error) {
    console.error('❌ PIPELINE ERROR:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
