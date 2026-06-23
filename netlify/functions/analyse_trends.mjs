// analyse_trends.mjs — MecaIA
// Analyse les tendances OBD et génère des prédictions de pannes
// POST /api/analyse_trends  { user_id, vehicle_id }
// Retourne: { alerts: [], trends: [], health_score: 0-100 }

import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const _CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};

// Seuils de dérive par PID
const THRESHOLDS = {
  LTFT:       { warn: 10, crit: 15, unit: '%',  label: 'Correction carburant LT' },
  STFT:       { warn: 15, crit: 25, unit: '%',  label: 'Correction carburant CT' },
  BATT:       { warn: 12.2, crit: 11.9, unit: 'V', label: 'Tension batterie', inverted: true },
  COOLANT:    { warn: 100, crit: 108, unit: '°C', label: 'Température refroidissement' },
  LOAD:       { warn: 85, crit: 95, unit: '%',  label: 'Charge moteur' },
};

function linRegSlope(points) {
  if (points.length < 3) return null;
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p);
  const xMean = xs.reduce((a,b) => a+b, 0) / n;
  const yMean = ys.reduce((a,b) => a+b, 0) / n;
  const num = xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i] - yMean), 0);
  const den = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

function daysUntilThreshold(current, slope, threshold, inverted = false) {
  if (Math.abs(slope) < 0.001) return null;
  const delta = threshold - current;
  if (inverted) {
    if (slope >= 0) return null;
    const days = Math.abs(delta / slope);
    return days > 0 && days < 60 ? Math.round(days) : null;
  } else {
    if (slope <= 0) return null;
    const days = delta / slope;
    return days > 0 && days < 60 ? Math.round(days) : null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { user_id, vehicle_id } = body;
  if (!user_id) return { statusCode: 400, body: JSON.stringify({ error: 'user_id requis' }) };

  const supa = createClient(SUPA_URL, SUPA_KEY);

  // Récupérer les 7 derniers jours de lectures groupées par PID
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  let query = supa
    .from('obd_readings')
    .select('pid, value, ts')
    .eq('user_id', user_id)
    .gte('ts', since)
    .order('ts', { ascending: true })
    .limit(2000);

  if (vehicle_id) query = query.eq('vehicle_id', vehicle_id);

  const { data: readings, error } = await query;
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  if (!readings || readings.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ alerts: [], trends: [], health_score: 70, message: 'Pas encore de données OBD' }) };
  }

  // Grouper par PID
  const byPid = {};
  readings.forEach(r => {
    if (!byPid[r.pid]) byPid[r.pid] = [];
    byPid[r.pid].push({ v: parseFloat(r.value), ts: r.ts });
  });

  const alerts = [];
  const trends = [];
  let healthPenalty = 0;

  // Analyser chaque PID avec seuil
  for (const [pid, cfg] of Object.entries(THRESHOLDS)) {
    const pidData = byPid[pid];
    if (!pidData || pidData.length < 3) continue;

    const values = pidData.map(p => Math.abs(p.v)); // LTFT/STFT: abs value
    const current = pidData[pidData.length - 1].v;
    const absValues = pid === 'LTFT' || pid === 'STFT' ? pidData.map(p => Math.abs(p.v)) : pidData.map(p => p.v);

    const slope = linRegSlope(absValues);
    const currentAbs = Math.abs(current);
    const inverted = !!cfg.inverted;

    // Tendance
    const avg = absValues.reduce((a,b)=>a+b,0) / absValues.length;
    const min = Math.min(...absValues);
    const max = Math.max(...absValues);

    trends.push({
      pid,
      label: cfg.label,
      current: parseFloat(current.toFixed(2)),
      avg: parseFloat(avg.toFixed(2)),
      min: parseFloat(min.toFixed(2)),
      max: parseFloat(max.toFixed(2)),
      slope: parseFloat((slope || 0).toFixed(4)),
      unit: cfg.unit,
      points: pidData.length,
    });

    // Alerte seuil
    const testVal = inverted ? current : currentAbs;
    const isWarn = inverted ? testVal < cfg.warn : testVal > cfg.warn;
    const isCrit = inverted ? testVal < cfg.crit : testVal > cfg.crit;

    if (isCrit) {
      healthPenalty += 20;
      alerts.push({
        type: 'CRITICAL',
        pid,
        label: cfg.label,
        current: parseFloat(current.toFixed(2)),
        threshold: cfg.crit,
        unit: cfg.unit,
        message: `${cfg.label} critique : ${current.toFixed(1)}${cfg.unit} (seuil ${cfg.crit}${cfg.unit})`,
        days_ahead: 0,
      });
    } else if (isWarn) {
      healthPenalty += 10;
      // Prédiction quand ça va dépasser le seuil critique
      const daysToCrit = daysUntilThreshold(inverted ? current : currentAbs, slope, cfg.crit, inverted);
      alerts.push({
        type: 'WARNING',
        pid,
        label: cfg.label,
        current: parseFloat(current.toFixed(2)),
        threshold: cfg.warn,
        unit: cfg.unit,
        message: daysToCrit
          ? `${cfg.label} : ${current.toFixed(1)}${cfg.unit} — seuil critique dans ~${daysToCrit} jours`
          : `${cfg.label} : ${current.toFixed(1)}${cfg.unit} à surveiller`,
        days_ahead: daysToCrit || null,
      });
    } else if (slope && !inverted) {
      // Pas encore en alerte mais dérive en cours
      const daysToWarn = daysUntilThreshold(currentAbs, slope, cfg.warn, false);
      if (daysToWarn && daysToWarn < 30) {
        healthPenalty += 5;
        alerts.push({
          type: 'TREND',
          pid,
          label: cfg.label,
          current: parseFloat(current.toFixed(2)),
          unit: cfg.unit,
          message: `${cfg.label} : tendance à la hausse, seuil d'alerte dans ~${daysToWarn} jours`,
          days_ahead: daysToWarn,
        });
      }
    }
  }

  // Health score global (base 100 - pénalités)
  const health_score = Math.max(10, Math.min(100, 100 - healthPenalty));

  // Sauvegarder les alertes en base
  if (alerts.length > 0) {
    const rows = alerts.map(a => ({
      user_id,
      vehicle_id: vehicle_id || null,
      type: a.type,
      pid: a.pid,
      current_val: a.current,
      threshold: a.threshold || null,
      prediction: a.message,
      days_ahead: a.days_ahead,
      acknowledged: false,
    }));
    // Supprimer les anciennes alertes non-ack du même type + insérer nouvelles
    await supa.from('obd_alerts')
      .delete()
      .eq('user_id', user_id)
      .eq('acknowledged', false);
    await supa.from('obd_alerts').insert(rows);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alerts, trends, health_score }),
  };
};
