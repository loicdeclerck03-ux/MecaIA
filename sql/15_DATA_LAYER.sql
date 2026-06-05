-- ============================================================
-- COUCHE DONNÉES — Profil utilisateur + véhicules enrichis
-- Remplace le document Firestore users/{uid}.
-- Prérequis : USER_GARAGE_SCHEMA.sql, PAYMENTS_SCHEMA.sql,
--             TOKEN_MODEL.sql.
-- ============================================================

-- ---- Profil (nom, type, compteurs, code promo) ----
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id         UUID PRIMARY KEY,
  name            TEXT,
  type            TEXT DEFAULT 'mechanic',
  promo_code      TEXT,
  diagnostics     INT DEFAULT 0,
  pieces_searches INT DEFAULT 0,
  total_paid      NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Crée le profil + 3 crédits offerts si absent (idempotent)
CREATE OR REPLACE FUNCTION ensure_user_profile(p_user_id UUID, p_name TEXT, p_type TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO user_profiles(user_id, name, type, promo_code)
  VALUES (
    p_user_id,
    COALESCE(p_name, ''),
    COALESCE(NULLIF(p_type, ''), 'mechanic'),
    'CODE-' || UPPER(SUBSTRING(REPLACE(p_user_id::TEXT, '-', '') FROM 1 FOR 6))
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO user_credits(user_id, credits_balance, credits_lifetime)
  VALUES (p_user_id, 3, 3)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profil complet : profil + solde crédits + état du pass illimité
CREATE OR REPLACE FUNCTION get_user_profile(p_user_id UUID)
RETURNS TABLE (
  name            TEXT,
  type            TEXT,
  promo_code      TEXT,
  diagnostics     INT,
  pieces_searches INT,
  credits_balance NUMERIC,
  unlimited       BOOLEAN,
  unlimited_until TIMESTAMPTZ
) AS $$
  SELECT
    p.name, p.type, p.promo_code, p.diagnostics, p.pieces_searches,
    COALESCE(c.credits_balance, 0),
    COALESCE(c.unlimited_until > NOW(), FALSE),
    c.unlimited_until
  FROM user_profiles p
  LEFT JOIN user_credits c ON c.user_id = p.user_id
  WHERE p.user_id = p_user_id;
$$ LANGUAGE sql STABLE;

-- Incrémenter le compteur de diagnostics (appelé après un diag réussi)
CREATE OR REPLACE FUNCTION bump_diagnostics(p_user_id UUID)
RETURNS VOID AS $$
  UPDATE user_profiles SET diagnostics = diagnostics + 1 WHERE user_id = p_user_id;
$$ LANGUAGE sql;

-- ---- Véhicule : conserver TOUS les champs de l'UI ----
ALTER TABLE user_vehicles ADD COLUMN IF NOT EXISTS engine_code TEXT;

-- add_user_vehicle enrichi (kw/puissance, vin, code moteur).
-- On supprime l'ancienne signature puis on recrée (évite l'ambiguïté d'overload).
DROP FUNCTION IF EXISTS add_user_vehicle(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION add_user_vehicle(
  p_user_id UUID, p_marque TEXT, p_modele TEXT, p_annee INTEGER, p_km_current INTEGER,
  p_immatriculation TEXT, p_nickname TEXT, p_carburant TEXT DEFAULT NULL,
  p_couleur TEXT DEFAULT NULL, p_puissance_ch INTEGER DEFAULT NULL,
  p_vin TEXT DEFAULT NULL, p_engine_code TEXT DEFAULT NULL
)
RETURNS TABLE (vehicle_id UUID, success BOOLEAN, message TEXT) AS $$
DECLARE v_id UUID; v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_vehicles WHERE user_id = p_user_id AND is_active = TRUE;
  INSERT INTO user_vehicles(
    user_id, marque, modele, annee, km_current, immatriculation, nickname,
    carburant, couleur, puissance_ch, vin, engine_code, is_primary
  ) VALUES (
    p_user_id, p_marque, p_modele, p_annee, p_km_current, p_immatriculation, p_nickname,
    p_carburant, p_couleur, p_puissance_ch, p_vin, p_engine_code, (v_count = 0)
  ) RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, TRUE, 'Vehicle added successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_user_vehicles enrichi (renvoie carburant, puissance, vin, code moteur)
DROP FUNCTION IF EXISTS get_user_vehicles(UUID);
CREATE OR REPLACE FUNCTION get_user_vehicles(p_user_id UUID)
RETURNS TABLE (
  id UUID, marque TEXT, modele TEXT, annee INTEGER, km_current INTEGER,
  immatriculation TEXT, nickname TEXT, carburant TEXT, puissance_ch INTEGER,
  vin TEXT, engine_code TEXT, is_primary BOOLEAN, is_active BOOLEAN,
  last_diagnosis_date TIMESTAMP, pending_diagnostics_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT uv.id, uv.marque, uv.modele, uv.annee, uv.km_current,
         uv.immatriculation, uv.nickname, uv.carburant, uv.puissance_ch,
         uv.vin, uv.engine_code, uv.is_primary, uv.is_active,
         MAX(ud.diagnosis_date) AS last_diagnosis_date,
         COUNT(CASE WHEN ud.status = 'new' THEN 1 END)::INTEGER AS pending_diagnostics_count
  FROM user_vehicles uv
  LEFT JOIN user_diagnostics ud ON uv.id = ud.vehicle_id
  WHERE uv.user_id = p_user_id AND uv.is_active = TRUE
  GROUP BY uv.id, uv.marque, uv.modele, uv.annee, uv.km_current, uv.immatriculation,
           uv.nickname, uv.carburant, uv.puissance_ch, uv.vin, uv.engine_code,
           uv.is_primary, uv.is_active
  ORDER BY uv.is_primary DESC, uv.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Supprimer (soft delete) un véhicule, avec contrôle de propriété
CREATE OR REPLACE FUNCTION delete_user_vehicle(p_user_id UUID, p_vehicle_id UUID)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
BEGIN
  UPDATE user_vehicles SET is_active = FALSE, updated_at = NOW()
  WHERE id = p_vehicle_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'not_found_or_forbidden'::TEXT; RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, 'deleted'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ensure_user_profile, get_user_profile, bump_diagnostics,
  add_user_vehicle, get_user_vehicles, delete_user_vehicle
  TO authenticated, anon, service_role;

-- ============================================================
-- DONE
-- ============================================================
