-- ============================================================
-- STRIPE — IDEMPOTENCE & CRÉDIT ATOMIQUE
-- Garantit qu'un paiement ne crédite QU'UNE SEULE FOIS,
-- même si Stripe renvoie le même événement plusieurs fois
-- (comportement normal des webhooks Stripe : "at least once").
-- ============================================================

-- 1) Journal des événements Stripe déjà traités
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id     TEXT PRIMARY KEY,          -- evt_... (identifiant unique Stripe)
  session_id   TEXT,                       -- cs_...  (session checkout)
  user_id      UUID,
  credits      NUMERIC,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_user
  ON processed_stripe_events(user_id);

-- 2) Crédit idempotent : enregistre l'événement puis crédite
--    UNIQUEMENT si l'événement n'avait jamais été vu.
CREATE OR REPLACE FUNCTION credit_from_stripe_event(
  p_event_id   TEXT,
  p_session_id TEXT,
  p_user_id    UUID,
  p_credits    NUMERIC,
  p_description TEXT
)
RETURNS TABLE (
  credited     BOOLEAN,
  new_balance  NUMERIC,
  message      TEXT
) AS $$
DECLARE
  v_count   INTEGER;
  v_balance NUMERIC;
BEGIN
  -- Tentative d'enregistrement de l'événement.
  -- Si l'event_id existe déjà -> ON CONFLICT DO NOTHING -> 0 ligne insérée.
  INSERT INTO processed_stripe_events(event_id, session_id, user_id, credits)
  VALUES (p_event_id, p_session_id, p_user_id, p_credits)
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    -- Déjà traité auparavant : on ne recrédite pas.
    RETURN QUERY SELECT FALSE, NULL::NUMERIC, 'already_processed'::TEXT;
    RETURN;
  END IF;

  -- Premier traitement de cet événement : on crédite une seule fois.
  SELECT ac.new_balance INTO v_balance
  FROM add_credits(p_user_id, p_credits, 0, p_description) ac;

  RETURN QUERY SELECT TRUE, v_balance, 'credited'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION credit_from_stripe_event TO authenticated, anon, service_role;

-- ============================================================
-- DONE
-- ============================================================
