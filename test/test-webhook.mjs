// ============================================================
// TEST HARNESS — stripe-webhook.js
// Calcule de vraies signatures HMAC SHA256
// ============================================================
import { webcrypto as crypto } from 'node:crypto';

process.env.STRIPE_SECRET_KEY     = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_123';
process.env.SUPABASE_URL          = 'https://fake.supabase.co';
process.env.SUPABASE_SECRET       = 'fake-secret';
process.env.RESEND_API_KEY        = 'fake-resend';

let mockDB = {
  existingTransactions: [],  // pour tester déduplication
  incrementCalls: 0,
  paidCalls: 0,
  unlimitedSet: false,
  insertedTransactions: [],
  emailsSent: [],
};
function reset() {
  mockDB.incrementCalls = 0; mockDB.paidCalls = 0; mockDB.unlimitedSet = false;
  mockDB.insertedTransactions = []; mockDB.emailsSent = [];
}

global.fetch = async (url, opts = {}) => {
  const u = url.toString(); const method = opts.method || 'GET';
  if (u.includes('/rpc/increment_credits')) { mockDB.incrementCalls++; return res(200, null); }
  if (u.includes('/rpc/increment_paid'))    { mockDB.paidCalls++; return res(200, null); }
  if (u.includes('api.resend.com'))         { mockDB.emailsSent.push(JSON.parse(opts.body)); return res(200, {id:'email-1'}); }
  if (u.includes('/rest/v1/transactions')) {
    if (method === 'GET') {
      // Déduplication : si on cherche une session déjà existante
      const match = mockDB.existingTransactions.find(s => u.includes(s));
      return res(200, match ? [{ id:'tx-existing' }] : []);
    }
    if (method === 'POST') { mockDB.insertedTransactions.push(JSON.parse(opts.body)); return res(201, [{id:'tx-1'}]); }
    if (method === 'PATCH') return res(204, null);
  }
  if (u.includes('/rest/v1/users')) {
    if (method === 'GET')   return res(200, [{ email:'test@example.com', name:'Loïc' }]);
    if (method === 'PATCH') { if(JSON.parse(opts.body).is_unlimited) mockDB.unlimitedSet = true; return res(204, null); }
  }
  return res(200, null);
};
function res(status, data) {
  return { ok: status>=200&&status<300, status, json: async()=>data, text: async()=>data===null?'':JSON.stringify(data) };
}

// Calculer une signature Stripe valide
async function signStripe(payload, secret, timestamp) {
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const sig = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
  return `t=${timestamp},v1=${sig}`;
}

const { handler } = await import('../netlify/functions/stripe-webhook.js');

let passed=0, failed=0; const failures=[];
async function test(name, fn) {
  try { const r = await fn(); if(r===true){passed++;console.log(`  ✅ ${name}`);} else {failed++;failures.push(`${name}: ${r}`);console.log(`  ❌ ${name} → ${r}`);} }
  catch(e){ failed++; failures.push(`${name}: EXCEPTION ${e.message}`); console.log(`  ❌ ${name} → EXCEPTION: ${e.message}`); }
}

const now = Math.floor(Date.now()/1000);
function makeEvent(payloadObj, sig) {
  return { httpMethod:'POST', headers:{ 'stripe-signature': sig }, body: JSON.stringify(payloadObj) };
}
const validPayment = {
  type: 'checkout.session.completed',
  data: { object: { id:'cs_test_123', metadata:{ userId:'user-1', credits:'25', pack:'25credits', amount:'5.00' } } }
};

console.log('\n═══ TESTS STRIPE WEBHOOK ═══\n');

