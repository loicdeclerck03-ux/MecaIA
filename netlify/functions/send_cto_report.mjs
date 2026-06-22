// send_cto_report.mjs — Rapport CTO autonome via Resend
export default async function handler(req) {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });

    const token = req.headers.get("x-cto-token");
    if (token !== "mecaia-cto-2026") return new Response("Unauthorized", { status: 401 });

    let body;
    try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

    const { timestamp = "", sessionType = "AUTO", htmlContent = "", textContent = "" } = body;
    if (!htmlContent) return new Response("htmlContent required", { status: 400 });

    const subject = `CTO MecaIA - Rapport ${sessionType} - ${timestamp}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{font-family:Arial,sans-serif;background:#060809;color:#eef4fa;margin:0;padding:0}
.w{max-width:680px;margin:0 auto;background:#0d1520}
.h{background:#0d1520;border-bottom:3px solid #e8a000;padding:20px 28px}
.h h1{margin:0;color:#e8a000;font-size:20px;letter-spacing:2px}
.h p{color:#7a9ab5;font-size:12px;margin:6px 0 0}
.b{padding:20px 28px}
h2{color:#e8a000;font-size:15px;border-bottom:1px solid #1c2b3a;padding-bottom:6px}
.f{background:#060809;padding:14px 28px;border-top:1px solid #1c2b3a;font-size:11px;color:#4a5a6e}
a{color:#e8a000}pre{background:#1c2b3a;padding:10px;border-radius:6px;font-size:12px;white-space:pre-wrap}
</style></head><body>
<div class="w">
<div class="h"><h1>CTO AUTONOME MECAIA</h1>
<p>Session: <strong>${sessionType}</strong> &nbsp; ${timestamp} &nbsp; <a href="https://mecaiaauto.com">mecaiaauto.com</a></p></div>
<div class="b">${htmlContent}</div>
<div class="f">Rapport automatique CTO MecaIA - Claude Code 2.1.185</div>
</div></body></html>`;

    const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            from: "CTO MecaIA <cto@mecaiaauto.com>",
            to: ["loicdeclerck4020@gmail.com"],
            subject,
            html,
            text: textContent || subject
        })
    });

    const result = await resp.json();
    if (!resp.ok) return new Response(JSON.stringify({ error: result }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, id: result.id }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export const config = { path: "/api/cto-report" };
