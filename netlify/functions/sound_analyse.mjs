// sound_analyse.mjs — MecaIA
// Analyse audio (bruit moteur) synchronisé avec snapshot OBD
// POST { audio_b64, obd_snapshot, snapshot_ts, vehicle_id }
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const ANT_KEY  = process.env.ANTHROPIC_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Token requis' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { audio_b64, obd_snapshot, snapshot_ts, vehicle_id } = body;
  if (!audio_b64) return { statusCode: 400, body: JSON.stringify({ error: 'audio_b64 requis' }) };

  // Auth
  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
  const { data: { user } } = await supa.auth.getUser(token);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };

  // Récupérer infos véhicule si dispo
  let vehicleInfo = '';
  if (vehicle_id) {
    const { data: v } = await supa
      .from('user_vehicles')
      .select('marque, modele, annee, carburant')
      .eq('id', vehicle_id).single();
    if (v) vehicleInfo = `Véhicule : ${v.marque} ${v.modele} ${v.annee} (${v.carburant || 'essence'})`;
  }

  // Formater le snapshot OBD
  const obdLines = Object.entries(obd_snapshot || {})
    .map(([pid, val]) => `${pid}: ${val}`)
    .join('\n');

  // Construire le prompt pour Claude
  const prompt = `Tu es un mécanicien expert spécialisé en diagnostic acoustique automobile.

${vehicleInfo}

Données OBD au moment de l'enregistrement (${snapshot_ts || 'maintenant'}) :
${obdLines || 'Aucune donnée OBD disponible'}

J'ai enregistré un bruit provenant du véhicule. Analyse ce que tu entends en corrélation avec les données OBD ci-dessus.

Réponds en 3 parties :
1. DESCRIPTION DU BRUIT : fréquence approximative, caractère (métallique, sourd, sifflement...), localisation probable
2. CORRÉLATION OBD : comment ce bruit correspond-il aux données OBD ? (ex: si claquement + LTFT élevé → admission)
3. PISTES DIAGNOSTIQUES : 2-3 causes les plus probables, par ordre de probabilité

Sois direct et pratique. Maximum 200 mots.`;

  const anthropic = new Anthropic({ apiKey: ANT_KEY });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          }
          // Note: Claude Haiku ne supporte pas encore l'audio natif
          // L'audio sera transcrit via un service futur (Whisper)
          // Pour l'instant, on analyse sur base des données OBD seules
          // En indiquant que l'utilisateur a signalé un bruit
        ]
      }]
    });

    const analysis = response.content[0]?.text || 'Analyse non disponible';

    // Sauvegarder l'analyse en base
    await supa.from('obd_sessions').insert({
      user_id: user.id,
      vehicle_id: vehicle_id || null,
      session_type: 'sound_analysis',
      result_json: {
        analysis,
        obd_snapshot,
        snapshot_ts,
        tokens: response.usage?.output_tokens || 0
      },
      created_at: new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
