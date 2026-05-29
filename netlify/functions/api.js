// ============================================================
// 🔧 MECAIA — BACKEND API PRINCIPAL
// Diagnostic IA Dylan + RAG Supabase + Multi-langues
// Créé par Loïc Declerck - Belgique
// ============================================================

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ============================================================
// PERSONNALITÉ DE DYLAN — Adapté selon niveau utilisateur
// ============================================================
function buildDylanPersonality(userLevel, lang) {
  const langInstructions = {
    fr: "Tu réponds TOUJOURS en français belge naturel.",
    nl: "Je antwoordt ALTIJD in natuurlijk Nederlands.",
    en: "You ALWAYS respond in natural English.",
    de: "Du antwortest IMMER auf natürlichem Deutsch."
  };

  const baseDylan = `Tu es Dylan, un mécanicien IA expert créé par Loïc Declerck (21 ans, mécano au Garage Mécapro à Barchon, Belgique). Tu as la personnalité d'un mécano belge sympa : direct, franc, avec un peu d'humour léger de garage (pas trop), honnête sur tes limites.

RÈGLES ABSOLUES :
1. ${langInstructions[lang] || langInstructions.fr}
2. Tu es HONNÊTE : si tu n'es pas sûr, tu le dis. Tu donnes un % de confiance.
3. Tu donnes JAMAIS un diagnostic à 100% sûr sans vérification physique.
4. Tu suggères TOUJOURS de vérifier avec un mécano si c'est important.
5. Tu n'inventes JAMAIS de codes OBD ou de pièces.
6. Si la question n'est pas claire, tu poses 1 question pour préciser (pas 5).
7. Tu n'es PAS un chatbot général — tu parles QUE de mécanique auto.
8. Si on te demande autre chose, recadre poliment : "Moi je suis mécano hein, pour ça demande à Google !"

TON HUMOUR (léger) :
- Une petite blague de garage de temps en temps
- Expressions imagées ("ta voiture elle fait la tête", "elle a chopé un coup de mou")
- JAMAIS d'humour si c'est urgent ou si le client est inquiet
- Pas d'emojis sauf 1 max par réponse

ANTI-ARNAQUE :
Tu défends le client. Si tu vois un truc qui sent l'arnaque garage, tu le dis :
"Attention, certains garages te diraient X à 1500€, mais en vrai vérifie d'abord Y qui coûte 80€."`;

  const levelAdjustments = {
    debutant: `

TU PARLES À UN DÉBUTANT (particulier qui s'y connaît pas) :
- Langage SIMPLE, zéro jargon technique sans explication
- Métaphores ("c'est comme..."), analogies du quotidien
- Tu rassures : "pas de panique", "c'est courant"
- Tu expliques le POURQUOI avec des mots simples
- Tu donnes un ordre d'idée de prix
- Tu dis si on peut continuer à rouler ou pas`,

    apprenti: `

TU PARLES À UN APPRENTI MÉCANO (veut apprendre) :
- Langage mécanique mais TOUJOURS expliqué
- Tu enseignes le RAISONNEMENT, pas juste la réponse
- Tu donnes les valeurs de mesure attendues
- Tu expliques les pièges courants
- Tu cites les outils nécessaires
- Tu compares les méthodes possibles`,

    pro: `

TU PARLES À UN MÉCANO PRO (expérimenté) :
- Langage technique direct, pas de blabla
- Valeurs précises (pression, tension, ohms)
- Tu vas droit au but
- Tu mentionnes les codes OBD spécifiques
- Tu compares avec les autres pannes similaires
- Tu peux te permettre du jargon
- Pas de "fais-toi aider par un mécano"`
  };

  return baseDylan + (levelAdjustments[userLevel] || levelAdjustments.debutant);
}

// ============================================================
// DÉTECTION AUTO DU NIVEAU UTILISATEUR
// ============================================================
function detectUserLevel(text) {
  if (!text) return 'debutant';
  const lower = text.toLowerCase();
  
  // Mots techniques = pro
  const proKeywords = ['actuateur', 'égr', 'fap', 'rampe commune', 'common rail', 'turbo géométrie variable',
    'tgv', 'débitmètre', 'lambda', 'pmh', 'arbre à cames', 'ohms', 'multimètre', 'dtc', 
    'mode dégradé', 'vanos', 'déphaseur', 'collecteur admission', 'cliquetis', 'détonation',
    'segment', 'piston', 'bielle', 'distribution', 'culasse', 'joint culasse', 'compression',
    'allumage', 'bougie', 'bobine'];
  
  // Mots techniques basiques = apprenti  
  const apprentiKeywords = ['embrayage', 'alternateur', 'démarreur', 'batterie', 'filtre',
    'plaquette', 'frein', 'cardan', 'rotule', 'amortisseur', 'voyant', 'fusible'];
  
  let proCount = 0, apprentiCount = 0;
  proKeywords.forEach(k => { if (lower.includes(k)) proCount++; });
  apprentiKeywords.forEach(k => { if (lower.includes(k)) apprentiCount++; });
  
  if (proCount >= 2) return 'pro';
  if (proCount >= 1 || apprentiCount >= 2) return 'apprenti';
  return 'debutant';
}

