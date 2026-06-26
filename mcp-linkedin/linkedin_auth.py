#!/usr/bin/env python3
"""
LinkedIn OAuth 2.0 — Script de connexion MecaIA
Lance un serveur local temporaire pour capturer le callback OAuth.
Durée: 2-3 minutes · Résultat: access_token écrit dans .env
"""

import os, sys, json, webbrowser, urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from dotenv import load_dotenv, set_key
import httpx

ENV_PATH      = Path(__file__).parent / ".env"
REDIRECT_URI  = "http://localhost:8401/callback"
AUTH_URL      = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL     = "https://www.linkedin.com/oauth/v2/accessToken"
SCOPES        = "openid profile email w_member_social r_organization_social w_organization_social"

load_dotenv(ENV_PATH)
CLIENT_ID     = os.environ.get("LINKEDIN_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET", "")

auth_code = None

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        
        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = """<!DOCTYPE html><html><body style="font-family:sans-serif;background:#060809;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
            <div style="text-align:center"><h1 style="color:#e8a000">✅ MecaIA LinkedIn connecté !</h1>
            <p>Tu peux fermer cet onglet.</p></div></body></html>"""
            self.wfile.write(html.encode())
        elif "error" in params:
            auth_code = "ERROR:" + params.get("error_description", [""])[0]
            self.send_response(400)
            self.end_headers()
        
        # Signal serveur pour s'arrêter
        self.server._done = True
    
    def log_message(self, *args):
        pass  # Silencer les logs HTTP

def run():
    if not CLIENT_ID or not CLIENT_SECRET:
        print("\n❌ LINKEDIN_CLIENT_ID ou LINKEDIN_CLIENT_SECRET manquant dans .env")
        print("\n── ÉTAPES POUR CRÉER TON APP LINKEDIN ──────────────────────────────")
        print("1. Aller sur: https://www.linkedin.com/developers/apps/new")
        print("2. App name: MecaIA")
        print("3. Company: ta page LinkedIn MecaIA")
        print("4. Privacy policy URL: https://mecaiaauto.com/confidentialite")
        print("5. Business email: loic@mecaia... (ton email)")
        print("6. Accepter les conditions")
        print("\n── APRÈS CRÉATION ───────────────────────────────────────────────────")
        print("7. Onglet 'Auth' → copier Client ID et Client Secret")
        print("8. Ajouter redirect URL: http://localhost:8401/callback")
        print("9. Onglet 'Products' → demander accès à 'Share on LinkedIn' + 'Sign In with LinkedIn'")
        print("\n── CONFIGURER .env ──────────────────────────────────────────────────")
        print(f"10. Éditer: {ENV_PATH}")
        print("    LINKEDIN_CLIENT_ID=ta_cle_ici")
        print("    LINKEDIN_CLIENT_SECRET=ton_secret_ici")
        print("\nRelancer ce script ensuite.")
        sys.exit(1)
    
    # Construire l'URL d'autorisation
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": "mecaia_linkedin_auth"
    }
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    
    print("\n🔑 LinkedIn OAuth — MecaIA")
    print("═" * 50)
    print("1. Le navigateur va s'ouvrir sur LinkedIn")
    print("2. Autoriser l'accès à ton compte")
    print("3. La page se fermera automatiquement")
    print("═" * 50)
    input("\nAppuyer sur Entrée pour ouvrir LinkedIn...")
    
    webbrowser.open(auth_url)
    
    # Serveur local pour le callback
    server = HTTPServer(("localhost", 8401), OAuthHandler)
    server._done = False
    print("\n⏳ En attente de ton autorisation LinkedIn...")
    
    while not server._done:
        server.handle_request()
    
    if not auth_code or auth_code.startswith("ERROR:"):
        print(f"\n❌ Autorisation refusée: {auth_code}")
        sys.exit(1)
    
    # Échanger le code contre un access token
    print("\n🔄 Échange du code OAuth...")
    resp = httpx.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET
    })
    
    if resp.status_code != 200:
        print(f"❌ Erreur token: {resp.status_code} — {resp.text[:200]}")
        sys.exit(1)
    
    data = resp.json()
    token = data.get("access_token", "")
    expires_in = data.get("expires_in", 0)
    
    if not token:
        print("❌ Pas de token dans la réponse LinkedIn")
        sys.exit(1)
    
    # Sauvegarder dans .env
    set_key(str(ENV_PATH), "LINKEDIN_ACCESS_TOKEN", token)
    
    # Récupérer le Person URN
    me_resp = httpx.get("https://api.linkedin.com/v2/userinfo",
                         headers={"Authorization": f"Bearer {token}"})
    if me_resp.status_code == 200:
        me_data = me_resp.json()
        person_id = me_data.get("sub", "")
        if person_id:
            person_urn = f"urn:li:person:{person_id}"
            set_key(str(ENV_PATH), "LINKEDIN_PERSON_URN", person_urn)
            print(f"✅ Person URN sauvegardé: {person_urn}")
    
    expires_days = expires_in // 86400
    print(f"\n✅ TOKEN LINKEDIN SAUVEGARDÉ DANS .env")
    print(f"   Validité: ~{expires_days} jours")
    print(f"\n→ Redémarrer Claude Desktop pour activer le MCP LinkedIn")
    print(f"→ Ensuite, lancer: linkedin_get_org_urn() pour trouver l'URN de ta Page MecaIA")

if __name__ == "__main__":
    run()
