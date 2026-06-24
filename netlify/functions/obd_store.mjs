// obd_store.mjs — MecaIA
// Stocke les lectures OBD2 en batch dans obd_readings
// POST { vehicle_id, readings: [{pid, value, unit?}] }
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  // Auth via Bearer token
  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Token requis' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { vehicle_id, readings, session_key, device_id } = body;
  if (!readings || !Array.isArray(readings) || readings.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'readings array requis' }) };
  }

  // Vérifier le token et récupérer user_id
  const supa = createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: false }
  });

  const { data: _ad, error: authError } = await supa.auth.getUser(token);
  if (authError || !_ad?.user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };
  const user = _ad.user;
  if (authError || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };

  const user_id = user.id;
  const ts = new Date().toISOString();

  // Construire les rows
  const rows = readings
    .filter(r => r.pid && r.value != null && !isNaN(parseFloat(r.value)))
    .map(r => ({
      user_id,
      vehicle_id: vehicle_id || null,
      device_id: device_id || 'electron',
      ts,
      pid: r.pid,
      value: parseFloat(r.value),
      unit: r.unit || null,
      session_key: session_key || null,
    }));

  if (rows.length === 0) return { statusCode: 200, body: JSON.stringify({ stored: 0 }) };

  const { error: insertError } = await supa.from('obd_readings').insert(rows);
  if (insertError) return { statusCode: 500, body: JSON.stringify({ error: insertError.message }) };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stored: rows.length, ts }),
  };
};
