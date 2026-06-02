-- ============================================================
-- MECAIA — RESET COMPLET DE LA BASE DE DONNÉES
-- ============================================================
-- ⚠️ À EXÉCUTER EN UNE SEULE FOIS dans Supabase → SQL Editor
-- Ce script EFFACE tout et recrée proprement.
-- Résout l'erreur "duplicate key users_email_key".
--
-- COMMENT FAIRE :
-- 1. Supabase → SQL Editor → New query
-- 2. Copier-coller TOUT ce fichier
-- 3. Cliquer RUN
-- 4. Vérifier "Success. No rows returned"
-- ============================================================

-- ------------------------------------------------------------
-- ÉTAPE 1 : SUPPRIMER l'ancien (ordre important : enfants d'abord)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS users_updated_at ON public.users;

DROP TABLE IF EXISTS public.chat_messages  CASCADE;
DROP TABLE IF EXISTS public.team_members   CASCADE;
DROP TABLE IF EXISTS public.used_promos    CASCADE;
DROP TABLE IF EXISTS public.promo_codes    CASCADE;
DROP TABLE IF EXISTS public.transactions   CASCADE;
DROP TABLE IF EXISTS public.diagnostics    CASCADE;
DROP TABLE IF EXISTS public.cars           CASCADE;
DROP TABLE IF EXISTS public.users          CASCADE;

DROP VIEW IF EXISTS public.admin_stats CASCADE;

