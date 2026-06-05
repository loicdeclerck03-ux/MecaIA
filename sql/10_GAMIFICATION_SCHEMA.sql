-- ============================================================
-- TABLE: user_badges
-- Badges et achievements utilisateur
-- ============================================================

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Badge info
  badge_type TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_description TEXT,
  badge_icon TEXT,
  
  -- Rarity
  rarity TEXT, -- 'common', 'uncommon', 'rare', 'epic', 'legendary'
  
  -- Timeline
  earned_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX idx_user_badges_type ON user_badges(badge_type);

-- ============================================================
-- TABLE: user_achievements
-- Achievements avec progression
-- ============================================================

CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Achievement
  achievement_type TEXT NOT NULL UNIQUE, -- 'first_diagnostic', 'diy_master_5', 'generous_helper', etc
  achievement_name TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  
  -- Progress
  progress_current INTEGER DEFAULT 0,
  progress_required INTEGER DEFAULT 1,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX idx_user_achievements_completed ON user_achievements(is_completed);

-- ============================================================
-- TABLE: user_points
-- Points utilisateur global
-- ============================================================

CREATE TABLE IF NOT EXISTS user_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  
  -- Points
  total_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  
  -- Levels
  user_level INTEGER DEFAULT 1, -- 1-50
  xp_current INTEGER DEFAULT 0,
  xp_for_next_level INTEGER DEFAULT 100,
  
  -- Ranking
  global_rank INTEGER,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_points_user_id ON user_points(user_id);
CREATE INDEX idx_user_points_global_rank ON user_points(global_rank);

-- ============================================================
-- TABLE: point_transactions
-- Historique des points gagnés
-- ============================================================

CREATE TABLE IF NOT EXISTS point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Points
  points_earned INTEGER NOT NULL,
  reason TEXT, -- 'first_diagnosis', 'repair_completed', 'helpful_comment', etc
  
  -- Reference
  related_id UUID,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_point_transactions_user_id ON point_transactions(user_id);

-- ============================================================
-- BADGE DEFINITIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS badge_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  badge_type TEXT NOT NULL UNIQUE,
  badge_name TEXT NOT NULL,
  badge_description TEXT,
  badge_icon TEXT,
  rarity TEXT,
  
  -- How to unlock
  unlock_condition TEXT,
  points_reward INTEGER DEFAULT 50
);

INSERT INTO badge_definitions (badge_type, badge_name, badge_description, rarity, unlock_condition, points_reward)
VALUES 
  ('first_diagnostic', 'Diagnostic Master', 'Completed your first diagnostic', 'common', 'get_diagnosis', 10),
  ('diy_expert_5', 'DIY Expert', 'Completed 5 DIY repairs', 'uncommon', 'complete_5_repairs', 100),
  ('repair_champ_10', 'Repair Champion', 'Completed 10 repairs', 'rare', 'complete_10_repairs', 250),
  ('generous_helper', 'Generous Helper', 'Helped 5+ users with advice', 'epic', 'help_5_users', 500),
  ('data_collector', 'Data Collector', 'Maintain 3+ vehicles', 'uncommon', 'maintain_3_vehicles', 75),
  ('maintenance_guru', 'Maintenance Guru', 'Never miss a maintenance deadline', 'epic', 'perfect_maintenance', 400)
ON CONFLICT DO NOTHING;

-- ============================================================
-- FUNCTION: award_points
-- Attribue des points à un utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION award_points(
  p_user_id UUID,
  p_points INTEGER,
  p_reason TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  total_points INTEGER,
  new_level INTEGER,
  message TEXT
) AS $$
DECLARE
  v_new_total INTEGER;
  v_new_level INTEGER;
BEGIN
  -- Insérer ou mettre à jour user_points
  INSERT INTO user_points (user_id, total_points, lifetime_points, xp_current)
  VALUES (p_user_id, p_points, p_points, p_points)
  ON CONFLICT (user_id) DO UPDATE SET
    total_points = user_points.total_points + p_points,
    lifetime_points = user_points.lifetime_points + p_points,
    xp_current = user_points.xp_current + p_points,
    updated_at = NOW();

  -- Vérifier level up (100 XP par niveau)
  SELECT total_points INTO v_new_total FROM user_points WHERE user_id = p_user_id;
  v_new_level := 1 + (v_new_total / 100);

  UPDATE user_points
  SET user_level = v_new_level
  WHERE user_id = p_user_id;

  -- Enregistrer la transaction
  INSERT INTO point_transactions (user_id, points_earned, reason)
  VALUES (p_user_id, p_points, p_reason);

  RETURN QUERY SELECT 
    TRUE,
    v_new_total,
    v_new_level,
    'Points awarded';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: unlock_badge
-- Déverrouille un badge
-- ============================================================

CREATE OR REPLACE FUNCTION unlock_badge(
  p_user_id UUID,
  p_badge_type TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  badge_name TEXT,
  message TEXT
) AS $$
DECLARE
  v_badge_name TEXT;
  v_points_reward INTEGER;
BEGIN
  -- Vérifier si le badge existe
  SELECT badge_name, points_reward INTO v_badge_name, v_points_reward
  FROM badge_definitions
  WHERE badge_type = p_badge_type;

  IF v_badge_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL, 'Badge not found';
    RETURN;
  END IF;

  -- Insérer le badge
  INSERT INTO user_badges (user_id, badge_type, badge_name, badge_description)
  SELECT p_user_id, p_badge_type, badge_name, badge_description
  FROM badge_definitions
  WHERE badge_type = p_badge_type;

  -- Attribuer les points bonus
  PERFORM award_points(p_user_id, v_points_reward, 'badge_unlock: ' || p_badge_type);

  RETURN QUERY SELECT 
    TRUE,
    v_badge_name,
    'Badge unlocked!';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: get_user_profile_stats
-- Stats gamification utilisateur
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_profile_stats(p_user_id UUID)
RETURNS TABLE (
  total_points INTEGER,
  user_level INTEGER,
  badges_earned INTEGER,
  global_rank INTEGER,
  lifetime_points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.total_points,
    up.user_level,
    COUNT(ub.*)::INTEGER,
    up.global_rank,
    up.lifetime_points
  FROM user_points up
  LEFT JOIN user_badges ub ON up.user_id = ub.user_id
  WHERE up.user_id = p_user_id
  GROUP BY up.user_id, up.total_points, up.user_level, up.global_rank, up.lifetime_points;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT, INSERT ON user_badges TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_achievements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_points TO authenticated;
GRANT SELECT, INSERT ON point_transactions TO authenticated;
GRANT SELECT ON badge_definitions TO authenticated;
GRANT EXECUTE ON FUNCTION award_points TO authenticated;
GRANT EXECUTE ON FUNCTION unlock_badge TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_profile_stats TO authenticated;

-- ============================================================
-- DONE
-- ============================================================
