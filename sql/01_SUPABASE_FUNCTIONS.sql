-- ============================================================
-- SUPABASE FUNCTIONS — Pour RAG + Recherche
-- ============================================================

-- 1️⃣ FONCTION: Recherche semantic (avec pgvector)
CREATE OR REPLACE FUNCTION search_diagnostic_cases(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  similarity_threshold float DEFAULT 0.6
)
RETURNS TABLE (
  id uuid,
  vehicle_marque text,
  vehicle_modele text,
  primary_diagnosis text,
  confidence_percent int,
  estimated_cost_min int,
  estimated_cost_max int,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.vehicle_marque,
    dc.vehicle_modele,
    dc.primary_diagnosis,
    dc.confidence_percent,
    dc.estimated_cost_min,
    dc.estimated_cost_max,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM diagnostic_cases dc
  WHERE 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- 2️⃣ FONCTION: Récupérer stats accumulation
CREATE OR REPLACE FUNCTION get_accumulation_stats()
RETURNS TABLE (
  total_cases int,
  average_confidence float,
  most_common_diagnosis text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::int as total_cases,
    AVG(confidence_percent)::float as average_confidence,
    (SELECT primary_diagnosis FROM diagnostic_cases 
     GROUP BY primary_diagnosis ORDER BY COUNT(*) DESC LIMIT 1) as most_common_diagnosis
  FROM diagnostic_cases;
END;
$$ LANGUAGE plpgsql;

-- 3️⃣ FONCTION puis TRIGGER : auto-indexer les nouveaux cas
--    (la FONCTION doit être créée AVANT le trigger, sinon erreur)
CREATE OR REPLACE FUNCTION update_diagnostic_embedding()
RETURNS TRIGGER AS $$
BEGIN
  -- Embedding fourni en amont (ou NULL). Post-traitement éventuel ici.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS index_new_diagnostic ON diagnostic_cases;
CREATE TRIGGER index_new_diagnostic
AFTER INSERT ON diagnostic_cases
FOR EACH ROW
EXECUTE FUNCTION update_diagnostic_embedding();

-- ✅ Tout prêt pour la recherche semantic!
