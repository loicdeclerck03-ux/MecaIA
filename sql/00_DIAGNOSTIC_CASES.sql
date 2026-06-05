-- ============================================================
-- 00 — TABLE diagnostic_cases  (À EXÉCUTER EN TOUT PREMIER)
-- Cette table était utilisée par les fonctions/le seed mais n'était
-- créée nulle part. On la crée ici, compatible avec :
--   • INSERT_1500_CASES.sql (seed : vehicle_year, obd_code, embedding)
--   • dylan_agents (sauvegarde organique : user_id, can_drive)
--   • search_diagnostic_cases_text (recherche par mots-clés)
--   • search_diagnostic_cases (recherche vectorielle, pgvector)
-- ============================================================

-- Extension vectorielle (nécessaire pour la colonne embedding + la recherche vectorielle)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS diagnostic_cases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID,                       -- rempli par dylan (sauvegarde organique), NULL pour le seed
  vehicle_marque      TEXT,
  vehicle_modele      TEXT,
  vehicle_year        INTEGER,
  vehicle_km          INTEGER,
  symptoms            TEXT,                        -- seed : texte simple
  obd_code            TEXT,
  primary_diagnosis   TEXT,
  confidence_percent  INTEGER,
  urgency             TEXT,
  can_drive           BOOLEAN,                     -- rempli par dylan
  estimated_cost_min  INTEGER,
  estimated_cost_max  INTEGER,
  parts_needed        JSONB,
  embedding           vector(1536),                -- optionnel : fourni par le seed, NULL sinon
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour accélérer la recherche par mots-clés
CREATE INDEX IF NOT EXISTS idx_diag_cases_marque ON diagnostic_cases (vehicle_marque);
CREATE INDEX IF NOT EXISTS idx_diag_cases_modele ON diagnostic_cases (vehicle_modele);
CREATE INDEX IF NOT EXISTS idx_diag_cases_created ON diagnostic_cases (created_at DESC);

-- Note : la sécurité (RLS) de cette table est gérée par 18_RLS.sql.
-- L'accès applicatif se fait via la clé service (qui contourne RLS),
-- donc la recherche de cas similaires fonctionne sans souci.

-- ============================================================
-- DONE — exécuter ENSUITE 01_SUPABASE_FUNCTIONS.sql, etc.
-- ============================================================
