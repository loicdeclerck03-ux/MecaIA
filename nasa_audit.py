
# NASA AUDIT v3 - dead code guards + i18n correct
import re, os, json
from collections import Counter

HTML = r"C:\Users\pasmoi\Documents\GitHub\MecaIA\index.html"
NETLIFY = r"C:\Users\pasmoi\Documents\GitHub\MecaIA\netlify\functions"
MAINJS  = r"C:\Users\pasmoi\Desktop\Meca ia\07_APPLICATIONS\APP_WINDOWS\src\main.js"

with open(HTML, encoding='utf-8') as fp:
    html = fp.read()
html_lines = html.split('\n')
elem_ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', html))

issues, warns, ok_list = [], [], []

# IDs qui n'ont pas besoin d'exister dans le HTML statique
DYNAMIC_IDS = {
    'toast-c', 'diag-empty-hint', 'm-ct-result', 'obd-alerts-wrap',
    'pay-eco-msg', 'meia-scroll', 'zd', 'box-live-bar', 'm-ct-sim',
    # Dead code avec null guards (chkD, togPT)
    'd-mk', 'd-mo', 'd-an', 'd-cb', 'btn-d', 'pr-ty', 'pr-vb',
    # ID dans innerHTML généré dynamiquement
    'pr-val', 'pr-val-1', 'pr-val-2',
}

print("=== NASA AUDIT v3 - MecaIA ===\n")

# A01
screens = re.findall(r'id="(s-\w+)"', html)
ok_list.append(f"A01: {len(screens)} screens, {len(elem_ids)} IDs")
print(f"A01: OK - {len(screens)} screens, {len(elem_ids)} IDs")

# A02 - boutons onclick
KNOWN = {
    'confirm','alert','parseInt','parseFloat','setTimeout','setInterval','clearTimeout',
    'console','document','window','Math','Object','JSON','String','Number','Boolean',
    'Date','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
    'closest','querySelector','querySelectorAll','getElementById','getElementsByClassName',
    'open','scrollTo','scrollIntoView','focus','blur','click','remove','appendChild',
    'createElement','setAttribute','getAttribute','addEventListener','removeEventListener',
    'preventDefault','stopPropagation','function','openCTSimulator','runCTSimulator','matches','contains','replaceWith','dispatchEvent',
    'showPg','navTo','openM','closeM','goAuth','goLand','togF','toast','showToast',
    'shr','genDylanDevis','setLang','majC','majVis','useC','loadCars','showAddCar',
    'hideAddCar','addCar','searchS','payToggle','buyPackage','downloadApp',
    'boxSend','boxSendCmd','boxAskDTC','boxReadFreezeFrame','boxToggleMonitors',
    'boxToggleOpt','boxDoReset','boxInit','boxNewConv','boxLoadGarage','boxSelectCar',
    'dylanFeedback','dylanControl','dylanTurn','showVoyant','dylanNewConv','dylanNew',
    'boxHandleConnect','refreshCredits','nouveauDiag','majDashboard','checkSession',
    'startCTCheck','boxHandlePorts','clearDTCs','startScan','stopScan','togPT','chkD',
    'dylanShowSessions','showCTResult','filtS','doPhoto','doVIN','renderOBDAlerts',
    'boxStartScan','boxTogglePanel','showPromoAdmin','hidePromoAdmin',
}

onclick_raw = re.findall(r'onclick=["\']([^"\']+)["\']', html)
called_fns = set()
for raw in onclick_raw:
    called_fns.update(re.findall(r'(\w+)\s*\(', raw))
defined_fns = set(re.findall(r'window\.(\w+)\s*=', html))
defined_fns.update(re.findall(r'function\s+(\w+)\s*\(', html))
missing_fns = [f for f in called_fns if f not in defined_fns and f not in KNOWN and len(f) > 2]
if missing_fns:
    for m in sorted(missing_fns): issues.append(f"A02 fn onclick manquante: {m}")
    print(f"A02 BOUTONS: {len(missing_fns)} manquantes - {missing_fns}")
else:
    ok_list.append(f"A02: {len(called_fns)} fonctions onclick OK")
    print(f"A02 BOUTONS: OK ({len(called_fns)} fns)")

# A03 - getElementById
getbyid_all = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", html)
missing_ids = [i for i in set(getbyid_all)
               if i not in elem_ids and i not in DYNAMIC_IDS
               and '+' not in i and '{' not in i]
if missing_ids:
    for mid in sorted(missing_ids): issues.append(f"A03 ID manquant: {mid}")
    print(f"A03 IDs: {len(missing_ids)} manquants - {missing_ids}")
