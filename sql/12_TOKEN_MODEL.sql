-- ============================================================
-- MODÈLE DE JETONS & PASS ILLIMITÉ
-- Règles métier :
--   • 1 jeton  = 1 session de diagnostic Dylan de 10 minutes
--   • 1 jeton  = 1 comparatif de pièces
--   • VIN      = GRATUIT (aucun jeton)
--   • Illimité = pass de 30 jours, jetons illimités (diag + comparatif)
-- Prérequis : PAYMENTS_SCHEMA.sql (user_credits, add_credits,
--             credit_transactions) et STRIPE_IDEMPOTENCY.sql
--             (processed_stripe_events) doivent être exécutés avant.
-- ============================================================

-- Pass illimité : date jusqu'à laquelle l'utilisateur est illimité
ALTER TABLE user_credits
  ADD COLUMN IF NOT EXISTS unlimited_until TIMESTAMPTZ;

-- Sessions de diagnostic : une fenêtre de 10 min ouverte par jeton
CREATE TABLE IF NOT EXISTS diagnostic_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  cost_credits  NUMERIC DEFAULT 0,        -- 0 si pass illimité, sinon 1
  via_unlimited BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_diag_sessions_user
  ON diagnostic_sessions(user_id, expires_at);

-- ------------------------------------------------------------
-- Le pass illimité est-il actif ?
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_unlimited_active(p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT unlimited_until FROM user_credits WHERE user_id = p_user_id) > NOW(),
    FALSE
  );
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- Ouvrir une session de diagnostic (10 min)
--   • pass illimité actif -> gratuit
--   • sinon -> débite 1 jeton (refus si solde insuffisant)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_diagnostic_session(p_user_id UUID)
RETURNS TABLE (
  success           BOOLEAN,
  session_id        UUID,
  expires_at        TIMESTAMPTZ,
  remaining_balance NUMERIC,
  unlimited         BOOLEAN,
  message           TEXT
) AS $$
DECLARE
  v_unlimited BOOLEAN;
  v_balance   NUMERIC;
  v_sid       UUID;
  v_exp       TIMESTAMPTZ := NOW() + INTERVAL '10 minutes';
BEGIN
  v_unlimited := is_unlimited_active(p_user_id);

  IF v_unlimited THEN
    INSERT INTO diagnostic_sessions(user_id, expires_at, cost_credits, via_unlimited)
    VALUES (p_user_id, v_exp, 0, TRUE) RETURNING id INTO v_sid;
    SELECT credits_balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;
    RETURN QUERY SELECT TRUE, v_sid, v_exp, COALESCE(v_balance,0), TRUE, 'unlimited_session'::TEXT;
    RETURN;
  END IF;

  SELECT credits_balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;
  IF COALESCE(v_balance,0) < 1 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ, COALESCE(v_balance,0), FALSE, 'insufficient_credits'::TEXT;
    RETURN;
  END IF;

  UPDATE user_credits
    SET credits_balance = credits_balance - 1,
        credits_used    = credits_used + 1,
        last_update     = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions(user_id, transaction_type, credits_amount, description)
  VALUES (p_user_id, 'usage', 1, 'Diagnostic Dylan (10 min)');

  INSERT INTO diagnostic_sessions(user_id, expires_at, cost_credits, via_unlimited)
  VALUES (p_user_id, v_exp, 1, FALSE) RETURNING id INTO v_sid;

  SELECT credits_balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;
  RETURN QUERY SELECT TRUE, v_sid, v_exp, v_balance, FALSE, 'session_started'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- Une session de diagnostic est-elle encore active ?
