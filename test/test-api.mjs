// ============================================================
// TEST HARNESS — api.js
// Mock toutes les API externes, exécute chaque route réellement
// ============================================================

// --- 1. Variables d'environnement factices ---
process.env.ANTHROPIC_KEY     = 'sk-ant-test-fake';
process.env.SUPABASE_URL      = 'https://fake.supabase.co';
process.env.SUPABASE_ANON = 'fake-anon';
process.env.SUPABASE_SECRET   = 'fake-secret';
process.env.STRIPE_PUBLIC_KEY = 'pk_test_fake';
process.env.OWNER_CODE        = 'LOIC-SECRET-2024';

// --- 2. État simulé de la "base de données" ---
let mockDB = {
  user: { id: 'user-123', email: 'test@example.com', credits: 3, is_unlimited: false },
  decrementCalls: 0,
  incrementCalls: 0,
  diagCountCalls: 0,
  insertedDiags: [],
  insertedCars: [],
  insertedPromos: [],
};

// Permet de reconfigurer le user avant chaque test
function setUser(u) { mockDB.user = { ...mockDB.user, ...u }; }
function resetCounters() {
  mockDB.decrementCalls = 0; mockDB.incrementCalls = 0;
  mockDB.diagCountCalls = 0; mockDB.insertedDiags = []; mockDB.insertedCars = [];
}

// --- 3. MOCK global.fetch ---
global.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  const u = url.toString();

  // --- Supabase Auth : vérifier token ---
  if (u.includes('/auth/v1/user')) {
    const auth = opts.headers?.Authorization || '';
    if (auth.includes('valid-token')) {
      return mockRes(200, mockDB.user);
    }
    if (auth.includes('admin-token')) {
      return mockRes(200, { id: 'owner-1', email: 'loicdeclerck4020@gmail.com' });
    }
    return mockRes(401, { error: 'invalid token' });
  }

  // --- Anthropic Claude ---
  if (u.includes('api.anthropic.com')) {
    const reqBody = JSON.parse(opts.body);
    // Retourner un JSON valide selon le contexte
    let fakeText = '{"code":"P0300","systeme":"Allumage","titre":"Ratés moteur","description":"Test desc","severite":"HAUTE","rouler":true,"causes":["c1"],"etapes":["e1"],"outils":["o1"],"difficulte":2,"pieces":["p1"],"comment_tester":"test","pannes_liees":"none","economie_diy":100,"temps":"1h","mo_min":50,"mo_max":200,"pieces_min":30,"pieces_max":400,"conseil":"conseil","prevention":"prev"}';
    // Pour VIN / urgence / pieces / alertes, le parsing JSON marche aussi (on s'en fiche du contenu exact)
    if (reqBody.system?.includes('VIN'))      fakeText = '{"pays":"France","constructeur":"Renault","modele":"Clio","variante":"","annee":"2018","usine":"","moteur":"","carburant":"","transmission":"","serie":"123"}';
    if (reqBody.system?.includes('urgence'))  fakeText = '{"gravite":"STOP","rouler":false,"message":"msg","action":"action"}';
    if (reqBody.system?.includes('pièces') || reqBody.system?.includes('pieces'))   fakeText = '{"pieces":[{"nom":"Bougie","ref":"NGK123","prix":15}]}';
    if (reqBody.system?.includes('entretien'))fakeText = '{"alertes":[{"type":"Vidange","km":10000,"urgence":"Bientôt"}]}';
    // photo → texte libre (pas JSON)
    if (reqBody.messages?.[0]?.content?.[0]?.type === 'image') fakeText = 'Analyse: bougie usée, à remplacer.';
    return mockRes(200, { content: [{ type: 'text', text: fakeText }] });
  }

  // --- Supabase RPC ---
  if (u.includes('/rpc/decrement_credits')) { mockDB.decrementCalls++; return mockRes(200, null); }
  if (u.includes('/rpc/increment_credits')) { mockDB.incrementCalls++; return mockRes(200, null); }
  if (u.includes('/rpc/increment_diag_count')) { mockDB.diagCountCalls++; return mockRes(200, null); }
  if (u.includes('/rpc/increment_paid')) { return mockRes(200, null); }

  // --- Supabase REST ---
  if (u.includes('/rest/v1/users')) {
    if (method === 'GET') return mockRes(200, [mockDB.user]);
    if (method === 'PATCH') return mockRes(200, null);
  }
  if (u.includes('/rest/v1/cars')) {
    if (method === 'GET')  return mockRes(200, mockDB.insertedCars);
    if (method === 'POST') { const c = JSON.parse(opts.body); mockDB.insertedCars.push(c); return mockRes(201, [c]); }
    if (method === 'DELETE') return mockRes(204, null);
  }
  if (u.includes('/rest/v1/diagnostics')) {
    if (method === 'GET')  return mockRes(200, mockDB.insertedDiags);
    if (method === 'POST') { mockDB.insertedDiags.push(JSON.parse(opts.body)); return mockRes(201, [{ id: 'diag-1' }]); }
    if (method === 'PATCH') return mockRes(204, null);
  }
  if (u.includes('/rest/v1/promo_codes')) {
    if (method === 'GET') {
      // Simuler un code promo valide
      if (u.includes('VALID5')) return mockRes(200, [{ code:'VALID5', type:'credits', credits:5, uses_left:10, uses_total:0, expires_at:null }]);
      if (u.includes('REDUC20')) return mockRes(200, [{ code:'REDUC20', type:'reduction', reduction:20, uses_left:10, uses_total:0, expires_at:null }]);
      if (u.includes('EXPIRED')) return mockRes(200, [{ code:'EXPIRED', type:'credits', credits:5, uses_left:0, uses_total:5, expires_at:null }]);
      return mockRes(200, []); // code inexistant
    }
    if (method === 'POST') { mockDB.insertedPromos.push(JSON.parse(opts.body)); return mockRes(201, [JSON.parse(opts.body)]); }
    if (method === 'PATCH') return mockRes(204, null);
  }
  if (u.includes('/rest/v1/used_promos')) {
    if (method === 'GET')  return mockRes(200, []); // jamais utilisé par défaut
    if (method === 'POST') return mockRes(201, [{}]);
  }
  if (u.includes('/rest/v1/transactions')) {
    return mockRes(200, [{ amount: '10.00', created_at: '2026-01-01' }]);
  }

  // Défaut : 200 vide
  return mockRes(200, null);
};

