/* ============================================================
   MecaIA — ÉTAPE 9.4 — IA & NETTOYAGE (dernière sous-étape frontend)
   À coller DANS le <script type="module">, EN REMPLACEMENT de :
   doDiag, doPhoto, doVIN, doPieces, doAlertes, ET de la fonction claude().
   PUIS supprimer (voir instructions) : const API, const OWNER_CODE,
   les imports + init Firebase.
   Tout passe par MecaIA.authedFetch (JWT) -> plus aucune clé dans le navigateur.
   ============================================================ */

// ---- DIAGNOSTIC (serveur dylan_agents) ----
window.doDiag = async function () {
  const code = document.getElementById('d-code').value.trim().toUpperCase();
  const mk = document.getElementById('d-mk').value; const mo = document.getElementById('d-mo').value.trim();
  const an = document.getElementById('d-an').value; const cb = document.getElementById('d-cb').value;
  const kw = document.getElementById('d-kw').value.trim(); const km = document.getElementById('d-km').value.trim();
  const cm = document.getElementById('d-cm').value.trim().toUpperCase(); const sy = document.getElementById('d-sy').value.trim();
  if (!mk || !mo || !an || !cb) { toast('Remplir Marque, Modèle, Année, Carburant', 'er'); return; }
  if (!useC()) return;
  const btn = document.getElementById('btn-d'); btn.disabled = true; btn.textContent = '⏳ DYLAN ANALYSE...'; loader('zd');
  try {
    const veh = [mk, mo, cb, kw && kw + 'kW', an && '(' + an + ')', km && km + 'km', cm && 'Moteur:' + cm].filter(Boolean).join(' ');
    const user_input = [code && 'Code OBD: ' + code, 'Véhicule: ' + veh, sy && 'Symptômes: ' + sy].filter(Boolean).join('\n');
    const r = await MecaIA.authedFetch('dylan_agents', { method: 'POST', body: { user_input, vehicle_marque: mk, vehicle_modele: mo, vehicle_km: parseInt(km) || null } });
    if (r.status === 402) { openM('m-pay'); toast('Plus de crédits !', 'er'); btn.disabled = false; btn.textContent = '⚡ DIAGNOSTIC IA (1 crédit)'; return; }
    const data = r.data;
    if (!r.ok || !data || !data.success) { throw new Error((data && data.error) || 'Dylan API error'); }
    save('Diagnostic V3', mk + ' ' + mo + ' — ' + data.primary_diagnosis, 'diag');
    let sev = 'sevM'; if (data.urgency === 'immédiat') sev = 'sevH'; else if (data.urgency === 'préventif') sev = 'sevF';
    const confidence_color = data.confidence_percent >= 80 ? 'var(--green)' : data.confidence_percent >= 60 ? 'var(--accent)' : 'var(--red)';
    const urgency_emoji = data.urgency === 'immédiat' ? '🔴' : data.urgency === 'bientôt' ? '🟡' : '🟢';
    const low_confidence_warning = data.confidence_percent < 60 ? `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:13px 15px;margin-bottom:13px;color:var(--red)">⚠️ Confiance basse (${data.confidence_percent}%). <button class="bsm" onclick="doFallbackInternet('${data.primary_diagnosis}')" style="margin-top:7px">🔍 Chercher sur Internet</button></div>` : '';
    const clarify_box = data.clarify_question && data.clarify_question !== 'Je pense avoir assez d\'infos.' ? `<div class="cons cb2" style="margin-top:11px;"><strong>❓ Clarifications:</strong> ${data.clarify_question}</div>` : '';
    const result_html = `<div><div class="card"><div class="ch"><div><div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:2px">DYLAN V3</div><div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;color:#fff">${data.primary_diagnosis}</div></div><div style="display:flex;gap:5px;align-items:center"><span class="sev ${sev}">${data.urgency.toUpperCase()}</span><span style="font-size:10px;padding:3px 7px;border-radius:3px;background:var(--s2);border:1px solid var(--border);color:${confidence_color}">📊 ${data.confidence_percent}%</span><span style="font-size:10px;padding:3px 7px;border-radius:3px;background:var(--s2);border:1px solid var(--border);color:${data.can_drive ? 'var(--green)' : 'var(--red)'}">${data.can_drive ? '✓ Roule' : '✗ Stop'}</span></div></div><div class="cb">${low_confidence_warning}<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.12);border-radius:8px;padding:13px 15px;margin-bottom:13px"><div style="font-size:13px;line-height:1.75;color:#fff;font-weight:500">${data.primary_diagnosis}</div><div style="font-size:12px;color:var(--muted);margin-top:7px;line-height:1.6">Confiance: <strong style="color:${confidence_color}">${data.confidence_percent}%</strong> — Urgence: <strong>${urgency_emoji} ${data.urgency}</strong></div></div>${clarify_box}<div class="dv-box"><div class="dv-t">💶 ESTIMATION DU COÛT</div><div class="dv-r"><span>Coût estimé</span><span>${data.estimated_cost_min}€ — ${data.estimated_cost_max}€</span></div></div>${data.parts_needed && data.parts_needed.length > 0 ? `<div class="slbl">🔩 PIÈCES</div><div class="tags">${data.parts_needed.map(p => '<span class="tag">' + p + '</span>').join('')}</div>` : ''}<button class="bg" onclick="genPDF()">📄 PDF</button><button class="bb" onclick="shr('${data.primary_diagnosis}',${data.estimated_cost_min},${data.estimated_cost_max})">📤 PARTAGER</button></div><div class="rfooter"><div><span class="dot"></span>DYLAN V3</div><div>${new Date().toLocaleString('fr-FR')}</div></div></div></div>`;
    document.getElementById('zd').innerHTML = result_html;
    await refreshCredits();
    toast('✅ Diagnostic V3 prêt', 'ok');
  } catch (error) { errB('zd', error.message); }
  btn.disabled = false; btn.textContent = '⚡ DIAGNOSTIC IA (1 crédit)';
};

