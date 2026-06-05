-- ============================================================
-- TABLE: user_vehicles
-- Les véhicules de chaque utilisateur
-- ============================================================

CREATE TABLE IF NOT EXISTS user_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Vehicle info
  marque TEXT NOT NULL,
  modele TEXT NOT NULL,
  annee INTEGER,
  km_current INTEGER,
  immatriculation TEXT,
  vin TEXT,
  
  -- Vehicle identification
  couleur TEXT,
  carburant TEXT, -- "essence", "diesel", "hybride", "electrique"
  boite_vitesses TEXT, -- "manuel", "automatique"
  puissance_ch INTEGER, -- Chevaux
  
  -- Ownership
  is_primary BOOLEAN DEFAULT FALSE,
  nickname TEXT, -- "Ma vieille Peugeot", "Voiture du travail", etc
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_id_not_null CHECK (user_id IS NOT NULL),
  CONSTRAINT marque_not_null CHECK (marque IS NOT NULL)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_vehicles_user_id 
  ON user_vehicles(user_id);

CREATE INDEX IF NOT EXISTS idx_user_vehicles_marque_modele 
  ON user_vehicles(marque, modele);

-- ============================================================
-- TABLE: user_diagnostics
-- Historique des diagnostics pour chaque véhicule
-- ============================================================

CREATE TABLE IF NOT EXISTS user_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  
  -- Diagnostic info
  primary_diagnosis TEXT NOT NULL,
  symptoms JSONB, -- ["bruit moteur", "voyant allumé", ...]
  obd_codes JSONB, -- ["P0087", "P0101", ...]
  
  -- Causes & solutions
  causes JSONB, -- ["FAP encrassé", "Injecteur défaillant", ...]
  parts_needed JSONB, -- ["Filtre anti-pollution", "Injecteur", ...]
  
  -- Confidence & urgency
  confidence_percent INTEGER,
  urgency TEXT, -- "immédiat", "bientôt", "maintenance"
  can_drive BOOLEAN,
  
  -- Costs
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  
  -- Status
  status TEXT DEFAULT 'new', -- 'new', 'viewed', 'repaired', 'ignored'
  repair_status TEXT, -- 'pending', 'in_progress', 'completed', 'cancelled'
  repair_date DATE,
  repair_cost INTEGER,
  repair_notes TEXT,
  
  -- Metadata
  diagnosis_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_id_not_null CHECK (user_id IS NOT NULL),
  CONSTRAINT vehicle_id_not_null CHECK (vehicle_id IS NOT NULL)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_diagnostics_user_id 
  ON user_diagnostics(user_id);

