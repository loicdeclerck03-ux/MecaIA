// ============================================================
// 🔧 MECAIA — BACKEND SÉCURISÉ (Netlify Function)
// Fichier : netlify/functions/api.js
// ------------------------------------------------------------
// RÔLE DE CE FICHIER :
//   1. Cacher la clé Anthropic (elle ne quitte JAMAIS le serveur).
//   2. Gérer les crédits côté serveur (le client ne peut pas tricher).
//   3. Vérifier l'identité de l'utilisateur via son jeton Supabase.
//   4. Servir de point d'entrée unique pour : diagnostic, pièces,
//      VIN, alertes, urgence, photo, chat.
//
// SÉCURITÉ :
//   - Toutes les clés sont dans les VARIABLES D'ENVIRONNEMENT Netlify
//     (jamais écrites ici). Voir la liste en bas du fichier.
//   - Les actions payantes vérifient et décrémentent le crédit AVANT
//     d'appeler l'IA. Impossible de falsifier depuis le navigateur.
//
// DÉPENDANCES : AUCUNE (on parle à Supabase via son API REST avec fetch).
//   → Pas de npm install, pas de build. Plus simple, plus robuste.
// ============================================================

// ------------------------------------------------------------
// CONFIG (lue depuis les variables d'environnement Netlify)
// ------------------------------------------------------------
const SUPABASE_URL    = process.env.SUPABASE_URL;       // ex: https://xxxx.supabase.co
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;    // clé "service_role" (SECRÈTE)
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;      // clé API Anthropic (SECRÈTE)
const OWNER_CODE      = process.env.OWNER_CODE || '';   // code secret propriétaire (active l'illimité)
const MODEL           = 'claude-haiku-4-5-20251001';    // modèle utilisé (économique)

// En-têtes CORS : autorisent ton site à appeler ce backend.
const HEADERS = {
  'Access-Control-Allow-Origin': '*',                   // (à restreindre à ton domaine plus tard)
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Coût en crédits de chaque action (VIN et urgence = gratuits).
const COUT = {
  diagnostic: 1,
  pieces: 1,
  alertes: 1,
  photo: 1,
  chat: 1,
  vin: 0,
  urgence: 0,
  promo: 0,
  owner: 0,
  dashboard: 0,
  gencode: 0,
  set_profile: 0
};

// ============================================================
// OUTILS SUPABASE (via API REST, avec la clé service_role)
// ============================================================

// Petit raccourci pour appeler l'API REST de Supabase.
// `path` ex: "users?auth_id=eq.123&select=*"
async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
  // 204 = pas de contenu (ex: PATCH sans retour)
  return res.status === 204 ? null : res.json();
}

// Vérifie le jeton de l'utilisateur et renvoie son compte Auth.
// → Empêche quelqu'un de se faire passer pour un autre.
async function verifierUtilisateur(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json(); // { id, email, ... }
  } catch (e) {
    return null;
  }
}

// Charge le profil métier (crédits, type, etc.) à partir de l'auth_id.
async function chargerProfil(authId) {
  const rows = await sb(`users?auth_id=eq.${authId}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

// Vérifie + décrémente un crédit de façon ATOMIQUE et sécurisée.
// Renvoie { ok:true } ou { ok:false, raison:'...' }.
async function consommerCredit(profil, cout) {
  if (cout === 0) return { ok: true };                  // action gratuite

  // Pack illimité encore valide ?
  if (profil.unlimited_until && new Date(profil.unlimited_until) > new Date()) {
    return { ok: true };
  }
  // Crédits suffisants ?
  if ((profil.credits || 0) < cout) {
    return { ok: false, raison: 'credits_insuffisants' };
  }
  // On décrémente (service_role → contourne la RLS en toute sécurité).
  await sb(`users?id=eq.${profil.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ credits: profil.credits - cout })
  });
  return { ok: true, credits_restants: profil.credits - cout };
}

