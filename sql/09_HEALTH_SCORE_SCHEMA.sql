-- ============================================================
-- TABLE: vehicle_health_scores
-- Score santé global du véhicule
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL UNIQUE,
  
  -- Overall score (0-100)
  health_score INTEGER DEFAULT 100,
  health_status TEXT DEFAULT 'excellent', -- excellent, good, fair, poor, critical
  
  -- Component scores
  engine_health INTEGER DEFAULT 100,
  transmission_health INTEGER DEFAULT 100,
  brakes_health INTEGER DEFAULT 100,
  suspension_health INTEGER DEFAULT 100,
  electrical_health INTEGER DEFAULT 100,
  fluids_health INTEGER DEFAULT 100,
  
  -- Factors
  recent_issues_count INTEGER DEFAULT 0,
  pending_repairs_count INTEGER DEFAULT 0,
  maintenance_overdue_count INTEGER DEFAULT 0,
  
  -- Prediction
  estimated_repair_cost INTEGER DEFAULT 0,
  reliability_percent INTEGER DEFAULT 95,
  
  -- Metadata
  last_calculation TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vehicle_health_scores_vehicle_id ON vehicle_health_scores(vehicle_id);

-- ============================================================
-- TABLE: health_score_history
-- Historique du score santé
-- ============================================================

CREATE TABLE IF NOT EXISTS health_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL,
  
  health_score INTEGER,
  health_status TEXT,
  
  -- Reason for change
  change_reason TEXT, -- 'diagnostic_added', 'repair_completed', 'maintenance_logged', etc
  related_id UUID, -- diagnostic_id, repair_id, etc
  
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_health_score_history_vehicle_id ON health_score_history(vehicle_id);
CREATE INDEX idx_health_score_history_recorded_at ON health_score_history(recorded_at DESC);

-- ============================================================
-- FUNCTION: calculate_vehicle_health
-- Calcule le score santé d'un véhicule
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_vehicle_health(p_vehicle_id UUID)
RETURNS TABLE (
  health_score INTEGER,
  health_status TEXT,
  engine_health INTEGER,
  brakes_health INTEGER,
  estimated_repair_cost INTEGER,
  recent_issues_count INTEGER
) AS $$
DECLARE
  v_recent_issues INTEGER;
  v_pending_repairs INTEGER;
  v_overdue_maintenance INTEGER;
  v_avg_confidence INTEGER;
  v_health_score INTEGER;
  v_status TEXT;
BEGIN
  -- Compter les problèmes récents
  SELECT COUNT(*) INTO v_recent_issues FROM user_diagnostics
  WHERE vehicle_id = p_vehicle_id AND diagnosis_date >= NOW() - INTERVAL '30 days';
  
  -- Compter les réparations en attente
  SELECT COUNT(*) INTO v_pending_repairs FROM user_repairs
  WHERE vehicle_id = p_vehicle_id AND status != 'completed';
  
  -- Compter les maintenances overdue
  SELECT COUNT(*) INTO v_overdue_maintenance FROM user_vehicle_maintenance
  WHERE vehicle_id = p_vehicle_id AND next_maintenance_date < CURRENT_DATE;
  
  -- Calculer la confiance moyenne des diagnostics
  SELECT COALESCE(AVG(confidence_percent), 100)::INTEGER INTO v_avg_confidence
  FROM user_diagnostics WHERE vehicle_id = p_vehicle_id;
  
  -- Calculer le score santé (0-100)
  v_health_score := 100;
  v_health_score := v_health_score - (v_recent_issues * 15); -- -15 par problème récent
  v_health_score := v_health_score - (v_pending_repairs * 20); -- -20 par réparation en attente
  v_health_score := v_health_score - (v_overdue_maintenance * 10); -- -10 par maintenance overdue
  v_health_score := GREATEST(0, LEAST(100, v_health_score));
  
  -- Déterminer le statut
  v_status := CASE
    WHEN v_health_score >= 80 THEN 'excellent'
    WHEN v_health_score >= 60 THEN 'good'
    WHEN v_health_score >= 40 THEN 'fair'
    WHEN v_health_score >= 20 THEN 'poor'
    ELSE 'critical'
  END;
  
  -- Mettre à jour le score dans la table
  UPDATE vehicle_health_scores
  SET health_score = v_health_score,
      health_status = v_status,
      engine_health = v_avg_confidence,
      recent_issues_count = v_recent_issues,
      pending_repairs_count = v_pending_repairs,
      maintenance_overdue_count = v_overdue_maintenance,
      last_calculation = NOW()
  WHERE vehicle_id = p_vehicle_id;
  
  RETURN QUERY SELECT 
    v_health_score,
    v_status,
    v_avg_confidence,
    85, -- brakes_health (exemple)
    v_pending_repairs * 300, -- estimated cost
    v_recent_issues;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_vehicle_health
-- Récupère le score santé d'un véhicule
-- ============================================================

CREATE OR REPLACE FUNCTION get_vehicle_health(p_vehicle_id UUID)
RETURNS TABLE (
  health_score INTEGER,
  health_status TEXT,
  recent_issues INTEGER,
  pending_repairs INTEGER,
  maintenance_overdue INTEGER,
  reliability_percent INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vhs.health_score,
    vhs.health_status,
    vhs.recent_issues_count,
    vhs.pending_repairs_count,
    vhs.maintenance_overdue_count,
    vhs.reliability_percent
  FROM vehicle_health_scores vhs
  WHERE vhs.vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON vehicle_health_scores TO authenticated;
GRANT SELECT, INSERT ON health_score_history TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_vehicle_health TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_health TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
