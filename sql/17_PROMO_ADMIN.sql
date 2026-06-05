-- ============================================================
-- ADMIN & CODES PROMO
-- - Codes promo : crédits | illimité (jours) | pourcentage (1-100)
-- - Limite d'utilisations + date d'expiration + actif/inactif
-- - Historique complet + activation/désactivation
-- - Octroi direct (donner illimité/crédits à un testeur par email)
-- - Stats pour le dashboard
-- Prérequis : DATA_LAYER.sql, PAYMENTS_SCHEMA.sql, TOKEN_MODEL.sql
-- ============================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS promo_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('credits','unlimited','percent')),
  value       NUMERIC NOT NULL,        -- credits: nb | unlimited: jours | percent: 1-100
  max_uses    INT,                      -- NULL = illimité
  uses_count  INT DEFAULT 0,
  active       BOOLEAN DEFAULT TRUE,
  expires_at  TIMESTAMPTZ,              -- NULL = pas d'expiration
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id     UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (code_id, user_id)
);

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;        -- accès via clé service uniquement
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;

-- ---- ADMIN : créer un code ----
CREATE OR REPLACE FUNCTION admin_create_promo(
  p_code TEXT, p_kind TEXT, p_value NUMERIC, p_max_uses INT, p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (id UUID, code TEXT, message TEXT) AS $$
DECLARE v_id UUID;
BEGIN
  IF p_kind = 'percent' AND (p_value < 1 OR p_value > 100) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, 'pourcentage doit être 1-100'::TEXT; RETURN;
  END IF;
  INSERT INTO promo_codes(code, kind, value, max_uses, expires_at)
  VALUES (UPPER(TRIM(p_code)), p_kind, p_value, p_max_uses, p_expires_at)
  RETURNING promo_codes.id INTO v_id;
  RETURN QUERY SELECT v_id, UPPER(TRIM(p_code)), 'ok'::TEXT;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT NULL::UUID, NULL::TEXT, 'code déjà existant'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---- ADMIN : lister tous les codes (actifs + inactifs) avec statut + usage ----
CREATE OR REPLACE FUNCTION admin_list_promos()
RETURNS TABLE (
  id UUID, code TEXT, kind TEXT, value NUMERIC,
  max_uses INT, uses_count INT, active BOOLEAN,
  expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ, status TEXT
) AS $$
  SELECT
    pc.id, pc.code, pc.kind, pc.value,
    pc.max_uses, pc.uses_count, pc.active,
    pc.expires_at, pc.created_at,
    CASE
      WHEN NOT pc.active THEN 'désactivé'
      WHEN pc.expires_at IS NOT NULL AND pc.expires_at <= NOW() THEN 'expiré'
      WHEN pc.max_uses IS NOT NULL AND pc.uses_count >= pc.max_uses THEN 'épuisé'
      ELSE 'actif'
    END AS status
  FROM promo_codes pc
  ORDER BY pc.created_at DESC;
$$ LANGUAGE sql STABLE;

-- ---- ADMIN : activer / désactiver ----
CREATE OR REPLACE FUNCTION admin_set_promo_active(p_id UUID, p_active BOOLEAN)
RETURNS TABLE (success BOOLEAN, active BOOLEAN) AS $$
  UPDATE promo_codes SET active = p_active WHERE id = p_id
  RETURNING TRUE, active;
$$ LANGUAGE sql;

-- ---- ADMIN : octroyer crédits/illimité à un testeur par email ----
CREATE OR REPLACE FUNCTION admin_grant_by_email(p_email TEXT, p_kind TEXT, p_value NUMERIC)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = LOWER(TRIM(p_email));
  IF v_uid IS NULL THEN RETURN QUERY SELECT FALSE, 'utilisateur introuvable'::TEXT; RETURN; END IF;
  PERFORM ensure_user_profile(v_uid, '', 'mechanic');
  IF p_kind = 'credits' THEN
    PERFORM add_credits(v_uid, p_value, 0, 'Octroi admin');
  ELSIF p_kind = 'unlimited' THEN
    PERFORM grant_unlimited(v_uid, p_value::INT);
  ELSE
    RETURN QUERY SELECT FALSE, 'kind invalide (credits|unlimited)'::TEXT; RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---- ADMIN : stats dashboard ----
CREATE OR REPLACE FUNCTION admin_stats()
RETURNS TABLE (total_users BIGINT, total_diagnostics BIGINT, active_promos BIGINT, unlimited_users BIGINT) AS $$
  SELECT
    (SELECT COUNT(*) FROM user_profiles),
    (SELECT COALESCE(SUM(diagnostics), 0) FROM user_profiles),
    (SELECT COUNT(*) FROM promo_codes WHERE active AND (expires_at IS NULL OR expires_at > NOW())),
    (SELECT COUNT(*) FROM user_credits WHERE unlimited_until > NOW());
$$ LANGUAGE sql STABLE;

-- ---- UTILISATEUR : échanger un code (crédits/illimité appliqués direct) ----
CREATE OR REPLACE FUNCTION redeem_promo(p_user_id UUID, p_code TEXT)
RETURNS TABLE (success BOOLEAN, kind TEXT, value NUMERIC, message TEXT) AS $$
DECLARE r promo_codes;
BEGIN
  SELECT * INTO r FROM promo_codes WHERE code = UPPER(TRIM(p_code));
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::NUMERIC, 'code introuvable'::TEXT; RETURN; END IF;
  IF NOT r.active THEN RETURN QUERY SELECT FALSE, r.kind, r.value, 'code désactivé'::TEXT; RETURN; END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at <= NOW() THEN RETURN QUERY SELECT FALSE, r.kind, r.value, 'code expiré'::TEXT; RETURN; END IF;
  IF r.max_uses IS NOT NULL AND r.uses_count >= r.max_uses THEN RETURN QUERY SELECT FALSE, r.kind, r.value, 'code épuisé'::TEXT; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM promo_redemptions WHERE code_id = r.id AND user_id = p_user_id) THEN
    RETURN QUERY SELECT FALSE, r.kind, r.value, 'code déjà utilisé'::TEXT; RETURN;
  END IF;
  IF r.kind = 'percent' THEN
    RETURN QUERY SELECT FALSE, 'percent'::TEXT, r.value, 'à utiliser lors de l''achat'::TEXT; RETURN;
  END IF;

  INSERT INTO promo_redemptions(code_id, user_id) VALUES (r.id, p_user_id);
  UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = r.id;

  IF r.kind = 'credits' THEN
    PERFORM add_credits(p_user_id, r.value, 0, 'Code promo ' || r.code);
  ELSIF r.kind = 'unlimited' THEN
    PERFORM grant_unlimited(p_user_id, r.value::INT);
  END IF;

  RETURN QUERY SELECT TRUE, r.kind, r.value, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---- Validation d'un % au checkout (utilisé par stripe_checkout) ----
CREATE OR REPLACE FUNCTION validate_percent_promo(p_code TEXT)
RETURNS TABLE (valid BOOLEAN, percent NUMERIC, code_id UUID) AS $$
  SELECT
    (pc.active
      AND pc.kind = 'percent'
      AND (pc.expires_at IS NULL OR pc.expires_at > NOW())
      AND (pc.max_uses IS NULL OR pc.uses_count < pc.max_uses)),
    pc.value, pc.id
  FROM promo_codes pc
  WHERE pc.code = UPPER(TRIM(p_code));
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION admin_create_promo, admin_list_promos, admin_set_promo_active,
  admin_grant_by_email, admin_stats, redeem_promo, validate_percent_promo
  TO service_role;

-- ============================================================
-- DONE
-- ============================================================

-- Incrément d'usage d'un code % (appelé au checkout)
CREATE OR REPLACE FUNCTION bump_percent_promo(p_id UUID)
RETURNS VOID AS $$
  UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = p_id;
$$ LANGUAGE sql;

GRANT EXECUTE ON FUNCTION bump_percent_promo TO service_role;
