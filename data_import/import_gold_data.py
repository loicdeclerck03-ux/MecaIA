"""
MecaIA — Import données gold
Exécuter DEPUIS le dossier : cd C:\Users\pasmoi\Documents\GitHub\MecaIA\data_import
Puis : set SUPABASE_SERVICE_KEY=eyJhbGci... && python import_gold_data.py
"""
import csv, json, requests, os, sys

# ─── CONFIG ─────────────────────────────────────────────────────────────────
SUPABASE_URL = "https://vexxjbpbfrvgszvzpmgu.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_KEY:
    print("\n❌ ERREUR: Il faut la clé service_role de Supabase.")
    print("   Supabase > Settings > API > service_role key")
    print("   Puis relancer: set SUPABASE_SERVICE_KEY=eyJhbGci... && python import_gold_data.py")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

BASE_DATA = r"C:\Users\pasmoi\Desktop\code default et info voiture"

# ─── HELPERS ────────────────────────────────────────────────────────────────
def insert_batch(table, rows):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    total = 0
    for i in range(0, len(rows), 100):
        batch = rows[i:i+100]
        r = requests.post(url, headers=HEADERS, json=batch)
        if r.status_code not in (200, 201, 204):
            print(f"  ⚠ Batch {i//100+1} erreur {r.status_code}: {r.text[:300]}")
        else:
            total += len(batch)
            print(f"  ✓ {total}/{len(rows)} lignes importées", end='\r')
    print(f"  ✓ {total} lignes importées")

# ─── 1. PANNES MASTER → diagnostic_cases ─────────────────────────────────────
print("\n=== 1. pannes_MASTER.csv → diagnostic_cases ===")
path_pannes = rf"{BASE_DATA}\PANNES\CURATED\pannes_MASTER.csv"

def urgency_from(fault, risk):
    if any(x in (fault or '') for x in ['BRAKE','OIL_PRESSURE','COOLANT_TEMP']):
        return 'high'
    if 'MOYEN' in (risk or ''):
        return 'medium'
    return 'low'

rows = []
with open(path_pannes, encoding='utf-8') as f:
    for row in csv.DictReader(f):
        labor = float(row.get('labor_hours_est') or 0)
        dtc_raw = row.get('dtc_codes','') or ''
        first_code = dtc_raw.split('|')[0].strip() if dtc_raw and 'Aucun' not in dtc_raw else None
        yr = (int(row.get('year_from') or 2010) + int(row.get('year_to') or 2020)) // 2
        parts_raw = row.get('parts_replaced','') or ''
        parts_json = [{"name": p.strip()} for p in parts_raw.split('+') if p.strip() and 'Aucune' not in p]
        
        rows.append({
            "user_id": None,
            "vehicle_marque": row.get('make',''),
            "vehicle_modele": (row.get('model','') + ' ' + row.get('engine','')).strip(),
            "vehicle_year": yr,
            "vehicle_km": int(row.get('mileage_km_typical') or 0),
            "symptoms": row.get('symptom_fr',''),
            "obd_code": first_code,
            "primary_diagnosis": (row.get('root_cause_fr','') +
                ' | Réparation: ' + row.get('solution_fr','') +
                ' | MO: ' + str(row.get('labor_hours_est','')) + 'h' +
                ' | Source: ' + row.get('source','')),
            "confidence_percent": 85,
            "urgency": urgency_from(row.get('fault_system'), row.get('recurrence_risk')),
            "can_drive": not any(x in (row.get('fault_system','')) for x in ['BRAKE','OIL_PRESSURE']),
            "estimated_cost_min": max(int(labor * 80), 50) if labor else None,
            "estimated_cost_max": max(int(labor * 150), 100) if labor else None,
            "parts_needed": parts_json or None,
        })

print(f"  {len(rows)} cas à importer...")
insert_batch("diagnostic_cases", rows)

# ─── 2. DTC CLASSIC → dtc_procedures ─────────────────────────────────────────
print("\n=== 2. dtc_classic_procedures.csv → dtc_procedures ===")
path_classic = rf"{BASE_DATA}\PROCEDURES\procedure part 2\PROCEDURES\dtc_classic_procedures.csv"

with open(path_classic, encoding='utf-8') as f:
    reader = csv.DictReader(f)
    headers_csv = reader.fieldnames
    print(f"  Colonnes CSV: {headers_csv}")
    rows_classic = list(reader)

print(f"  {len(rows_classic)} procédures classiques à importer...")
# Colonnes table: make, model, model_year, engine_code, fuel_type, dtc_code, system_type, defect_description_fr, procedure_fr, niveau
TABLE_COLS = {'make','model','model_year','engine_code','fuel_type','dtc_code','system_type','defect_description_fr','procedure_fr','niveau'}
rows_mapped = []
for row in rows_classic:
    mapped = {k: v for k, v in row.items() if k in TABLE_COLS and v}
    if mapped.get('dtc_code'):
        rows_mapped.append(mapped)

insert_batch("dtc_procedures", rows_mapped)

# ─── 3. DTC US/JAPON → dtc_procedures ─────────────────────────────────────────
print("\n=== 3. dtc_us_japan_procedures.csv → dtc_procedures ===")
path_usj = rf"{BASE_DATA}\PROCEDURES\procedure part 2\PROCEDURES\dtc_us_japan_procedures.csv"

with open(path_usj, encoding='utf-8') as f:
    reader = csv.DictReader(f)
    rows_usj = list(reader)

print(f"  {len(rows_usj)} procédures US/Japon à importer...")
rows_usj_mapped = []
for row in rows_usj:
    mapped = {k: v for k, v in row.items() if k in TABLE_COLS and v}
    if mapped.get('dtc_code'):
        rows_usj_mapped.append(mapped)

insert_batch("dtc_procedures", rows_usj_mapped)

# ─── RÉSUMÉ ───────────────────────────────────────────────────────────────────
print("\n✅ Import terminé !")
print("Vérifier dans Supabase > Table Editor")
