// SIMULATION COMPLÈTE — teste le backend SANS réseau réel
// Mock fetch pour simuler Supabase Auth, Supabase REST et Claude
import assert from 'node:assert';

// ── Variables d'env simulées (EXACTEMENT comme sur Netlify de Loïc) ──
process.env.ANTHROPIC_KEY   = 'sk-ant-FAKE';
process.env.SUPABASE_URL    = 'https://fake.supabase.co';
process.env.SUPABASE_ANON   = 'anon-FAKE';     // ← nom corrigé
process.env.SUPABASE_SECRET = 'secret-FAKE';
process.env.STRIPE_PUBLIC_KEY = 'pk_live_FAKE';
process.env.OWNER_CODE      = 'LOIC2024';

// ── Base de données simulée en mémoire ──
const DB = {
  users: [{ id: 'user-123', email: 'test@test.com', name: 'Test', type: 'mechanic', credits: 3, is_unlimited: false, diagnostics_count: 0, total_paid: 0 }],
  cars: [],
  diagnostics: [],
  promo_codes: [{ code: 'WELCOME3', type: 'credits', credits: 3, reduction: 0, uses_left: 1000, uses_total: 0, expires_at: null }],
  used_promos: [],
  chat_messages: []
};

let claudeCalls = 0;

// ── MOCK fetch : intercepte tous les appels réseau ──
global.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;

  // 1) Auth Supabase : /auth/v1/user → renvoie l'user du token
  if (url.includes('/auth/v1/user')) {
    const auth = opts.headers?.Authorization || '';
    if (auth.includes('valid-token')) {
      return mockRes({ id: 'user-123', email: 'test@test.com' });
    }
    if (auth.includes('owner-token')) {
      return mockRes({ id: 'user-123', email: 'loicdeclerck4020@gmail.com' });
    }
    return mockRes({}, 401);
  }

  // 2) Claude API
  if (url.includes('api.anthropic.com')) {
    claudeCalls++;
    // Réponse JSON valide selon le type de prompt
    const prompt = body.messages[0].content;
    let fake;
    if (prompt.includes('"gravite"')) fake = { gravite: 'STOP', rouler: false, message: 'Test', action: 'Test' };
    else if (prompt.includes('"nom exact"')) fake = { pieces: [{ nom: 'Bougie', marque: 'NGK', reference: 'BKR6E', prix_min: 8, prix_max: 15, compatibilite: 'OK', qualite: 'OEM', urgence: 'Entretien normal' }] };
    else if (prompt.includes('"alertes":[')) fake = { alertes: [{ icon: '🔧', titre: 'Vidange', desc: 'Test', km_next: 170000, urgence: 'Bientôt' }] };
    else if (prompt.includes('"pays"')) fake = { pays: 'France', constructeur: 'Renault', modele: 'Clio', annee: '2018', carburant: 'Essence' };
    else if (prompt.includes('Réponds en 2-4 phrases')) return mockRes({ content: [{ type: 'text', text: 'Salut, ton problème vient sûrement de la bougie. 🔧' }] });
    else fake = { code: 'P0101', systeme: 'Admission', titre: 'Débitmètre', description: 'Test', severite: 'MOYENNE', rouler: true, causes: ['c1','c2'], etapes: ['e1','e2'], outils: ['clé'], difficulte: 2, pieces: ['MAF'], conseil: 'Test', mo_min: 50, mo_max: 100, pieces_min: 30, pieces_max: 80 };
    return mockRes({ content: [{ type: 'text', text: JSON.stringify(fake) }] });
  }

  // 3) Supabase RPC (decrement/increment credits)
  if (url.includes('/rpc/decrement_credits')) {
    const u = DB.users.find(x => x.id === body.p_user_id);
    if (u) u.credits -= 1;
    return mockRes(u?.credits ?? 0);
  }
  if (url.includes('/rpc/increment_credits')) {
    const u = DB.users.find(x => x.id === body.user_id);
    if (u) u.credits += body.amount;
    return mockRes(u?.credits ?? 0);
  }
  if (url.includes('/rpc/increment_diag_count')) {
    const u = DB.users.find(x => x.id === body.p_user_id);
    if (u) u.diagnostics_count += 1;
    return mockRes(null);
  }

  // 4) Supabase REST (tables)
  if (url.includes('/rest/v1/users')) {
    if (method === 'GET') return mockRes(DB.users.filter(u => url.includes(u.id)));
    if (method === 'PATCH') { Object.assign(DB.users[0], body); return mockRes(null); }
  }
  if (url.includes('/rest/v1/cars')) {
    if (method === 'GET') return mockRes(DB.cars);
    if (method === 'POST') { const c = { id: 'car-1', ...body }; DB.cars.push(c); return mockRes([c]); }
    if (method === 'DELETE') { DB.cars = []; return mockRes(null); }
  }
  if (url.includes('/rest/v1/diagnostics')) {
    if (method === 'POST') { DB.diagnostics.push(body); return mockRes([body]); }
    if (method === 'GET') return mockRes(DB.diagnostics);
  }
  if (url.includes('/rest/v1/promo_codes')) {
    if (method === 'GET') return mockRes(DB.promo_codes.filter(p => url.includes(p.code)));
    if (method === 'POST') { DB.promo_codes.push(body); return mockRes([body]); }
    if (method === 'PATCH') return mockRes(null);
  }
  if (url.includes('/rest/v1/used_promos')) {
    if (method === 'GET') return mockRes([]);
    if (method === 'POST') { DB.used_promos.push(body); return mockRes([body]); }
  }
  if (url.includes('/rest/v1/chat_messages')) {
    if (method === 'POST') { DB.chat_messages.push(body); return mockRes([body]); }
  }
  if (url.includes('/rest/v1/transactions')) {
    if (method === 'GET') return mockRes([{ amount: 10, created_at: new Date().toISOString() }]);
    if (method === 'POST') return mockRes([body]);
  }
  return mockRes({}, 404);
};

