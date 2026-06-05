-- ============================================================
-- RECHERCHE DE CAS SIMILAIRES (sans embeddings)
-- Remplace le RAG vectoriel cassé par une recherche par mots-clés
-- qui fonctionne avec la config actuelle (aucune clé d'embeddings).
-- "Prise" propre : on pourra rebrancher un vrai RAG vectoriel plus
-- tard sans toucher au reste.
-- Prérequis : table diagnostic_cases (SUPABASE_FUNCTIONS.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION search_diagnostic_cases_text(
  p_marque TEXT,
  p_modele TEXT,
  p_query  TEXT,
  p_limit  INT DEFAULT 8
)
RETURNS TABLE (
  primary_diagnosis  TEXT,
  confidence_percent INT,
  estimated_cost_min INT,
  estimated_cost_max INT,
  score              INT
) AS $$
  SELECT
    dc.primary_diagnosis,
    dc.confidence_percent,
    dc.estimated_cost_min,
    dc.estimated_cost_max,
    (
      (CASE WHEN COALESCE(p_marque,'') <> '' AND dc.vehicle_marque ILIKE '%'||p_marque||'%' THEN 2 ELSE 0 END) +
      (CASE WHEN COALESCE(p_modele,'') <> '' AND dc.vehicle_modele ILIKE '%'||p_modele||'%' THEN 2 ELSE 0 END) +
      (CASE WHEN COALESCE(p_query,'')  <> '' AND dc.primary_diagnosis ILIKE '%'||p_query||'%' THEN 1 ELSE 0 END)
    )::INT AS score
  FROM diagnostic_cases dc
  WHERE
       (COALESCE(p_marque,'') <> '' AND dc.vehicle_marque ILIKE '%'||p_marque||'%')
    OR (COALESCE(p_modele,'') <> '' AND dc.vehicle_modele ILIKE '%'||p_modele||'%')
    OR (COALESCE(p_query,'')  <> '' AND dc.primary_diagnosis ILIKE '%'||p_query||'%')
  ORDER BY score DESC, dc.confidence_percent DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION search_diagnostic_cases_text
  TO authenticated, anon, service_role;

-- ============================================================
-- DONE
-- ============================================================
