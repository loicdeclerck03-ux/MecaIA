-- ============================================================
-- CORRECTIFS BASE DE DONNÉES
-- 1) SUPABASE_FUNCTIONS.sql créait le TRIGGER avant la FONCTION
--    qu'il référence -> le script échouait. On (re)crée dans le bon ordre.
-- 2) On enregistre désormais des cas SANS embedding (RAG par mots-clés),
--    donc la colonne embedding doit être optionnelle.
-- À exécuter APRÈS SUPABASE_FUNCTIONS.sql.
-- ============================================================

-- 1) Fonction AVANT le trigger
CREATE OR REPLACE FUNCTION update_diagnostic_embedding()
RETURNS TRIGGER AS $$
BEGIN
  -- Réservé à un post-traitement futur. Ne bloque rien.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS index_new_diagnostic ON diagnostic_cases;
CREATE TRIGGER index_new_diagnostic
AFTER INSERT ON diagnostic_cases
FOR EACH ROW
EXECUTE FUNCTION update_diagnostic_embedding();

-- 2) embedding optionnel (si la colonne existe et est NOT NULL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'diagnostic_cases' AND column_name = 'embedding'
  ) THEN
    BEGIN
      ALTER TABLE diagnostic_cases ALTER COLUMN embedding DROP NOT NULL;
    EXCEPTION WHEN others THEN
      -- déjà nullable ou non applicable : on ignore
      NULL;
    END;
  END IF;
END $$;

-- ============================================================
-- DONE
-- ============================================================
