-- ============================================================
-- TABLE: repair_guides
-- Guides de réparation (YouTube + RTAs)
-- ============================================================

CREATE TABLE IF NOT EXISTS repair_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Diagnostic link
  diagnosis_type TEXT NOT NULL UNIQUE, -- "FAP encrassé", "EGR défaillante", etc
  
  -- YouTube info
  youtube_url TEXT,
  youtube_title TEXT,
  youtube_channel TEXT,
  youtube_duration_minutes INTEGER,
  youtube_views INTEGER,
  youtube_rating DECIMAL(3,1), -- 1.0-5.0
  
  -- RTA (Real Time Analysis) - Texts guides
  rta_steps JSONB, -- [{step: 1, title: "Démonter...", duration: 15, ...}]
  rta_tools_needed JSONB, -- ["Clé à molette", "Tournevis Phillips", ...]
  rta_difficulty TEXT, -- "facile", "moyen", "difficile"
  rta_time_minutes INTEGER,
  
  -- Parts & costs
  parts_recommended JSONB, -- [{name: "FAP", brand: "OEM", price: 400, affiliate_link: "..."}]
  avg_total_cost INTEGER,
  
  -- Metadata
  is_diy BOOLEAN DEFAULT TRUE, -- Can user do it themselves?
  affiliate_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_repair_guides_diagnosis_type 
  ON repair_guides(diagnosis_type);

-- ============================================================
-- TABLE: user_repairs
-- Historique des réparations utilisateur
-- ============================================================

CREATE TABLE IF NOT EXISTS user_repairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  diagnostic_id UUID,
  
  -- Repair info
  diagnosis_type TEXT NOT NULL,
  repair_title TEXT,
  status TEXT DEFAULT 'planning', -- 'planning', 'in_progress', 'completed', 'failed'
  
  -- Guide reference
  guide_id UUID,
  followed_youtube BOOLEAN DEFAULT FALSE,
  followed_rta BOOLEAN DEFAULT FALSE,
  
  -- Cost tracking
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  actual_cost INTEGER,
  parts_purchased JSONB, -- [{name, brand, price, date}]
  
  -- Timeline
  start_date DATE,
  planned_completion_date DATE,
  actual_completion_date DATE,
  time_spent_hours DECIMAL(5,1),
  
  -- Notes
  notes TEXT,
  issues_encountered TEXT,
  lessons_learned TEXT,
  
  -- Rating
  difficulty_actual TEXT, -- "easier", "as_expected", "harder"
  success_rating INTEGER, -- 1-5
  would_diy_again BOOLEAN,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_repairs_user_id 
  ON user_repairs(user_id);

