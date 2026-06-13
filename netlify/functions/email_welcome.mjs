// EMAIL_WELCOME — envoie un mail de bienvenue chaleureux via Resend
//  • auth obligatoire : on envoie UNIQUEMENT à l'email du compte connecté
//  • appelé par le frontend juste après une inscription réussie
import { getUser, json, preflight } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend necessite un domaine verifie. Utiliser onboarding@resend.dev si le domaine custom echoue.
const EMAIL_FROM = process.env.EMAIL_FROM_VERIFIED || "MecaIA <onboarding@resend.dev>";
const SITE = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const email = auth.email;
  if (!email) return json(400, { error: "Aucun email sur ce compte" });

  if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY non définie" });

  let prenom = "";
  try { prenom = (JSON.parse(event.body || "{}").name || "").trim().split(" ")[0]; } catch (_) {}
  const hello = prenom ? `Bonjour ${prenom},` : "Bonjour,";

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
    <div style="background:#0b0f14;padding:24px;text-align:center;border-radius:12px 12px 0 0">
      <span style="color:#f0a500;font-size:22px;font-weight:bold;letter-spacing:1px">MECA IA</span>
    </div>
    <div style="padding:28px 24px;background:#ffffff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
      <h2 style="margin:0 0 14px;font-size:20px">${hello}</h2>
      <p style="font-size:15px;line-height:1.6;color:#333">
        Bienvenue sur <strong>MecaIA</strong> ! On est ravis de t'avoir parmi nous. 🔧
      </p>
      <p style="font-size:15px;line-height:1.6;color:#333">
        Ton compte est prêt. Tu peux dès maintenant :
      </p>
      <ul style="font-size:15px;line-height:1.8;color:#333;padding-left:20px">
        <li>Discuter avec <strong>Dylan</strong>, ton assistant diagnostic auto</li>
        <li>Enregistrer tes véhicules dans ton <strong>garage</strong></li>
        <li>Rechercher des <strong>pièces</strong> et suivre ton entretien</li>
      </ul>
      <p style="text-align:center;margin:26px 0">
        <a href="${SITE}" style="display:inline-block;padding:13px 26px;background:#f0a500;color:#0b0f14;font-weight:bold;text-decoration:none;border-radius:8px">Ouvrir MecaIA</a>
      </p>
      <p style="font-size:13px;line-height:1.6;color:#777">
        Une question ? Réponds simplement à cet email, on est là pour t'aider.
      </p>
      <p style="font-size:13px;color:#333">À très vite,<br>L'équipe MecaIA</p>
    </div>
  </div>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: "Bienvenue sur MecaIA 🔧", html }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[EMAIL_WELCOME] Resend:", body);
      return json(502, { success: false, error: body.message || "Envoi échoué" });
    }
    return json(200, { success: true, id: body.id || null });
  } catch (e) {
    console.error("[EMAIL_WELCOME]", e.message);
    return json(500, { success: false, error: e.message });
  }
};
