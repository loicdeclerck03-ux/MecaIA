// EMAIL_WELCOME — bienvenue MecaIA via Resend
// Design table-based compatible Gmail/Outlook
import { getUser, json, preflight } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM_VERIFIED || "MecaIA <noreply@mecaiaauto.com>";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const email = auth.email;
  if (!email) return json(400, { error: "Aucun email sur ce compte" });
  if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY non definie" });

  let prenom = "";
  try { prenom = (JSON.parse(event.body || "{}").name || "").trim().split(" ")[0]; } catch (_) {}
  const salut = prenom ? `Bienvenue ${prenom} !` : "Bienvenue !";

  const html = `
<table width="100%" bgcolor="#0a0a0a" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:40px 16px">
  <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%">
    <tr><td align="center" style="padding-bottom:28px">
      <span style="font-family:Arial Black,Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:3px;color:#e8a000">MECA</span><span style="font-family:Arial Black,Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:3px;color:#ffffff"> IA</span>
    </td></tr>
    <tr><td bgcolor="#111111" style="border-radius:12px;padding:32px 28px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:#e8a000;text-transform:uppercase;padding-bottom:10px">BIENVENUE</td></tr>
        <tr><td style="font-family:Arial,sans-serif;font-size:21px;font-weight:700;color:#ffffff;padding-bottom:14px">${salut}</td></tr>
        <tr><td style="font-family:Arial,sans-serif;font-size:14px;color:#888888;line-height:1.7;padding-bottom:26px">Ton compte MecaIA est pret. Dylan, ton mecanicien IA, est la pour diagnostiquer ta voiture en quelques messages.</td></tr>
        <tr><td align="center" style="padding-bottom:26px">
          <a href="${SITE}" style="display:inline-block;background:#e8a000;color:#0a0a0a;font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;text-decoration:none;padding:13px 32px;border-radius:8px">OUVRIR MECAIA</a>
        </td></tr>
        <tr><td style="border-top:1px solid #1e1e1e;padding-top:18px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#666666;padding-bottom:7px">Dylan diagnostique ton probleme en 3-5 messages</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#666666;padding-bottom:7px">Decodeur VIN gratuit - 3 par jour</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#666666">Compare les pieces aux meilleurs prix belges</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding-top:22px;font-family:Arial,sans-serif;font-size:12px;color:#444444">MecaIA &middot; mecaiaauto.com</td></tr>
  </table>
</td></tr>
</table>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: `Bienvenue sur MecaIA${prenom ? " " + prenom : ""} - Ton expert automobile IA`,
        html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[EMAIL_WELCOME] Resend error:", JSON.stringify(data));
      return json(502, { success: false, error: data.message || "Envoi echoue" });
    }
    console.log("[EMAIL_WELCOME] OK:", data.id, "->", email);
    return json(200, { success: true, id: data.id || null });
  } catch (e) {
    console.error("[EMAIL_WELCOME] Exception:", e.message);
    return json(500, { success: false, error: e.message });
  }
};