// ---- ANALYSE PHOTO (serveur photo_analyze) ----
window.doPhoto = async function (event) {
  const file = event.target.files[0]; if (!file) return;
  if (!useC()) return;
  loader('zd');
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const r = await MecaIA.authedFetch('photo_analyze', { method: 'POST', body: { media_type: file.type, image_base64: e.target.result.split(',')[1] } });
      if (r.status === 402) { openM('m-pay'); toast('Plus de crédits !', 'er'); return; }
      const data = r.data;
      if (!r.ok || !data || !data.success) throw new Error((data && data.error) || 'Erreur analyse');
      const analyse = data.analysis;
      save('Analyse photo', analyse.substring(0, 80), 'photo');
      document.getElementById('zd').innerHTML = `<div class="card"><div class="ch"><div class="ct">📸 ANALYSE PHOTO IA</div></div><div class="cb"><img src="${e.target.result}" style="width:100%;border-radius:8px;margin-bottom:13px;border:1px solid var(--border);max-height:280px;object-fit:cover"><div style="font-size:13px;line-height:1.85;white-space:pre-wrap">${analyse}</div><button class="bb" style="margin-top:11px" onclick="shr('Analyse photo','?','?')">📤 PARTAGER</button></div><div class="rfooter"><div style="display:flex;align-items:center;gap:5px"><span class="dot"></span>ANALYSE PHOTO</div><div>${new Date().toLocaleString('fr-FR')}</div></div></div>`;
      await refreshCredits();
    } catch (err) { errB('zd', err.message); }
  };
  reader.readAsDataURL(file);
};

