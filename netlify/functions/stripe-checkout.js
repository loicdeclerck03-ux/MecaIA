// ============================================================
// 💳 MECAIA — STRIPE CHECKOUT
// Crée une session de paiement Stripe sécurisée
// ============================================================

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Mapping pack → Price ID Stripe
const PACK_TO_PRICE = {
  1: { priceId: process.env.STRIPE_PRICE_1EUR, credits: 1, name: '1 crédit' },
  25: { priceId: process.env.STRIPE_PRICE_5EUR, credits: 25, name: 'Pack 25 crédits' },
  60: { priceId: process.env.STRIPE_PRICE_10EUR, credits: 60, name: 'Pack 60 crédits' },
  999: { priceId: process.env.STRIPE_PRICE_15EUR, credits: 999, name: 'Illimité 30 jours' }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { credits, userId, userEmail, returnUrl } = JSON.parse(event.body);
    
    const pack = PACK_TO_PRICE[credits];
    if (!pack || !pack.priceId) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Pack inconnu' }) 
      };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: 'Stripe non configuré' }) 
      };
    }

    // Création de la session via API Stripe directe (sans SDK pour rester léger)
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price]', pack.priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', `${returnUrl || 'https://euphonious-frangollo-da0cc1.netlify.app'}?payment=success&credits=${credits}`);
    params.append('cancel_url', `${returnUrl || 'https://euphonious-frangollo-da0cc1.netlify.app'}?payment=cancel`);
    
    if (userEmail) {
      params.append('customer_email', userEmail);
    }
    
    // Metadata pour identifier l'user au webhook
    if (userId) params.append('metadata[userId]', userId);
    params.append('metadata[credits]', credits.toString());
    params.append('metadata[packName]', pack.name);

    const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeResp.json();
    
    if (session.error) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: session.error.message }) 
      };
    }
    
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        url: session.url,
        sessionId: session.id
      }) 
    };
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
