#!/usr/bin/env python3
"""
MecaIA LinkedIn MCP — Posting automatique sur profil perso + Page MecaIA
LinkedIn REST API v2 · OAuth 2.0 Bearer Token
Outils: post texte, post image, page post, analytics, update profil
"""

import os, json, mimetypes, sys
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict
import httpx

load_dotenv(Path(__file__).parent / ".env")

ACCESS_TOKEN    = os.environ.get("LINKEDIN_ACCESS_TOKEN", "")
PERSON_URN      = os.environ.get("LINKEDIN_PERSON_URN", "")   # urn:li:person:XXXXX
ORG_URN         = os.environ.get("LINKEDIN_ORG_URN", "")      # urn:li:organization:XXXXX
LI_API          = "https://api.linkedin.com/v2"

mcp = FastMCP("mecaia_linkedin_mcp")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def auth_headers() -> dict:
    if not ACCESS_TOKEN:
        raise ValueError("LINKEDIN_ACCESS_TOKEN manquant dans mcp-linkedin/.env")
    return {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": "202401"
    }

async def li_get(path: str, params: dict = None) -> dict:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{LI_API}{path}", headers=auth_headers(), params=params)
        r.raise_for_status()
        return r.json()

async def li_post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{LI_API}{path}", headers=auth_headers(), json=body)
        r.raise_for_status()
        return r.json() if r.content else {"status": r.status_code}

def handle_err(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        try:
            detail = e.response.json()
        except Exception:
            detail = e.response.text[:200]
        if code == 401:
            return "❌ Token LinkedIn expiré ou invalide. Relancer linkedin_auth.py pour obtenir un nouveau token."
        if code == 403:
            return "❌ Permission refusée. Vérifier les scopes OAuth (w_member_social, w_organization_social)."
        if code == 422:
            return f"❌ Données invalides: {detail}"
        return f"❌ LinkedIn API {code}: {detail}"
    if isinstance(e, ValueError) and "ACCESS_TOKEN" in str(e):
        return f"❌ {str(e)}\n→ Lancer: python mcp-linkedin/linkedin_auth.py"
    return f"❌ {type(e).__name__}: {str(e)}"

async def get_person_urn() -> str:
    """Récupère ou charge l'URN de la personne."""
    if PERSON_URN:
        return PERSON_URN
    me = await li_get("/userinfo")
    uid = me.get("sub", "")
    if uid:
        return f"urn:li:person:{uid}"
    raise ValueError("Impossible de récupérer ton profil LinkedIn. Vérifier le token.")

async def upload_image_linkedin(image_path: str, owner_urn: str) -> Optional[str]:
    """Upload une image sur LinkedIn, retourne l'asset URN."""
    p = Path(image_path)
    if not p.exists():
        return None
    
    # 1. Enregistrer l'upload
    reg_body = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": owner_urn,
            "serviceRelationships": [{
                "relationshipType": "OWNER",
                "identifier": "urn:li:userGeneratedContent"
            }]
        }
    }
    reg = await li_post("/assets?action=registerUpload", reg_body)
    upload_url = reg.get("value", {}).get("uploadMechanism", {}).get(
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {}
    ).get("uploadUrl")
    asset_urn = reg.get("value", {}).get("asset")
    
    if not upload_url or not asset_urn:
        return None
    
    # 2. Upload le fichier
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        img_bytes = f.read()
    
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.put(upload_url,
                        headers={"Authorization": f"Bearer {ACCESS_TOKEN}",
                                 "Content-Type": mime},
                        content=img_bytes)
        if r.status_code not in (200, 201):
            return None
    
    return asset_urn

# ─── Input Models ─────────────────────────────────────────────────────────────

class PostTextInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(..., description="Texte du post LinkedIn", min_length=5, max_length=3000)
    post_on_page: bool = Field(default=False, description="True = poster sur la Page MecaIA · False = profil perso")
    visibility: str = Field(default="PUBLIC", description="PUBLIC ou CONNECTIONS")

class PostImageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(..., description="Texte du post", min_length=5, max_length=3000)
    image_path: str = Field(..., description="Chemin absolu vers l'image (JPG/PNG/GIF)")
    image_alt: str = Field(default="Image MecaIA", description="Texte alternatif de l'image")
    post_on_page: bool = Field(default=False, description="Poster sur la Page ou le profil")

class UpdateProfileInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    headline: Optional[str] = Field(None, description="Titre professionnel LinkedIn", max_length=220)
    summary: Optional[str] = Field(None, description="Résumé/bio profil", max_length=2600)

class UpdatePageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    description: Optional[str] = Field(None, description="Description de la Page MecaIA")
    website: Optional[str] = Field(None, description="URL site web")
    tagline: Optional[str] = Field(None, description="Tagline de la page", max_length=120)

# ─── Tools ────────────────────────────────────────────────────────────────────

@mcp.tool(name="linkedin_post_text",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def linkedin_post_text(params: PostTextInput) -> str:
    """Publie un post texte sur LinkedIn (profil perso OU Page MecaIA).

    Args:
        params: content, post_on_page, visibility

    Returns:
        str: Confirmation avec URL du post publié.
    """
    try:
        owner = ORG_URN if params.post_on_page else await get_person_urn()
        if params.post_on_page and not ORG_URN:
            return "❌ LINKEDIN_ORG_URN non configuré dans .env\n→ Lancer linkedin_auth.py pour le récupérer."
        
        body = {
            "author": owner,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": params.content},
                    "shareMediaCategory": "NONE"
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": params.visibility}
        }
        result = await li_post("/ugcPosts", body)
        post_id = result.get("id", "")
        target = "Page MecaIA" if params.post_on_page else "Profil perso"
        
        return (
            f"✅ Post publié sur **{target}**\n"
            f"**ID:** `{post_id}`\n"
            f"**Caractères:** {len(params.content)}\n"
            f"**Visibilité:** {params.visibility}\n"
            f"→ Voir sur LinkedIn: https://www.linkedin.com/feed/update/{post_id}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="linkedin_post_image",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def linkedin_post_image(params: PostImageInput) -> str:
    """Publie un post avec image sur LinkedIn.

    Upload l'image sur les serveurs LinkedIn puis publie le post.
    Supporte JPG, PNG, GIF.

    Args:
        params: content, image_path (chemin absolu), image_alt, post_on_page

    Returns:
        str: Confirmation + URL du post.
    """
    try:
        owner = ORG_URN if params.post_on_page else await get_person_urn()
        if params.post_on_page and not ORG_URN:
            return "❌ LINKEDIN_ORG_URN manquant dans .env"
        
        if not Path(params.image_path).exists():
            return f"❌ Image introuvable: `{params.image_path}`"
        
        asset_urn = await upload_image_linkedin(params.image_path, owner)
        if not asset_urn:
            return "❌ Upload image LinkedIn échoué. Vérifier format (JPG/PNG/GIF max 5MB)."
        
        body = {
            "author": owner,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": params.content},
                    "shareMediaCategory": "IMAGE",
                    "media": [{
                        "status": "READY",
                        "description": {"text": params.image_alt},
                        "media": asset_urn,
                        "title": {"text": "MecaIA"}
                    }]
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"}
        }
        result = await li_post("/ugcPosts", body)
        post_id = result.get("id", "")
        target = "Page MecaIA" if params.post_on_page else "Profil perso"
        
        return (
            f"✅ Post avec image publié sur **{target}**\n"
            f"**ID:** `{post_id}`\n"
            f"**Image:** {Path(params.image_path).name}\n"
            f"→ https://www.linkedin.com/feed/update/{post_id}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="linkedin_get_profile",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def linkedin_get_profile() -> str:
    """Récupère les infos du profil LinkedIn connecté + URNs importants.

    Affiche: nom, headline, URN personne et organisation.
    Utiliser pour vérifier la connexion et récupérer les URNs.

    Returns:
        str: Profil complet en markdown.
    """
    try:
        me = await li_get("/userinfo")
        urn = await get_person_urn()
        
        lines = [
            "## 👤 Profil LinkedIn Connecté\n",
            f"**Nom:** {me.get('name', '?')}",
            f"**Email:** {me.get('email', '?')}",
            f"**URN personne:** `{urn}`",
        ]
        
        if ORG_URN:
            lines.append(f"**URN organisation:** `{ORG_URN}`")
        else:
            lines.append("**⚠️ Page MecaIA:** LINKEDIN_ORG_URN non configuré")
        
        lines.append(f"\n✅ Token LinkedIn valide · Prêt à poster")
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="linkedin_get_org_urn",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def linkedin_get_org_urn(vanity_name: str = "mecaia") -> str:
    """Récupère l'URN de la Page LinkedIn (organisation) par son nom.

    Utiliser pour trouver LINKEDIN_ORG_URN à ajouter dans .env.

    Args:
        vanity_name: Nom de l'URL de ta page (ex: 'mecaia' pour linkedin.com/company/mecaia)

    Returns:
        str: URN de l'organisation à copier dans .env.
    """
    try:
        result = await li_get("/organizations", params={"q": "vanityName", "vanityName": vanity_name})
        elements = result.get("elements", [])
        if not elements:
            return f"❌ Aucune organisation trouvée avec vanityName='{vanity_name}'\n→ Vérifier l'URL de ta page LinkedIn"
        
        org = elements[0]
        org_id = org.get("id", "")
        org_urn = f"urn:li:organization:{org_id}"
        org_name = org.get("localizedName", "?")
        
        return (
            f"## 🏢 Page LinkedIn trouvée\n"
            f"**Nom:** {org_name}\n"
            f"**URN:** `{org_urn}`\n\n"
            f"→ Copier cet URN dans `mcp-linkedin/.env`:\n"
            f"`LINKEDIN_ORG_URN={org_urn}`\n"
            f"Puis redémarrer Claude Desktop."
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="linkedin_check_setup",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def linkedin_check_setup() -> str:
    """Vérifie que le MCP LinkedIn est correctement configuré.

    Returns:
        str: Rapport de santé + instructions si quelque chose manque.
    """
    lines = ["## 🔍 LinkedIn MCP — Diagnostic\n"]
    
    token_ok = bool(ACCESS_TOKEN)
    lines.append(f"{'✅' if token_ok else '❌'} Access Token: {'Configuré' if token_ok else 'MANQUANT → Lancer linkedin_auth.py'}")
    
    person_ok = bool(PERSON_URN)
    lines.append(f"{'✅' if person_ok else '⚠️'} Person URN: {PERSON_URN if person_ok else 'Auto-détecté au premier post'}")
    
    org_ok = bool(ORG_URN)
    lines.append(f"{'✅' if org_ok else '⚠️'} Org URN (Page): {ORG_URN if org_ok else 'Manquant → Lancer linkedin_get_org_urn()'}")
    
    if token_ok:
        try:
            me = await li_get("/userinfo")
            lines.append(f"\n✅ Connexion API OK: {me.get('name','?')}")
        except Exception as e:
            lines.append(f"\n❌ Connexion API échouée: {str(e)[:100]}")
    
    if not token_ok:
        lines.append("\n## 🔑 Comment obtenir le token\n")
        lines.append("1. Ouvrir PowerShell")
        lines.append("2. `cd C:\\Users\\pasmoi\\Documents\\GitHub\\MecaIA\\mcp-linkedin`")
        lines.append("3. `C:\\Python314\\python.exe linkedin_auth.py`")
        lines.append("4. Suivre les instructions dans le navigateur")
    
    return "\n".join(lines)

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[mecaia-linkedin] Token: {'OK' if ACCESS_TOKEN else 'MANQUANT'}", file=sys.stderr)
    mcp.run()