console.log('— Sécurité signature —');
await test('GET → 405', async () => {
  const r = await handler({ httpMethod:'GET', headers:{} }); return r.statusCode===405 || 'sc='+r.statusCode;
});
await test('Sans signature → 400', async () => {
  const r = await handler({ httpMethod:'POST', headers:{}, body:'{}' }); return r.statusCode===400 || 'sc='+r.statusCode;
});
await test('Signature invalide → 400', async () => {
  const r = await handler(makeEvent(validPayment, 't=' + now + ',v1=deadbeef')); return r.statusCode===400 || 'sc='+r.statusCode;
});
await test('Signature valide → 200', async () => {
  reset();
  const payload = JSON.stringify(validPayment);
  const sig = await signStripe(payload, 'whsec_test_secret_123', now);
  const r = await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return r.statusCode===200 || 'sc='+r.statusCode;
});
await test('REPLAY attack (timestamp vieux 10min) → 400', async () => {
  const oldTs = now - 600; // 10 minutes
  const payload = JSON.stringify(validPayment);
  const sig = await signStripe(payload, 'whsec_test_secret_123', oldTs);
  const r = await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return r.statusCode===400 || 'sc='+r.statusCode;
});
await test('Mauvais secret → 400', async () => {
  const payload = JSON.stringify(validPayment);
  const sig = await signStripe(payload, 'whsec_WRONG_secret', now);
  const r = await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return r.statusCode===400 || 'sc='+r.statusCode;
});

console.log('\n— Traitement paiement —');
await test('Paiement 25 crédits → increment appelé', async () => {
  reset();
  const payload = JSON.stringify(validPayment);
  const sig = await signStripe(payload, 'whsec_test_secret_123', now);
  await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return mockDB.incrementCalls===1 || `increments=${mockDB.incrementCalls}`;
});
await test('  → transaction sauvegardée', async () => mockDB.insertedTransactions.length===1 || `tx=${mockDB.insertedTransactions.length}`);
await test('  → total_paid mis à jour', async () => mockDB.paidCalls===1 || `paid=${mockDB.paidCalls}`);
await test('  → email envoyé', async () => mockDB.emailsSent.length===1 || `emails=${mockDB.emailsSent.length}`);
await test('  → PAS unlimited (pack normal)', async () => mockDB.unlimitedSet===false || 'unlimited activé à tort');

await test('Métadonnées manquantes → 400', async () => {
  reset();
  const bad = { type:'checkout.session.completed', data:{ object:{ id:'cs_bad', metadata:{} } } };
  const payload = JSON.stringify(bad);
  const sig = await signStripe(payload, 'whsec_test_secret_123', now);
  const r = await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return r.statusCode===400 || 'sc='+r.statusCode;
});

console.log('\n— Pack illimité —');
await test('Pack 999 → is_unlimited activé', async () => {
  reset();
  const unlim = { type:'checkout.session.completed', data:{ object:{ id:'cs_unlim', metadata:{ userId:'user-1', credits:'999', pack:'unlimited', amount:'15.00' } } } };
  const payload = JSON.stringify(unlim);
  const sig = await signStripe(payload, 'whsec_test_secret_123', now);
  await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return mockDB.unlimitedSet===true || 'unlimited PAS activé';
});

console.log('\n— Déduplication (anti double-crédit) —');
await test('Session déjà traitée → 200 sans re-créditer', async () => {
  reset();
  mockDB.existingTransactions = ['cs_test_123']; // simuler session déjà en base
  const payload = JSON.stringify(validPayment);
  const sig = await signStripe(payload, 'whsec_test_secret_123', now);
  const r = await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  const noDouble = mockDB.incrementCalls === 0;
  mockDB.existingTransactions = [];
  return (r.statusCode===200 && noDouble) ? true : `sc=${r.statusCode} increments=${mockDB.incrementCalls}`;
});

console.log('\n— Remboursement —');
await test('charge.refunded → 200', async () => {
  const refund = { type:'charge.refunded', data:{ object:{ id:'ch_1', payment_intent:'pi_1', amount_refunded:500 } } };
  const payload = JSON.stringify(refund);
  const sig = await signStripe(payload, 'whsec_test_secret_123', now);
  const r = await handler({ httpMethod:'POST', headers:{'stripe-signature':sig}, body:payload });
  return r.statusCode===200 || 'sc='+r.statusCode;
});

console.log('\n═══════════════════════════════════════');
console.log(`  RÉSULTAT : ${passed} ✅  |  ${failed} ❌`);
console.log('═══════════════════════════════════════');
if(failed>0){ console.log('\nÉCHECS :'); failures.forEach(f=>console.log('  • '+f)); process.exit(1); }
else console.log('\n🎉 WEBHOOK STRIPE — TOUS LES TESTS PASSENT');
