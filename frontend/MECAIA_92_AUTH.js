/* ============================================================
   MecaIA — ÉTAPE 9.2 — AUTH SUPABASE
   À coller DANS le <script type="module"> existant, EN REMPLACEMENT
   de : window.doLogin, window.doReg, window.doForgot, window.doOut
   ET du bloc onAuthStateChanged(auth, ...).
   On garde tes helpers UI (setAM, showSc, toast, ss, majC, majVis,
   setLang, renderCars, renderMbrs, loadDash, hideLoading, goLand)
   et tes variables (CU, CR, UT, cars, tries, lang, OWNER).
   NB : Firebase reste présent pour l'instant (les données passent à
   Supabase en 9.3, puis on retire Firebase en 9.4).
   ============================================================ */

// ---- Connexion ----
window.doLogin = async function () {
  if (tries >= 5) { setAM('Trop de tentatives. Attendez 5 minutes.', 'err'); return; }
  const em = document.getElementById('l-em').value.trim();
  const pw = document.getElementById('l-pw').value;
  if (!em || !pw) { setAM('Remplir tous les champs.', 'err'); return; }

  const { error } = await MecaIA.signIn(em, pw);
  if (error) {
    tries++;
    setAM(/invalid|credential/i.test(error.message) ? 'Email ou mot de passe incorrect.' : 'Erreur: ' + error.message, 'err');
    return;
  }
  tries = 0; // la session déclenche MecaIA.onAuth -> routage automatique
};

// ---- Inscription ----
window.doReg = async function () {
  const nm = document.getElementById('r-nm').value.trim();
  const em = document.getElementById('r-em').value.trim();
  const pw = document.getElementById('r-pw').value;
  const ty = document.getElementById('r-ty').value;
  if (!nm || !em || !pw) { setAM('Remplir tous les champs.', 'err'); return; }
  if (pw.length < 6) { setAM('Mot de passe minimum 6 caractères.', 'err'); return; }

  // name + type passés en métadonnées -> servent à créer le profil (9.3)
  const { data, error } = await MecaIA.signUp(em, pw, { name: nm, type: ty });
  if (error) {
    setAM(/already|exist|registered/i.test(error.message) ? 'Email déjà utilisé.' : error.message, 'err');
    return;
  }
  if (data && data.session) {
    setAM('✅ Bienvenue sur MecaIA !', 'ok'); // connecté immédiatement
  } else {
    // Si la confirmation email est activée dans Supabase Auth
    setAM('✅ Compte créé ! Vérifie ton email pour confirmer.', 'ok');
  }
};

// ---- Mot de passe oublié ----
window.doForgot = async function () {
  const em = document.getElementById('l-em').value.trim();
  if (!em) { setAM('Entrez votre email d\'abord.', 'err'); return; }
  const { error } = await MecaIA.resetPassword(em);
  setAM(error ? error.message : '✅ Email de réinitialisation envoyé !', error ? 'err' : 'ok');
};

// ---- Déconnexion ----
window.doOut = async function () {
  await MecaIA.signOut();
  goLand();
  toast('Déconnecté', 'ok');
};

// ---- Affichage immédiat de la landing ----
showSc('s-land');
hideLoading();

// ---- Listener de session Supabase (remplace onAuthStateChanged) ----
MecaIA.onAuth(async (user) => {
  if (user) {
    CU = user; // NB: identifiant = user.id (plus user.uid)
    try { await loadProfile(user); } catch (e) { console.log('profil:', e); }
    majVis();
    setLang(lang);
    if (user.email === OWNER) { showSc('s-dash'); loadDash(); }
    else showSc('s-app');
    hideLoading();
  } else {
    CU = null;
    showSc('s-land');
    hideLoading();
  }
});

// ---- Profil : STUB minimal en 9.2 (remplacé par la vraie version en 9.3) ----
// Évite de casser l'UI le temps de migrer la couche données.
async function loadProfile(user) {
  ss('u-nm', (user.user_metadata && user.user_metadata.name) || user.email);
  majC(); // CR/cars seront chargés depuis Supabase en 9.3
}
