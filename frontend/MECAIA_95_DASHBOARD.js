/* ============================================================
   MecaIA — DASHBOARD PROPRIÉTAIRE + CODES PROMO (Supabase)
   Réassigne loadDash (l'ancienne version Firestore meurt).
   Rendu dynamique dans #s-dash. Tout passe par la fonction
   serveur "admin" (réservée au propriétaire via OWNER_EMAIL).
   ============================================================ */

loadDash = async function () {
  const el = document.getElementById('s-dash');
  if (!el) return;
  el.innerHTML = `
  <div style="padding:16px;max-width:780px;margin:auto;width:100%">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;color:#fff">⚙️ TABLEAU DE BORD</div>
      <button class="bsm" onclick="showSc('s-app')">← Retour app</button>
    </div>

    <div class="card" style="margin-bottom:12px"><div class="ch"><div class="ct">📊 MONITORING</div></div>
      <div class="cb"><div id="dash-stats" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">Chargement…</div></div>
    </div>

    <div class="card" style="margin-bottom:12px"><div class="ch"><div class="ct">🎁 OFFRIR À UN TESTEUR</div></div>
      <div class="cb">
        <input id="dg-email" placeholder="email du testeur" style="width:100%;margin-bottom:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="bb" onclick="grantTester('unlimited',30)">Illimité 30 jours</button>
          <button class="bg" onclick="grantTester('credits',50)">+50 crédits</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px"><div class="ch"><div class="ct">➕ CRÉER UN CODE PROMO</div></div>
      <div class="cb">
        <input id="dp-code" placeholder="CODE (ex: TESTEUR2026)" style="width:100%;margin-bottom:8px;text-transform:uppercase">
        <select id="dp-kind" style="width:100%;margin-bottom:8px">
          <option value="percent">Réduction % (1-100, à l'achat)</option>
          <option value="credits">Crédits offerts</option>
          <option value="unlimited">Illimité (jours)</option>
        </select>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <input id="dp-value" type="number" placeholder="valeur (% / crédits / jours)" style="flex:1;min-width:120px">
          <input id="dp-max" type="number" placeholder="max utilisateurs (vide=illimité)" style="flex:1;min-width:120px">
          <input id="dp-exp" type="number" placeholder="valable X jours (vide=toujours)" style="flex:1;min-width:120px">
        </div>
        <button class="bb" onclick="createPromo()">Créer le code</button>
      </div>
    </div>

    <div class="card"><div class="ch"><div class="ct">🗂️ HISTORIQUE DES CODES</div></div>
      <div class="cb"><div id="dash-promos">Chargement…</div></div>
    </div>
  </div>`;
  await refreshDash();
};
window.loadDash = loadDash;

async function refreshDash() {
  const s = await MecaIA.authedFetch('admin', { method: 'POST', body: { action: 'stats' } });
  const se = document.getElementById('dash-stats');
  if (se) {
    if (s.status === 403) { se.innerHTML = '<div style="color:var(--red)">Accès réservé au propriétaire (vérifie OWNER_EMAIL).</div>'; }
    else if (s.ok && s.data && s.data.success) {
      const x = s.data.stats || {};
      const cell = (l, v) => `<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px"><div style="font-size:22px;font-weight:700;color:var(--accent)">${v ?? 0}</div><div style="font-size:11px;color:var(--muted)">${l}</div></div>`;
      se.innerHTML = cell('Utilisateurs', x.total_users) + cell('Diagnostics', x.total_diagnostics) + cell('Illimités actifs', x.unlimited_users) + cell('Codes actifs', x.active_promos);
    } else se.innerHTML = '<div style="color:var(--muted)">Stats indisponibles.</div>';
  }

  const p = await MecaIA.authedFetch('admin', { method: 'POST', body: { action: 'list_promos' } });
  const pe = document.getElementById('dash-promos');
  if (pe) {
    if (p.ok && p.data && p.data.success) {
      const list = p.data.promos || [];
      if (!list.length) { pe.innerHTML = '<div style="color:var(--muted);font-size:13px">Aucun code.</div>'; return; }
      const kindLbl = { percent: '% réduction', credits: 'crédits', unlimited: 'jours illimité' };
      const stColor = { 'actif': 'var(--green)', 'désactivé': 'var(--muted)', 'expiré': 'var(--red)', 'épuisé': 'var(--red)' };
      pe.innerHTML = list.map(c => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div><div style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:#fff">${c.code}</div>
        <div style="font-size:11px;color:var(--muted)">${c.value} ${kindLbl[c.kind] || c.kind} · ${c.uses_count}/${c.max_uses ?? '∞'} utilisés · <span style="color:${stColor[c.status] || 'var(--muted)'}">${c.status}</span></div></div>
        <button class="bsm" onclick="togglePromo('${c.id}',${!c.active})">${c.active ? 'Désactiver' : 'Réactiver'}</button>
      </div>`).join('');
    } else pe.innerHTML = '<div style="color:var(--muted)">Liste indisponible.</div>';
  }
}
window.refreshDash = refreshDash;

window.createPromo = async function () {
  const code = (document.getElementById('dp-code').value || '').trim().toUpperCase();
  const kind = document.getElementById('dp-kind').value;
  const value = parseFloat(document.getElementById('dp-value').value);
  const maxV = document.getElementById('dp-max').value;
  const expD = document.getElementById('dp-exp').value;
  if (!code || !Number.isFinite(value)) { toast('Code et valeur requis', 'er'); return; }
  if (kind === 'percent' && (value < 1 || value > 100)) { toast('Le % doit être 1-100', 'er'); return; }
  const payload = {
    code, kind, value,
    max_uses: maxV ? parseInt(maxV) : null,
    expires_at: expD ? new Date(Date.now() + parseInt(expD) * 86400000).toISOString() : null,
  };
  const r = await MecaIA.authedFetch('admin', { method: 'POST', body: { action: 'create_promo', payload } });
  if (r.ok && r.data && r.data.success) { toast('✅ Code créé : ' + r.data.code, 'ok'); refreshDash(); }
  else toast('Erreur : ' + ((r.data && r.data.error) || ''), 'er');
};

window.togglePromo = async function (id, active) {
  const r = await MecaIA.authedFetch('admin', { method: 'POST', body: { action: 'toggle_promo', payload: { id, active } } });
  if (r.ok && r.data && r.data.success) { toast(active ? 'Code réactivé' : 'Code désactivé', 'ok'); refreshDash(); }
  else toast('Erreur', 'er');
};

window.grantTester = async function (kind, value) {
  const email = (document.getElementById('dg-email').value || '').trim();
  if (!email) { toast('Entre un email', 'er'); return; }
  const r = await MecaIA.authedFetch('admin', { method: 'POST', body: { action: 'grant', payload: { email, kind, value } } });
  if (r.ok && r.data && r.data.success) { toast('✅ ' + r.data.message, 'ok'); refreshDash(); }
  else toast('Erreur : ' + ((r.data && r.data.error) || ''), 'er');
};

/* ---- Côté UTILISATEUR : échanger un code promo (crédits/illimité) ---- */
window.redeemPromo = async function () {
  const code = prompt('Entre ton code promo :');
  if (!code) return;
  const r = await MecaIA.authedFetch('promo_redeem', { method: 'POST', body: { code } });
  if (r.ok && r.data && r.data.success) {
    toast('🎉 Code appliqué !', 'ok');
    if (window.refreshCredits) refreshCredits();
  } else toast((r.data && r.data.message) || 'Code invalide', 'er');
};