CREATE INDEX IF NOT EXISTS idx_user_diagnostics_vehicle_id 
  ON user_diagnostics(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_user_diagnostics_status 
  ON user_diagnostics(status);

CREATE INDEX IF NOT EXISTS idx_user_diagnostics_diagnosis_date 
  ON user_diagnostics(diagnosis_date DESC);

-- ============================================================
-- FUNCTION: get_user_vehicles
-- Récupère tous les véhicules de l'utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_vehicles(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  marque TEXT,
  modele TEXT,
  annee INTEGER,
  km_current INTEGER,
  immatriculation TEXT,
  nickname TEXT,
  is_primary BOOLEAN,
  is_active BOOLEAN,
  last_diagnosis_date TIMESTAMP,
  last_diagnosis_type TEXT,
  pending_diagnostics_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    uv.id,
    uv.marque,
    uv.modele,
    uv.annee,
    uv.km_current,
    uv.immatriculation,
    uv.nickname,
    uv.is_primary,
    uv.is_active,
    MAX(ud.diagnosis_date) as last_diagnosis_date,
    (SELECT primary_diagnosis FROM user_diagnostics 
     WHERE vehicle_id = uv.id 
     ORDER BY diagnosis_date DESC LIMIT 1) as last_diagnosis_type,
    COUNT(CASE WHEN ud.status = 'new' THEN 1 END)::INTEGER as pending_diagnostics_count
  FROM user_vehicles uv
  LEFT JOIN user_diagnostics ud ON uv.id = ud.vehicle_id
  WHERE uv.user_id = p_user_id AND uv.is_active = TRUE
  GROUP BY uv.id, uv.marque, uv.modele, uv.annee, uv.km_current, 
           uv.immatriculation, uv.nickname, uv.is_primary, uv.is_active
  ORDER BY uv.is_primary DESC, uv.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: add_user_vehicle
-- Ajoute un nouveau véhicule pour l'utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION add_user_vehicle(
  p_user_id UUID,
  p_marque TEXT,
  p_modele TEXT,
  p_annee INTEGER,
  p_km_current INTEGER,
  p_immatriculation TEXT,
  p_nickname TEXT,
  p_carburant TEXT DEFAULT NULL,
  p_couleur TEXT DEFAULT NULL
)
RETURNS TABLE (
  vehicle_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_vehicle_id UUID;
  v_count INTEGER;
BEGIN
  -- Vérifier si c'est le premier véhicule
  SELECT COUNT(*) INTO v_count 
  FROM user_vehicles 
  WHERE user_id = p_user_id AND is_active = TRUE;

  -- Insérer le véhicule
  INSERT INTO user_vehicles (
    user_id,
    marque,
    modele,
    annee,
    km_current,
    immatriculation,
    nickname,
    carburant,
    couleur,
    is_primary
  ) VALUES (
    p_user_id,
    p_marque,
    p_modele,
    p_annee,
    p_km_current,
    p_immatriculation,
    p_nickname,
    p_carburant,
    p_couleur,
    v_count = 0  -- Primary if first vehicle
  ) RETURNING id INTO v_vehicle_id;

  RETURN QUERY SELECT 
    v_vehicle_id,
    TRUE,
    'Vehicle added successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_vehicle_diagnostics
-- Récupère les diagnostics d'un véhicule
-- ============================================================

CREATE OR REPLACE FUNCTION get_vehicle_diagnostics(p_vehicle_id UUID)
RETURNS TABLE (
  id UUID,
  primary_diagnosis TEXT,
  confidence_percent INTEGER,
  urgency TEXT,
  status TEXT,
  diagnosis_date TIMESTAMP,
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  days_ago INTEGER,
  repair_status TEXT,
  repair_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ud.id,
    ud.primary_diagnosis,
    ud.confidence_percent,
    ud.urgency,
    ud.status,
    ud.diagnosis_date,
    ud.estimated_cost_min,
    ud.estimated_cost_max,
    (CURRENT_DATE - ud.diagnosis_date::DATE)::INTEGER as days_ago,
    ud.repair_status,
    ud.repair_date
  FROM user_diagnostics ud
  WHERE ud.vehicle_id = p_vehicle_id
  ORDER BY ud.diagnosis_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: add_user_diagnostic
-- Ajoute un diagnostic pour un véhicule utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION add_user_diagnostic(
  p_user_id UUID,
  p_vehicle_id UUID,
  p_primary_diagnosis TEXT,
  p_symptoms JSONB,
  p_obd_codes JSONB,
  p_causes JSONB,
  p_parts_needed JSONB,
  p_confidence_percent INTEGER,
  p_urgency TEXT,
  p_can_drive BOOLEAN,
  p_estimated_cost_min INTEGER,
  p_estimated_cost_max INTEGER
)
RETURNS TABLE (
  diagnostic_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_diagnostic_id UUID;
BEGIN
  INSERT INTO user_diagnostics (
    user_id,
    vehicle_id,
    primary_diagnosis,
    symptoms,
    obd_codes,
    causes,
    parts_needed,
    confidence_percent,
    urgency,
    can_drive,
    estimated_cost_min,
    estimated_cost_max
  ) VALUES (
    p_user_id,
    p_vehicle_id,
    p_primary_diagnosis,
    p_symptoms,
    p_obd_codes,
    p_causes,
    p_parts_needed,
    p_confidence_percent,
    p_urgency,
    p_can_drive,
    p_estimated_cost_min,
    p_estimated_cost_max
  ) RETURNING id INTO v_diagnostic_id;

  RETURN QUERY SELECT 
    v_diagnostic_id,
    TRUE,
    'Diagnostic added to user profile';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_user_diagnostics_summary
-- Stats sur les diagnostics d'un utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_diagnostics_summary(p_user_id UUID)
RETURNS TABLE (
  total_diagnostics INTEGER,
  total_vehicles INTEGER,
  avg_confidence NUMERIC,
  pending_repairs INTEGER,
  completed_repairs INTEGER,
  total_estimated_cost_min INTEGER,
  total_estimated_cost_max INTEGER,
  last_diagnosis_date TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(ud.*)::INTEGER,
    COUNT(DISTINCT ud.vehicle_id)::INTEGER,
    ROUND(AVG(ud.confidence_percent)::NUMERIC, 2),
    COUNT(CASE WHEN ud.repair_status IS NULL OR ud.repair_status != 'completed' THEN 1 END)::INTEGER,
    COUNT(CASE WHEN ud.repair_status = 'completed' THEN 1 END)::INTEGER,
    COALESCE(SUM(ud.estimated_cost_min), 0)::INTEGER,
    COALESCE(SUM(ud.estimated_cost_max), 0)::INTEGER,
    MAX(ud.diagnosis_date)
  FROM user_diagnostics ud
  WHERE ud.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: update_vehicle_km
-- Mettre à jour le kilométrage d'un véhicule
-- ============================================================

CREATE OR REPLACE FUNCTION update_vehicle_km(
  p_vehicle_id UUID,
  p_km_new INTEGER
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  km_previous INTEGER,
  km_new INTEGER,
  km_added INTEGER
) AS $$
DECLARE
  v_km_previous INTEGER;
BEGIN
  SELECT km_current INTO v_km_previous 
  FROM user_vehicles 
  WHERE id = p_vehicle_id;

  UPDATE user_vehicles
  SET km_current = p_km_new, updated_at = NOW()
  WHERE id = p_vehicle_id;

  RETURN QUERY SELECT 
    TRUE,
    'KM updated successfully',
    v_km_previous,
    p_km_new,
    p_km_new - COALESCE(v_km_previous, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON user_vehicles TO authenticated;
GRANT SELECT, INSERT ON user_diagnostics TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_vehicles TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_vehicle TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_diagnostics TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_diagnostic TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_diagnostics_summary TO authenticated;
GRANT EXECUTE ON FUNCTION update_vehicle_km TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
-- User garage schema complètement configuré en BD
