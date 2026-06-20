"""
MecaIA — Import gros fichiers vers Supabase
Loïc : Lance ce script sur ton PC. Il tourne tout seul.
Durée estimée : 20-40 min selon ta connexion

PRÉREQUIS :
  pip install psycopg2-binary

USAGE :
  python import_gros_fichiers.py

ÉTAPE 1 : Récupère ton mot de passe Supabase
  → supabase.com → ton projet → Settings → Database
  → "Connection string" mode "Transaction"
  → Copie le mot de passe et remplace [MOT_DE_PASSE] ci-dessous
"""

import csv, os, sys
from datetime import datetime

SUPABASE_DB = "postgresql://postgres.vexxjbpbfrvgszvzpmgu:[MOT_DE_PASSE]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
BASE = r"C:\Users\pasmoi\Desktop\code default et info voiture"

def clean(v, max_len=500):
    if v is None: return None
    s = str(v).strip()
    return s[:max_len] if s else None

def boolv(v): return str(v).lower() in ('true','1','yes')

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def import_table(conn, table, rows, conflict_cols, batch=500):
    if not rows:
        log(f"  {table} : aucune ligne")
        return 0
    cur = conn.cursor()
    cols = list(rows[0].keys())
    ph = ','.join(['%s'] * len(cols))
    col_str = ','.join(f'"{c}"' for c in cols)
    sql = f'INSERT INTO {table} ({col_str}) VALUES ({ph}) ON CONFLICT ({conflict_cols}) DO NOTHING'
    total = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i+batch]
        try:
            cur.executemany(sql, [tuple(r.get(c) for c in cols) for r in chunk])
            conn.commit()
            total += len(chunk)
            log(f"  {table} : {total}/{len(rows)}")
        except Exception as e:
            conn.rollback()
            log(f"  ERREUR: {e}")
    cur.close()
    return total

def create_tables(conn):
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS repair_procedures (
      id BIGSERIAL PRIMARY KEY, source TEXT, niveau TEXT,
      make TEXT, model TEXT, model_year TEXT, engine_code TEXT,
      fuel_type TEXT, category TEXT, system_type TEXT,
      dtc_code TEXT, recall_number TEXT, recall_date TEXT,
      procedure_en TEXT, procedure_fr TEXT, notification_type TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(recall_number, make, model, dtc_code)
    );
    CREATE INDEX IF NOT EXISTS idx_rp_make ON repair_procedures(make);
    CREATE INDEX IF NOT EXISTS idx_rp_dtc ON repair_procedures(dtc_code);
    CREATE TABLE IF NOT EXISTS eu_safety_alerts (
      id BIGSERIAL PRIMARY KEY, source TEXT, niveau TEXT,
      alert_number TEXT UNIQUE, alert_date TEXT, alert_level TEXT,
      alert_country TEXT, product_name TEXT, product_brand TEXT,
      alert_description TEXT, technical_defect TEXT, alert_type TEXT, rapex_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_eu_brand ON eu_safety_alerts(product_brand);
    """)
    conn.commit()
    cur.close()
    log("Tables OK")

def import_tc_canada(conn):
    fp = os.path.join(BASE, "PROCEDURES", "tc_canada_procedures.csv")
    if not os.path.exists(fp): log("tc_canada introuvable"); return
    log("Lecture TC Canada...")
    seen, rows = set(), []
    with open(fp, newline='', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            key = f"{clean(r.get('recall_number'))}|{clean(r.get('make'))}|{clean(r.get('model'))}|{clean(r.get('dtc_code'))}"
            if key in seen: continue
            seen.add(key)
            rows.append({
                "source": "Transport Canada VRDB", "niveau": "NIVEAU_1",
                "make": clean(r.get('make')), "model": clean(r.get('model')),
                "model_year": clean(r.get('model_year')), "engine_code": clean(r.get('engine_code')),
                "fuel_type": clean(r.get('fuel_type')), "category": clean(r.get('category')),
                "system_type": clean(r.get('system_type')), "dtc_code": clean(r.get('dtc_code')),
                "recall_number": clean(r.get('recall_number')), "recall_date": clean(r.get('recall_date')),
                "procedure_en": clean(r.get('procedure_en'), 800),
                "procedure_fr": clean(r.get('procedure_fr'), 800),
                "notification_type": clean(r.get('notification_type')),
            })
    log(f"  {len(rows)} uniques sur 117977")
    n = import_table(conn, "repair_procedures", rows, "recall_number,make,model,dtc_code")
    log(f"TC Canada : {n} lignes importées ✅")

def import_rapex(conn):
    fp = os.path.join(BASE, "PANNES", "COMPLAINTS", "rapex_eu_motor_vehicles.csv")
    if not os.path.exists(fp): log("rapex introuvable"); return
    log("Lecture RAPEX EU...")
    seen, rows = set(), []
    with open(fp, newline='', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            no = clean(r.get('alert_number'))
            if not no or no in seen: continue
            seen.add(no)
            rows.append({
                "source": "EU Safety Gate RAPEX", "niveau": "NIVEAU_1",
                "alert_number": no, "alert_date": clean(r.get('alert_date')),
                "alert_level": clean(r.get('alert_level')), "alert_country": clean(r.get('alert_country')),
                "product_name": clean(r.get('product_name'), 200),
                "product_brand": clean(r.get('product_brand')),
                "alert_description": clean(r.get('alert_description'), 500),
                "technical_defect": clean(r.get('technical_defect'), 500),
                "alert_type": clean(r.get('alert_type')), "rapex_url": clean(r.get('rapex_url')),
            })
    log(f"  {len(rows)} alertes EU")
    n = import_table(conn, "eu_safety_alerts", rows, "alert_number")
    log(f"RAPEX : {n} alertes importées ✅")

if __name__ == "__main__":
    try:
        import psycopg2
    except ImportError:
        print("Lance d'abord : pip install psycopg2-binary")
        sys.exit(1)
    if "[MOT_DE_PASSE]" in SUPABASE_DB:
        print("⚠️  Configure le mot de passe dans le script !")
        print("Supabase > Settings > Database > Connection string")
        sys.exit(1)
    log("Connexion...")
    conn = psycopg2.connect(SUPABASE_DB)
    create_tables(conn)
    log("=== TC CANADA (117 977 lignes) ===")
    import_tc_canada(conn)
    log("=== RAPEX EU (6 892 alertes) ===")
    import_rapex(conn)
    conn.close()
    log("=== TOUT TERMINÉ ===")
