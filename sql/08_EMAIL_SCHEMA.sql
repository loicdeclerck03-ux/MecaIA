-- ============================================================
-- TABLE: user_emails
-- Vérification et historique emails utilisateur
-- ============================================================

CREATE TABLE IF NOT EXISTS user_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Email info
  email TEXT NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT FALSE,
  
  -- Verification
  verification_token TEXT UNIQUE,
  verification_token_expires TIMESTAMP,
  verified_at TIMESTAMP,
  
  -- Recovery
  is_recovery_email BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_emails_user_id ON user_emails(user_id);
CREATE INDEX idx_user_emails_email ON user_emails(email);
CREATE INDEX idx_user_emails_verification_token ON user_emails(verification_token);

-- ============================================================
-- TABLE: email_logs
-- Logs des emails envoyés
-- ============================================================

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  
  email_to TEXT NOT NULL,
  email_type TEXT NOT NULL, -- 'verification', 'password_reset', 'notification'
  subject TEXT,
  status TEXT DEFAULT 'sent', -- 'sent', 'opened', 'clicked', 'failed'
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX idx_email_logs_type ON email_logs(email_type);

-- ============================================================
-- FUNCTION: create_email_verification
-- Crée un token de vérification email
-- ============================================================

CREATE OR REPLACE FUNCTION create_email_verification(
  p_user_id UUID,
  p_email TEXT
)
RETURNS TABLE (
  email_id UUID,
  verification_token TEXT,
  expires_at TIMESTAMP,
  success BOOLEAN
) AS $$
DECLARE
  v_token TEXT;
  v_email_id UUID;
  v_expires TIMESTAMP;
BEGIN
  -- Générer un token aléatoire
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := NOW() + INTERVAL '24 hours';
  
  -- Insérer l'email
  INSERT INTO user_emails (user_id, email, verification_token, verification_token_expires)
  VALUES (p_user_id, p_email, v_token, v_expires)
  RETURNING id INTO v_email_id;
  
  RETURN QUERY SELECT v_email_id, v_token, v_expires, TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: verify_email
-- Vérifie un email avec le token
-- ============================================================

CREATE OR REPLACE FUNCTION verify_email(p_verification_token TEXT)
RETURNS TABLE (
  success BOOLEAN,
  user_id UUID,
  message TEXT
) AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Vérifier le token
  SELECT user_id INTO v_user_id FROM user_emails 
  WHERE verification_token = p_verification_token 
    AND verification_token_expires > NOW()
  LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL, 'Invalid or expired token';
    RETURN;
  END IF;
  
  -- Marquer comme vérifié
  UPDATE user_emails
  SET is_verified = TRUE,
      is_primary = TRUE,
      verified_at = NOW(),
      verification_token = NULL
  WHERE user_id = v_user_id AND is_verified = FALSE;
  
  RETURN QUERY SELECT TRUE, v_user_id, 'Email verified';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: log_email
-- Enregistre un email envoyé
-- ============================================================

CREATE OR REPLACE FUNCTION log_email(
  p_user_id UUID,
  p_email_to TEXT,
  p_email_type TEXT,
  p_subject TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
) AS $$
BEGIN
  INSERT INTO email_logs (user_id, email_to, email_type, subject, status)
  VALUES (p_user_id, p_email_to, p_email_type, p_subject, 'sent');
  
  RETURN QUERY SELECT TRUE, 'Email logged';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON user_emails TO authenticated;
GRANT SELECT, INSERT ON email_logs TO authenticated;
GRANT EXECUTE ON FUNCTION create_email_verification TO authenticated;
GRANT EXECUTE ON FUNCTION verify_email TO authenticated;
GRANT EXECUTE ON FUNCTION log_email TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
