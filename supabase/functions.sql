-- ============================================================
-- MECAIA — FONCTIONS SQL SUPPLÉMENTAIRES
-- À exécuter dans Supabase → SQL Editor APRÈS schema.sql
-- ============================================================

-- ============================================================
-- FONCTION : décrémenter crédits (utilisé à chaque diagnostic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrement_credits(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_credits INTEGER;
  current_credits INTEGER;
BEGIN
  SELECT credits INTO current_credits FROM public.users WHERE id = p_user_id;
  IF current_credits IS NULL OR current_credits <= 0 THEN
    RAISE EXCEPTION 'Plus de crédits';
  END IF;
  UPDATE public.users
  SET credits = credits - 1, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO new_credits;
  RETURN new_credits;
END;
$$;

-- ============================================================
-- FONCTION : incrémenter crédits (paiement Stripe)
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_credits(user_id UUID, amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_credits INTEGER;
BEGIN
  UPDATE public.users
  SET credits = credits + amount, updated_at = NOW()
  WHERE id = user_id
  RETURNING credits INTO new_credits;
  RETURN new_credits;
END;
$$;

-- ============================================================
-- FONCTION : incrémenter compteur diagnostics
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_diag_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
  SET diagnostics_count = diagnostics_count + 1, updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

-- ============================================================
-- FONCTION : incrémenter total payé
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_paid(p_user_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
  SET total_paid = total_paid + p_amount, updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

-- ============================================================
-- TRIGGER : créer profil automatiquement après inscription
-- (Déclenché à chaque nouveau user dans auth.users)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
END;
$$;

-- Créer le trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- VUE : statistiques globales (pour dashboard Loïc)
-- ============================================================
CREATE OR REPLACE VIEW public.admin_stats AS
SELECT
  COUNT(DISTINCT u.id)                          AS total_users,
  COALESCE(SUM(u.diagnostics_count), 0)         AS total_diagnostics,
  COALESCE(SUM(u.total_paid), 0)                AS total_revenue,
  COUNT(DISTINCT CASE WHEN u.is_unlimited THEN u.id END) AS unlimited_users,
  COUNT(DISTINCT CASE WHEN u.credits > 0 THEN u.id END)  AS active_users
FROM public.users u;

-- Accès uniquement au service_role (backend)
REVOKE ALL ON public.admin_stats FROM anon, authenticated;
GRANT SELECT ON public.admin_stats TO service_role;

-- ============================================================
-- VÉRIFICATION (exécuter pour confirmer tout est OK)
-- ============================================================
-- SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';