CREATE INDEX IF NOT EXISTS idx_user_repairs_vehicle_id 
  ON user_repairs(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_user_repairs_status 
  ON user_repairs(status);

-- ============================================================
-- FUNCTION: get_repair_guide
-- Récupère un guide de réparation par type diagnostic
-- ============================================================

CREATE OR REPLACE FUNCTION get_repair_guide(p_diagnosis_type TEXT)
RETURNS TABLE (
  id UUID,
  diagnosis_type TEXT,
  youtube_url TEXT,
  youtube_title TEXT,
  youtube_duration_minutes INTEGER,
  youtube_rating DECIMAL,
  rta_steps JSONB,
  rta_tools_needed JSONB,
  rta_difficulty TEXT,
  rta_time_minutes INTEGER,
  parts_recommended JSONB,
  avg_total_cost INTEGER,
  is_diy BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rg.id,
    rg.diagnosis_type,
    rg.youtube_url,
    rg.youtube_title,
    rg.youtube_duration_minutes,
    rg.youtube_rating,
    rg.rta_steps,
    rg.rta_tools_needed,
    rg.rta_difficulty,
    rg.rta_time_minutes,
    rg.parts_recommended,
    rg.avg_total_cost,
    rg.is_diy
  FROM repair_guides rg
  WHERE rg.diagnosis_type = p_diagnosis_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: add_user_repair
-- Ajoute une réparation au suivi utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION add_user_repair(
  p_user_id UUID,
  p_vehicle_id UUID,
  p_diagnostic_id UUID,
  p_diagnosis_type TEXT,
  p_guide_id UUID,
  p_estimated_cost_min INTEGER,
  p_estimated_cost_max INTEGER,
  p_start_date DATE
)
RETURNS TABLE (
  repair_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_repair_id UUID;
BEGIN
  INSERT INTO user_repairs (
    user_id,
    vehicle_id,
    diagnostic_id,
    diagnosis_type,
    guide_id,
    estimated_cost_min,
    estimated_cost_max,
    start_date,
    status
  ) VALUES (
    p_user_id,
    p_vehicle_id,
    p_diagnostic_id,
    p_diagnosis_type,
    p_guide_id,
    p_estimated_cost_min,
    p_estimated_cost_max,
    p_start_date,
    'planning'
  ) RETURNING id INTO v_repair_id;

  RETURN QUERY SELECT 
    v_repair_id,
    TRUE,
    'Repair tracking started';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: update_repair_status
-- Met à jour le statut d'une réparation
-- ============================================================

CREATE OR REPLACE FUNCTION update_repair_status(
  p_repair_id UUID,
  p_new_status TEXT,
  p_actual_cost INTEGER DEFAULT NULL,
  p_completion_date DATE DEFAULT NULL,
  p_success_rating INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  updated_status TEXT
) AS $$
BEGIN
  UPDATE user_repairs
  SET
    status = p_new_status,
    actual_cost = COALESCE(p_actual_cost, actual_cost),
    actual_completion_date = COALESCE(p_completion_date, actual_completion_date),
    success_rating = COALESCE(p_success_rating, success_rating),
    notes = COALESCE(p_notes, notes),
    updated_at = NOW()
  WHERE id = p_repair_id;

  RETURN QUERY SELECT 
    TRUE,
    'Repair status updated',
    p_new_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_user_repairs
-- Récupère l'historique des réparations utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_repairs(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  vehicle_marque TEXT,
  vehicle_modele TEXT,
  diagnosis_type TEXT,
  status TEXT,
  start_date DATE,
  actual_completion_date DATE,
  estimated_cost_min INTEGER,
  actual_cost INTEGER,
  success_rating INTEGER,
  days_elapsed INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ur.id,
    uv.marque,
    uv.modele,
    ur.diagnosis_type,
    ur.status,
    ur.start_date,
    ur.actual_completion_date,
    ur.estimated_cost_min,
    ur.actual_cost,
    ur.success_rating,
    (CURRENT_DATE - ur.start_date)::INTEGER as days_elapsed
  FROM user_repairs ur
  LEFT JOIN user_vehicles uv ON ur.vehicle_id = uv.id
  WHERE ur.user_id = p_user_id
  ORDER BY ur.start_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_repair_statistics
-- Stats sur les réparations de l'utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION get_repair_statistics(p_user_id UUID)
RETURNS TABLE (
  total_repairs INTEGER,
  completed_repairs INTEGER,
  avg_success_rating DECIMAL,
  total_spent INTEGER,
  avg_time_hours DECIMAL,
  diy_success_rate DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER,
    COUNT(CASE WHEN status = 'completed' THEN 1 END)::INTEGER,
    ROUND(AVG(success_rating)::NUMERIC, 2),
    COALESCE(SUM(actual_cost), 0)::INTEGER,
    ROUND(AVG(time_spent_hours)::NUMERIC, 1),
    ROUND(
      COUNT(CASE WHEN status = 'completed' AND success_rating >= 4 THEN 1 END)::NUMERIC / 
      NULLIF(COUNT(CASE WHEN status = 'completed' THEN 1 END), 0) * 100,
      1
    ) -- Success rate for completed
  FROM user_repairs
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SAMPLE REPAIR GUIDES (Insert)
-- ============================================================

INSERT INTO repair_guides (
  diagnosis_type,
  youtube_url,
  youtube_title,
  youtube_channel,
  youtube_duration_minutes,
  youtube_views,
  youtube_rating,
  rta_steps,
  rta_tools_needed,
  rta_difficulty,
  rta_time_minutes,
  parts_recommended,
  avg_total_cost,
  is_diy
) VALUES (
  'FAP encrassé',
  'https://www.youtube.com/watch?v=example1',
  'Comment nettoyer le FAP sans enlever',
  'Mécanique Facile',
  45,
  250000,
  4.7,
  '[{"step": 1, "title": "Localiser le FAP", "duration": 5}, {"step": 2, "title": "Débrancher les capteurs", "duration": 10}]',
  '["Clé à molette", "Tournevis Phillips", "Bac de collecte"]',
  'moyen',
  60,
  '[{"name": "Filtre anti-pollution", "brand": "OEM", "price": 250, "affiliate_link": "https://..."}, {"name": "Joint", "brand": "OEM", "price": 15}]',
  350,
  TRUE
) ON CONFLICT DO NOTHING;

INSERT INTO repair_guides (
  diagnosis_type,
  youtube_url,
  youtube_title,
  youtube_channel,
  youtube_duration_minutes,
  youtube_views,
  youtube_rating,
  rta_steps,
  rta_tools_needed,
  rta_difficulty,
  rta_time_minutes,
  parts_recommended,
  avg_total_cost,
  is_diy
) VALUES (
  'Plaquettes de frein usées',
  'https://www.youtube.com/watch?v=example2',
  'Changement plaquettes de frein - Tuto complet',
  'AutoRepair TV',
  38,
  180000,
  4.8,
  '[{"step": 1, "title": "Surélever le véhicule", "duration": 10}, {"step": 2, "title": "Retirer les roues", "duration": 15}]',
  '["Cric", "Clé à molette", "Tournevis Phillips"]',
  'facile',
  90,
  '[{"name": "Plaquettes frein", "brand": "ATE", "price": 120, "affiliate_link": "https://..."}]',
  180,
  TRUE
) ON CONFLICT DO NOTHING;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT ON repair_guides TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_repairs TO authenticated;
GRANT EXECUTE ON FUNCTION get_repair_guide TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_repair TO authenticated;
GRANT EXECUTE ON FUNCTION update_repair_status TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_repairs TO authenticated;
GRANT EXECUTE ON FUNCTION get_repair_statistics TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