-- (sert à autoriser les messages Dylan gratuits dans la fenêtre 10 min)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_active_diagnostic_session(p_user_id UUID)
RETURNS TABLE (active BOOLEAN, expires_at TIMESTAMPTZ) AS $$
DECLARE v_exp TIMESTAMPTZ;
BEGIN
  SELECT MAX(ds.expires_at) INTO v_exp
  FROM diagnostic_sessions ds
  WHERE ds.user_id = p_user_id AND ds.expires_at > NOW();
  RETURN QUERY SELECT (v_exp IS NOT NULL), v_exp;
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------
-- Consommer 1 jeton pour un comparatif de pièces
--   • pass illimité actif -> gratuit
--   • sinon -> débite 1 jeton (refus si solde insuffisant)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_parts_comparison(p_user_id UUID)
RETURNS TABLE (
  success           BOOLEAN,
  remaining_balance NUMERIC,
  unlimited         BOOLEAN,
  message           TEXT
) AS $$
DECLARE
  v_unlimited BOOLEAN;
  v_balance   NUMERIC;
BEGIN
  v_unlimited := is_unlimited_active(p_user_id);

  IF v_unlimited THEN
    SELECT credits_balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;
    RETURN QUERY SELECT TRUE, COALESCE(v_balance,0), TRUE, 'unlimited'::TEXT;
    RETURN;
  END IF;

  SELECT credits_balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;
  IF COALESCE(v_balance,0) < 1 THEN
    RETURN QUERY SELECT FALSE, COALESCE(v_balance,0), FALSE, 'insufficient_credits'::TEXT;
    RETURN;
  END IF;

  UPDATE user_credits
    SET credits_balance = credits_balance - 1,
        credits_used    = credits_used + 1,
        last_update     = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions(user_id, transaction_type, credits_amount, description)
  VALUES (p_user_id, 'usage', 1, 'Comparatif de pièces');

  SELECT credits_balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;
  RETURN QUERY SELECT TRUE, v_balance, FALSE, 'charged'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- Accorder / prolonger le pass illimité (utilisé par le webhook Stripe)
-- Cumulatif : si déjà actif, on ajoute les jours à la fin.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_unlimited(p_user_id UUID, p_days INT)
RETURNS TABLE (unlimited_until TIMESTAMPTZ) AS $$
DECLARE
  v_base TIMESTAMPTZ;
  v_new  TIMESTAMPTZ;
BEGIN
  INSERT INTO user_credits(user_id, credits_balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT uc.unlimited_until INTO v_base FROM user_credits uc WHERE uc.user_id = p_user_id;
  v_new := GREATEST(COALESCE(v_base, NOW()), NOW()) + (p_days || ' days')::INTERVAL;

  UPDATE user_credits SET unlimited_until = v_new, last_update = NOW()
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- Appliquer un achat Stripe (IDEMPOTENT) : crédits OU pass illimité
-- Remplace credit_from_stripe_event pour gérer les deux cas.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_stripe_purchase(
  p_event_id       TEXT,
  p_session_id     TEXT,
  p_user_id        UUID,
  p_credits        NUMERIC,
  p_unlimited_days INT,
  p_description    TEXT
)
RETURNS TABLE (applied BOOLEAN, kind TEXT, message TEXT) AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO processed_stripe_events(event_id, session_id, user_id, credits)
  VALUES (p_event_id, p_session_id, p_user_id, COALESCE(p_credits,0))
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'already_processed'::TEXT;
    RETURN;
  END IF;

  IF COALESCE(p_unlimited_days,0) > 0 THEN
    PERFORM grant_unlimited(p_user_id, p_unlimited_days);
    RETURN QUERY SELECT TRUE, 'unlimited'::TEXT, 'granted'::TEXT;
  ELSE
    PERFORM add_credits(p_user_id, p_credits, 0, p_description);
    RETURN QUERY SELECT TRUE, 'credits'::TEXT, 'credited'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_unlimited_active, start_diagnostic_session,
  has_active_diagnostic_session, consume_parts_comparison, grant_unlimited,
  apply_stripe_purchase TO authenticated, anon, service_role;

-- ============================================================
-- DONE
-- ============================================================