function mockRes(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => data === null ? '' : JSON.stringify(data),
  };
}

// --- 4. Importer le handler (APRÈS avoir défini env + fetch) ---
const { handler } = await import('../netlify/functions/api.js');

// --- 5. Helpers de test ---
let passed = 0, failed = 0;
const failures = [];

function evPost(action, body = {}, token = 'valid-token') {
  return {
    httpMethod: 'POST',
    headers: { authorization: token ? `Bearer ${token}` : '' },
    body: JSON.stringify({ action, ...body }),
  };
}
function evGet(action, token = null) {
  return {
    httpMethod: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: { action },
  };
}

async function test(name, eventObj, checkFn) {
  try {
    const res = await handler(eventObj);
    const body = res.body ? JSON.parse(res.body) : {};
    const result = checkFn(res, body);
    if (result === true) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; failures.push(`${name}: ${result}`); console.log(`  ❌ ${name} → ${result}`); }
  } catch (e) {
    failed++; failures.push(`${name}: EXCEPTION ${e.message}`);
    console.log(`  ❌ ${name} → EXCEPTION: ${e.message}`);
  }
}

// ============================================================
// BATTERIE DE TESTS
// ============================================================
console.log('\n═══ TESTS API.JS ═══\n');

console.log('— Routes système —');
await test('OPTIONS → 200', { httpMethod:'OPTIONS', headers:{} }, (r) => r.statusCode === 200 || 'statusCode='+r.statusCode);
await test('GET config → 3 clés', evGet('config'), (r,b) =>
  (b.supabaseUrl && b.supabaseAnonKey && b.stripePublicKey) ? true : 'manque clé: '+JSON.stringify(b));