DROP FUNCTION IF EXISTS public.handle_new_user()           CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at()            CASCADE;
DROP FUNCTION IF EXISTS public.decrement_credits(UUID)     CASCADE;
DROP FUNCTION IF EXISTS public.increment_credits(UUID,INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.increment_diag_count(UUID)  CASCADE;
DROP FUNCTION IF EXISTS public.increment_paid(UUID,NUMERIC) CASCADE;

-- ------------------------------------------------------------
-- ÉTAPE 2 : TABLE users
-- (email SANS contrainte UNIQUE → plus d'erreur duplicate key)
-- ------------------------------------------------------------
CREATE TABLE public.users (
  id                UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT          NOT NULL,
  name              TEXT          NOT NULL DEFAULT '',
  type              TEXT          NOT NULL DEFAULT 'amateur'
                                  CHECK (type IN ('mechanic','amateur','apprenti','garage')),
  credits           INTEGER       NOT NULL DEFAULT 3 CHECK (credits >= 0),
  is_unlimited      BOOLEAN       NOT NULL DEFAULT FALSE,
  unlimited_until   TIMESTAMPTZ,
  promo_code        TEXT          UNIQUE,
  total_paid        NUMERIC(10,2) NOT NULL DEFAULT 0,
  diagnostics_count INTEGER       NOT NULL DEFAULT 0,
  chat_session_start TIMESTAMPTZ,
  lang              TEXT          NOT NULL DEFAULT 'fr',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 3 : TABLE cars (garage virtuel)
-- ------------------------------------------------------------
CREATE TABLE public.cars (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  marque      TEXT        NOT NULL,
  modele      TEXT        NOT NULL,
  annee       TEXT        NOT NULL,
  carbu       TEXT        NOT NULL,
  kw          TEXT,
  code_moteur TEXT,
  vin         TEXT,
  km          TEXT,
  nom         TEXT,
  score       INTEGER     DEFAULT 85 CHECK (score BETWEEN 0 AND 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 4 : TABLE diagnostics (historique + suivi)
-- ------------------------------------------------------------
CREATE TABLE public.diagnostics (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  car_id       UUID        REFERENCES public.cars(id) ON DELETE SET NULL,
  type         TEXT        NOT NULL DEFAULT 'obd'
                           CHECK (type IN ('obd','photo','pieces','alertes','vin','chat')),
  input        JSONB       NOT NULL DEFAULT '{}',
  output       JSONB       NOT NULL DEFAULT '{}',
  credits_used INTEGER     NOT NULL DEFAULT 1,
  is_fav       BOOLEAN     NOT NULL DEFAULT FALSE,
  rating       INTEGER     CHECK (rating BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 5 : TABLE transactions (paiements Stripe)
-- ------------------------------------------------------------
CREATE TABLE public.transactions (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_session_id TEXT          UNIQUE,
  amount            NUMERIC(10,2) NOT NULL,
  credits           INTEGER       NOT NULL,
  pack_name         TEXT,
  status            TEXT          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','completed','refunded')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 6 : TABLE promo_codes
-- ------------------------------------------------------------
CREATE TABLE public.promo_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL UNIQUE,
  type        TEXT        NOT NULL CHECK (type IN ('credits','reduction')),
  credits     INTEGER     DEFAULT 5,
  reduction   INTEGER     DEFAULT 0 CHECK (reduction BETWEEN 0 AND 100),
  uses_left   INTEGER     NOT NULL DEFAULT 1,
  uses_total  INTEGER     NOT NULL DEFAULT 0,
  owner_id    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 7 : TABLE used_promos
-- ------------------------------------------------------------
CREATE TABLE public.used_promos (
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, code)
);

-- ------------------------------------------------------------
-- ÉTAPE 8 : TABLE team_members
-- ------------------------------------------------------------
CREATE TABLE public.team_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  name        TEXT,
  status      TEXT        NOT NULL DEFAULT 'invited'
                          CHECK (status IN ('invited','active','removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 9 : TABLE chat_messages (Dylan)
-- ------------------------------------------------------------
CREATE TABLE public.chat_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id  TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT        NOT NULL,
  q_number    INTEGER     DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÉTAPE 10 : INDEXES (performance)
-- ------------------------------------------------------------
CREATE INDEX idx_cars_user    ON public.cars(user_id);
CREATE INDEX idx_diag_user    ON public.diagnostics(user_id);
CREATE INDEX idx_diag_created ON public.diagnostics(created_at DESC);
CREATE INDEX idx_trans_user   ON public.transactions(user_id);
CREATE INDEX idx_chat_session ON public.chat_messages(session_id);
CREATE INDEX idx_promo_code   ON public.promo_codes(code);

-- ------------------------------------------------------------
-- ÉTAPE 11 : ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_promos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own"        ON public.users         FOR ALL USING (auth.uid() = id);
CREATE POLICY "cars_own"         ON public.cars          FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "diagnostics_own"  ON public.diagnostics   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "transactions_own" ON public.transactions  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "used_promos_own"  ON public.used_promos   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "team_own"         ON public.team_members  FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "chat_own"         ON public.chat_messages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "promos_read"      ON public.promo_codes   FOR SELECT USING (TRUE);

-- ------------------------------------------------------------
-- ÉTAPE 12 : FONCTION updated_at automatique
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- ÉTAPE 13 : FONCTIONS crédits (RPC appelées par le backend)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_credits(p_user_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_credits INTEGER; current_credits INTEGER;
BEGIN
  SELECT credits INTO current_credits FROM public.users WHERE id = p_user_id;
  IF current_credits IS NULL OR current_credits <= 0 THEN
    RAISE EXCEPTION 'Plus de crédits';
  END IF;
  UPDATE public.users SET credits = credits - 1, updated_at = NOW()
  WHERE id = p_user_id RETURNING credits INTO new_credits;
  RETURN new_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.increment_credits(user_id UUID, amount INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_credits INTEGER;
BEGIN
  UPDATE public.users SET credits = credits + amount, updated_at = NOW()
  WHERE id = user_id RETURNING credits INTO new_credits;
  RETURN new_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.increment_diag_count(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users SET diagnostics_count = diagnostics_count + 1, updated_at = NOW()
  WHERE id = p_user_id;
END; $$;

CREATE OR REPLACE FUNCTION public.increment_paid(p_user_id UUID, p_amount NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users SET total_paid = total_paid + p_amount, updated_at = NOW()
  WHERE id = p_user_id;
END; $$;

-- ------------------------------------------------------------
-- ÉTAPE 14 : TRIGGER création auto du profil à l'inscription
-- (C'EST LA CLÉ : crée la ligne dans public.users automatiquement)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, type, credits, promo_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'type', 'amateur'),
    3,
    'CODE-' || upper(substring(NEW.id::text, 1, 6))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- ÉTAPE 15 : VUE statistiques admin
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.admin_stats AS
SELECT
  COUNT(DISTINCT u.id)                                  AS total_users,
  COALESCE(SUM(u.diagnostics_count), 0)                 AS total_diagnostics,
  COALESCE(SUM(u.total_paid), 0)                        AS total_revenue,
  COUNT(DISTINCT CASE WHEN u.is_unlimited THEN u.id END) AS unlimited_users,
  COUNT(DISTINCT CASE WHEN u.credits > 0 THEN u.id END)  AS active_users
FROM public.users u;

-- ------------------------------------------------------------
-- ÉTAPE 16 : Codes promo de départ
-- ------------------------------------------------------------
INSERT INTO public.promo_codes (code, type, credits, uses_left)
VALUES
  ('WELCOME3', 'credits', 3, 1000),
  ('BETA10',   'credits', 10, 100)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- ✅ TERMINÉ — Vérification (optionnel, décommenter pour tester)
-- ============================================================
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';
