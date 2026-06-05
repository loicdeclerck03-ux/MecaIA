-- ============================================================
-- CONTRÔLE DE PROPRIÉTÉ
-- Empêche un utilisateur authentifié d'accéder aux données
-- (véhicule, réparation) d'un AUTRE utilisateur.
-- Prérequis : USER_GARAGE_SCHEMA.sql (user_vehicles),
--             REPAIR_MODE_SCHEMA.sql (user_repairs).
-- ============================================================

CREATE OR REPLACE FUNCTION user_owns_vehicle(p_user_id UUID, p_vehicle_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_vehicles
    WHERE id = p_vehicle_id AND user_id = p_user_id
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION user_owns_repair(p_user_id UUID, p_repair_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_repairs
    WHERE id = p_repair_id AND user_id = p_user_id
  );
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION user_owns_vehicle, user_owns_repair
  TO authenticated, anon, service_role;

-- ============================================================
-- DONE
-- ============================================================
