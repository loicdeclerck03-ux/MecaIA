/* ============================================================
   MecaIA — ÉTAPE 9.3 — COUCHE DONNÉES (Supabase, plus de Firestore)
   À coller DANS le <script type="module">, EN REMPLACEMENT de :
   loadProfile (stub 9.2), addCar, renderCars, selC, updKm, delCar,
   saveC, useC, sUD.
   Garde tes helpers UI (ss, toast, majC, openM, hideAddCar, chkD,
   sc, selCar, cars, CR, UT, CU).
   ============================================================ */

// Mappe un véhicule Supabase -> forme attendue par l'UI
function mapVehicle(v) {
  return {
    id: v.id, nom: v.nickname, marque: v.marque, modele: v.modele, annee: v.annee,
    carbu: v.carburant, kw: v.puissance_ch, cm: v.engine_code, vin: v.vin,
    km: v.km_current, score: 85,
  };
}

// ---- Profil + crédits (remplace le chargement Firestore) ----
async function loadProfile(user) {
  const pr = await MecaIA.authedFetch('profile_get');
  if (pr.ok && pr.data && pr.data.success) {
    const p = pr.data.profile || {};
    CR = pr.data.unlimited ? 999 : Number(pr.data.credits || 0);
    UT = p.type || 'mechanic';
    const tl = { mechanic: 'Mécanicien', amateur: 'Particulier', apprenti: 'Apprenti', garage: 'Garage' };
    ss('u-nm', p.name || user.email);
    ss('u-ty', tl[p.type] || 'Mécanicien');
    ss('u-lv', p.diagnostics > 50 ? '⭐ Expert' : p.diagnostics > 20 ? '🔧 Confirmé' : '🌱 Débutant');
    ss('my-promo', p.promo_code || '');
    ss('gs-d', p.diagnostics || 0);
    majC();
  }
  await loadCars();
}

// ---- Voitures (garage) ----
async function loadCars() {
  const g = await MecaIA.authedFetch('garage_get');
  if (g.ok && g.data && g.data.success) {
    cars = (g.data.vehicles || []).map(mapVehicle);
    renderCars(cars);
    ss('gs-v', cars.length);
  }
}
window.loadCars = loadCars;

// ---- Rafraîchir le solde de crédits après une opération serveur ----
async function refreshCredits() {
  const pr = await MecaIA.authedFetch('profile_get');
  if (pr.ok && pr.data && pr.data.success) {
    CR = pr.data.unlimited ? 999 : Number(pr.data.credits || 0);
    majC();
  }
}
window.refreshCredits = refreshCredits;

// ---- Ajouter un véhicule ----
window.addCar = async function () {
  const m = document.getElementById('nc-mk').value;
  const mo = document.getElementById('nc-mo').value.trim();
  const a = document.getElementById('nc-an').value.trim();
  const c = document.getElementById('nc-cb').value;
  if (!m || !mo || !a || !c) { toast('Remplir Marque, Modèle, Année et Carburant', 'er'); return; }

  const body = {
    marque: m, modele: mo, annee: parseInt(a) || null, carburant: c,
    puissance_ch: parseInt(document.getElementById('nc-kw').value) || null,
    engine_code: document.getElementById('nc-cm').value.trim().toUpperCase(),
    vin: document.getElementById('nc-vn').value.trim().toUpperCase(),
    km_current: parseInt(document.getElementById('nc-km').value) || null,
    nickname: document.getElementById('nc-nm').value.trim(),
  };
  const r = await MecaIA.authedFetch('garage_add_vehicle', { method: 'POST', body });
  if (!r.ok || !r.data || !r.data.success) { toast('Erreur: ' + ((r.data && r.data.error) || 'ajout'), 'er'); return; }

  await loadCars();
  hideAddCar();
  toast('✅ Véhicule ajouté !', 'ok');
  ['nc-mk', 'nc-mo', 'nc-an', 'nc-cb', 'nc-kw', 'nc-cm', 'nc-vn', 'nc-km', 'nc-nm']
    .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
};

