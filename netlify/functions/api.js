// netlify/functions/api.js
// ============================================================
// MECAIA — BACKEND PRINCIPAL SÉCURISÉ
// Toutes les routes IA passent par ici — JAMAIS côté client
// ============================================================

const ANTHROPIC_KEY     = process.env.ANTHROPIC_KEY;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON     = process.env.SUPABASE_ANON;
const SUPABASE_SECRET   = process.env.SUPABASE_SECRET;
const STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY;
const OWNER_CODE        = process.env.OWNER_CODE;

// Headers CORS
const headers = {
  'Content-Type'                : 'application/json',
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// ============================================================
// UTILITAIRES
// ============================================================

/** Appel Supabase REST (service_role = bypass RLS) */
async function supaQuery(path, method = 'GET', body = null, token = null) {
  const key = token ? SUPABASE_ANON : SUPABASE_SECRET;
  const authHeader = token ? `Bearer ${token}` : `Bearer ${SUPABASE_SECRET}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type'   : 'application/json',
      'apikey'         : key,
      'Authorization'  : authHeader,
      'Prefer'         : method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Récupérer un utilisateur par son JWT */
async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Récupérer les crédits d'un utilisateur */
async function getCredits(userId) {
  const rows = await supaQuery(`users?id=eq.${userId}&select=credits,is_unlimited`);
  return rows?.[0] || null;
}

/** Vérifier crédits + débiter si OK */
async function checkAndDebit(userId) {
  const u = await getCredits(userId);
  if (!u) return { ok: false, reason: 'Utilisateur introuvable' };
  if (u.is_unlimited) return { ok: true, credits: 999 };
  if (u.credits <= 0) return { ok: false, reason: 'Plus de crédits' };
  // Décrémenter directement via RPC
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/decrement_credits`, {
    method: 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`
    },
    body: JSON.stringify({ p_user_id: userId })
  });
  return { ok: true, credits: u.credits - 1 };
}

/** Appel Claude (Haiku par défaut, Sonnet si premium) */
async function callClaude(system, messages, maxTokens = 1500, model = 'claude-haiku-4-5-20251001') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type'     : 'application/json',
      'x-api-key'        : ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.map(b => b.text || '').join('');
}

/** Sauvegarder un diagnostic en base */
async function saveDiag(userId, type, input, output, carId = null) {
  await supaQuery('diagnostics', 'POST', {
    user_id: userId, car_id: carId,
    type, input, output,
    credits_used: 1,
    created_at: new Date().toISOString()
  });
  // Incrémenter compteur diagnostics
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_diag_count`, {
    method: 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`
    },
    body: JSON.stringify({ p_user_id: userId })
  });
}

/** Réponse JSON */
const ok  = (data)  => ({ statusCode: 200, headers, body: JSON.stringify(data) });
const err = (msg, code = 400) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export async function handler(event) {

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // GET /api?action=config → clés publiques
  if (event.httpMethod === 'GET') {
    const action = event.queryStringParameters?.action;
    if (action === 'config') {
      return ok({
        supabaseUrl     : SUPABASE_URL,
        supabaseAnonKey : SUPABASE_ANON,
        stripePublicKey : STRIPE_PUBLIC_KEY
      });
    }
    return err('Action inconnue', 404);
  }

  if (event.httpMethod !== 'POST') return err('Méthode non autorisée', 405);

  let body;
  try { body = JSON.parse(event.body); }
  catch { return err('Body JSON invalide'); }

  const { action } = body;

  // ============================================================
  // ROUTE: photo (1 crédit)
  // ============================================================
  if (action === 'photo') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const debit = await checkAndDebit(authUser.id);
    if (!debit.ok) return err(debit.reason, 402);

    const { imageBase64, imageMime } = body;
    if (!imageBase64) return err('Image manquante');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type'     : 'application/json',
          'x-api-key'        : ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model     : 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system    : 'Tu es Dylan, expert mécanicien belge. Tu analyses des photos de pièces auto avec précision. Réponds en français, directement et professionnellement.',
          messages  : [{
            role   : 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: imageMime || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: 'Analyse cette photo:\n1. Ce que tu vois précisément\n2. État (bon/usé/défaillant)\n3. Problèmes visibles\n4. Urgence: Immédiat/Bientôt/Préventif\n5. Recommandations\n6. Pièces à commander si nécessaire' }
            ]
          }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const analyse = data.content.map(b => b.text || '').join('');
      await saveDiag(authUser.id, 'photo', { imageMime }, { analyse });
      return ok({ analyse, creditsLeft: debit.credits });
    } catch(e) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` },
        body: JSON.stringify({ user_id: authUser.id, amount: 1 })
      });
      return err('Erreur analyse photo: ' + e.message, 500);
    }
  }

  // ============================================================
  // ROUTE: diagnostic (1 crédit)
  // ============================================================
  if (action === 'diagnostic') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const debit = await checkAndDebit(authUser.id);
    if (!debit.ok) return err(debit.reason, 402);

    const { vehicleInfo, code, symptoms, userType, carId } = body;
    const isAmateur  = userType === 'amateur';
    const isApprentice = userType === 'apprenti';

    const system = isAmateur
      ? 'Tu es Dylan, mécanicien belge qui explique en langage simple. Utilise des analogies de la vie quotidienne. Réponds UNIQUEMENT en JSON valide sans markdown.'
      : isApprentice
      ? 'Tu es Dylan, formateur mécanicien pédagogique belge. Explique pourquoi chaque étape. Réponds UNIQUEMENT en JSON valide sans markdown.'
      : 'Tu es Dylan, expert mécanicien automobile belge avec 20 ans d\'expérience. Diagnostics ultra précis. Réponds UNIQUEMENT en JSON valide sans markdown.';

    const prompt = `Code OBD: ${code || 'non fourni'}
Véhicule: ${vehicleInfo || 'non précisé'}
Symptômes: ${symptoms || 'non précisés'}
JSON:
{"code":"${code || 'SYMPTÔMES'}","systeme":"système exact","titre":"titre précis","description":"explication 3-4 phrases","severite":"HAUTE","rouler":true,"causes":["c1","c2","c3","c4"],"etapes":["e1 avec valeurs","e2","e3","e4","e5"],"outils":["outil1 avec taille","outil2","outil3"],"difficulte":2,"pieces":["p1","p2","p3"],"comment_tester":"comment tester avec valeurs exactes","pannes_liees":"autres pannes liées","economie_diy":120,"temps":"estimation","mo_min":50,"mo_max":200,"pieces_min":30,"pieces_max":400,"conseil":"conseil expert spécifique","prevention":"prévention futur"}`;

    try {
      const text = await callClaude(system, [{ role: 'user', content: prompt }]);
      const result = JSON.parse(text.replace(/```json|```/g, '').trim());
      await saveDiag(authUser.id, 'obd', { vehicleInfo, code, symptoms }, result, carId || null);
      return ok({ ...result, creditsLeft: debit.credits });
    } catch (e) {
      // Rembourser le crédit si erreur IA
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` },
        body: JSON.stringify({ user_id: authUser.id, amount: 1 })
      });
      return err('Erreur diagnostic IA: ' + e.message, 500);
    }
  }

  // ============================================================
  // ROUTE: vin (GRATUIT)
  // ============================================================
  if (action === 'vin') {
    const { vin } = body;
    if (!vin || vin.length < 5) return err('VIN invalide');

    try {
      const text = await callClaude(
        'Expert décodage VIN. Réponds UNIQUEMENT en JSON valide sans markdown.',
        [{ role: 'user', content: `Décode ce VIN: ${vin}\nWMI: ${vin.substring(0,3)}\nCodes WMI: VF1=Renault,VF3=Peugeot,VF7=Citroën,WBA=BMW,WDB=Mercedes,WAU=Audi,WVW=VW,ZFA=Fiat,VSS=SEAT,TMB=Skoda,SAL=LandRover\nJSON:\n{"pays":"","constructeur":"","modele":"","variante":"","annee":"","usine":"","moteur":"","carburant":"","transmission":"","serie":"${vin.substring(9)}"}` }],
        800
      );
      const result = JSON.parse(text.replace(/```json|```/g, '').trim());
      return ok(result);
    } catch (e) { return err('Erreur VIN: ' + e.message, 500); }
  }

  // ============================================================
  // ROUTE: pieces (1 crédit)
  // ============================================================
  if (action === 'pieces') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const debit = await checkAndDebit(authUser.id);
    if (!debit.ok) return err(debit.reason, 402);

    const { vehicleInfo, partName } = body;
    if (!vehicleInfo || !partName) return err('Infos manquantes');

    try {
      const text = await callClaude(
        'Expert pièces automobiles. Références aussi précises que possible. JSON uniquement sans markdown.',
        [{ role: 'user', content: `Véhicule: ${vehicleInfo}\nPièce: ${partName}\nJSON:\n{"pieces":[{"nom":"nom exact","marque":"NGK/Bosch/Valeo/Febi...","reference":"réf précise","ref_origine":"réf constructeur","prix_min":15,"prix_max":45,"compatibilite":"note précise","qualite":"OEM ou Aftermarket ou Origine","conseil":"conseil montage","urgence":"Immédiat ou Sous 1000km ou Entretien normal"}]}\n3-4 pièces de qualités différentes.` }],
        1200
      );
      const result = JSON.parse(text.replace(/```json|```/g, '').trim());
      await saveDiag(authUser.id, 'pieces', { vehicleInfo, partName }, result);
      return ok({ ...result, creditsLeft: debit.credits });
    } catch (e) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }, body: JSON.stringify({ user_id: authUser.id, amount: 1 }) });
      return err('Erreur pièces: ' + e.message, 500);
    }
  }

  // ============================================================
  // ROUTE: alertes (1 crédit)
  // ============================================================
  if (action === 'alertes') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const debit = await checkAndDebit(authUser.id);
    if (!debit.ok) return err(debit.reason, 402);

    const { vehicleInfo, mileage } = body;
    if (!mileage) return err('Kilométrage manquant');

    try {
      const text = await callClaude(
        'Expert entretien automobile. JSON uniquement sans markdown.',
        [{ role: 'user', content: `Véhicule: ${vehicleInfo || 'non précisé'} à ${mileage} km\nJSON:\n{"alertes":[{"icon":"🔧","titre":"intervention","desc":"description précise","km_next":170000,"urgence":"Immédiat ou Bientôt ou Préventif"}]}\n6-8 alertes basées sur le kilométrage réel.` }],
        1000
      );
      const result = JSON.parse(text.replace(/```json|```/g, '').trim());
      await saveDiag(authUser.id, 'alertes', { vehicleInfo, mileage }, result);
      return ok({ ...result, creditsLeft: debit.credits });
    } catch (e) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }, body: JSON.stringify({ user_id: authUser.id, amount: 1 }) });
      return err('Erreur alertes: ' + e.message, 500);
    }
  }

  // ============================================================
  // ROUTE: chat Dylan (3 questions = 1 crédit)
  // ============================================================
  if (action === 'chat') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const { message, history, sessionId, vehicleInfo } = body;
    if (!message) return err('Message manquant');

    // ── Modèle : 1 crédit = 15 minutes de chat illimité ──
    const urows = await supaQuery(`users?id=eq.${authUser.id}&select=credits,is_unlimited,chat_session_start`);
    const u = urows?.[0];
    if (!u) return err('Utilisateur introuvable', 404);

    const now = Date.now();
    const FIFTEEN_MIN = 15 * 60 * 1000;
    const sessionStart = u.chat_session_start ? new Date(u.chat_session_start).getTime() : 0;
    const sessionExpired = (now - sessionStart) > FIFTEEN_MIN;

    let creditsLeft = u.is_unlimited ? 999 : u.credits;
    let sessionEnds = sessionStart + FIFTEEN_MIN;

    if (sessionExpired) {
      // Nouvelle fenêtre de 15 min → débiter 1 crédit (sauf illimité)
      if (!u.is_unlimited) {
        if (u.credits <= 0) return err('Plus de crédits', 402);
        await supaQuery(`users?id=eq.${authUser.id}`, 'PATCH', {
          credits: u.credits - 1,
          chat_session_start: new Date(now).toISOString()
        });
        creditsLeft = u.credits - 1;
      } else {
        await supaQuery(`users?id=eq.${authUser.id}`, 'PATCH', {
          chat_session_start: new Date(now).toISOString()
        });
      }
      sessionEnds = now + FIFTEEN_MIN;
    }
    // Sinon : dans la fenêtre de 15 min → message gratuit

    const system = `Tu es Dylan, mécanicien automobile belge de 25 ans. Direct, franc, humour léger, anti-arnaque. Tu parles comme un vrai mécano belge, pas comme un robot.
Véhicule de l'utilisateur: ${vehicleInfo || 'non précisé'}
Règles:
- Réponds en 2-4 phrases maximum (concis!)
- Si c'est urgent, dis-le clairement
- Cite des valeurs précises (ex: "entre 0.3 et 0.5 bar")
- Utilise des emojis avec parcimonie 🔧
- Dis "je ne sais pas" si tu n'es pas sûr
- Oriente vers un pro si c'est risqué`;

    // Construire l'historique de la conversation
    const messages = [
      ...(history || []),
      { role: 'user', content: message }
    ];

    try {
      const text = await callClaude(system, messages, 600);

      // Sauvegarder les messages
      await supaQuery('chat_messages', 'POST', {
        user_id: authUser.id,
        session_id: sessionId || 'default',
        role: 'user',
        content: message,
        created_at: new Date().toISOString()
      });
      await supaQuery('chat_messages', 'POST', {
        user_id: authUser.id,
        session_id: sessionId || 'default',
        role: 'assistant',
        content: text,
        created_at: new Date().toISOString()
      });

      return ok({ reply: text, creditsLeft, sessionEnds, freshSession: sessionExpired });
    } catch (e) { return err('Erreur chat: ' + e.message, 500); }
  }

  // ============================================================
  // ROUTE: urgence (GRATUIT — pas de login requis)
  // ============================================================
  if (action === 'urgence') {
    const { description, vehicleInfo } = body;
    if (!description) return err('Description manquante');

    try {
      const text = await callClaude(
        'Expert mécanicien. Analyse urgence rapide. JSON sans markdown.',
        [{ role: 'user', content: `Véhicule: ${vehicleInfo || 'non précisé'}\nProblème: ${description}\nJSON:\n{"gravite":"STOP","rouler":false,"message":"explication courte","action":"quoi faire maintenant"}` }],
        400
      );
      const result = JSON.parse(text.replace(/```json|```/g, '').trim());
      return ok(result);
    } catch (e) { return err('Erreur urgence: ' + e.message, 500); }
  }

  // ============================================================
  // ROUTE: promo (valider un code promo)
  // ============================================================
  if (action === 'promo') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const { code } = body;
    if (!code) return err('Code manquant');

    // Vérifier si le code existe
    const promos = await supaQuery(`promo_codes?code=eq.${code.toUpperCase()}&select=*`);
    const promo = promos?.[0];
    if (!promo || promo.uses_left <= 0) return err('Code invalide ou expiré');
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return err('Code expiré');

    // Vérifier si déjà utilisé par cet user
    const used = await supaQuery(`used_promos?user_id=eq.${authUser.id}&code=eq.${code.toUpperCase()}&select=code`);
    if (used?.length > 0) return err('Code déjà utilisé');

    if (promo.type === 'reduction') {
      return ok({ type: 'reduction', value: promo.reduction, message: `Réduction -${promo.reduction}% appliquée !` });
    }

    // Ajouter les crédits
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` },
      body: JSON.stringify({ user_id: authUser.id, amount: promo.credits })
    });

    // Marquer comme utilisé
    await supaQuery('used_promos', 'POST', { user_id: authUser.id, code: code.toUpperCase() });

    // Décrémenter uses_left
    await fetch(`${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${code.toUpperCase()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ uses_left: promo.uses_left - 1, uses_total: promo.uses_total + 1 })
    });

    return ok({ type: 'credits', credits: promo.credits, message: `${promo.credits} crédits ajoutés !` });
  }

  // ============================================================
  // ROUTE: owner (code propriétaire → illimité)
  // ============================================================
  if (action === 'owner') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);

    const { code } = body;
    if (code !== OWNER_CODE) return err('Code incorrect');

    await supaQuery(`users?id=eq.${authUser.id}`, 'PATCH', { is_unlimited: true, credits: 999 });
    return ok({ message: 'Crédits illimités activés !' });
  }

  // ============================================================
  // ROUTE: cars (CRUD garage)
  // ============================================================
  if (action === 'cars_get') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);
    const cars = await supaQuery(`cars?user_id=eq.${authUser.id}&order=created_at.asc`);
    return ok({ cars: cars || [] });
  }

  if (action === 'cars_add') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);
    const { car } = body;
    if (!car?.marque || !car?.modele) return err('Données véhicule incomplètes');
    const result = await supaQuery('cars', 'POST', { ...car, user_id: authUser.id });
    return ok({ car: result?.[0] || car });
  }

  if (action === 'cars_delete') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);
    const { carId } = body;
    await fetch(`${SUPABASE_URL}/rest/v1/cars?id=eq.${carId}&user_id=eq.${authUser.id}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
    });
    return ok({ message: 'Véhicule supprimé' });
  }

  // ============================================================
  // ROUTE: historique
  // ============================================================
  if (action === 'history') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);
    const diags = await supaQuery(`diagnostics?user_id=eq.${authUser.id}&order=created_at.desc&limit=50`);
    return ok({ history: diags || [] });
  }

  if (action === 'history_fav') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);
    const { diagId, isFav } = body;
    await fetch(`${SUPABASE_URL}/rest/v1/diagnostics?id=eq.${diagId}&user_id=eq.${authUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ is_fav: isFav })
    });
    return ok({ message: 'Favori mis à jour' });
  }

  // ============================================================
  // ROUTE: profile (infos user)
  // ============================================================
  if (action === 'profile') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.id) return err('Non authentifié', 401);
    const users = await supaQuery(`users?id=eq.${authUser.id}&select=*`);
    return ok({ profile: users?.[0] || null });
  }

  // ============================================================
  // ROUTE: admin stats (propriétaire uniquement)
  // ============================================================
  if (action === 'admin_stats') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.email || authUser.email !== 'loicdeclerck4020@gmail.com') return err('Non autorisé', 403);

    const users = await supaQuery('users?select=id,email,name,credits,total_paid,diagnostics_count,created_at&order=created_at.desc&limit=50');
    const transactions = await supaQuery('transactions?select=amount,created_at&status=eq.completed&order=created_at.desc&limit=20');
    const totalRevenue = transactions?.reduce((s, t) => s + parseFloat(t.amount), 0) || 0;

    return ok({
      users: users || [],
      totalUsers: users?.length || 0,
      totalRevenue: totalRevenue.toFixed(2),
      recentTransactions: transactions || []
    });
  }

  // ============================================================
  // ROUTE: gen_promo (propriétaire uniquement)
  // ============================================================
  if (action === 'gen_promo') {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const authUser = await getUserFromToken(token);
    if (!authUser?.email || authUser.email !== 'loicdeclerck4020@gmail.com') return err('Non autorisé', 403);

    const { type, credits, reduction, usesLeft, customName } = body;
    const code = customName?.toUpperCase() || 'CODE-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    await supaQuery('promo_codes', 'POST', {
      code, type: type || 'credits',
      credits: credits || 5,
      reduction: reduction || 0,
      uses_left: usesLeft || 1,
      uses_total: 0,
      created_at: new Date().toISOString()
    });

    return ok({ code, message: `Code ${code} créé !` });
  }

  return err('Action inconnue', 404);
}
