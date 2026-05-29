// ============================================================
// 💳 MECAIA — STRIPE WEBHOOK
// Reçoit les confirmations de paiement et ajoute les crédits
// ============================================================

const crypto = require('crypto');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Vérification signature Stripe (sécurité)
function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  try {
    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
    const sig = parts.find(p => p.startsWith('v1='))?.split('=')[1];
    
    if (!timestamp || !sig) return false;
    
    const signedPayload = `${timestamp}.${payload}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const signature = event.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    // Vérification de la signature (sécurité critique)
    if (webhookSecret && !verifyStripeSignature(event.body, signature, webhookSecret)) {
      console.warn('Stripe webhook signature invalid');
      return { 
        statusCode: 401, 
        headers, 
        body: JSON.stringify({ error: 'Invalid signature' }) 
      };
    }

    const stripeEvent = JSON.parse(event.body);
    
    // On traite UNIQUEMENT les paiements complétés
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const userId = session.metadata?.userId;
      const credits = parseInt(session.metadata?.credits || '0');
      const amountPaid = (session.amount_total || 0) / 100; // en €
      const customerEmail = session.customer_email || session.customer_details?.email;
      
      console.log(`Paiement reçu: ${amountPaid}€ pour ${credits} crédits, user: ${userId || customerEmail}`);
      
      // 1. Mettre à jour les crédits dans Supabase
      if (userId && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET) {
        try {
          // Récupérer les crédits actuels
          const getUser = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=credits,totalPaid`, {
            headers: {
              'apikey': process.env.SUPABASE_SECRET,
              'Authorization': `Bearer ${process.env.SUPABASE_SECRET}`
            }
          });
          
          const users = await getUser.json();
          
          if (users && users.length > 0) {
            const user = users[0];
            const newCredits = credits === 999 ? 999 : (user.credits || 0) + credits;
            const newTotalPaid = (user.totalPaid || 0) + amountPaid;
            
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
              method: 'PATCH',
              headers: {
                'apikey': process.env.SUPABASE_SECRET,
                'Authorization': `Bearer ${process.env.SUPABASE_SECRET}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                credits: newCredits,
                totalPaid: newTotalPaid
              })
            });
          }
        } catch (e) {
          console.error('Supabase update error:', e);
        }
      }
      
      // 2. Envoyer email de confirmation via Resend
      if (customerEmail && process.env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'MecaIA <onboarding@resend.dev>',
              to: customerEmail,
              subject: `✅ Paiement confirmé - ${credits === 999 ? 'Illimité' : credits + ' crédits'} ajoutés`,
              html: `
                <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;background:#080b0f;color:#c8d4e0;border-radius:10px">
                  <h1 style="color:#f0a500">🔧 MecaIA</h1>
                  <h2>Merci pour ton achat !</h2>
                  <p>Salut,</p>
                  <p>Ton paiement de <strong style="color:#f0a500">${amountPaid}€</strong> est confirmé.</p>
                  <p>Tu as maintenant <strong style="color:#10b981">${credits === 999 ? 'un accès illimité pendant 30 jours' : credits + ' crédits'}</strong> sur ton compte MecaIA.</p>
                  <p>Tu peux commencer à diagnostiquer maintenant : <a href="https://euphonious-frangollo-da0cc1.netlify.app" style="color:#f0a500">Lancer un diagnostic</a></p>
                  <hr style="border-color:#1e2a3a">
                  <p style="color:#4a5a6e;font-size:12px">Dylan, ton mécano IA, est prêt à t'aider 24/7.</p>
                  <p style="color:#4a5a6e;font-size:12px">MecaIA - Créé par Loïc Declerck - Belgique</p>
                </div>
              `
            })
          });
        } catch (e) {
          console.error('Email send error:', e);
        }
      }
    }
    
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ received: true }) 
    };
    
  } catch (error) {
    console.error('Webhook error:', error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
