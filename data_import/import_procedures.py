"""
MecaIA — Import procedures DTC classiques + US/Japon
Utilise psycopg2 — pas de cle service_role necessaire
Lancer : python import_procedures.py
"""
import csv, psycopg2, psycopg2.extras, os, sys

DB_PASSWORD = input("Mot de passe Supabase DB (Settings > Database) : ").strip()
DSN = f"postgresql://postgres.vexxjbpbfrvgszvzpmgu:{DB_PASSWORD}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
BASE = r"C:\Users\pasmoi\Desktop\code default et info voiture"
COLS = {'make','model','model_year','engine_code','fuel_type','dtc_code','system_type','defect_description_fr','procedure_fr','niveau'}

def import_csv(conn, path, label):
    print(f"\n=== {label} ===")
    rows = []
    with open(path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            m = {k: v for k,v in row.items() if k in COLS and v and v.strip()}
            if m.get('dtc_code') and m.get('procedure_fr'):
                rows.append(m)
    if not rows:
        print("  Aucune ligne valide"); return
    cols = sorted(COLS & set(rows[0].keys()))
    sql = f"INSERT INTO dtc_procedures ({','.join(cols)}) VALUES %s ON CONFLICT DO NOTHING"
    with conn.cursor() as cur:
        total = 0
        for i in range(0, len(rows), 500):
            batch = [[r.get(c) for c in cols] for r in rows[i:i+500]]
            psycopg2.extras.execute_values(cur, sql, batch)
            conn.commit()
            total += len(batch)
            print(f"  {total}/{len(rows)}", end='\r')
    print(f"  OK {total} lignes")

conn = psycopg2.connect(DSN, connect_timeout=10)
print("Connecte")
import_csv(conn, rf"{BASE}\PROCEDURES\procedure part 2\PROCEDURES\dtc_classic_procedures.csv", "Procedures EU classiques")
import_csv(conn, rf"{BASE}\PROCEDURES\procedure part 2\PROCEDURES\dtc_us_japan_procedures.csv", "Procedures US/Japon")
with conn.cursor() as cur:
    cur.execute("SELECT COUNT(*) FROM dtc_procedures"); print(f"\nTotal dtc_procedures : {cur.fetchone()[0]}")
conn.close()