function mockRes(data, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => (data === null ? '' : JSON.stringify(data))
  };
}

// ── Charger le handler ──
const { handler } = await import('../netlify/functions/api.js');

// ── Helper pour appeler une route ──
async function call(action, body = {}, token = 'valid-token') {
  const res = await handler({
    httpMethod: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ action, ...body })
  });
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

// ════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════
let passed = 0, failed = 0;
function test(name, fn) {
  return fn().then(() => { console.log('✅', name); passed++; })
             .catch(e => { console.log('❌', name, '→', e.message); failed++; });
}

// 1. Config (GET)
await test('config renvoie les clés publiques', async () => {
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'config' } });
  const d = JSON.parse(res.body);
  assert(d.supabaseUrl && d.supabaseAnonKey && d.stripePublicKey, 'clés manquantes');
});

// 2. Diagnostic (consomme 1 crédit)
await test('diagnostic fonctionne et débite 1 crédit', async () => {
  DB.users[0].credits = 3;
  const r = await call('diagnostic', { vehicleInfo: 'Renault Clio', code: 'P0101', symptoms: 'ralenti', userType: 'mechanic' });
  assert(r.status === 200, 'status ' + r.status);
  assert(r.data.titre === 'Débitmètre', 'pas de diagnostic');
  assert(r.data.creditsLeft === 2, 'crédit non débité: ' + r.data.creditsLeft);
  assert(DB.diagnostics.length === 1, 'diagnostic non sauvegardé');
});

// 3. Diagnostic SANS crédit → refusé
await test('diagnostic refusé si 0 crédit', async () => {
  DB.users[0].credits = 0;
  const r = await call('diagnostic', { vehicleInfo: 'X', code: 'P0', userType: 'mechanic' });
  assert(r.status === 402, 'devrait être 402, reçu ' + r.status);
});

// 4. Diagnostic SANS auth → 401
await test('diagnostic refusé sans authentification', async () => {
  const r = await call('diagnostic', { vehicleInfo: 'X' }, 'mauvais-token');
  assert(r.status === 401, 'devrait être 401, reçu ' + r.status);
});

// 5. VIN gratuit (pas de crédit requis)
await test('vin gratuit fonctionne', async () => {
  const r = await call('vin', { vin: 'VF1RFD00000000000' });
  assert(r.status === 200 && r.data.constructeur === 'Renault', 'vin échoué');
});

// 6. Pièces
await test('pieces fonctionne et débite', async () => {
  DB.users[0].credits = 3;
  const r = await call('pieces', { vehicleInfo: 'Clio', partName: 'bougie' });
  assert(r.status === 200 && r.data.pieces.length > 0, 'pieces échoué');
  assert(r.data.creditsLeft === 2, 'crédit non débité');
});

