-- ============================================================
-- LIMITE VIN — 3 décodages gratuits par jour et par utilisateur
-- (le VIN reste gratuit, mais plafonné pour éviter les abus).
-- Reset à minuit UTC.
-- ============================================================

CREATE TABLE IF NOT EXISTS vin_lookups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  vin        TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vin_lookups_user_day
  ON vin_lookups(user_id, created_at);

-- Sécurité : accessible uniquement via la clé service (RLS sans policy)
ALTER TABLE vin_lookups ENABLE ROW LEVEL SECURITY;

-- Combien de VIN l'utilisateur a-t-il décodés aujourd'hui (UTC) ?
CREATE OR REPLACE FUNCTION vin_count_today(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INT FROM vin_lookups
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('day', NOW());
$$ LANGUAGE sql STABLE;

-- Enregistre un décodage réussi (à appeler après un VIN trouvé)
CREATE OR REPLACE FUNCTION record_vin_lookup(p_user_id UUID, p_vin TEXT)
RETURNS VOID AS $$
  INSERT INTO vin_lookups(user_id, vin) VALUES (p_user_id, p_vin);
$$ LANGUAGE sql;

GRANT EXECUTE ON FUNCTION vin_count_today, record_vin_lookup
  TO authenticated, anon, service_role;

-- ============================================================
-- DONE
-- ============================================================
