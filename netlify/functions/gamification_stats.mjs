// GAMIFICATION_STATS — profil/points/badges de l'utilisateur connecté (auth)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const { data: stats, error: sErr } = await supabase.rpc("get_user_profile_stats", { p_user_id: userId });
    if (sErr) throw sErr;

    const { data: badges, error: bErr } = await supabase
      .from("user_badges").select("badge_type, badge_name, earned_at").eq("user_id", userId);
    if (bErr) throw bErr;

    const { data: recentPoints, error: pErr } = await supabase
      .from("point_transactions").select("points_earned, reason, created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
    if (pErr) throw pErr;

    const profile = stats && stats.length > 0 ? stats[0] : {};
    return json(200, {
      success: true,
      profile: {
        total_points: profile.total_points || 0,
        user_level: profile.user_level || 1,
        global_rank: profile.global_rank || "-",
        badges_earned: profile.badges_earned || 0,
        lifetime_points: profile.lifetime_points || 0,
      },
      badges: badges || [],
      recent_points: recentPoints || [],
    });
  } catch (error) {
    console.error("[GAMIFICATION]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