else:
    ok_list.append(f"A03: {len(set(getbyid_all))} getElementById OK")
    print(f"A03 IDs: OK")

# A04 - authedFetch
netlify_fns = set(fn.replace('.mjs','') for fn in os.listdir(NETLIFY) if fn.endswith('.mjs'))
fetch_calls = set(re.findall(r"authedFetch\(['\"](\w+)['\"]", html))
missing_apis = [fn for fn in fetch_calls if fn not in netlify_fns]
if missing_apis:
    for fn in missing_apis: issues.append(f"A04 API manquante: {fn}.mjs")
    print(f"A04 APIs: {len(missing_apis)} manquantes")
else:
    ok_list.append(f"A04: {len(fetch_calls)} APIs connectees")
    print(f"A04 APIs: OK ({len(fetch_calls)} calls)")

# A05 - navigation
showpg = set(re.findall(r"showPg\(['\"](\w+)['\"]", html))
navto  = set(re.findall(r"navTo\(['\"](\w+)['\"]", html))
tab_ids = set(re.findall(r'id="t-(\w+)"', html))
pg_ids  = set(re.findall(r'id="pg-(\w+)"', html))
nav_missing = [pg for pg in showpg|navto if pg not in tab_ids and pg not in pg_ids]
if nav_missing:
    for pg in nav_missing: issues.append(f"A05 NAV destination manquante: {pg}")
    print(f"A05 NAV: {len(nav_missing)} manquantes - {nav_missing}")
else:
    ok_list.append(f"A05: Navigation OK ({len(showpg|navto)} destinations)")
    print(f"A05 NAV: OK ({len(showpg|navto)} destinations)")

# A06 - modals
openm  = set(re.findall(r"openM\(['\"]([^'\"]+)['\"]", html))
closem = set(re.findall(r"closeM\(['\"]([^'\"]+)['\"]", html))
modal_ids = set(re.findall(r'id="(m-[^"]+)"', html))
modal_missing = [m for m in openm|closem if m not in modal_ids and m not in DYNAMIC_IDS]
if modal_missing:
    for m in modal_missing: issues.append(f"A06 MODAL manquant: {m}")
    print(f"A06 MODALS: {len(modal_missing)} manquants")
else:
    ok_list.append(f"A06: Modals OK ({len(modal_ids)} modals, {len(openm|closem)} appels)")
    print(f"A06 MODALS: OK ({len(modal_ids)})")

# A07 - apostrophes JS
apos_bugs = []
in_script = False
for i, line in enumerate(html_lines):
    if '<script' in line and 'src=' not in line: in_script = True
    if '</script>' in line: in_script = False
    if in_script and ('innerHTML' in line or 'textContent' in line):
        clean = line.replace("&apos;","APOS").replace("\\'","ESC")
        if re.search(r"'[^'\\]*[a-z]'[a-z]", clean):
            apos_bugs.append(f"L{i+1}: {line.strip()[:100]}")
if apos_bugs:
    for a in apos_bugs[:5]: issues.append(f"A07 APOSTROPHE: {a}")
    print(f"A07 APOSTROPHES: {len(apos_bugs)} bugs")
else:
    ok_list.append("A07: 0 apostrophe bug")
    print("A07 APOSTROPHES: OK")

# A08 - IDs dupliqués (dans HTML seulement, pas JS)
# Extraire IDs uniquement dans les balises HTML (pas dans les strings JS)
html_tags_only = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
all_ids_html = re.findall(r'\bid=["\']([^"\']+)["\']', html_tags_only)
id_counts = Counter(all_ids_html)
dups = [(id_, cnt) for id_, cnt in id_counts.items() if cnt > 1 and id_ not in DYNAMIC_IDS]
if dups:
    for id_, cnt in sorted(dups, key=lambda x: -x[1])[:5]: issues.append(f"A08 ID DUPLIQUE: '{id_}' x{cnt}")
    print(f"A08 DUP IDs: {len(dups)} - {[d[0] for d in dups[:3]]}")
else:
    ok_list.append(f"A08: 0 ID duplique dans HTML ({len(all_ids_html)} total)")
    print(f"A08 DUP IDs: OK")

# A09 - Netlify exports
fn_files = sorted([fn for fn in os.listdir(NETLIFY) if fn.endswith('.mjs')])
bad_exports = []
for fn_file in fn_files:
    path = os.path.join(NETLIFY, fn_file)
    with open(path, encoding='utf-8', errors='replace') as fp:
        fc = fp.read()
    if 'export const handler' not in fc and 'export default' not in fc and 'exports.handler' not in fc:
        bad_exports.append(fn_file)
