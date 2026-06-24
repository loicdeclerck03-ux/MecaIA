'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  process.stderr.write('[mecaia-mcp] ERREUR: SUPABASE_URL et SUPABASE_SERVICE_KEY requis dans .env\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }
function err(msg, detail) {
  const e = { error: msg };
  if (detail) e.detail = detail;
  return { content: [{ type: 'text', text: JSON.stringify(e) }], isError: true };
}

const server = new McpServer({ name: 'mecaia-mcp-server', version: '1.0.0' });
// mecaia_get_user
server.registerTool('mecaia_get_user', {
  title: 'Recuperer un utilisateur MecaIA',
  description: 'Retourne les infos d\'un utilisateur: email, type, credits, is_unlimited, diagnostics_count, total_paid. Recherche par email ou user_id.',
  inputSchema: {
    email: z.string().email().optional().describe('Email de l\'utilisateur'),
    user_id: z.string().uuid().optional().describe('UUID de l\'utilisateur')
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ email, user_id }) => {
  if (!email && !user_id) return err('email ou user_id requis');
  let q = supabase.from('users').select('id,email,name,type,credits,is_unlimited,unlimited_until,diagnostics_count,total_paid,lang,created_at');
  if (email) q = q.eq('email', email);
  if (user_id) q = q.eq('id', user_id);
  const { data, error } = await q.single();
  if (error) return err('Utilisateur non trouve', error.message);
  return ok(data);
});

// mecaia_list_users
server.registerTool('mecaia_list_users', {
  title: 'Lister les utilisateurs MecaIA',
  description: 'Liste les utilisateurs avec filtres optionnels. Retourne id, email, type, credits, diagnostics_count, created_at.',
  inputSchema: {
    type: z.enum(['mechanic','amateur','apprenti','garage']).optional().describe('Filtrer par type'),
    limit: z.number().int().min(1).max(100).default(50).describe('Nombre max de resultats'),
    offset: z.number().int().min(0).default(0).describe('Pagination'),
    order_by: z.enum(['created_at','diagnostics_count','credits','total_paid']).default('created_at').describe('Tri')
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ type, limit, offset, order_by }) => {
  let q = supabase.from('users')
    .select('id,email,name,type,credits,is_unlimited,diagnostics_count,total_paid,created_at')
    .order(order_by, { ascending: false })
    .range(offset, offset + limit - 1);
  if (type) q = q.eq('type', type);
  const { data, error, count } = await q;
  if (error) return err('Erreur listing users', error.message);
  return ok({ users: data, count: data.length, offset });
});

// mecaia_get_user_cars
server.registerTool('mecaia_get_user_cars', {
  title: 'Vehicules d\'un utilisateur',
  description: 'Retourne la liste des vehicules (garage virtuel) d\'un utilisateur: marque, modele, annee, carburant, km, VIN, score sante.',
  inputSchema: {
    user_id: z.string().uuid().describe('UUID de l\'utilisateur')
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ user_id }) => {
  const { data, error } = await supabase.from('cars')
    .select('id,marque,modele,annee,carbu,kw,code_moteur,vin,km,nom,score,created_at')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false });
  if (error) return err('Erreur vehicules', error.message);
  return ok({ cars: data, count: data.length });
});

