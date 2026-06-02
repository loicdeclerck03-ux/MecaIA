-- ============================================================
-- MECAIA — SCHEMA SUPABASE COMPLET
-- À exécuter dans Supabase → SQL Editor → New query
-- ============================================================

-- ============================================================
-- TABLE : users (profils utilisateurs)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL,
  name          TEXT        NOT NULL DEFAULT '',
  type          TEXT        NOT NULL DEFAULT 'amateur'
                            CHECK (type IN ('mechanic','amateur','apprenti','garage')),
  credits       INTEGER     NOT NULL DEFAULT 3 CHECK (credits >= 0),
  is_unlimited  BOOLEAN     NOT NULL DEFAULT FALSE,
  unlimited_until TIMESTAMPTZ,
  promo_code    TEXT        UNIQUE,
  total_paid    NUMERIC(10,2) NOT NULL DEFAULT 0,
  diagnostics_count INTEGER NOT NULL DEFAULT 0,
  lang          TEXT        NOT NULL DEFAULT 'fr',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE : cars (garage virtuel)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cars (
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

-- ============================================================
-- TABLE : diagnostics (historique des diagnostics)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.diagnostics (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  car_id      UUID        REFERENCES public.cars(id) ON DELETE SET NULL,
  type        TEXT        NOT NULL DEFAULT 'obd'
                          CHECK (type IN ('obd','photo','pieces','alertes','vin','chat')),
  input       JSONB       NOT NULL DEFAULT '{}',
  output      JSONB       NOT NULL DEFAULT '{}',
  credits_used INTEGER    NOT NULL DEFAULT 1,
  is_fav      BOOLEAN     NOT NULL DEFAULT FALSE,
  rating      INTEGER     CHECK (rating BETWEEN 1 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE : transactions (paiements Stripe)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_session_id TEXT        UNIQUE,
  amount            NUMERIC(10,2) NOT NULL,
  credits           INTEGER     NOT NULL,
  pack_name         TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','completed','refunded')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE : promo_codes (codes promo)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.promo_codes (
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

-- ============================================================
-- TABLE : used_promos (codes déjà utilisés par user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.used_promos (
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, code)
);

-- ============================================================
-- TABLE : team_members (équipe / invitations)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.team_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  name        TEXT,
  status      TEXT        NOT NULL DEFAULT 'invited'
                          CHECK (status IN ('invited','active','removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE : chat_messages (Chat Dylan)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id  TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT        NOT NULL,
  q_number    INTEGER     DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES (performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_cars_user        ON public.cars(user_id);
CREATE INDEX IF NOT EXISTS idx_diag_user        ON public.diagnostics(user_id);
CREATE INDEX IF NOT EXISTS idx_diag_created     ON public.diagnostics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trans_user       ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_session     ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_promo_code       ON public.promo_codes(code);

-- ============================================================
-- ROW LEVEL SECURITY (chaque user voit SES données)
-- ============================================================
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_promos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies : chaque user gère ses données
CREATE POLICY "users_own" ON public.users
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "cars_own" ON public.cars
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "diagnostics_own" ON public.diagnostics
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "transactions_own" ON public.transactions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "used_promos_own" ON public.used_promos
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "team_own" ON public.team_members
  FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "chat_own" ON public.chat_messages
  FOR ALL USING (auth.uid() = user_id);

-- Promo codes : lecture publique, écriture admin uniquement
CREATE POLICY "promos_read" ON public.promo_codes
  FOR SELECT USING (TRUE);

-- NOTE : les fonctions increment_credits / decrement_credits / etc.
-- sont définies dans functions.sql (à exécuter après ce fichier).

-- ============================================================
-- FONCTION : trigger auto updated_at
-- ============================================================
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

-- ============================================================
-- DONNÉES INITIALES : quelques codes promo de test
-- ============================================================
INSERT INTO public.promo_codes (code, type, credits, uses_left)
VALUES
  ('WELCOME3', 'credits', 3, 1000),
  ('BETA10',   'credits', 10, 100)
ON CONFLICT (code) DO NOTHING;