// ---- Rendu des voitures (UUID entre quotes dans les onclick !) ----
function renderCars(cs) {
  const gc = document.getElementById('g-cars');
  const sl = document.getElementById('car-sel-list');
  if (!gc) return;
  if (!cs.length) {
    gc.innerHTML = '<div style="text-align:center;padding:18px;color:var(--muted);font-size:13px">Aucun véhicule.</div>';
    if (sl) sl.innerHTML = '<div style="text-align:center;padding:18px;color:var(--muted);font-size:13px">Aucun véhicule. Ajoutez-en un dans <strong style="color:var(--accent)">GARAGE</strong>.</div>';
    return;
  }
  gc.innerHTML = cs.map(c => `<div class="car-c"><div style="font-size:24px">🚗</div><div class="car-info"><div class="car-n">${c.nom || c.marque + ' ' + c.modele}</div><div class="car-d">${c.marque} ${c.modele} ${c.annee} · ${c.carbu}${c.kw ? ' · ' + c.kw + 'kW' : ''}${c.cm ? ' · ' + c.cm : ''}</div>${c.km ? `<div class="car-k">📍 ${c.km} km</div>` : ''}</div><div style="text-align:center;min-width:38px"><div class="car-sc" style="color:${sc(c.score || 85)}">${c.score || 85}</div><div style="font-size:9px;color:var(--muted)">SANTÉ</div></div><div style="display:flex;gap:5px"><button class="bsm" onclick="updKm('${c.id}')">KM</button><button class="br" onclick="delCar('${c.id}')">✕</button></div></div>`).join('');
  if (sl) sl.innerHTML = cs.map(c => `<div class="car-c${selCar?.id === c.id ? ' sel' : ''}" onclick="selC('${c.id}')"><div style="font-size:22px">🚗</div><div class="car-info"><div class="car-n">${c.nom || c.marque + ' ' + c.modele}</div><div class="car-d">${c.marque} ${c.modele} ${c.annee} · ${c.carbu}</div>${c.km ? `<div class="car-k">📍 ${c.km} km</div>` : ''}</div>${selCar?.id === c.id ? '<span style="color:var(--accent);font-size:17px">✓</span>' : ''}</div>`).join('');
}

// ---- Sélection d'un véhicule (id = UUID string) ----
window.selC = function (id) {
  selCar = cars.find(c => c.id === id);
  if (!selCar) return;
  const sv = (el, v) => { const e = document.getElementById(el); if (e && v) e.value = v; };
  sv('d-mk', selCar.marque); sv('d-mo', selCar.modele); sv('d-an', selCar.annee);
  sv('d-cb', selCar.carbu); sv('d-kw', selCar.kw); sv('d-cm', selCar.cm); sv('d-km', selCar.km);
  chkD(); renderCars(cars); toast('✅ ' + (selCar.nom || selCar.marque) + ' sélectionné', 'ok');
};

// ---- Mettre à jour le KM (serveur) ----
window.updKm = async function (id) {
  const km = prompt('Nouveau kilométrage:'); if (!km) return;
  const r = await MecaIA.authedFetch('garage_update_km', { method: 'POST', body: { vehicle_id: id, km: parseInt(km) || 0 } });
  if (r.ok && r.data && r.data.success) { await loadCars(); toast('KM mis à jour', 'ok'); }
  else toast('Erreur maj KM', 'er');
};

// ---- Supprimer un véhicule (serveur) ----
window.delCar = async function (id) {
  if (!confirm('Supprimer ce véhicule ?')) return;
  const r = await MecaIA.authedFetch('garage_delete_vehicle', { method: 'POST', body: { vehicle_id: id } });
  if (r.ok && r.data && r.data.success) { if (selCar?.id === id) selCar = null; await loadCars(); toast('Véhicule supprimé', 'ok'); }
  else toast('Erreur suppression', 'er');
};

// ---- Crédits : autorité = serveur. Ces helpers deviennent légers. ----
// useC() = simple pré-contrôle UI (le débit réel est fait par le serveur
// dans dylan_agents / parts_compare). Pas de décrément local.
function useC() {
  if (CR === 999) return true;
  if (CR <= 0) { openM('m-pay'); toast('Plus de crédits !', 'er'); return false; }
  return true;
}
async function saveC() { /* crédits gérés côté serveur, plus de Firestore */ }
async function sUD() { /* données côté serveur, plus de Firestore */ }
