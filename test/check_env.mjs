// check_env.mjs — longueurs seulement (jamais les valeurs)
const L = k => (process.env[k] || "").length;
console.log("LEN SUPABASE_URL=" + L("SUPABASE_URL") + " SUPABASE_SECRET=" + L("SUPABASE_SECRET") + " SUPABASE_ANON=" + L("SUPABASE_ANON") + " ANTHROPIC_KEY=" + L("ANTHROPIC_KEY"));
