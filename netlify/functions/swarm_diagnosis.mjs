// swarm_diagnosis.mjs — MecaIA ONE — Intelligence collective flotte
// v2 : auth standard + credit gate + CORS + code lisible — audit 24/06/2026
import Anthropic from '@anthropic-ai/sdk';
import { getUser, serviceClient, json, preflight, ensureDiagSession } from '../lib/auth.mjs';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: 'Non authentifié' });

  const supabase = serviceClient();

  // Vérification des crédits (comme photo_analyze, dylan_agents)
  const gate = await ensureDiagSession(supabase, auth.userId);
  if (!gate.allowed) {
    return json(402, {
      success: false, code: 'insufficient_credits',
      message: 'Crédits insuffisants.', remaining_balance: gate.balance,
    });
  }

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { b = {}; }
  const { vehicle_id, marque = '', modele = '', annee = 0, symptoms = [] } = b;

  // Données OBD 7 derniers jours — filtrées par user (jamais cross-user)
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  let query = supabase
    .from('obd_readings')
    .select('pid, value')
    .eq('user_id', auth.userId)
    .gte('ts', since)
    .limit(300);
  if (vehicle_id) query = query.eq('vehicle_id', vehicle_id);

  const { data: reads } = await query.catch(() => ({ data: [] }));

  const byPid = {};
  (reads || []).forEach(r => {
    if (!byPid[r.pid]) byPid[r.pid] = [];
    byPid[r.pid].push(parseFloat(r.value));
  });

  const pattern = {};
  Object.entries(byPid).forEach(([k, v]) => {
    pattern[k] = +(v.reduce((a, c) => a + c, 0) / v.length).toFixed(2);
  });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
  const prompt = [
    `Expert diagnostique auto européen.`,
    `Véhicule: ${marque} ${modele} ${annee}`,
    `Symptômes: ${symptoms.join(', ') || 'aucun'}`,
    `Pattern OBD 7j: ${JSON.stringify(pattern)}`,
    `Retourne JSON strict: {"pannes_frequentes":[{"nom":"...","probabilite":"haute/moyenne/faible","description":"..."}],"prediction_risque":"...","action_prioritaire":"..."}`,
  ].join('\n');

  let analysis = {
    pannes_frequentes: [],
    prediction_risque: 'Données insuffisantes',
    action_prioritaire: 'Connecter le boîtier OBD et rouler 30 jours',
  };

  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (r.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json\n?/gi, '').replace(/```/g, '').trim();
    analysis = JSON.parse(clean);
  } catch (e) {
    console.error('[SWARM] IA:', e.message);
    // On retourne les données OBD même si l'IA échoue
  }

  return json(200, {
    vehicle_pattern: pattern,
    symptoms,
    swarm_analysis: analysis,
    charged: gate.charged,
    unlimited: gate.unlimited,
  });
};