// ---- VIN (serveur vin_lookup, GRATUIT) ----
window.doVIN = async function () {
  const vin = document.getElementById('v-n').value.trim().toUpperCase();
  if (vin.length < 5) { toast('VIN invalide', 'er'); return; }
  const btn = document.getElementById('btn-v'); btn.disabled = true; btn.textContent = '⏳ DÉCODAGE...';
  loader('zv'); save('Décodage VIN', vin, 'vin');
  try {
    const r = await MecaIA.authedFetch('vin_lookup', { method: 'POST', body: { vin } });
    if (r.status === 429) { toast((r.data && r.data.message) || 'Limite de 3 VIN par jour atteinte.', 'er'); errB('zv', (r.data && r.data.message) || 'Limite de 3 VIN/jour atteinte.'); btn.disabled = false; btn.textContent = '🔍 DÉCODER CE VIN — GRATUIT'; return; }
    const data = r.data;
    if (!r.ok || !data || !data.success) throw new Error((data && data.error) || 'VIN introuvable');
    const v = data.vehicle || {};
    const fl = [['PAYS', v.pays_fabrication], ['CONSTRUCTEUR', v.marque], ['MODÈLE', v.modele], ['ANNÉE', v.annee], ['MOTEUR', v.moteur || (v.cylindree_l ? v.cylindree_l + 'L' : '')], ['CARBURANT', v.carburant], ['CYLINDRES', v.cylindres], ['CARROSSERIE', v.carrosserie], ['N° VIN', data.vin]];
    document.getElementById('zv').innerHTML = `<div class="card"><div class="ch"><div class="ct">VIN DÉCODÉ</div><span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:1px">${data.vin}</span></div><div class="vgrid">${fl.map(f => `<div class="vc"><div class="vcl">${f[0]}</div><div class="vcv">${f[1] || '—'}</div></div>`).join('')}</div><div style="padding:8px 15px;border-top:1px solid var(--border);font-family:'IBM Plex Mono',monospace;font-size:9px;color:rgba(240,165,0,0.7)">⚠️ Source NHTSA — couverture limitée pour certains modèles européens</div><div class="rfooter"><div style="display:flex;align-items:center;gap:5px"><span class="dot"></span>GRATUIT · MECA-IA</div><div>${new Date().toLocaleString('fr-FR')}</div></div></div>`;
  } catch (e) { errB('zv', e.message); }
  btn.disabled = false; btn.textContent = '🔍 DÉCODER CE VIN — GRATUIT';
};