// ============================================================
// RAG SUPABASE — Recherche d'expertise pertinente
// ============================================================
async function searchExpertise(query, supabaseUrl, supabaseKey) {
  if (!supabaseUrl || !supabaseKey) return [];
  
  try {
    // Recherche simple par mots-clés dans expertise_loic
    const lower = query.toLowerCase();
    const keywords = lower.split(' ').filter(w => w.length > 3).slice(0, 5);
    
    if (keywords.length === 0) return [];
    
    const filter = keywords.map(k => `contenu.ilike.%${k}%`).join(',');
    const url = `${supabaseUrl}/rest/v1/expertise_loic?or=(${filter})&limit=5`;
    
    const resp = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    
    if (!resp.ok) return [];
    const data = await resp.json();
    return data || [];
  } catch (e) {
    console.log('RAG error:', e.message);
    return [];
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { type, messages, system, max_tokens, lang, userLevel, userQuery, imageBase64, imageMediaType } = body;

    // ====== TYPE : DIAGNOSTIC CLASSIQUE ======
    if (type === 'claude' || type === 'diagnostic') {
      // Détection du niveau si non fourni
      const level = userLevel || detectUserLevel(userQuery || (messages && messages[0]?.content) || '');
      const language = lang || 'fr';
      
      // Récupération de l'expertise pertinente (RAG)
      const expertise = await searchExpertise(
        userQuery || (messages && messages[0]?.content) || '',
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET
      );
      
      // Construction du prompt système avec personnalité Dylan + expertise
      let systemPrompt = system || buildDylanPersonality(level, language);
      
      if (expertise.length > 0) {
        systemPrompt += `\n\n=== EXPERTISE LOÏC (utilise ces infos si pertinent) ===\n`;
        expertise.forEach((e, i) => {
          systemPrompt += `\n[${i+1}] ${e.sujet}: ${e.contenu}\n`;
        });
        systemPrompt += `\n=== FIN EXPERTISE ===\n\nUtilise ces astuces terrain si elles correspondent au problème, en les citant naturellement.`;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: max_tokens || 1500,
          system: systemPrompt,
          messages: messages
        })
      });
      
      const data = await response.json();
      
      // Log dans Supabase pour cas_reels (non bloquant)
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET) {
        try {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/cas_reels`, {
            method: 'POST',
            headers: {
              'apikey': process.env.SUPABASE_SECRET,
              'Authorization': `Bearer ${process.env.SUPABASE_SECRET}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              symptomes_decrits: userQuery || (messages && messages[0]?.content)?.substring(0, 500) || '',
              diagnostic_ia: (data.content?.[0]?.text || '').substring(0, 1000),
              succes: null,
              confirme: false
            })
          });
        } catch (e) { /* silently fail */ }
      }
      
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // ====== TYPE : ANALYSE PHOTO ======
    if (type === 'photo') {
      const language = lang || 'fr';
      const level = userLevel || 'debutant';
      const systemPrompt = buildDylanPersonality(level, language) + `\n\nTu analyses une photo d'une pièce auto, d'un moteur, ou d'un défaut visible. Donne ton diagnostic avec ton niveau de confiance.`;
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageMediaType || 'image/jpeg',
                  data: imageBase64
                }
              },
              {
                type: 'text',
                text: userQuery || 'Qu\'est-ce que tu vois sur cette photo ? Y a-t-il un problème ?'
              }
            ]
          }]
        })
      });
      
      const data = await response.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // ====== TYPE : VIN DECODER ======
    if (type === 'vin') {
      const { vin } = body;
      if (!vin || vin.length < 11) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'VIN invalide' }) };
      }
      
      // Appel API NHTSA vPIC (gratuit, officiel US gov, fiable)
      const vinUrl = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
      const vinResp = await fetch(vinUrl);
      const vinData = await vinResp.json();
      
      // Parser les résultats
      const results = {};
      if (vinData.Results) {
        vinData.Results.forEach(r => {
          if (r.Value && r.Value !== 'Not Applicable' && r.Value !== 'null') {
            results[r.Variable] = r.Value;
          }
        });
      }
      
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          vin, 
          marque: results['Make'] || 'Inconnu',
          modele: results['Model'] || 'Inconnu',
          annee: results['Model Year'] || 'Inconnu',
          carrosserie: results['Body Class'] || '',
          moteur: results['Engine Model'] || results['Displacement (L)'] || '',
          carburant: results['Fuel Type - Primary'] || '',
          transmission: results['Transmission Style'] || '',
          pays: results['Plant Country'] || '',
          usine: results['Plant City'] || '',
          raw: results
        }) 
      };
    }

    // ====== TYPE : URGENCE "C'EST GRAVE DOCTEUR" ======
    if (type === 'urgence') {
      const { description, vehicule } = body;
      const language = lang || 'fr';
      
      const systemPrompt = buildDylanPersonality('debutant', language) + `

TU ES EN MODE URGENCE. Quelqu'un est paniqué (peut-être au bord de la route).
- Réponse COURTE (max 4-5 phrases)
- Direct : "Tu peux rouler" ou "Arrête-toi tout de suite"
- Si grave : explique calmement le danger
- Si pas grave : rassure et conseille
- Pas d'humour ici, c'est sérieux
- Format JSON OBLIGATOIRE :
{
  "gravite": "STOP" ou "ATTENTION" ou "OK",
  "rouler": true ou false,
  "message": "explication courte rassurante",
  "action": "ce qu'il faut faire maintenant"
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: `Véhicule: ${vehicule || 'non précisé'}\nProblème: ${description}\n\nRéponds en JSON.`
          }]
        })
      });
      
      const data = await response.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Type inconnu: ' + type }) };

  } catch (error) {
    console.error('API Error:', error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: error.message || 'Erreur serveur' }) 
    };
  }
};
