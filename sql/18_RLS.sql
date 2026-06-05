-- ============================================================
-- RLS — ROW LEVEL SECURITY (défense en profondeur)
-- Nos fonctions serveur utilisent la clé SERVICE (contourne RLS),
-- donc ceci ne casse aucune fonction. Cela bloque en revanche tout
-- accès DIRECT (clé anon) à des données qui ne sont pas les siennes.
-- À exécuter APRÈS la création de toutes les tables.
-- Hypothèse : user_id = auth.uid() (Supabase Auth).
-- ============================================================

-- ---- Tables liées directement à user_id ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_vehicles','user_diagnostics','user_vehicle_maintenance','user_repairs',
    'user_credits','credit_transactions','stripe_payments','user_emails','email_logs',
    'diagnostic_sessions','user_badges','user_achievements','user_points','point_transactions'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_owner_sel', t);
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_id = auth.uid());', t||'_owner_sel', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_owner_ins', t);
      EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = auth.uid());', t||'_owner_ins', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_owner_upd', t);
      EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (user_id = auth.uid());', t||'_owner_upd', t);
    END IF;
  END LOOP;
END $$;

-- ---- Tables liées à un véhicule (via user_vehicles) ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_health_scores','health_score_history'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_owner_sel', t);
      EXECUTE format($f$CREATE POLICY %I ON %I FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_vehicles v WHERE v.id = %I.vehicle_id AND v.user_id = auth.uid())
      );$f$, t||'_owner_sel', t, t);
    END IF;
  END LOOP;
END $$;

-- ---- diagnostic_cases : un utilisateur lit ses propres cas ----
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'diagnostic_cases') THEN
    ALTER TABLE diagnostic_cases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS diagnostic_cases_owner_sel ON diagnostic_cases;
    CREATE POLICY diagnostic_cases_owner_sel ON diagnostic_cases
      FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

-- ---- Données de référence : lecture publique ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_packages','badge_definitions','repair_guides','maintenance_templates'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_public_sel', t);
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true);', t||'_public_sel', t);
    END IF;
  END LOOP;
END $$;

-- ---- Tables système : RLS activé SANS policy = accessible uniquement
--      via la clé service (webhook Stripe). Aucun accès anon/authenticated. ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['processed_stripe_events'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- DONE
-- ============================================================