await test('GET inconnu → 404', evGet('nimporte'), (r) => r.statusCode === 404 || 'statusCode='+r.statusCode);
await test('POST body invalide → 400', { httpMethod:'POST', headers:{}, body:'pas du json' }, (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);
await test('PUT → 405', { httpMethod:'PUT', headers:{}, body:'{}' }, (r) => r.statusCode === 405 || 'statusCode='+r.statusCode);
await test('action inconnue → 404', evPost('xyz'), (r) => r.statusCode === 404 || 'statusCode='+r.statusCode);

console.log('\n— Authentification —');
await test('diagnostic sans token → 401', evPost('diagnostic', { vehicleInfo:'Clio' }, ''), (r) => r.statusCode === 401 || 'statusCode='+r.statusCode);
await test('diagnostic token invalide → 401', evPost('diagnostic', {}, 'bad-token'), (r) => r.statusCode === 401 || 'statusCode='+r.statusCode);
await test('cars_get sans token → 401', evPost('cars_get', {}, ''), (r) => r.statusCode === 401 || 'statusCode='+r.statusCode);

console.log('\n— Diagnostic (crédits) —');
setUser({ credits: 3, is_unlimited: false }); resetCounters();
await test('diagnostic OK → renvoie creditsLeft', evPost('diagnostic', { vehicleInfo:'Clio 2018', code:'P0300' }), (r,b) =>
  (r.statusCode === 200 && b.creditsLeft === 2 && b.titre) ? true : `statusCode=${r.statusCode} creditsLeft=${b.creditsLeft}`);
await test('  → 1 décrément effectué', {}, () => mockDB.decrementCalls === 1 || `décréments=${mockDB.decrementCalls}`);
await test('  → diagnostic sauvegardé', {}, () => mockDB.insertedDiags.length === 1 || `diags=${mockDB.insertedDiags.length}`);
await test('  → compteur diag incrémenté', {}, () => mockDB.diagCountCalls === 1 || `diagCount=${mockDB.diagCountCalls}`);

setUser({ credits: 0, is_unlimited: false }); resetCounters();
await test('diagnostic SANS crédit → 402', evPost('diagnostic', { vehicleInfo:'Clio' }), (r) => r.statusCode === 402 || 'statusCode='+r.statusCode);
await test('  → AUCUN décrément (refusé avant)', {}, () => mockDB.decrementCalls === 0 || `décréments=${mockDB.decrementCalls}`);

setUser({ credits: 0, is_unlimited: true }); resetCounters();
await test('diagnostic ILLIMITÉ → 200 sans décrément', evPost('diagnostic', { vehicleInfo:'Clio' }), (r,b) =>
  (r.statusCode === 200 && mockDB.decrementCalls === 0) ? true : `statusCode=${r.statusCode} décréments=${mockDB.decrementCalls}`);

console.log('\n— VIN (gratuit) —');
await test('vin valide → 200', evPost('vin', { vin:'VF1JZS0AE51140932' }), (r,b) =>
  (r.statusCode === 200 && b.constructeur) ? true : `statusCode=${r.statusCode}`);
await test('vin trop court → 400', evPost('vin', { vin:'AB' }), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);
setUser({ credits: 0, is_unlimited: false }); resetCounters();
await test('vin SANS crédit → marche quand même (gratuit)', evPost('vin', { vin:'VF1JZS0AE51140932' }), (r) =>
  r.statusCode === 200 || 'statusCode='+r.statusCode);
await test('  → aucun décrément (gratuit)', {}, () => mockDB.decrementCalls === 0 || `décréments=${mockDB.decrementCalls}`);

console.log('\n— Photo (la route qui était cassée) —');
setUser({ credits: 3, is_unlimited: false }); resetCounters();
await test('photo POST OK → 200 + analyse', evPost('photo', { imageBase64:'fakedata', imageMime:'image/jpeg' }), (r,b) =>
  (r.statusCode === 200 && b.analyse && b.creditsLeft === 2) ? true : `statusCode=${r.statusCode} analyse=${!!b.analyse} creditsLeft=${b.creditsLeft}`);
await test('  → 1 décrément', {}, () => mockDB.decrementCalls === 1 || `décréments=${mockDB.decrementCalls}`);
await test('photo sans image → 400', evPost('photo', {}), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);
await test('photo sans token → 401', evPost('photo', { imageBase64:'x' }, ''), (r) => r.statusCode === 401 || 'statusCode='+r.statusCode);

console.log('\n— Urgence (gratuit) —');
await test('urgence OK → 200', evPost('urgence', { description:'voyant rouge' }), (r,b) =>
  (r.statusCode === 200 && b.gravite) ? true : `statusCode=${r.statusCode}`);
await test('urgence sans description → 400', evPost('urgence', {}), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);

console.log('\n— Pièces (crédit) —');
setUser({ credits: 3, is_unlimited: false }); resetCounters();
await test('pieces OK → 200', evPost('pieces', { vehicleInfo:'Clio', partName:'bougie' }), (r,b) =>
  r.statusCode === 200 ? true : `statusCode=${r.statusCode} body=${JSON.stringify(b)}`);

console.log('\n— Alertes (crédit) —');
setUser({ credits: 3, is_unlimited: false }); resetCounters();
await test('alertes OK → 200', evPost('alertes', { vehicleInfo:'Clio', mileage:'150000' }), (r,b) =>
  r.statusCode === 200 ? true : `statusCode=${r.statusCode} body=${JSON.stringify(b)}`);

console.log('\n— Garage (CRUD) —');
setUser({ credits: 3 }); resetCounters();
await test('cars_add OK → 200', evPost('cars_add', { car:{ marque:'Renault', modele:'Clio', annee:'2018' } }), (r,b) =>
  r.statusCode === 200 ? true : `statusCode=${r.statusCode}`);
await test('cars_add incomplet → 400', evPost('cars_add', { car:{ marque:'Renault' } }), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);
await test('cars_get OK → 200 array', evPost('cars_get', {}), (r,b) =>
  (r.statusCode === 200 && Array.isArray(b.cars)) ? true : `statusCode=${r.statusCode}`);
await test('cars_delete OK → 200', evPost('cars_delete', { carId:'car-1' }), (r) => r.statusCode === 200 || 'statusCode='+r.statusCode);

console.log('\n— Historique —');
await test('history OK → 200 array', evPost('history', {}), (r,b) =>
  (r.statusCode === 200 && Array.isArray(b.history)) ? true : `statusCode=${r.statusCode}`);
await test('history_fav OK → 200', evPost('history_fav', { diagId:'d1', isFav:true }), (r) => r.statusCode === 200 || 'statusCode='+r.statusCode);

console.log('\n— Profile —');
await test('profile OK → 200', evPost('profile', {}), (r,b) =>
  (r.statusCode === 200 && b.profile) ? true : `statusCode=${r.statusCode}`);

console.log('\n— Promo —');
setUser({ credits: 3 }); resetCounters();
await test('promo VALID5 → 200 + 5 crédits', evPost('promo', { code:'VALID5' }), (r,b) =>
  (r.statusCode === 200 && b.type === 'credits' && b.credits === 5) ? true : `statusCode=${r.statusCode} body=${JSON.stringify(b)}`);
await test('  → increment_credits appelé', {}, () => mockDB.incrementCalls === 1 || `increments=${mockDB.incrementCalls}`);
await test('promo REDUC20 → 200 + réduction', evPost('promo', { code:'REDUC20' }), (r,b) =>
  (r.statusCode === 200 && b.type === 'reduction' && b.value === 20) ? true : `statusCode=${r.statusCode} body=${JSON.stringify(b)}`);
await test('promo EXPIRED → 400', evPost('promo', { code:'EXPIRED' }), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);
await test('promo INEXISTANT → 400', evPost('promo', { code:'NOPE99' }), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);
await test('promo sans code → 400', evPost('promo', {}), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);

console.log('\n— Owner (code illimité) —');
await test('owner bon code → 200', evPost('owner', { code:'LOIC-SECRET-2024' }), (r) => r.statusCode === 200 || 'statusCode='+r.statusCode);
await test('owner mauvais code → 400', evPost('owner', { code:'WRONG' }), (r) => r.statusCode === 400 || 'statusCode='+r.statusCode);

console.log('\n— Admin (sécurité) —');
await test('admin_stats user normal → 403', evPost('admin_stats', {}, 'valid-token'), (r) => r.statusCode === 403 || 'statusCode='+r.statusCode);
await test('admin_stats owner → 200', evPost('admin_stats', {}, 'admin-token'), (r,b) =>
  (r.statusCode === 200 && b.totalRevenue !== undefined) ? true : `statusCode=${r.statusCode}`);
await test('gen_promo user normal → 403', evPost('gen_promo', {}, 'valid-token'), (r) => r.statusCode === 403 || 'statusCode='+r.statusCode);
await test('gen_promo owner → 200 + code', evPost('gen_promo', { type:'credits', credits:10 }, 'admin-token'), (r,b) =>
  (r.statusCode === 200 && b.code) ? true : `statusCode=${r.statusCode}`);

// ============================================================
// RÉSULTAT
// ============================================================
console.log('\n═══════════════════════════════════════');
console.log(`  RÉSULTAT : ${passed} ✅  |  ${failed} ❌`);
console.log('═══════════════════════════════════════');
if (failed > 0) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log('  • ' + f));
  process.exit(1);
} else {
  console.log('\n🎉 TOUS LES TESTS PASSENT');
}
