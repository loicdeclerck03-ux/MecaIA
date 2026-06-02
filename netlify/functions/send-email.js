// netlify/functions/send-email.js
// ============================================================
// EMAILS MECAIA — Templates Resend
// ============================================================

const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = 'MecaIA <noreply@mecaia.be>';
const SITE_URL     = process.env.FRONTEND_URL || 'https://euphonious-frangollo-da0cc1.netlify.app';

const headers = {
  'Content-Type'                : 'application/json',
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// ============================================================
// STYLES COMMUNS
// ============================================================
const baseStyle = `
  font-family: 'Arial', sans-serif;
  background: #080b0f;
  color: #c8d4e0;
  padding: 0;
  margin: 0;
`;

const wrapStyle = `
  max-width: 520px;
  margin: 30px auto;
  background: #0f1318;
  border: 1px solid #1e2a3a;
  border-radius: 14px;
  overflow: hidden;
`;

function header() {
  return `
    <div style="background:#0f1318;padding:24px 30px;border-bottom:1px solid #1e2a3a;text-align:center">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <div style="width:38px;height:38px;background:#f0a500;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:20px">⚙</div>
        <span style="font-size:22px;font-weight:700;letter-spacing:3px;color:#fff">MECA<span style="color:#f0a500">IA</span></span>
      </div>
    </div>`;
}

function footer() {
  return `
    <div style="background:#080b0f;padding:18px 30px;text-align:center;border-top:1px solid #1e2a3a">
      <p style="color:#2a3548;font-size:11px;margin:0">MecaIA · Loïc Declerck · Belgique 🇧🇪</p>
      <p style="color:#2a3548;font-size:10px;margin:4px 0 0">loicdeclerck4020@gmail.com · <a href="${SITE_URL}" style="color:#f0a500;text-decoration:none">${SITE_URL}</a></p>
    </div>`;
}

// ============================================================
// TEMPLATES
// ============================================================

function tplWelcome({ name, credits = 3, promoCode }) {
  return `<!DOCTYPE html><html><body style="${baseStyle}">
<div style="${wrapStyle}">
  ${header()}
  <div style="padding:30px">
    <h2 style="color:#fff;font-size:22px;margin:0 0 8px">Bienvenue sur MecaIA, ${name} ! 🔧</h2>
    <p style="color:#4a5a6e;font-size:14px;margin:0 0 20px;line-height:1.7">
      Ton compte est prêt. Tu as <strong style="color:#f0a500">${credits} crédits gratuits</strong> pour commencer.
    </p>
    <div style="background:#151a21;border:1px solid #1e2a3a;border-radius:10px;padding:20px;margin-bottom:20px">
      <div style="display:grid;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">⚡</span>
          <div><strong style="color:#fff;font-size:13px">Diagnostic IA ultra rapide</strong><br><span style="color:#4a5a6e;font-size:12px">Code OBD, symptôme ou photo → rapport expert en 10s</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🚗</span>
          <div><strong style="color:#fff;font-size:13px">Garage virtuel</strong><br><span style="color:#4a5a6e;font-size:12px">Sauvegarde tes véhicules, suivi kilométrage</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🔍</span>
          <div><strong style="color:#fff;font-size:13px">Décodeur VIN gratuit</strong><br><span style="color:#4a5a6e;font-size:12px">Décode l'historique complet de ton véhicule</span></div>
        </div>
      </div>
    </div>
    ${promoCode ? `
    <div style="background:rgba(240,165,0,0.08);border:1px solid rgba(240,165,0,0.25);border-radius:8px;padding:14px;text-align:center;margin-bottom:20px">
      <div style="color:#4a5a6e;font-size:11px;margin-bottom:5px;letter-spacing:1px">TON CODE PARRAINAGE</div>
      <div style="color:#f0a500;font-size:20px;font-weight:700;letter-spacing:3px">${promoCode}</div>
      <div style="color:#4a5a6e;font-size:11px;margin-top:5px">Partage-le · tes amis reçoivent des crédits bonus</div>
    </div>` : ''}
    <div style="text-align:center">
      <a href="${SITE_URL}" style="display:inline-block;background:#f0a500;color:#000;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1.5px">OUVRIR MECAIA →</a>
    </div>
  </div>
  ${footer()}
</div></body></html>`;
}

function tplReset({ name, resetUrl }) {
  return `<!DOCTYPE html><html><body style="${baseStyle}">
<div style="${wrapStyle}">
  ${header()}
  <div style="padding:30px">
    <h2 style="color:#fff;font-size:20px;margin:0 0 8px">Réinitialisation mot de passe</h2>
    <p style="color:#4a5a6e;font-size:14px;margin:0 0 20px;line-height:1.7">
      Bonjour ${name},<br>
      Tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton ci-dessous.
    </p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${resetUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1px">RÉINITIALISER MON MOT DE PASSE →</a>
    </div>
    <p style="color:#2a3548;font-size:12px;text-align:center">Ce lien expire dans 24 heures.<br>Si tu n'as pas fait cette demande, ignore cet email.</p>
  </div>
  ${footer()}
</div></body></html>`;
}

function tplPaymentSuccess({ name, credits, amount, packName }) {
  const isUnlimited = credits === 999;
  return `<!DOCTYPE html><html><body style="${baseStyle}">
<div style="${wrapStyle}">
  ${header()}
  <div style="padding:30px">
    <h2 style="color:#fff;font-size:20px;margin:0 0 6px;text-align:center">✅ Paiement confirmé !</h2>
    <p style="color:#4a5a6e;font-size:14px;text-align:center;margin:0 0 24px">Merci ${name}, tes crédits sont actifs immédiatement.</p>
    <div style="background:#151a21;border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
      <div style="font-size:56px;font-weight:700;color:#10b981;line-height:1">${isUnlimited ? '∞' : '+' + credits}</div>
      <div style="color:#4a5a6e;font-size:12px;margin-top:6px">${isUnlimited ? 'Accès illimité 30 jours' : credits + ' crédits MecaIA'}</div>
      <div style="color:#2a3548;font-size:11px;margin-top:4px">Montant payé : <strong style="color:#f0a500">${amount}€</strong></div>
    </div>
    <div style="background:#080b0f;border-radius:8px;padding:14px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1e2a3a;font-size:12px"><span style="color:#4a5a6e">Pack</span><span style="color:#fff">${packName}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1e2a3a;font-size:12px"><span style="color:#4a5a6e">Crédits</span><span style="color:#10b981">${isUnlimited ? 'Illimité' : credits}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700"><span style="color:#fff">Total</span><span style="color:#f0a500">${amount}€</span></div>
    </div>
    <div style="text-align:center">
      <a href="${SITE_URL}" style="display:inline-block;background:#f0a500;color:#000;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1.5px">UTILISER MES CRÉDITS →</a>
    </div>
  </div>
  ${footer()}
</div></body></html>`;
}

function tplLowCredits({ name, credits }) {
  return `<!DOCTYPE html><html><body style="${baseStyle}">
<div style="${wrapStyle}">
  ${header()}
  <div style="padding:30px">
    <h2 style="color:#fff;font-size:20px;margin:0 0 8px">⚠️ Plus que ${credits} crédit${credits > 1 ? 's' : ''} restant${credits > 1 ? 's' : ''}</h2>
    <p style="color:#4a5a6e;font-size:14px;margin:0 0 20px;line-height:1.7">
      Bonjour ${name}, ton solde MecaIA est presque épuisé.<br>
      Recharge maintenant pour continuer à diagnostiquer.
    </p>
    <div style="text-align:center;margin-bottom:20px">
      <div style="background:#151a21;border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:20px;display:inline-block">
        <div style="font-size:44px;font-weight:700;color:#f0a500">${credits}</div>
        <div style="color:#4a5a6e;font-size:12px">crédit${credits > 1 ? 's' : ''} restant${credits > 1 ? 's' : ''}</div>
      </div>
    </div>
    <div style="display:grid;gap:8px;margin-bottom:20px">
      <div style="background:#151a21;border:1px solid #1e2a3a;border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="color:#fff;font-size:13px;font-weight:600">25 crédits</div><div style="color:#4a5a6e;font-size:11px">0,20€/utilisation</div></div>
        <div style="color:#f0a500;font-weight:700;font-size:16px">5€</div>
      </div>
      <div style="background:#151a21;border:1px solid rgba(240,165,0,0.3);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="color:#fff;font-size:13px;font-weight:600">60 crédits ⭐ Meilleure valeur</div><div style="color:#4a5a6e;font-size:11px">0,17€/utilisation</div></div>
        <div style="color:#f0a500;font-weight:700;font-size:16px">10€</div>
      </div>
    </div>
    <div style="text-align:center">
      <a href="${SITE_URL}" style="display:inline-block;background:#f0a500;color:#000;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1.5px">RECHARGER MES CRÉDITS →</a>
    </div>
  </div>
  ${footer()}
</div></body></html>`;
}

// ============================================================
// HANDLER (route interne appelée par les autres functions)
// ============================================================
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body invalide' }) }; }

  const { template, to, data } = body;
  if (!template || !to) return { statusCode: 400, headers, body: JSON.stringify({ error: 'template et to requis' }) };

  const templates = { welcome: tplWelcome, reset: tplReset, payment_success: tplPaymentSuccess, low_credits: tplLowCredits };
  const subjects  = {
    welcome        : `🔧 Bienvenue sur MecaIA !`,
    reset          : `🔑 Réinitialise ton mot de passe MecaIA`,
    payment_success: `✅ Paiement confirmé — Crédits ajoutés !`,
    low_credits    : `⚠️ Plus que ${data?.credits} crédit(s) sur MecaIA`
  };

  const tplFn = templates[template];
  if (!tplFn) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Template inconnu' }) };

  try {
    const html = tplFn(data || {});
    const res  = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body   : JSON.stringify({ from: FROM_EMAIL, to: [to], subject: subjects[template], html })
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error.message);
    return { statusCode: 200, headers, body: JSON.stringify({ sent: true, id: result.id }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}

// Export pour usage dans d'autres functions
export async function sendEmailInternal(template, to, data) {
  const templates = { welcome: tplWelcome, reset: tplReset, payment_success: tplPaymentSuccess, low_credits: tplLowCredits };
  const subjects  = {
    welcome        : `🔧 Bienvenue sur MecaIA !`,
    reset          : `🔑 Réinitialise ton mot de passe MecaIA`,
    payment_success: `✅ Paiement confirmé — Crédits ajoutés !`,
    low_credits    : `⚠️ Plus que ${data?.credits} crédit(s) sur MecaIA`
  };
  try {
    const html = templates[template](data || {});
    await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body   : JSON.stringify({ from: FROM_EMAIL, to: [to], subject: subjects[template], html })
    });
  } catch (e) { console.error('Email error:', e.message); }
}
