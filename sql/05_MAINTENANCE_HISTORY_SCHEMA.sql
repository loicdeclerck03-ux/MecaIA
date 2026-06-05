-- ============================================================
-- TABLE: user_vehicle_maintenance
-- Historique maintenance de chaque véhicule utilisateur
-- ============================================================

-- Drop si existe (pour tests)
-- DROP TABLE IF EXISTS user_vehicle_maintenance CASCADE;

-- CREATE TABLE: user_vehicle_maintenance
CREATE TABLE IF NOT EXISTS user_vehicle_maintenance (
  -- IDs
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  
  -- Maintenance info
  maintenance_type TEXT NOT NULL, -- "oil_change", "filter_change", "tire_rotation", "battery", "brake_pads", "coolant", "inspection", etc
  maintenance_date DATE NOT NULL, -- Quand ça a été fait
  maintenance_description TEXT, -- Description libre: "Huile Motul 5W40, 5L"
  
  -- Odometer/KM at maintenance
  vehicle_km_at_maintenance INTEGER, -- Kilométrage au moment de la maintenance
  
  -- Cost tracking
  cost_eur DECIMAL(10, 2), -- Coût en EUR
  shop_name TEXT, -- "Garage Dupont", "Norauto", etc
  shop_location TEXT, -- Localisation du garage
  
  -- Next maintenance
  next_maintenance_date DATE, -- Quand il faudrait refaire
  next_maintenance_km INTEGER, -- Après combien de km refaire
  
  -- Notes
  notes TEXT, -- Notes libres
  
  -- Media
  receipt_image_url TEXT, -- URL de la facture/ticket
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_id_not_null CHECK (user_id IS NOT NULL),
  CONSTRAINT vehicle_id_not_null CHECK (vehicle_id IS NOT NULL),
  CONSTRAINT maintenance_date_valid CHECK (maintenance_date <= CURRENT_DATE)
);

-- INDEX: Pour performance
CREATE INDEX IF NOT EXISTS idx_user_vehicle_maintenance_user_id 
  ON user_vehicle_maintenance(user_id);