// ---- COMPARATIF PIÈCES (serveur parts_compare, 1 jeton) ----
window.doPieces = async function () {
  const mk = document.getElementById('p-mk').value; const mo = document.getElementById('p-mo').value.trim();
  const an = document.getElementById('p-an').value.trim(); const cb = document.getElementById('p-cb').value;
  const kw = document.getElementById('p-kw').value.trim(); const cy = document.getElementById('p-cy').value.trim();
  const cm = document.getElementById('p-cm').value.trim().toUpperCase(); const km = document.getElementById('p-km').value.trim();
  const pc = document.getElementById('p-pc').value.trim();
  if (!mk || !mo || !pc) { toast('Remplir Marque, Modèle et Pièce', 'er'); return; }
  if (!useC()) return;
  const btn = document.getElementById('btn-p'); btn.disabled = true; btn.textContent = '⏳ RECHERCHE...'; loader('zp');
  const veh = [mk, mo, an, cb, kw && kw + 'kW', cy && cy + 'cm³', cm && 'Code:' + cm, km && km + 'km'].filter(Boolean).join(' ');
  save('Pièces: ' + pc, veh, 'pieces');
  try {
    const r = await MecaIA.authedFetch('parts_compare', { method: 'POST', body: { part_name: pc, vehicle: veh, vehicle_marque: mk, vehicle_modele: mo } });
    if (r.status === 402) { openM('m-pay'); toast('Plus de crédits !', 'er'); btn.disabled = false; btn.textContent = '🔧 TROUVER LES PIÈCES (1 crédit)'; return; }
    const d = r.data;
    if (!r.ok || !d || !d.success) throw new Error((d && d.error) || 'Erreur pièces');
    document.getElementById('zp').innerHTML = `<div class="card"><div class="ch"><div class="ct">${pc.toUpperCase()}</div><span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)">${d.pieces.length} résultats · ${veh}</span></div><div class="plist">${d.pieces.map(p => { const url = 'https://www.autodoc.be/fr/search?query=' + encodeURIComponent(p.reference || p.nom); const uc = p.urgence === 'Immédiat' ? 'var(--red)' : p.urgence === 'Sous 1000km' ? 'var(--accent)' : 'var(--green)'; return `<div class="pi"><div class="pm"><div class="pn">${p.nom}</div><div class="pr">${p.marque} · Réf: ${p.reference}${p.ref_origine ? ' · OEM: ' + p.ref_origine : ''} · <span style="color:var(--accent)">${p.qualite}</span></div><div class="pc">✓ ${p.compatibilite}</div>${p.conseil ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">💬 ${p.conseil}</div>` : ''} ${p.urgence ? `<div style="font-size:10px;color:${uc};margin-top:2px;font-family:'IBM Plex Mono',monospace">⏰ ${p.urgence}</div>` : ''}</div><div class="pp">~${p.prix_min}€<br><span style="font-size:10px;color:var(--muted)">à ${p.prix_max}€</span></div><a href="${url}" target="_blank" style="text-decoration:none"><button class="bsm">COMMANDER →</button></a></div>`; }).join('')}</div><div style="padding:8px 15px;border-top:1px solid var(--border);font-family:'IBM Plex Mono',monospace;font-size:9px;color:rgba(240,165,0,0.7)">⚠️ Références indicatives — vérifier compatibilité avant commande</div><div class="rfooter"><div style="display:flex;align-items:center;gap:5px"><span class="dot"></span>PIÈCES MECA-IA</div><div>${new Date().toLocaleString('fr-FR')}</div></div></div>`;
    await refreshCredits();
  } catch (e) { errB('zp', e.message); }
  btn.disabled = false; btn.textContent = '🔧 TROUVER LES PIÈCES (1 crédit)';
};

// ---- ALERTES ENTRETIEN (serveur alerts_generate) ----
window.doAlertes = async function () {
  const mk = document.getElementById('a-mk').value.trim(); const mo = document.getElementById('a-mo').value.trim();
  const an = document.getElementById('a-an').value.trim(); const km = document.getElementById('a-km').value.trim();
  if (!km) { toast('Entrer le kilométrage', 'er'); return; }
  if (!useC()) return;
  loader('za'); save('Alertes entretien', [mk, mo, km + 'km'].filter(Boolean).join(' '), 'alerte');
  try {
    const r = await MecaIA.authedFetch('alerts_generate', { method: 'POST', body: { vehicle_marque: mk, vehicle_modele: mo, vehicle_annee: an, vehicle_km: parseInt(km) || km } });
    if (r.status === 402) { openM('m-pay'); toast('Plus de crédits !', 'er'); return; }
    const d = r.data;
    if (!r.ok || !d || !d.success) throw new Error((d && d.error) || 'Erreur alertes');
    document.getElementById('za').innerHTML = '<div>' + d.alertes.map(a => { const col = a.urgence === 'Immédiat' ? 'var(--red)' : a.urgence === 'Bientôt' ? 'var(--accent)' : 'var(--green)'; const sv = a.urgence === 'Immédiat' ? 'sevH' : a.urgence === 'Bientôt' ? 'sevM' : 'sevF'; return `<div class="ali" style="border-left:3px solid ${col}"><div style="font-size:19px;flex-shrink:0">${a.icon}</div><div style="flex:1"><div style="font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;color:#fff;margin-bottom:2px">${a.titre}</div><div style="font-size:11px;color:var(--muted)">${a.desc}</div>${a.km_next ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--accent);margin-top:2px">Prochain: ${a.km_next.toLocaleString()} km</div>` : ''}</div><span class="sev ${sv}">${a.urgence}</span></div>`; }).join('') + '</div>';
    await refreshCredits();
  } catch (e) { errB('za', e.message); }
};