// 7. Alertes
await test('alertes fonctionne', async () => {
  DB.users[0].credits = 3;
  const r = await call('alertes', { vehicleInfo: 'Clio', mileage: '150000' });
  assert(r.status === 200 && r.data.alertes.length > 0, 'alertes échoué');
});

// 8. Chat Dylan — 1 crédit = 15 min
await test('chat Dylan : 1er message débite 1 crédit + ouvre session 15min', async () => {
  DB.users[0].credits = 3;
  DB.users[0].chat_session_start = null;
  const r = await call('chat', { message: 'ma voiture fait du bruit', sessionId: 's1' });
  assert(r.status === 200 && r.data.reply, 'chat échoué');
  assert(r.data.freshSession === true, 'devrait être une nouvelle session');
  assert(r.data.creditsLeft === 2, 'crédit non débité: ' + r.data.creditsLeft);
  assert(r.data.sessionEnds > Date.now(), 'pas de fin de session');
});

await test('chat Dylan : 2e message DANS les 15min est gratuit', async () => {
  // chat_session_start vient d'être mis à maintenant par le test précédent
  const creditsAvant = DB.users[0].credits;
  const r = await call('chat', { message: 'et le voyant orange ?', sessionId: 's1' });
  assert(r.status === 200 && r.data.reply, 'chat échoué');
  assert(r.data.freshSession === false, 'ne devrait PAS rouvrir de session');
  assert(DB.users[0].credits === creditsAvant, 'ne devrait pas débiter dans les 15min');
});

await test('chat Dylan : refusé si 0 crédit et session expirée', async () => {
  DB.users[0].credits = 0;
  DB.users[0].chat_session_start = null; // session expirée
  const r = await call('chat', { message: 'test', sessionId: 's2' });
  assert(r.status === 402, 'devrait être 402, reçu ' + r.status);
});

// 9. Urgence (gratuit, sans login)
await test('urgence gratuite sans login', async () => {
  const r = await call('urgence', { description: 'voyant rouge', vehicleInfo: 'Clio' }, null);
  assert(r.status === 200 && r.data.gravite, 'urgence échouée');
});

// 10. Ajouter voiture
await test('cars_add ajoute un véhicule', async () => {
  const r = await call('cars_add', { car: { marque: 'Renault', modele: 'Clio', annee: '2018', carbu: 'Essence', code_moteur: 'K9K' } });
  assert(r.status === 200 && r.data.car.marque === 'Renault', 'ajout échoué');
});

// 11. Récupérer voitures
await test('cars_get retourne les véhicules', async () => {
  const r = await call('cars_get');
  assert(r.status === 200 && Array.isArray(r.data.cars), 'get échoué');
});

// 12. Code promo
await test('promo WELCOME3 ajoute 3 crédits', async () => {
  DB.users[0].credits = 1;
  const r = await call('promo', { code: 'WELCOME3' });
  assert(r.status === 200 && r.data.credits === 3, 'promo échouée');
});

// 13. Code owner → illimité
await test('owner LOIC2024 active illimité', async () => {
  const r = await call('owner', { code: 'LOIC2024' });
  assert(r.status === 200, 'owner échoué');
  assert(DB.users[0].is_unlimited === true, 'illimité non activé');
});

// 14. Code owner incorrect → refusé
await test('owner code incorrect refusé', async () => {
  const r = await call('owner', { code: 'MAUVAIS' });
  assert(r.status === 400, 'devrait refuser');
});

// 15. Admin stats réservé au propriétaire
await test('admin_stats refusé si pas propriétaire', async () => {
  const r = await call('admin_stats', {}, 'valid-token');
  assert(r.status === 403, 'devrait être 403');
});

await test('admin_stats OK pour le propriétaire', async () => {
  const r = await call('admin_stats', {}, 'owner-token');
  assert(r.status === 200 && Array.isArray(r.data.users), 'admin échoué');
});

// ── RÉSUMÉ ──
console.log('\n════════════════════════════');
console.log(`RÉSULTAT : ${passed} réussis, ${failed} échoués`);
console.log(`Appels Claude simulés : ${claudeCalls}`);
console.log('════════════════════════════');
process.exit(failed > 0 ? 1 : 0);