// Rembourse un crédit si l'IA a échoué (pour ne pas léser l'utilisateur).
async function rembourserCredit(profil, cout) {
  if (cout === 0 || !profil) return;
  try {
    const frais = await chargerProfil(profil.auth_id);  // relit la valeur à jour
    await sb(`users?id=eq.${profil.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ credits: (frais.credits || 0) + cout })
    });
  } catch (e) { /* on ignore : le remboursement est best-effort */ }
}

// Enregistre le diagnostic dans l'historique (table diagnostics).
async function sauvegarderDiagnostic(profil, type, donnees) {
  try {
    await sb('diagnostics', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify({
        user_id:       profil ? profil.id : null,
        type:          type,
        question:      donnees.question || null,
        obd_code:      donnees.obd_code || null,
        vehicule_desc: donnees.vehicule || null,
        response:      donnees.response || null,
        category:      donnees.category || null,
        severity:      donnees.severity || null,
        confidence:    donnees.confidence || null
      })
    });
  } catch (e) { /* l'historique n'est pas critique : on n'interrompt pas */ }
}

// Incrémente un compteur (diagnostics ou pieces_searches) sur le profil.
async function incrementerCompteur(profil, champ) {
  if (!profil) return;
  try {
    const valeur = (profil[champ] || 0) + 1;
    await sb(`users?id=eq.${profil.id}`, {
      method: 'PATCH', body: JSON.stringify({ [champ]: valeur })
    });
  } catch (e) { /* non critique */ }
}

// ============================================================
// APPEL À CLAUDE (Anthropic) — la clé reste côté serveur
// ============================================================
async function appelerClaude(system, messages, maxTokens = 1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Erreur API IA');
  return data.content.map(b => b.text || '').join('');
}

// Force une réponse JSON propre (enlève les ```json éventuels).
function parseJSON(txt) {
  return JSON.parse(txt.replace(/```json|```/g, '').trim());
}

// ============================================================
// 🔌 EMPLACEMENT FUTUR : RECHERCHE DANS LA BASE (RAG / agents)
// Pour l'instant renvoie vide. À l'étape 3, on branchera ici la
// recherche dans expertise_loic / pannes / obd_codes / cas_reels.
// Le reste du code n'aura PAS besoin d'être modifié.
// ============================================================
async function chercherDansLaBase(/* question, categorie */) {
  return []; // <- on remplira ça quand les 122 réponses + embeddings seront en base
}

// ============================================================
// CONSTRUCTION DES PROMPTS (selon le niveau de l'utilisateur)
// ============================================================
function systemeDiagnostic(niveau) {
  if (niveau === 'amateur' || niveau === 'debutant')
    return "Tu es un expert mécanicien qui explique en langage simple aux particuliers. Utilise des analogies. Réponds UNIQUEMENT en JSON valide sans markdown.";
  if (niveau === 'apprenti')
    return "Tu es un formateur mécanicien pédagogique. Explique le pourquoi de chaque étape. Réponds UNIQUEMENT en JSON valide sans markdown.";
  return "Tu es un expert mécanicien automobile avec 20 ans d'expérience. Diagnostics ultra précis. Réponds UNIQUEMENT en JSON valide sans markdown.";
}

// ============================================================
// HANDLER PRINCIPAL — point d'entrée de la fonction
// ============================================================
exports.handler = async (event) => {
  // Route publique : configuration (URLs publiques, clés ANON)
  // Cette route n'a besoin de POST → elle est accessible en GET
  const action = event.queryStringParameters?.action;
  if (event.httpMethod === 'GET' && action === 'config') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON: process.env.SUPABASE_ANON,
      })
    };
  }

  // Pré-vol CORS
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Méthode non autorisée' }) };

  // Vérifie que la config serveur est complète (évite les erreurs obscures)
  if (!SUPABASE_URL || !SUPABASE_SECRET || !ANTHROPIC_KEY) {
    return { statusCode: 500, headers: HEADERS,
      body: JSON.stringify({ error: 'Configuration serveur incomplète (variables d\'environnement manquantes).' }) };
  }

  try {
    const body   = JSON.parse(event.body || '{}');
    const action = body.action;                              // 'diagnostic', 'pieces', ...
    const cout   = COUT[action] ?? null;

    if (cout === null)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Action inconnue' }) };

    // Identité de l'utilisateur (jeton envoyé dans l'en-tête Authorization)
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token      = authHeader.replace('Bearer ', '').trim();
    const authUser   = await verifierUtilisateur(token);

    // Les actions PAYANTES exigent une connexion.
    let profil = null;
    if (cout > 0) {
      if (!authUser)
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Connexion requise.' }) };
      profil = await chargerProfil(authUser.id);
      if (!profil)
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Profil introuvable.' }) };

      const credit = await consommerCredit(profil, cout);
      if (!credit.ok)
        return { statusCode: 402, headers: HEADERS, body: JSON.stringify({ error: 'Crédits insuffisants', code: 'NO_CREDITS' }) };
    } else if (authUser) {
      // Action gratuite mais utilisateur connecté → on charge quand même son profil
      profil = await chargerProfil(authUser.id);
    }

    // --------------------------------------------------------
    // AIGUILLAGE DES ACTIONS
    // --------------------------------------------------------
    let resultat;
    try {
      switch (action) {

        // ----- DIAGNOSTIC -----
        case 'diagnostic': {
          const { code, vehicule, symptomes, niveau } = body;
          const prompt =
            `Code OBD: ${code || 'non fourni'}\nVéhicule: ${vehicule || 'non précisé'}\n` +
            `Symptômes: ${symptomes || 'non précisés'}\nJSON:\n` +
            `{"code":"${code || 'SYMPTÔMES'}","systeme":"système exact","titre":"titre précis",` +
            `"description":"explication 3-4 phrases","severite":"HAUTE","rouler":true,` +
            `"causes":["c1","c2","c3","c4"],"etapes":["e1 avec valeurs","e2","e3","e4","e5"],` +
            `"outils":["outil1 avec taille","outil2","outil3"],"difficulte":2,` +
            `"pieces":["p1","p2","p3"],"comment_tester":"avec valeurs exactes",` +
            `"pannes_liees":"autres pannes liées","economie_diy":120,"temps":"estimation",` +
            `"mo_min":50,"mo_max":200,"pieces_min":30,"pieces_max":400,` +
            `"conseil":"conseil expert spécifique","prevention":"prévention futur"}`;
          const txt = await appelerClaude(systemeDiagnostic(niveau), [{ role: 'user', content: prompt }], 1500);
          resultat = parseJSON(txt);
          await sauvegarderDiagnostic(profil, 'diagnostic', {
            question: symptomes, obd_code: code, vehicule, response: resultat,
            category: resultat.systeme, severity: resultat.severite
          });
          await incrementerCompteur(profil, 'diagnostics');
          break;
        }

        // ----- RECHERCHE PIÈCES -----
        case 'pieces': {
          const { vehicule, piece } = body;
          const prompt =
            `Véhicule: ${vehicule}\nPièce: ${piece}\nJSON:\n` +
            `{"pieces":[{"nom":"nom exact","marque":"NGK/Bosch/Valeo/Febi...",` +
            `"reference":"réf précise","ref_origine":"réf constructeur","prix_min":15,"prix_max":45,` +
            `"compatibilite":"note précise","qualite":"OEM ou Aftermarket ou Origine",` +
            `"conseil":"conseil montage","urgence":"Immédiat ou Sous 1000km ou Entretien normal"}]}\n` +
            `3-4 pièces de qualités différentes.`;
          const txt = await appelerClaude(
            "Expert pièces automobiles. Références aussi précises que possible. JSON uniquement sans markdown.",
            [{ role: 'user', content: prompt }], 1500);
          resultat = parseJSON(txt);
          await sauvegarderDiagnostic(profil, 'pieces', { question: piece, vehicule, response: resultat });
          await incrementerCompteur(profil, 'pieces_searches');
          break;
        }

        // ----- DÉCODAGE VIN (gratuit) -----
        case 'vin': {
          const { vin } = body;
          const prompt =
            `Décode ce VIN: ${vin}\nWMI: ${vin.substring(0, 3)}\n` +
            `Codes WMI: VF1=Renault,VF3=Peugeot,VF7=Citroën,WBA=BMW,WDB=Mercedes,WAU=Audi,` +
            `WVW=VW,ZFA=Fiat,VSS=SEAT,TMB=Skoda,SAL=LandRover,JHM=Honda,JN1=Nissan,KNA=Kia,KMH=Hyundai\n` +
            `JSON:\n{"pays":"","constructeur":"","modele":"","variante":"","annee":"","usine":"",` +
            `"moteur":"","carburant":"","transmission":"","serie":"${vin.substring(9)}"}`;
          const txt = await appelerClaude(
            "Expert mondial décodage VIN. JSON uniquement sans markdown.",
            [{ role: 'user', content: prompt }], 800);
          resultat = parseJSON(txt);
          await sauvegarderDiagnostic(profil, 'vin', { question: vin, response: resultat });
          break;
        }

        // ----- ALERTES ENTRETIEN -----
        case 'alertes': {
          const { vehicule, km } = body;
          const prompt =
            `Véhicule: ${vehicule} à ${km} km\nJSON:\n` +
            `{"alertes":[{"icon":"🔧","titre":"intervention","desc":"description précise",` +
            `"km_next":170000,"urgence":"Immédiat ou Bientôt ou Préventif"}]}\n` +
            `6-8 alertes basées sur le kilométrage réel.`;
          const txt = await appelerClaude(
            "Expert entretien automobile. JSON uniquement sans markdown.",
            [{ role: 'user', content: prompt }], 1200);
          resultat = parseJSON(txt);
          await sauvegarderDiagnostic(profil, 'alerte', { question: km + ' km', vehicule, response: resultat });
          break;
        }

        // ----- URGENCE "C'est grave docteur ?" (gratuit, sans connexion) -----
        case 'urgence': {
          const { description, vehicule } = body;
          const prompt =
            `Véhicule: ${vehicule || 'non précisé'}\nProblème: ${description}\nJSON:\n` +
            `{"gravite":"STOP","rouler":false,"message":"explication courte","action":"quoi faire maintenant"}`;
          const txt = await appelerClaude(
            "Expert mécanicien. Analyse urgence rapide. JSON sans markdown.",
            [{ role: 'user', content: prompt }], 600);
          resultat = parseJSON(txt);
          break;
        }

        // ----- ANALYSE PHOTO -----
        case 'photo': {
          const { image_base64, media_type } = body;
          const txt = await appelerClaude(
            "Tu es un expert mécanicien automobile. Tu analyses des photos avec précision. Réponds en français.",
            [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
              { type: 'text', text:
                "Analyse cette photo:\n1. Ce que tu vois précisément\n2. État de la pièce (bon/usé/défaillant)\n" +
                "3. Problèmes ou défauts visibles\n4. Urgence: immédiat/bientôt/préventif\n" +
                "5. Recommandations précises\n6. Pièces à commander si nécessaire" }
            ] }], 1000);
          resultat = { analyse: txt };
          await sauvegarderDiagnostic(profil, 'photo', { question: 'Analyse photo', response: resultat });
          break;
        }

        // ----- CHAT LIBRE (Dylan) -----
        case 'chat': {
          const { messages, niveau } = body;
          const persona =
            "Tu es Dylan, mécano IA belge : direct, franc, un peu d'humour, anti-arnaque. " +
            "Tu donnes des conseils mécaniques honnêtes et clairs. " +
            (niveau === 'pro' ? "L'utilisateur est un pro : sois technique."
             : niveau === 'apprenti' ? "L'utilisateur apprend : explique le pourquoi."
             : "L'utilisateur est un particulier : reste simple, évite le jargon.");
          resultat = { reponse: await appelerClaude(persona, messages, 1200) };
          await sauvegarderDiagnostic(profil, 'chat', {
            question: messages[messages.length - 1]?.content, response: resultat
          });
          break;
        }

        // ----- APPLIQUER UN CODE PROMO -----
        case 'promo': {
          if (!profil) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Connexion requise.' }) };
          const code = (body.code || '').trim().toUpperCase();
          const rows = await sb(`promo_codes?code=eq.${encodeURIComponent(code)}&select=*`);
          const promo = rows && rows[0];
          if (!promo || (promo.uses_remaining || 0) <= 0)
            return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Code invalide ou expiré.' }) };

          if (promo.type === 'reduction') {
            resultat = { type: 'reduction', value: promo.value };       // le client applique la remise à l'affichage
          } else {
            const dejaUtilises = profil.used_promos || [];
            if (dejaUtilises.includes(code))
              return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Code déjà utilisé.' }) };
            const ajout = promo.credits || 5;
            await sb(`users?id=eq.${profil.id}`, { method: 'PATCH',
              body: JSON.stringify({ credits: (profil.credits || 0) + ajout, used_promos: [...dejaUtilises, code] }) });
            await sb(`promo_codes?code=eq.${encodeURIComponent(code)}`, { method: 'PATCH',
              body: JSON.stringify({ uses_remaining: promo.uses_remaining - 1 }) });
            resultat = { type: 'credits', credits_ajoutes: ajout };
          }
          break;
        }

        // ----- ACTIVER LE CODE PROPRIÉTAIRE (illimité) -----
        case 'owner': {
          if (!profil) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Connexion requise.' }) };
          if (!OWNER_CODE || (body.code || '').trim().toUpperCase() !== OWNER_CODE.toUpperCase())
            return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Code incorrect.' }) };
          await sb(`users?id=eq.${profil.id}`, { method: 'PATCH', body: JSON.stringify({ credits: 999, is_owner: true }) });
          resultat = { ok: true };
          break;
        }

        // ----- METTRE À JOUR SON PROFIL (nom, type, langue, niveau) -----
        case 'set_profile': {
          if (!profil) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Connexion requise.' }) };
          const maj = {};
          if (body.name) maj.name = String(body.name).slice(0, 80);
          if (['mechanic','amateur','apprenti','garage'].includes(body.type)) maj.type = body.type;
          if (['fr','nl','en','de'].includes(body.lang)) maj.lang = body.lang;
          if (['auto','debutant','apprenti','pro'].includes(body.level)) maj.level = body.level;
          if (Object.keys(maj).length) await sb(`users?id=eq.${profil.id}`, { method: 'PATCH', body: JSON.stringify(maj) });
          resultat = maj;
          break;
        }

        // ----- DASHBOARD PROPRIÉTAIRE (lecture de tous les utilisateurs) -----
        case 'dashboard': {
          if (!profil || !profil.is_owner)
            return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Accès réservé au propriétaire.' }) };
          const users = await sb('users?select=name,email,type,credits,diagnostics,total_paid,created_at,is_owner&order=created_at.desc&limit=100');
          const recent = await sb('diagnostics?select=type,question,vehicule_desc,created_at&order=created_at.desc&limit=10');
          const totalDiag = users.reduce((s, u) => s + (u.diagnostics || 0), 0);
          const totalRevenue = users.reduce((s, u) => s + (parseFloat(u.total_paid) || 0), 0);
          resultat = { users, recent, totalDiag, totalRevenue };
          break;
        }

        // ----- GÉNÉRER UN CODE PROMO (propriétaire) -----
        case 'gencode': {
          if (!profil || !profil.is_owner)
            return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Accès réservé au propriétaire.' }) };
          const type = body.type === 'reduction' ? 'reduction' : 'credits';
          const val  = parseInt(body.val) || (type === 'credits' ? 5 : 20);
          const uses = parseInt(body.uses) || 1;
          let code = (body.nm || '').trim().toUpperCase();
          if (!code || code.length < 4) code = 'CODE-' + Math.random().toString(36).substring(2, 8).toUpperCase();
          await sb('promo_codes', { method: 'POST', prefer: 'return=minimal',
            body: JSON.stringify({ code, type, credits: type === 'credits' ? val : 5, value: type === 'reduction' ? val : 0,
              uses_remaining: uses, owner_email: profil.email }) });
          resultat = { code, type, val, uses };
          break;
        }

        default:
          return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Action non gérée' }) };
      }
    } catch (erreurIA) {
      // L'IA a échoué APRÈS avoir pris le crédit → on rembourse.
      await rembourserCredit(profil, cout);
      throw erreurIA;
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, data: resultat }) };

  } catch (error) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

// ============================================================
// 📋 VARIABLES D'ENVIRONNEMENT À CONFIGURER DANS NETLIFY
//    (Site settings → Environment variables)
//
//    SUPABASE_URL     = https://TON-PROJET.supabase.co
//    SUPABASE_SECRET  = (Supabase → Project Settings → API → service_role  ⚠️ SECRÈTE)
//    ANTHROPIC_KEY    = (ta clé sk-ant-...  ⚠️ SECRÈTE — à régénérer car l'ancienne a fuité)
//    OWNER_CODE       = (un mot de passe secret que TOI seul connais, ex: MECA-LOIC-2026)
//                        → permet d'activer les crédits illimités sur ton compte
//
// ⚠️ NE JAMAIS mettre ces valeurs dans le code ni sur GitHub.
// ============================================================
