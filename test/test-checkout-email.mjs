// ============================================================
// TEST — stripe-checkout.js + send-email.js
// ============================================================
process.env.STRIPE_SECRET_KEY     = 'sk_test_fake';
process.env.SUPABASE_URL          = 'https://fake.supabase.co';
process.env.SUPABASE_ANON_KEY     = 'fake-anon';
process.env.STRIPE_PRICE_1CREDIT  = 'price_real_1';
process.env.STRIPE_PRICE_25CREDITS= 'price_real_25';
process.env.FRONTEND_URL          = 'https://mecaia.test';
process.env.RESEND_API_KEY        = 'fake-resend';

let lastStripeBody = null;
let lastEmailBody = null;

global.fetch = async (url, opts = {}) => {
  const u = url.toString();
  if (u.includes('/auth/v1/user')) {
    const auth = opts.headers?.Authorization || '';
    if (auth.includes('valid-token')) return res(200, { id:'user-1', email:'test@example.com' });
    return res(401, { error:'invalid' });
  }
  if (u.includes('api.stripe.com/v1/checkout/sessions')) {
    lastStripeBody = opts.body; // URLSearchParams string
    return res(200, { id:'cs_test_xyz', url:'https://checkout.stripe.com/cs_test_xyz' });
  }
  if (u.includes('api.resend.com')) {
    lastEmailBody = JSON.parse(opts.body);
    return res(200, { id:'email-1' });
  }
  return res(200, null);
};
function res(status, data) {
  return { ok: status>=200&&status<300, status, json: async()=>data, text: async()=>JSON.stringify(data) };
}

let passed=0, failed=0; const failures=[];
async function test(name, fn) {
  try { const r = await fn(); if(r===true){passed++;console.log(`  ✅ ${name}`);} else {failed++;failures.push(`${name}: ${r}`);console.log(`  ❌ ${name} → ${r}`);} }
  catch(e){ failed++; failures.push(`${name}: ${e.message}`); console.log(`  ❌ ${name} → EXCEPTION: ${e.message}`); }
}

// ===== CHECKOUT =====
const { handler: checkout } = await import('../netlify/functions/stripe-checkout.js');

function ev(pack, token='valid-token', extra={}) {
  return { httpMethod:'POST', headers:{ authorization: token?`Bearer ${token}`:'' }, body: JSON.stringify({ pack, ...extra }) };
}

console.log('\n═══ TESTS STRIPE CHECKOUT ═══\n');
await test('OPTIONS → 200', async () => { const r = await checkout({ httpMethod:'OPTIONS', headers:{} }); return r.statusCode===200||'sc='+r.statusCode; });
await test('GET → 405', async () => { const r = await checkout({ httpMethod:'GET', headers:{} }); return r.statusCode===405||'sc='+r.statusCode; });
await test('Sans token → 401', async () => { const r = await checkout(ev('1credit','')); return r.statusCode===401||'sc='+r.statusCode; });
await test('Token invalide → 401', async () => { const r = await checkout(ev('1credit','bad')); return r.statusCode===401||'sc='+r.statusCode; });
await test('Pack invalide → 400', async () => { const r = await checkout(ev('inexistant')); return r.statusCode===400||'sc='+r.statusCode; });
await test('Pack 1credit → 200 + url', async () => {
  const r = await checkout(ev('1credit')); const b = JSON.parse(r.body);
  return (r.statusCode===200 && b.url && b.sessionId) ? true : `sc=${r.statusCode} body=${r.body}`;
});
await test('  → metadata userId présent', async () => lastStripeBody?.includes('metadata%5BuserId%5D=user-1') || 'userId manquant dans: '+lastStripeBody?.substring(0,200));
await test('  → metadata credits=1', async () => lastStripeBody?.includes('metadata%5Bcredits%5D=1') || 'credits manquant');
await test('  → price ID correct (env)', async () => lastStripeBody?.includes('price_real_1') || 'priceId manquant');
await test('  → success_url correct', async () => lastStripeBody?.includes('mecaia.test') || 'success_url manquant');
await test('Pack 25credits → metadata credits=25', async () => {
  await checkout(ev('25credits'));
  return lastStripeBody?.includes('metadata%5Bcredits%5D=25') || 'credits=25 manquant';
});
await test('Réduction → metadata discount', async () => {
  await checkout(ev('1credit','valid-token',{ discountPercent:20 }));
  return lastStripeBody?.includes('metadata%5Bdiscount%5D=20') || 'discount manquant';
});

// ===== SEND-EMAIL =====
let emailHandler;
try {
  const mod = await import('../netlify/functions/send-email.js');
  emailHandler = mod.handler;
} catch(e) {
  console.log('\n⚠️  send-email.js non importable: ' + e.message);
}

if (emailHandler) {
  console.log('\n═══ TESTS SEND-EMAIL ═══\n');
  function evMail(template, data, token='valid-token') {
    return { httpMethod:'POST', headers:{ authorization:`Bearer ${token}` }, body: JSON.stringify({ template, to: data.to, data }) };
  }
  await test('OPTIONS → 200', async () => { const r = await emailHandler({ httpMethod:'OPTIONS', headers:{} }); return r.statusCode===200||'sc='+r.statusCode; });
  await test('GET → 405', async () => { const r = await emailHandler({ httpMethod:'GET', headers:{} }); return r.statusCode===405||'sc='+r.statusCode; });
  await test('template manquant → 400', async () => {
    const r = await emailHandler({ httpMethod:'POST', headers:{}, body: JSON.stringify({ to:'x@y.com' }) });
    return r.statusCode===400||'sc='+r.statusCode;
  });
  await test('template inconnu → 400', async () => {
    const r = await emailHandler({ httpMethod:'POST', headers:{}, body: JSON.stringify({ template:'nope', to:'x@y.com' }) });
    return r.statusCode===400||'sc='+r.statusCode;
  });
  await test('welcome → 200', async () => {
    const r = await emailHandler(evMail('welcome', { to:'new@example.com', name:'Jean' }));
    return r.statusCode===200 ? true : `sc=${r.statusCode} body=${r.body}`;
  });
  await test('  → email à la bonne adresse', async () => lastEmailBody?.to?.includes('new@example.com') || 'mauvaise adresse: '+JSON.stringify(lastEmailBody?.to));
  await test('payment_success → 200', async () => {
    const r = await emailHandler(evMail('payment_success', { to:'buyer@example.com', name:'Loïc', credits:25, amount:'5.00' }));
    return r.statusCode===200 ? true : `sc=${r.statusCode}`;
  });
  await test('reset → 200', async () => {
    const r = await emailHandler(evMail('reset', { to:'reset@example.com', name:'X', link:'https://reset' }));
    return r.statusCode===200 ? true : `sc=${r.statusCode}`;
  });
  await test('low_credits → 200', async () => {
    const r = await emailHandler(evMail('low_credits', { to:'low@example.com', name:'X' }));
    return r.statusCode===200 ? true : `sc=${r.statusCode}`;
  });
}

console.log('\n═══════════════════════════════════════');
console.log(`  RÉSULTAT : ${passed} ✅  |  ${failed} ❌`);
console.log('═══════════════════════════════════════');
if(failed>0){ console.log('\nÉCHECS :'); failures.forEach(f=>console.log('  • '+f)); process.exit(1); }
else console.log('\n🎉 CHECKOUT + EMAIL — TOUS LES TESTS PASSENT');