CREATE INDEX IF NOT EXISTS idx_user_vehicle_maintenance_vehicle_id 
  ON user_vehicle_maintenance(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_user_vehicle_maintenance_date 
  ON user_vehicle_maintenance(maintenance_date DESC);

CREATE INDEX IF NOT EXISTS idx_user_vehicle_maintenance_type 
  ON user_vehicle_maintenance(maintenance_type);

-- ============================================================
-- TABLE: maintenance_templates
-- Templates pré-configurés pour les maintenances courantes
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Maintenance info
  maintenance_type TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL, -- "Changement d'huile", "Remplacement filtre", etc
  description TEXT, -- Description détaillée
  
  -- Recommandations
  recommended_interval_months INTEGER, -- Tous les X mois
  recommended_interval_km INTEGER, -- Tous les X km
  
  -- Coûts typiques
  avg_cost_min_eur DECIMAL(10, 2),
  avg_cost_max_eur DECIMAL(10, 2),
  
  -- Icon/emoji
  icon TEXT, -- "🛢️", "⚙️", etc
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert templates
INSERT INTO maintenance_templates (maintenance_type, display_name, description, recommended_interval_months, recommended_interval_km, avg_cost_min_eur, avg_cost_max_eur, icon) 
VALUES 
  ('oil_change', 'Changement d\'huile', 'Remplacement de l\'huile moteur', 6, 10000, 40, 80, '🛢️'),
  ('filter_change', 'Changement filtre air', 'Remplacement du filtre à air moteur', 12, 20000, 20, 50, '💨'),
  ('brake_pads', 'Plaquettes de frein', 'Remplacement des plaquettes de frein', 24, 50000, 80, 250, '🛑'),
  ('tire_rotation', 'Rotation des pneus', 'Rotation et équilibrage des pneus', 12, 15000, 50, 150, '🔄'),
  ('battery', 'Batterie', 'Remplacement batterie', 48, 60000, 100, 300, '🔋'),
  ('coolant', 'Liquide de refroidissement', 'Remplacement du liquide de refroidissement', 24, 40000, 30, 80, '❄️'),
  ('inspection', 'Contrôle technique', 'Inspection générale du véhicule', 12, 0, 0, 0, '🔍'),
  ('windshield_wipers', 'Essuie-glaces', 'Remplacement essuie-glaces', 6, 10000, 15, 40, '💧'),
  ('fuel_filter', 'Filtre à carburant', 'Remplacement filtre à carburant', 12, 20000, 30, 100, '⛽'),
  ('transmission_fluid', 'Fluide de transmission', 'Vidange boite de vitesses', 48, 80000, 150, 400, '⚙️');

-- ============================================================
-- FUNCTION: get_vehicle_maintenance_history
-- Récupère l'historique maintenance d'un véhicule
-- ============================================================

CREATE OR REPLACE FUNCTION get_vehicle_maintenance_history(p_vehicle_id UUID)
RETURNS TABLE (
  id UUID,
  maintenance_type TEXT,
  maintenance_date DATE,
  maintenance_description TEXT,
  vehicle_km_at_maintenance INTEGER,
  cost_eur DECIMAL,
  shop_name TEXT,
  days_ago INTEGER,
  is_overdue BOOLEAN,
  next_maintenance_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    uvm.id,
    uvm.maintenance_type,
    uvm.maintenance_date,
    uvm.maintenance_description,
    uvm.vehicle_km_at_maintenance,
    uvm.cost_eur,
    uvm.shop_name,
    (CURRENT_DATE - uvm.maintenance_date)::INTEGER as days_ago,
    (uvm.next_maintenance_date IS NOT NULL AND uvm.next_maintenance_date < CURRENT_DATE) as is_overdue,
    uvm.next_maintenance_date
  FROM user_vehicle_maintenance uvm
  WHERE uvm.vehicle_id = p_vehicle_id
  ORDER BY uvm.maintenance_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: add_maintenance_record
-- Ajoute un enregistrement de maintenance
-- ============================================================

CREATE OR REPLACE FUNCTION add_maintenance_record(
  p_user_id UUID,
  p_vehicle_id UUID,
  p_maintenance_type TEXT,
  p_maintenance_date DATE,
  p_maintenance_description TEXT,
  p_vehicle_km_at_maintenance INTEGER,
  p_cost_eur DECIMAL,
  p_shop_name TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  record_id UUID,
  success BOOLEAN,
  message TEXT,
  next_maintenance_date DATE
) AS $$
DECLARE
  v_record_id UUID;
  v_next_date DATE;
  v_template_interval_months INTEGER;
BEGIN
  -- Insérer la maintenance
  INSERT INTO user_vehicle_maintenance (
    user_id,
    vehicle_id,
    maintenance_type,
    maintenance_date,
    maintenance_description,
    vehicle_km_at_maintenance,
    cost_eur,
    shop_name,
    notes
  ) VALUES (
    p_user_id,
    p_vehicle_id,
    p_maintenance_type,
    p_maintenance_date,
    p_maintenance_description,
    p_vehicle_km_at_maintenance,
    p_cost_eur,
    p_shop_name,
    p_notes
  ) RETURNING id INTO v_record_id;

  -- Calculer la prochaine maintenance (à partir du template)
  SELECT recommended_interval_months INTO v_template_interval_months
  FROM maintenance_templates
  WHERE maintenance_type = p_maintenance_type;

  IF v_template_interval_months IS NOT NULL THEN
    v_next_date := p_maintenance_date + (v_template_interval_months || ' months')::INTERVAL;
    
    -- Mettre à jour next_maintenance_date
    UPDATE user_vehicle_maintenance
    SET next_maintenance_date = v_next_date
    WHERE id = v_record_id;
  END IF;

  RETURN QUERY SELECT 
    v_record_id,
    TRUE,
    'Maintenance record added successfully',
    v_next_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_maintenance_alerts
-- Retourne les maintenances overdue ou coming soon
-- ============================================================

CREATE OR REPLACE FUNCTION get_maintenance_alerts(p_vehicle_id UUID)
RETURNS TABLE (
  maintenance_type TEXT,
  display_name TEXT,
  next_maintenance_date DATE,
  days_until_due INTEGER,
  is_overdue BOOLEAN,
  icon TEXT,
  urgency TEXT -- "overdue", "urgent" (< 7 days), "warning" (< 30 days), "ok"
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mt.maintenance_type,
    mt.display_name,
    uvm.next_maintenance_date,
    (uvm.next_maintenance_date - CURRENT_DATE)::INTEGER as days_until_due,
    (uvm.next_maintenance_date < CURRENT_DATE) as is_overdue,
    mt.icon,
    CASE 
      WHEN uvm.next_maintenance_date < CURRENT_DATE THEN 'overdue'
      WHEN uvm.next_maintenance_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'urgent'
      WHEN uvm.next_maintenance_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
      ELSE 'ok'
    END as urgency
  FROM user_vehicle_maintenance uvm
  JOIN maintenance_templates mt ON uvm.maintenance_type = mt.maintenance_type
  WHERE uvm.vehicle_id = p_vehicle_id
    AND uvm.next_maintenance_date IS NOT NULL
  ORDER BY uvm.next_maintenance_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_maintenance_statistics
-- Stats: coût total, maintenances par type, etc
-- ============================================================

CREATE OR REPLACE FUNCTION get_maintenance_statistics(p_vehicle_id UUID)
RETURNS TABLE (
  total_maintenance_count INTEGER,
  total_cost_eur DECIMAL,
  avg_cost_per_maintenance DECIMAL,
  most_expensive_maintenance TEXT,
  last_maintenance_date DATE,
  days_since_last_maintenance INTEGER,
  maintenance_by_type JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER,
    COALESCE(SUM(cost_eur), 0),
    COALESCE(AVG(cost_eur), 0),
    (SELECT DISTINCT maintenance_type FROM user_vehicle_maintenance 
     WHERE vehicle_id = p_vehicle_id 
     ORDER BY cost_eur DESC LIMIT 1),
    MAX(maintenance_date),
    (CURRENT_DATE - MAX(maintenance_date))::INTEGER,
    json_object_agg(
      maintenance_type,
      COUNT(*)
    ) FILTER (WHERE maintenance_type IS NOT NULL)
  FROM user_vehicle_maintenance
  WHERE vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON user_vehicle_maintenance TO authenticated;
GRANT SELECT ON maintenance_templates TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_maintenance_history TO authenticated;
GRANT EXECUTE ON FUNCTION add_maintenance_record TO authenticated;
GRANT EXECUTE ON FUNCTION get_maintenance_alerts TO authenticated;
GRANT EXECUTE ON FUNCTION get_maintenance_statistics TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
-- Historique maintenance complètement configuré en BD