// mecaia_add_car
server.registerTool('mecaia_add_car', {
  title: 'Ajouter un vehicule',
  description: 'Ajoute un nouveau vehicule au garage d\'un utilisateur.',
  inputSchema: {
    user_id: z.string().uuid().describe('UUID utilisateur'),
    marque: z.string().min(1).describe('Marque ex BMW Peugeot'),
    modele: z.string().min(1).describe('Modele ex 318d 308'),
    annee: z.string().describe('Annee ex 2003'),
    carbu: z.string().describe('Carburant: essence diesel hybride electrique'),
    km: z.string().optional().describe('Kilometrage ex 180000'),
    vin: z.string().optional().describe('VIN 17 caracteres'),
    kw: z.string().optional().describe('Puissance en kW'),
    code_moteur: z.string().optional().describe('Code moteur ex M47'),
    nom: z.string().optional().describe('Surnom ex Ma vieille BMW')
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async (params) => {
  const { data, error } = await supabase.from('cars').insert([params]).select().single();
  if (error) return err('Erreur ajout vehicule', error.message);
  return ok({ car_id: data.id, success: true, car: data });
});
// mecaia_get_diagnostics
server.registerTool('mecaia_get_diagnostics', {
  title: 'Historique diagnostics',
  description: 'Recupere les diagnostics d\'un utilisateur ou d\'un vehicule specifique. Retourne: type, input/output, credits_used, rating, date.',
  inputSchema: {
    user_id: z.string().uuid().optional().describe('UUID utilisateur'),
    car_id: z.string().uuid().optional().describe('UUID vehicule'),
    limit: z.number().int().min(1).max(50).default(20).describe('Nombre max'),
    type: z.enum(['obd','photo','pieces','alertes','vin','chat']).optional().describe('Filtrer par type')
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ user_id, car_id, limit, type }) => {
  if (!user_id && !car_id) return err('user_id ou car_id requis');
  let q = supabase.from('diagnostics')
    .select('id,user_id,car_id,type,input,output,credits_used,is_fav,rating,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (user_id) q = q.eq('user_id', user_id);
  if (car_id) q = q.eq('car_id', car_id);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return err('Erreur diagnostics', error.message);
  return ok({ diagnostics: data, count: data.length });
});

// mecaia_get_diagnostic
server.registerTool('mecaia_get_diagnostic', {
  title: 'Detail d\'un diagnostic',
  description: 'Retourne le detail complet d\'un diagnostic: input (symptomes/codes OBD), output (analyse IA), rating.',
  inputSchema: { diagnostic_id: z.string().uuid().describe('UUID du diagnostic') },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ diagnostic_id }) => {
  const { data, error } = await supabase.from('diagnostics')
    .select('*').eq('id', diagnostic_id).single();
  if (error) return err('Diagnostic non trouve', error.message);
  return ok(data);
});

// mecaia_update_diagnostic
server.registerTool('mecaia_update_diagnostic', {
  title: 'Mettre a jour un diagnostic',
  description: 'Met a jour le rating ou is_fav d\'un diagnostic.',
  inputSchema: {
    diagnostic_id: z.string().uuid().describe('UUID du diagnostic'),
    rating: z.number().int().min(1).max(5).optional().describe('Note 1-5'),
    is_fav: z.boolean().optional().describe('Mettre en favori')
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ diagnostic_id, rating, is_fav }) => {
  const updates = {};
  if (rating !== undefined) updates.rating = rating;
  if (is_fav !== undefined) updates.is_fav = is_fav;
  if (!Object.keys(updates).length) return err('rating ou is_fav requis');
  const { error } = await supabase.from('diagnostics').update(updates).eq('id', diagnostic_id);
  if (error) return err('Erreur update diagnostic', error.message);
  return ok({ success: true, updated: updates });
});

// mecaia_get_user_credits
server.registerTool('mecaia_get_user_credits', {
  title: 'Credits d\'un utilisateur',
  description: 'Retourne le solde de credits, is_unlimited, unlimited_until et total paye.',
  inputSchema: { user_id: z.string().uuid().describe('UUID utilisateur') },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ user_id }) => {
  const { data, error } = await supabase.from('users')
    .select('credits,is_unlimited,unlimited_until,total_paid').eq('id', user_id).single();
  if (error) return err('Utilisateur non trouve', error.message);
  return ok(data);
});

// mecaia_add_credits
server.registerTool('mecaia_add_credits', {
  title: 'Ajouter des credits (admin)',
  description: 'Ajoute des credits a un utilisateur. Action admin. Utiliser pour corrections manuelles ou cadeaux.',
  inputSchema: {
    user_id: z.string().uuid().describe('UUID utilisateur'),
    credits: z.number().int().min(1).describe('Nombre de credits a ajouter'),
    reason: z.string().optional().describe('Raison ex correction manuelle cadeau beta')
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ user_id, credits, reason }) => {
  const { data: current, error: e1 } = await supabase.from('users').select('credits').eq('id', user_id).single();
  if (e1) return err('Utilisateur non trouve', e1.message);
  const newBalance = current.credits + credits;
  const { error: e2 } = await supabase.from('users').update({ credits: newBalance }).eq('id', user_id);
  if (e2) return err('Erreur update credits', e2.message);
  return ok({ success: true, credits_added: credits, new_balance: newBalance, reason: reason || 'Manuel' });
});
// mecaia_list_transactions
server.registerTool('mecaia_list_transactions', {
  title: 'Historique transactions',
  description: 'Retourne l\'historique Stripe d\'un utilisateur: montant, credits achetes, pack, status, date.',
  inputSchema: {
    user_id: z.string().uuid().describe('UUID utilisateur'),
    limit: z.number().int().min(1).max(50).default(20).describe('Nombre max')
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ user_id, limit }) => {
  const { data, error } = await supabase.from('transactions')
    .select('id,amount,credits,pack_name,status,stripe_session_id,created_at')
    .eq('user_id', user_id).order('created_at', { ascending: false }).limit(limit);
  if (error) return err('Erreur transactions', error.message);
  return ok({ transactions: data, count: data.length });
});

// mecaia_get_promo_codes
server.registerTool('mecaia_get_promo_codes', {
  title: 'Lister les codes promo',
  description: 'Retourne tous les codes promo: code, type, credits, uses_left, uses_total, expires_at.',
  inputSchema: {
    active_only: z.boolean().default(true).describe('Seulement codes encore utilisables'),
    limit: z.number().int().min(1).max(100).default(50)
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ active_only, limit }) => {
  let q = supabase.from('promo_codes')
    .select('id,code,type,credits,reduction,uses_left,uses_total,expires_at,created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (active_only) q = q.gt('uses_left', 0);
  const { data, error } = await q;
  if (error) return err('Erreur promo_codes', error.message);
  return ok({ promo_codes: data, count: data.length });
});

// mecaia_create_promo_code
server.registerTool('mecaia_create_promo_code', {
  title: 'Creer un code promo',
  description: 'Cree un nouveau code promo credits ou reduction.',
  inputSchema: {
    code: z.string().min(3).max(20).toUpperCase().describe('Code ex BETA10 WELCOME5'),
    type: z.enum(['credits','reduction']).describe('Type: credits=donne des credits, reduction=% remise'),
    credits: z.number().int().min(1).optional().describe('Credits a donner (type=credits)'),
    reduction: z.number().int().min(1).max(100).optional().describe('Pourcentage reduction (type=reduction)'),
    uses_left: z.number().int().min(1).default(100).describe('Nombre d\'utilisations max'),
    expires_days: z.number().int().min(1).optional().describe('Validite en jours depuis maintenant')
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ code, type, credits, reduction, uses_left, expires_days }) => {
  const insert = { code: code.toUpperCase(), type, uses_left, uses_total: 0 };
  if (credits) insert.credits = credits;
  if (reduction) insert.reduction = reduction;
  if (expires_days) insert.expires_at = new Date(Date.now() + expires_days * 86400000).toISOString();
  const { data, error } = await supabase.from('promo_codes').insert([insert]).select().single();
  if (error) return err('Erreur creation promo', error.message);
  return ok({ success: true, promo_code: data });
});

// mecaia_search_dtc_db
server.registerTool('mecaia_search_dtc_db', {
  title: 'Rechercher un code DTC dans la base',
  description: 'Recherche un code OBD dans la base de connaissances MecaIA (18826 codes). Retourne description, systeme, causes possibles.',
  inputSchema: {
    code: z.string().describe('Code DTC ex P0087 P0101 C0010'),
    limit: z.number().int().min(1).max(10).default(5)
  },
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async ({ code, limit }) => {
  const clean = code.toUpperCase().trim();
  const { data, error } = await supabase.from('dtc_codes')
    .select('code,description,system,causes,solutions')
    .or('code.eq.' + clean + ',code.ilike.' + clean + '%')
    .limit(limit);
  if (error) return err('Erreur recherche DTC', error.message);
  if (!data || data.length === 0) return ok({ found: false, code: clean, message: 'Code non trouve dans la base' });
  return ok({ found: true, code: clean, results: data });
});

// mecaia_get_stats
server.registerTool('mecaia_get_stats', {
  title: 'Statistiques MecaIA',
  description: 'Retourne les stats globales: nombre d\'utilisateurs, diagnostics, vehicules, revenus totaux.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false }
}, async () => {
  const [users, diags, cars, trans] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('diagnostics').select('id', { count: 'exact', head: true }),
    supabase.from('cars').select('id', { count: 'exact', head: true }),
    supabase.from('transactions').select('amount').eq('status', 'completed')
  ]);
  const revenue = trans.data ? trans.data.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) : 0;
  return ok({
    users: users.count || 0,
    diagnostics: diags.count || 0,
    cars: cars.count || 0,
    revenue_eur: Math.round(revenue * 100) / 100
  });
});

// Transport stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[mecaia-mcp-server] Demarre — Supabase: ' + SUPABASE_URL + '\n');
}
main().catch(e => { process.stderr.write('[mecaia-mcp] FATAL: ' + e.message + '\n'); process.exit(1); });