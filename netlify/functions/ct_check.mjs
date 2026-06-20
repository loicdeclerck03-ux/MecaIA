// ct_check.mjs — MecaIA Certificat Contrôle Technique
// Analyse les 8 moniteurs OBD readiness + DTC → verdict PRÊT/NON PRÊT
// Tarif : 9,99€ one-shot (ou inclus abonnement Pro)
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANT_KEY   = process.env.ANTHROPIC_KEY;

// Les 8 moniteurs readiness EOBD
const MONITORS = [
  { id: 'catalyst',      label: 'Catalyseur',          critical: true  },
  { id: 'heated_cat',   label: 'Catalyseur chauffé',   critical: false },
  { id: 'evap_system',  label: 'Système EVAP',         critical: true  },
  { id: 'sec_air',      label: 'Air secondaire',       critical: false },
  { id: 'ac_refrig',    label: 'Climatisation',        critical: false },
  { id: 'oxygen_sens',  label: 'Sondes lambda',        critical: true  },
  { id: 'oxygen_heat',  label: 'Chauffe-sondes',       critical: false },
  { id: 'egr_vvt',      label: 'EGR / VVT',           critical: false },
];

const NOT_APPLICABLE = 'N/A'; // moniteur non supporté par ce véhicule
const INCOMPLETE = 'INCOMPLETE';
const COMPLETE = 'COMPLETE';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { user_id, vehicle_id, monitors, dtcs, mil_on, mileage } = body;

  if (!user_id || !monitors) {
    return { statusCode: 400, body: JSON.stringify({ error: 'user_id et monitors requis' }) };
  }

  const supa = createClient(SUPA_URL, SUPA_KEY);

  // Vérifier abonnement ou paiement CT
  const { data: credits } = await supa
    .from('user_credits').select('balance').eq('user_id', user_id).single();

  // Calculer le verdict
  const issues = [];
  let ready = true;
  let criticalFail = false;

  // 1. Voyant MIL (Check Engine)
  if (mil_on) {
    issues.push({ type: 'mil', severity: 'CRITICAL', label: '🔴 Voyant moteur allumé — échec automatique CT' });
    ready = false;
    criticalFail = true;
  }

  // 2. DTC actifs
  if (dtcs && dtcs.length > 0) {
    const activeDtcs = dtcs.filter(d => !d.startsWith('P0'));
    dtcs.forEach(d => {
      issues.push({ type: 'dtc', severity: 'CRITICAL', label: `🔴 Code défaut actif: ${d}` });
    });
    if (dtcs.length > 0) { ready = false; criticalFail = true; }
  }

  // 3. Moniteurs readiness
  const monitorResults = {};
  MONITORS.forEach(mon => {
    const status = monitors[mon.id];
    monitorResults[mon.id] = { label: mon.label, status: status || NOT_APPLICABLE, critical: mon.critical };
    if (status === INCOMPLETE && mon.critical) {
      issues.push({ type: 'monitor', severity: 'WARNING', label: `⚠️ ${mon.label}: non complété (drive cycle requis)` });
      ready = false;
    } else if (status === INCOMPLETE) {
      issues.push({ type: 'monitor', severity: 'INFO', label: `ℹ️ ${mon.label}: non complété (non critique)` });
    }
  });

  // 4. Générer analyse IA
  const anthropic = new Anthropic({ apiKey: ANT_KEY });
  const monitorSummary = MONITORS.map(m => {
    const r = monitorResults[m.id];
    return `${r.label}: ${r.status}${r.critical ? ' (critique)' : ''}`;
  }).join('\n');

  const prompt = `Tu es un expert contrôle technique automobile européen (norme EOBD).

Voici les données OBD du véhicule ${vehicle_id ? `(ID: ${vehicle_id})` : ''} :
- Voyant MIL: ${mil_on ? 'ALLUMÉ ⚠️' : 'Éteint ✓'}
- Codes défauts: ${dtcs?.length ? dtcs.join(', ') : 'Aucun ✓'}
- Kilométrage: ${mileage ? mileage + ' km' : 'Non fourni'}

Moniteurs readiness:
${monitorSummary}

Verdict: ${ready ? '✅ PRÊT POUR LE CT' : '❌ NON PRÊT POUR LE CT'}

Génère un rapport clair en 3 parties:
1. VERDICT (1 phrase directe)
2. PROBLÈMES À RÉSOUDRE (si applicable, liste courte avec solutions concrètes)
3. DRIVE CYCLE RECOMMANDÉ (si des moniteurs sont incomplets, expliquer en 2-3 phrases simples comment les compléter: type de trajet, conditions, durée)

Ton rapport doit être compréhensible par un conducteur non-mécanicien. Maximum 200 mots.`;

  let aiReport = '';
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });
    aiReport = resp.content[0]?.text || '';
  } catch (e) {
    aiReport = `Verdict: ${ready ? 'Véhicule prêt pour le contrôle technique.' : 'Problèmes détectés — voir liste ci-dessus.'}`;
  }

  // Score de confiance 0-100
  const incompleteCount = MONITORS.filter(m => monitors[m.id] === INCOMPLETE).length;
  const confidence = Math.max(0, 100 - (criticalFail ? 60 : 0) - (incompleteCount * 5));

  const result = {
    ready,
    verdict: ready ? 'PRÊT' : 'NON PRÊT',
    confidence,
    issues,
    monitors: monitorResults,
    ai_report: aiReport,
    generated_at: new Date().toISOString(),
    disclaimer: 'Ce rapport est indicatif. Le résultat officiel du CT peut différer selon le centre de contrôle.'
  };

  // Sauvegarder en base
  try {
    await supa.from('obd_sessions').insert({
      user_id,
      vehicle_id: vehicle_id || null,
      session_type: 'ct_check',
      result_json: result,
      created_at: new Date().toISOString()
    });
  } catch (e) { /* non bloquant */ }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
};
