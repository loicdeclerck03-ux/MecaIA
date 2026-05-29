// ============================================================
// 📧 MECAIA — EMAILS RESEND
// Envoi d'emails automatiques (bienvenue, etc.)
// ============================================================

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const SITE_URL = 'https://euphonious-frangollo-da0cc1.netlify.app';

// Templates emails
const TEMPLATES = {
  bienvenue: (name) => ({
    subject: '🔧 Bienvenue sur MecaIA !',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px;background:#080b0f;color:#c8d4e0;border-radius:12px">
        <h1 style="color:#f0a500;font-size:32px;margin:0 0 20px">⚙️ MECA<span style="color:#fff">IA</span></h1>
        <h2 style="color:#fff">Salut ${name || ''} !</h2>
        <p>Bienvenue dans la famille MecaIA. Je suis <strong style="color:#f0a500">Dylan</strong>, ton mécano IA.</p>
        <p>Tu as <strong style="color:#10b981">3 crédits offerts</strong> pour commencer. Avec ça, tu peux :</p>
        <ul style="line-height:1.8">
          <li>🔧 Faire 3 diagnostics complets</li>
          <li>🔍 Décoder ton VIN <strong>gratuitement</strong> (toujours)</li>
          <li>🚨 Utiliser le SOS "C'est grave docteur ?"</li>
        </ul>
        <p style="margin:30px 0;text-align:center">
          <a href="${SITE_URL}" style="background:#f0a500;color:#000;padding:15px 30px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;letter-spacing:1px">DÉMARRER UN DIAGNOSTIC</a>
        </p>
        <hr style="border-color:#1e2a3a;margin:30px 0">
        <p style="color:#4a5a6e;font-size:12px">Je suis honnête : je peux me tromper, je te donne toujours un % de confiance. Pour les pannes critiques, fais vérifier par un mécano.</p>
        <p style="color:#4a5a6e;font-size:12px;margin-top:20px">MecaIA - Créé par Loïc Declerck (Mécano belge) - <a href="${SITE_URL}" style="color:#f0a500">euphonious-frangollo-da0cc1.netlify.app</a></p>
      </div>
    `
  }),
  
  reset_password: (resetLink) => ({
    subject: '🔐 Réinitialisation de ton mot de passe MecaIA',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px;background:#080b0f;color:#c8d4e0;border-radius:12px">
        <h1 style="color:#f0a500">🔧 MecaIA</h1>
        <h2 style="color:#fff">Réinitialisation de mot de passe</h2>
        <p>Tu as demandé à réinitialiser ton mot de passe. Clique ci-dessous :</p>
        <p style="margin:30px 0;text-align:center">
          <a href="${resetLink}" style="background:#f0a500;color:#000;padding:15px 30px;text-decoration:none;border-radius:6px;font-weight:bold">RÉINITIALISER</a>
        </p>
        <p style="color:#4a5a6e;font-size:12px">Si tu n'as pas demandé ça, ignore ce mail.</p>
      </div>
    `
  })
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { to, template, data } = JSON.parse(event.body);
    
    if (!to || !template) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Champs requis manquants' }) };
    }
    
    if (!process.env.RESEND_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resend non configuré' }) };
    }
    
    const templateFn = TEMPLATES[template];
    if (!templateFn) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Template inconnu' }) };
    }
    
    const { subject, html } = templateFn(data?.name || data?.resetLink || '');
    
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MecaIA <onboarding@resend.dev>',
        to: [to],
        subject,
        html
      })
    });
    
    const result = await resp.json();
    
    if (result.error) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: result.error }) };
    }
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: result.id }) };
    
  } catch (error) {
    console.error('Email error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