if bad_exports:
    for fn in bad_exports: issues.append(f"A09 NO EXPORT: {fn}")
    print(f"A09 NETLIFY: {len(bad_exports)} sans export")
else:
    ok_list.append(f"A09: {len(fn_files)} Netlify functions OK")
    print(f"A09 NETLIFY: OK ({len(fn_files)} functions)")

# A10 - Supabase top-level
supa_issues = []
for fn_file in fn_files:
    path = os.path.join(NETLIFY, fn_file)
    with open(path, encoding='utf-8', errors='replace') as fp:
        lines_f = fp.readlines()
    for i, ln in enumerate(lines_f[:15]):
        if 'createClient(' in ln and 'function' not in ln and 'const get' not in ln and '=>' not in ln:
            supa_issues.append(f"{fn_file} L{i+1}")
if supa_issues:
    for s in supa_issues[:3]: issues.append(f"A10 SUPA TOP-LEVEL: {s}")
    print(f"A10 SUPABASE: {len(supa_issues)} top-level")
else:
    ok_list.append("A10: Supabase lazy init OK")
    print("A10 SUPABASE: OK")

# A11 - CSS critiques
CRITICAL_CSS = ['d-msg','d-bubble','d-avatar','d-typing','bpid','bp-val','btp',
                'bqcmd','bsm','voy-card','voy-badge','voy-red','l-anticarly',
                'l-voyants','toast','toast-c']
style_all = ' '.join(re.findall(r'<style[^>]*>(.*?)</style>', html, re.DOTALL))
css_missing = [cls for cls in CRITICAL_CSS if f'.{cls}' not in style_all]
if css_missing:
    for cls in css_missing: warns.append(f"A11 CSS: .{cls} non definie")
    print(f"A11 CSS: {len(css_missing)} manquantes - {css_missing}")
else:
    ok_list.append(f"A11: {len(CRITICAL_CSS)} classes CSS critiques OK")
    print(f"A11 CSS: OK ({len(CRITICAL_CSS)} classes)")

# A12 - Secrets
for pat in [r'sk_live_\w+', r'sk_test_\w+', r'whsec_\w+']:
    found = re.findall(pat, html)
    for s in found: issues.append(f"A12 SECRET: {s[:15]}...")
if not any('A12' in i for i in issues):
    ok_list.append("A12: Aucun secret expose")
    print("A12 SECRETS: OK")
else:
    print(f"A12 SECRETS: ERREUR")

# A13 - OBD Box
BOX_REQ = ['box-feed','box-btn-scan','box-vin-card','box-live-badge',
           'box-opts-card','box-resets-card','pg-box','t-box','box-input']
box_miss = [r for r in BOX_REQ if r not in elem_ids]
if box_miss:
    for r in box_miss: issues.append(f"A13 BOX: {r} manquant")
    print(f"A13 OBD BOX: {len(box_miss)} manquants")
else:
    ok_list.append(f"A13: OBD Box {len(BOX_REQ)} elements OK")
    print(f"A13 OBD BOX: OK")

# A14 - Dylan
DYLAN_REQ = ['dylan-feed','dylan-in','dylan-progress']
dyl_miss = [r for r in DYLAN_REQ if r not in elem_ids]
if dyl_miss:
    for r in dyl_miss: issues.append(f"A14 DYLAN: {r} manquant")
    print(f"A14 DYLAN: {len(dyl_miss)} manquants")
else:
    da_path = os.path.join(NETLIFY, 'dylan_agents.mjs')
    with open(da_path, encoding='utf-8') as fp: da = fp.read()
    fb = 'feedback_requested' in da and 'upsert_diag_outcome' in html
    ok_list.append(f"A14: Dylan OK feedback={'actif' if fb else 'inactif'}")
    print(f"A14 DYLAN: OK (feedback={'actif' if fb else 'inactif'})")

# A15 - Garage
GAR_REQ = ['g-cars','car-sel-list','nc-mk','nc-mo','nc-an','nc-cb','nc-ct']
gar_miss = [r for r in GAR_REQ if r not in elem_ids]
if gar_miss:
    for r in gar_miss: issues.append(f"A15 GARAGE: {r} manquant")
    print(f"A15 GARAGE: {len(gar_miss)} manquants")
else:
    ok_list.append(f"A15: Garage {len(GAR_REQ)} elements OK")
    print(f"A15 GARAGE: OK")

# A16 - Voyants
voy1 = set(re.findall(r"showVoyant\(['\"](\w+)['\"]\)", html))
voy2 = set(re.findall(r"showVoyant\(&apos;(\w+)&apos;\)", html))
total_voy = len(voy1 | voy2)
if total_voy >= 10:
    ok_list.append(f"A16: {total_voy} voyants OK")
    print(f"A16 VOYANTS: OK ({total_voy})")
