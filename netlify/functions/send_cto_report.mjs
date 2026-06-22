// send_cto_report.mjs — Fonction Netlify pour rapports CTO automatiques
// Appelée par le script PowerShell local via HTTPS
// La clé Resend reste dans Netlify, jamais exposée localement

let _resend = null;
const getResend = () => {
  if (!_resend) {
    const { Resend } = await import("resend").catch(() => null);
    if (Resend) _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
};

export default async function handler(req) {
  // Vérif méthode
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  // Auth simple: token partagé
  const authHeader = req.headers.get("x-cto-token");
  const expectedToken = process.env.CTO_REPORT_TOKEN || "mecaia-cto-2026";
  if (authHeader !== expectedToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { timestamp, sessionType, subject, htmlContent, textContent } = body;

  if (!htmlContent) {
    return new Response(JSON.stringify({ error: "htmlContent required" }), { status: 400 });
  }

  const emailSubject = subject || `🤖 CTO MecaIA — Rapport ${sessionType || "AUTO"} — ${timestamp || new Date().toISOString()}`;

  // Email HTML complet
  const htmlEmail = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; background: #060809; color: #eef4fa; margin: 0; padding: 0; }
  .wrap { max-width: 680px; margin: 0 auto; background: #0d1520; }
  .header { background: #0d1520; border-bottom: 3px solid #e8a000; padding: 20px 28px; }
  .header h1 { margin: 0; color: #e8a000; font-size: 20px; letter-spacing: 2px; font-family: Rajdhani, Arial, sans-serif; }
  .header .meta { color: #7a9ab5; font-size: 12px; margin-top: 6px; }
  .body { padding: 20px 28px; }
  h2 { color: #e8a000; font-size: 15px; border-bottom: 1px solid #1c2b3a; padding-bottom: 6px; margin-top: 22px; }
  h3 { color: #7ecfff; font-size: 13px; margin: 12px 0 6px; }
  .ok { color: #22c55e; }
  .err { color: #ef4444; }
  .warn { color: #f59e0b; }
  .info { color: #3b82f6; }
  .footer { background: #060809; padding: 14px 28px; border-top: 1px solid #1c2b3a; font-size: 11px; color: #4a5a6e; }
  a { color: #e8a000; }
  pre { background: #1c2b3a; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; }
  code { background: #1c2b3a; padding: 1px 5px; border-radius: 3px; font-family: monospace; color: #7ecfff; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>🤖 CTO AUTONOME MECAIA</h1>
    <div class="meta">
      Session: <strong>${sessionType || "AUTO"}</strong> &nbsp;·&nbsp;
      ${timestamp || new Date().toISOString()} &nbsp;·&nbsp;
      <a href="https://mecaiaauto.com">mecaiaauto.com</a>
    </div>
  </div>
  <div class="body">
    ${htmlContent}
  </div>
  <div class="footer">
    Rapport généré automatiquement · CTO Autonome MecaIA v1.0 · Claude Code 2.1.185 · CANARI actif
  </div>
</div>
</body>
</html>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "CTO MecaIA <cto@mecaiaauto.com>",
        to: ["loicdeclerck4020@gmail.com"],
        subject: emailSubject,
        html: htmlEmail,
        text: textContent || emailSubject
      })
    });

    const result = await resp.json();

    if (!resp.ok) {
      console.error("Resend error:", result);
      return new Response(JSON.stringify({ error: result }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("CTO report email error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export const config = { path: "/api/cto-report" };
