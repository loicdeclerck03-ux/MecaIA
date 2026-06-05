-- ============================================================
-- TABLE: user_credits
-- Crédits utilisateur (pour les services premium)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  
  -- Credits
  credits_balance DECIMAL(10,2) DEFAULT 0,
  credits_lifetime DECIMAL(10,2) DEFAULT 0, -- Total jamais acheté
  credits_used DECIMAL(10,2) DEFAULT 0,
  
  -- Bonus
  bonus_credits DECIMAL(10,2) DEFAULT 0, -- Promo, referral, etc
  
  -- Last update
  last_update TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_credits_user_id ON user_credits(user_id);

-- ============================================================
-- TABLE: credit_packages
-- Packages de crédits disponibles à l'achat
-- ============================================================

CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Package info
  package_name TEXT NOT NULL UNIQUE, -- "Starter", "Pro", "Ultimate"
  credits_amount DECIMAL(10,2) NOT NULL,
  price_eur DECIMAL(10,2) NOT NULL,
  
  -- Bonus
  bonus_credits DECIMAL(10,2) DEFAULT 0,
  discount_percent INTEGER DEFAULT 0,
  
  -- Display
  is_popular BOOLEAN DEFAULT FALSE,
  display_order INTEGER,
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO credit_packages (package_name, credits_amount, price_eur, bonus_credits, is_popular, display_order)
VALUES 
  ('Starter', 10, 9.99, 0, FALSE, 1),
  ('Pro', 50, 39.99, 10, TRUE, 2),
  ('Ultimate', 200, 99.99, 50, FALSE, 3)
ON CONFLICT DO NOTHING;

-- ============================================================
-- TABLE: stripe_payments
-- Historique des paiements Stripe
-- ============================================================

CREATE TABLE IF NOT EXISTS stripe_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Stripe info
  stripe_payment_id TEXT NOT NULL UNIQUE,
  stripe_session_id TEXT,
  
  -- Payment details
  amount_eur DECIMAL(10,2) NOT NULL,
  credits_purchased DECIMAL(10,2) NOT NULL,
  bonus_credits DECIMAL(10,2) DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'succeeded', 'failed', 'cancelled'
  
  -- Metadata
  package_name TEXT,
  payment_method TEXT, -- 'card', 'paypal', etc
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_stripe_payments_user_id ON stripe_payments(user_id);
CREATE INDEX idx_stripe_payments_status ON stripe_payments(status);

-- ============================================================
-- TABLE: credit_transactions
-- Historique des transactions de crédits
-- ============================================================

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Transaction
  transaction_type TEXT NOT NULL, -- 'purchase', 'usage', 'bonus', 'refund'
  credits_amount DECIMAL(10,2) NOT NULL,
  
  -- Reference
  related_id TEXT, -- ID du payment/diagnostic/etc
  
  -- Details
  description TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);

-- ============================================================
-- FUNCTION: get_user_credits
-- Récupère le solde de crédits
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_credits(p_user_id UUID)
RETURNS TABLE (
  credits_balance DECIMAL,
  credits_lifetime DECIMAL,
  credits_used DECIMAL,
  bonus_credits DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT uc.credits_balance, uc.credits_lifetime, uc.credits_used, uc.bonus_credits
  FROM user_credits uc
  WHERE uc.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: add_credits
-- Ajoute des crédits (après paiement réussi)
-- ============================================================

CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_credits DECIMAL,
  p_bonus_credits DECIMAL DEFAULT 0,
  p_transaction_description TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  new_balance DECIMAL,
  message TEXT
) AS $$
DECLARE
  v_new_balance DECIMAL;
BEGIN
  -- Insérer ou mettre à jour user_credits
  INSERT INTO user_credits (user_id, credits_balance, credits_lifetime, bonus_credits)
  VALUES (p_user_id, p_credits, p_credits, p_bonus_credits)
  ON CONFLICT (user_id) DO UPDATE SET
    credits_balance = user_credits.credits_balance + p_credits,
    credits_lifetime = user_credits.credits_lifetime + p_credits,
    bonus_credits = user_credits.bonus_credits + p_bonus_credits,
    last_update = NOW();

  -- Enregistrer la transaction
  INSERT INTO credit_transactions (user_id, transaction_type, credits_amount, description)
  VALUES (p_user_id, 'purchase', p_credits, p_transaction_description);

  -- Récupérer le nouveau solde
  SELECT credits_balance INTO v_new_balance FROM user_credits WHERE user_id = p_user_id;

  RETURN QUERY SELECT 
    TRUE,
    v_new_balance,
    'Credits added successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: use_credits
-- Utilise des crédits (pour un diagnostic, etc)
-- ============================================================

CREATE OR REPLACE FUNCTION use_credits(
  p_user_id UUID,
  p_credits DECIMAL,
  p_reason TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  remaining_balance DECIMAL,
  message TEXT
) AS $$
DECLARE
  v_current_balance DECIMAL;
BEGIN
  SELECT credits_balance INTO v_current_balance FROM user_credits WHERE user_id = p_user_id;

  IF v_current_balance < p_credits THEN
    RETURN QUERY SELECT FALSE, v_current_balance, 'Insufficient credits';
    RETURN;
  END IF;

  UPDATE user_credits
  SET credits_balance = credits_balance - p_credits,
      credits_used = credits_used + p_credits,
      last_update = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (user_id, transaction_type, credits_amount, description)
  VALUES (p_user_id, 'usage', p_credits, p_reason);

  RETURN QUERY SELECT 
    TRUE,
    v_current_balance - p_credits,
    'Credits used';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT ON user_credits TO authenticated;
GRANT SELECT ON credit_packages TO authenticated;
GRANT SELECT, INSERT ON stripe_payments TO authenticated;
GRANT SELECT, INSERT ON credit_transactions TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_credits TO authenticated;
GRANT EXECUTE ON FUNCTION add_credits TO authenticated;
GRANT EXECUTE ON FUNCTION use_credits TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