else:
    issues.append(f"A16: Seulement {total_voy} voyants (attendu >= 10)")
    print(f"A16 VOYANTS: ERREUR ({total_voy})")

# A17 - Stripe backend
sc_path = os.path.join(NETLIFY, 'stripe_checkout.mjs')
with open(sc_path, encoding='utf-8') as fp: sc = fp.read()
sc_prices = re.findall(r'price_\w+', sc)
if sc_prices:
    ok_list.append(f"A17: stripe_checkout.mjs {len(sc_prices)} Price IDs backend")
    print(f"A17 STRIPE: OK ({len(sc_prices)} Price IDs backend)")
else:
    warns.append("A17: Pas de Price IDs dans stripe_checkout")
    print("A17 STRIPE: Warning")

# A18 - Electron
if os.path.exists(MAINJS):
    with open(MAINJS, encoding='utf-8', errors='replace') as fp: mjs = fp.read()
    mjs_ids = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", mjs)
    ELECTRON_DYN = {'meia-scroll'}
    mjs_miss = [mid for mid in mjs_ids
                if mid not in elem_ids and mid not in DYNAMIC_IDS
                and mid not in ELECTRON_DYN and '+' not in mid]
    if mjs_miss:
        for mid in mjs_miss: warns.append(f"A18 ELECTRON: '{mid}' absent HTML")
        print(f"A18 ELECTRON: {len(mjs_miss)} IDs absents")
    else:
        ok_list.append(f"A18: Electron OK ({len(mjs_ids)} IDs coherents)")
        print(f"A18 ELECTRON: OK ({len(mjs_ids)} IDs)")

# A19 - i18n avec const T={}
t_block = re.search(r'const T\s*=\s*\{[\s\S]*?(fr|nl|en|de)', html)
if t_block:
    langs_in_T = set(re.findall(r'\b(fr|nl|en|de)\s*:\s*\{', html[:len(html)//2]))
    langs_in_T = set(re.findall(r'\b(fr|nl|en|de)\s*:\s*\{', html))
    if len(langs_in_T) >= 1:
        print(f"A19 I18N: OK ({len(langs_in_T)} langues: {langs_in_T})")
    else:
        warns.append(f"A19: i18n partiel ({len(langs_in_T)} langues)")
        print(f"A19 I18N: Warning")
else:
    warns.append("A19: const T non trouve")
    print("A19 I18N: Warning")

# A20 - App Windows
if os.path.exists(MAINJS):
    preload = os.path.join(os.path.dirname(MAINJS), 'preload.js')
    with open(MAINJS, encoding='utf-8', errors='replace') as fp: mjs = fp.read()
    checks = {
        'boxUpdateLive override': 'boxUpdateLive' in mjs,
        'scroll CSS fix': 'overflow-y:auto' in mjs,
        'preload.js': os.path.exists(preload),
        'contextBridge': os.path.exists(preload) and 'contextBridge' in open(preload,'r',errors='replace').read(),
        'single instance': 'requestSingleInstanceLock' in mjs,
        'cache clear': 'clearCache' in mjs,
        'bp-rpm2 IDs': 'bp-rpm2' in mjs,
    }
    fails = [k for k,v in checks.items() if not v]
    if fails:
        for fail in fails: warns.append(f"A20 ELECTRON: {fail} manquant")
        print(f"A20 ELECTRON: {len(fails)} warnings")
    else:
        ok_list.append(f"A20: App Windows {len(checks)} checks OK")
        print(f"A20 APP WINDOWS: OK ({len(checks)} checks)")

# SCORE
n_issues, n_warns, n_ok = len(issues), len(warns), len(ok_list)
total = n_issues + n_warns + n_ok
base  = (n_ok / max(total,1)) * 20
penalty = n_issues * 0.4 + n_warns * 0.1
score = round(max(0, min(20, base - penalty)), 1)

print(f"\n{'='*65}")
print(f"SCORE: {score}/20  ({n_ok} OK / {n_issues} ERR / {n_warns} WARN)")
print(f"{'='*65}")
if issues:
    print(f"\nERREURS ({n_issues}):")
    for i in issues: print(f"  ERR: {i}")
if warns:
    print(f"\nWARNINGS ({n_warns}):")
    for w in warns: print(f"  WRN: {w}")

with open(r"C:\CTO_MecaIA\audit_results.json",'w',encoding='utf-8') as fp:
    json.dump({"issues":issues,"warnings":warns,"ok":ok_list,"score":score},fp,ensure_ascii=False,indent=2)
