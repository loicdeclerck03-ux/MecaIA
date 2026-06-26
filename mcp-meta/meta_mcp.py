#!/usr/bin/env python3
"""
MecaIA Meta MCP — Facebook Page + Instagram Business
Meta Graph API v19.0
Post texte, images, reels · Update page info · Métriques
"""

import os, sys, json
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict
import httpx

load_dotenv(Path(__file__).parent / ".env")

PAGE_TOKEN   = os.environ.get("META_PAGE_ACCESS_TOKEN", "")
PAGE_ID      = os.environ.get("META_FACEBOOK_PAGE_ID", "")
IG_USER_ID   = os.environ.get("META_INSTAGRAM_USER_ID", "")
GRAPH_URL    = "https://graph.facebook.com/v19.0"

mcp = FastMCP("mecaia_meta_mcp")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def check_credentials(require_ig: bool = False):
    if not PAGE_TOKEN:
        raise ValueError("META_PAGE_ACCESS_TOKEN manquant. Voir meta_setup_guide() pour obtenir le token.")
    if not PAGE_ID:
        raise ValueError("META_FACEBOOK_PAGE_ID manquant dans .env")
    if require_ig and not IG_USER_ID:
        raise ValueError("META_INSTAGRAM_USER_ID manquant. Voir meta_setup_guide().")

async def graph_get(path: str, params: dict = None) -> dict:
    p = dict(params or {})
    p["access_token"] = PAGE_TOKEN
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{GRAPH_URL}/{path}", params=p)
        data = r.json()
        if "error" in data:
            raise httpx.HTTPStatusError(
                str(data["error"]), request=r.request, response=r
            )
        return data

async def graph_post(path: str, data: dict = None, files=None) -> dict:
    params = {"access_token": PAGE_TOKEN}
    async with httpx.AsyncClient(timeout=60) as c:
        if files:
            r = await c.post(f"{GRAPH_URL}/{path}", params=params, files=files, data=data or {})
        else:
            r = await c.post(f"{GRAPH_URL}/{path}", params=params, json=data or {})
        result = r.json()
        if "error" in result:
            raise httpx.HTTPStatusError(str(result["error"]), request=r.request, response=r)
        return result

def handle_err(e: Exception) -> str:
    if isinstance(e, ValueError):
        msg = str(e)
        return f"❌ {msg}\n→ Lancer `meta_setup_guide()` pour les instructions."
    if isinstance(e, httpx.HTTPStatusError):
        try:
            detail = json.loads(e.response.text)
            err = detail.get("error", {})
            if err.get("code") == 190:
                return "❌ Token Facebook expiré. Générer un nouveau token Page (voir meta_setup_guide)."
            if err.get("code") == 100:
                return f"❌ Paramètre invalide: {err.get('error_user_msg', err.get('message','?'))}"
            return f"❌ Meta API: {err.get('message', str(e))}"
        except Exception:
            pass
    return f"❌ {type(e).__name__}: {str(e)}"

# ─── Input Models ─────────────────────────────────────────────────────────────

class FbPostInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    message: str = Field(..., description="Texte du post Facebook", min_length=5, max_length=63206)
    link: Optional[str] = Field(None, description="URL à partager (optionnel)")
    published: bool = Field(default=True, description="True = publié maintenant · False = draft")

class FbPhotoInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    message: str = Field(..., description="Caption de la photo")
    image_path: str = Field(..., description="Chemin absolu vers l'image JPG/PNG")
    published: bool = Field(default=True, description="Publier immédiatement")

class IgImageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    image_url: str = Field(..., description="URL PUBLIQUE de l'image (doit être accessible depuis internet). Upload sur Supabase Storage ou Imgur d'abord.")
    caption: str = Field(..., description="Caption Instagram avec hashtags", min_length=5, max_length=2200)

class IgReelInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    video_url: str = Field(..., description="URL PUBLIQUE de la vidéo MP4 (max 15min, format 9:16 recommandé)")
    caption: str = Field(..., description="Caption avec hashtags", max_length=2200)
    share_to_feed: bool = Field(default=True, description="Partager aussi sur le feed Instagram")

class UpdatePageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    about: Optional[str] = Field(None, description="Description courte de la Page", max_length=255)
    description: Optional[str] = Field(None, description="Description longue de la Page", max_length=1024)
    website: Optional[str] = Field(None, description="URL du site web")
    phone: Optional[str] = Field(None, description="Numéro de téléphone")
    email: Optional[str] = Field(None, description="Email de contact de la page")

# ─── Tools — Facebook ─────────────────────────────────────────────────────────

@mcp.tool(name="meta_fb_post_text",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def meta_fb_post_text(params: FbPostInput) -> str:
    """Publie un post texte sur la Facebook Page MecaIA.

    Args:
        params: message, link (optionnel), published

    Returns:
        str: ID du post + lien direct.
    """
    try:
        check_credentials()
        body = {"message": params.message}
        if params.link:
            body["link"] = params.link
        if not params.published:
            body["published"] = "false"
        
        result = await graph_post(f"{PAGE_ID}/feed", body)
        post_id = result.get("id", "")
        
        return (
            f"✅ Post Facebook publié\n"
            f"**ID:** `{post_id}`\n"
            f"**Caractères:** {len(params.message)}\n"
            f"→ https://www.facebook.com/{post_id.replace('_', '/posts/')}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="meta_fb_post_photo",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def meta_fb_post_photo(params: FbPhotoInput) -> str:
    """Publie une photo avec légende sur la Facebook Page MecaIA.

    Args:
        params: message (caption), image_path (fichier local), published

    Returns:
        str: ID du post photo publié.
    """
    try:
        check_credentials()
        img_path = Path(params.image_path)
        if not img_path.exists():
            return f"❌ Image introuvable: `{params.image_path}`"
        
        with open(img_path, "rb") as f:
            files = {"source": (img_path.name, f, "image/jpeg")}
            result = await graph_post(
                f"{PAGE_ID}/photos",
                data={"message": params.message, "published": str(params.published).lower()},
                files=files
            )
        
        photo_id = result.get("id", "")
        return (
            f"✅ Photo Facebook publiée\n"
            f"**Photo ID:** `{photo_id}`\n"
            f"**Image:** {img_path.name}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="meta_fb_update_page",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def meta_fb_update_page(params: UpdatePageInput) -> str:
    """Met à jour les informations de la Facebook Page MecaIA.

    Peut modifier: description, site web, téléphone, email.

    Args:
        params: about, description, website, phone, email

    Returns:
        str: Confirmation des champs mis à jour.
    """
    try:
        check_credentials()
        body = {}
        changed = []
        for field, val in [
            ("about", params.about),
            ("description", params.description),
            ("website", params.website),
            ("phone", params.phone),
            ("emails", [params.email] if params.email else None)
        ]:
            if val is not None:
                body[field] = val
                changed.append(field)
        
        if not body:
            return "⚠️ Aucun champ à modifier fourni."
        
        result = await graph_post(PAGE_ID, body)
        success = result.get("success", False)
        
        return (
            f"{'✅' if success else '⚠️'} Page Facebook mise à jour\n"
            f"**Champs modifiés:** {', '.join(changed)}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="meta_fb_get_insights",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def meta_fb_get_insights(days: int = 7) -> str:
    """Récupère les métriques de la Facebook Page sur les N derniers jours.

    Args:
        days: Période en jours (7 ou 28 recommandé)

    Returns:
        str: Rapport métriques: reach, impressions, fans.
    """
    try:
        check_credentials()
        period = "week" if days <= 7 else "month"
        metrics = "page_impressions,page_reach,page_fans,page_post_engagements"
        
        data = await graph_get(f"{PAGE_ID}/insights", {
            "metric": metrics,
            "period": period
        })
        
        lines = [f"## 📊 Facebook Page Insights ({days} jours)\n"]
        for item in data.get("data", []):
            name = item.get("name", "?")
            values = item.get("values", [])
            val = values[-1].get("value", 0) if values else 0
            labels = {
                "page_impressions": "👁️ Impressions",
                "page_reach": "📡 Reach",
                "page_fans": "👥 Fans totaux",
                "page_post_engagements": "💬 Engagements"
            }
            lines.append(f"- **{labels.get(name, name)}:** {val:,}")
        
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)

# ─── Tools — Instagram ────────────────────────────────────────────────────────

@mcp.tool(name="meta_ig_post_image",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def meta_ig_post_image(params: IgImageInput) -> str:
    """Publie une image/photo sur Instagram Business MecaIA.

    ⚠️ L'image DOIT être une URL publique (pas un fichier local).
    → Uploader d'abord sur Supabase Storage ou Imgur, copier l'URL.

    Args:
        params: image_url (URL publique), caption

    Returns:
        str: ID du post Instagram publié.
    """
    try:
        check_credentials(require_ig=True)
        
        # Étape 1: Créer le container média
        container = await graph_post(f"{IG_USER_ID}/media", {
            "image_url": params.image_url,
            "caption": params.caption,
            "media_type": "IMAGE"
        })
        container_id = container.get("id")
        if not container_id:
            return "❌ Création container Instagram échouée."
        
        # Étape 2: Publier le container
        publish = await graph_post(f"{IG_USER_ID}/media_publish", {
            "creation_id": container_id
        })
        media_id = publish.get("id", "")
        
        return (
            f"✅ Image Instagram publiée\n"
            f"**Media ID:** `{media_id}`\n"
            f"**Caption:** {params.caption[:80]}...\n"
            f"→ Voir sur Instagram: https://www.instagram.com/p/{media_id}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="meta_ig_post_reel",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def meta_ig_post_reel(params: IgReelInput) -> str:
    """Publie un Reel vidéo sur Instagram Business MecaIA.

    ⚠️ La vidéo DOIT être une URL publique (pas un fichier local).
    Format recommandé: MP4 H.264 · 9:16 · max 90 secondes pour Reels.
    → Uploader d'abord sur Supabase Storage, copier l'URL publique.

    Args:
        params: video_url (URL publique MP4), caption, share_to_feed

    Returns:
        str: ID du Reel publié.
    """
    try:
        check_credentials(require_ig=True)
        
        # Étape 1: Créer le container Reel
        container = await graph_post(f"{IG_USER_ID}/media", {
            "video_url": params.video_url,
            "caption": params.caption,
            "media_type": "REELS",
            "share_to_feed": str(params.share_to_feed).lower()
        })
        container_id = container.get("id")
        if not container_id:
            return "❌ Création container Reel échouée."
        
        # Attendre processing (Reels prennent du temps)
        import asyncio
        await asyncio.sleep(5)
        
        # Vérifier le statut
        status = await graph_get(container_id, {"fields": "status_code,status"})
        status_code = status.get("status_code", "UNKNOWN")
        
        if status_code == "ERROR":
            return f"❌ Reel rejeté par Instagram: {status.get('status', {})}"
        
        if status_code == "FINISHED":
            # Étape 2: Publier
            publish = await graph_post(f"{IG_USER_ID}/media_publish", {
                "creation_id": container_id
            })
            media_id = publish.get("id", "")
            return (
                f"✅ Reel Instagram publié\n"
                f"**Media ID:** `{media_id}`\n"
                f"**Durée processing:** rapide\n"
                f"→ Vérifier dans Instagram Studio dans quelques minutes"
            )
        else:
            return (
                f"⏳ Reel en cours de processing (statut: {status_code})\n"
                f"**Container ID:** `{container_id}`\n"
                f"→ Instagram peut mettre 30-60s à traiter la vidéo.\n"
                f"→ Vérifier dans Instagram Creator Studio."
            )
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="meta_ig_get_insights",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def meta_ig_get_insights(days: int = 7) -> str:
    """Récupère les métriques Instagram Business sur les N derniers jours.

    Args:
        days: Période en jours (7, 14 ou 30)

    Returns:
        str: Rapport: reach, impressions, followers, profile views.
    """
    try:
        check_credentials(require_ig=True)
        period = "week" if days <= 7 else "month"
        metrics = "reach,impressions,profile_views,follower_count"
        
        data = await graph_get(f"{IG_USER_ID}/insights", {
            "metric": metrics,
            "period": period
        })
        
        lines = [f"## 📊 Instagram Insights ({days} jours)\n"]
        labels = {
            "reach": "📡 Reach",
            "impressions": "👁️ Impressions",
            "profile_views": "👤 Visites profil",
            "follower_count": "👥 Abonnés"
        }
        for item in data.get("data", []):
            name = item.get("name", "?")
            values = item.get("values", [])
            val = values[-1].get("value", 0) if values else 0
            lines.append(f"- **{labels.get(name, name)}:** {val:,}")
        
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)


@mcp.tool(name="meta_setup_guide",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def meta_setup_guide() -> str:
    """Guide complet pour configurer le MCP Meta (Facebook + Instagram).

    Retourne les instructions étape par étape pour obtenir les tokens.

    Returns:
        str: Guide de configuration en markdown.
    """
    return """# 🔑 Guide Configuration Meta MCP — MecaIA

## Prérequis
- Compte Facebook avec une Page "MecaIA"
- Compte Instagram Business relié à cette page Facebook

---

## ÉTAPE 1 — Créer une app Meta Developer

1. Aller sur **https://developers.facebook.com/apps/create/**
2. Type: **Business**
3. App name: **MecaIA Social**
4. Contact email: ton email
5. Cliquer "Créer une app"

---

## ÉTAPE 2 — Ajouter les produits

Dans ton app → "Ajouter un produit":
- ✅ **Facebook Login** → Configurer
- ✅ **Instagram Graph API** → Configurer

---

## ÉTAPE 3 — Obtenir le Page Access Token

1. Aller sur **https://developers.facebook.com/tools/explorer/**
2. Sélectionner ton app "MecaIA Social"
3. Cliquer "Générer un token d'accès utilisateur"
4. Cocher les permissions:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_insights`
5. Cliquer "Générer le token"
6. Dans le champ "Me", taper `me/accounts` → Exécuter
7. Copier le `access_token` de ta page MecaIA
8. Copier l'`id` de ta page MecaIA

---

## ÉTAPE 4 — Obtenir l'Instagram User ID

1. Dans l'Explorer: `{page_id}?fields=instagram_business_account`
2. Copier l'`id` du compte Instagram Business

---

## ÉTAPE 5 — Configurer .env

Éditer `C:\\Users\\pasmoi\\Documents\\GitHub\\MecaIA\\mcp-meta\\.env`:

```
META_PAGE_ACCESS_TOKEN=EAAxxxxxxxx...  (le token de ta page)
META_FACEBOOK_PAGE_ID=1234567890       (l'ID de ta page Facebook)
META_INSTAGRAM_USER_ID=9876543210      (l'ID Instagram Business)
```

---

## ÉTAPE 6 — Prolonger la durée du token

Les tokens Explorer expirent en ~1h. Pour un token longue durée (60 jours):

1. https://developers.facebook.com/tools/accesstoken/
2. Cliquer "Déboguer" sur ton token
3. Cliquer "Prolonger le jeton d'accès"

---

## Vérification

Après configuration, lancer `meta_check_setup()` pour confirmer que tout fonctionne.
"""


@mcp.tool(name="meta_check_setup",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def meta_check_setup() -> str:
    """Vérifie que le MCP Meta est correctement configuré.

    Returns:
        str: Rapport de santé + statut de la connexion API.
    """
    lines = ["## 🔍 Meta MCP — Diagnostic\n"]
    
    token_ok = bool(PAGE_TOKEN)
    page_ok = bool(PAGE_ID)
    ig_ok = bool(IG_USER_ID)
    
    lines.append(f"{'✅' if token_ok else '❌'} Page Access Token: {'Configuré' if token_ok else 'MANQUANT'}")
    lines.append(f"{'✅' if page_ok else '❌'} Facebook Page ID: {PAGE_ID if page_ok else 'MANQUANT'}")
    lines.append(f"{'✅' if ig_ok else '⚠️'} Instagram User ID: {IG_USER_ID if ig_ok else 'MANQUANT (Instagram désactivé)'}")
    
    if token_ok and page_ok:
        try:
            page_data = await graph_get(PAGE_ID, {"fields": "name,followers_count,fan_count"})
            name = page_data.get("name", "?")
            fans = page_data.get("fan_count", 0)
            followers = page_data.get("followers_count", 0)
            lines.append(f"\n✅ Connexion API OK: Page '{name}'")
            lines.append(f"   👥 Fans: {fans:,} | Abonnés: {followers:,}")
        except Exception as e:
            lines.append(f"\n❌ Connexion API échouée: {str(e)[:100]}")
            lines.append("→ Token probablement expiré. Voir meta_setup_guide().")
    
    if not (token_ok and page_ok):
        lines.append("\n→ Lancer `meta_setup_guide()` pour obtenir les instructions.")
    
    return "\n".join(lines)

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[mecaia-meta] FB:{bool(PAGE_ID)} IG:{bool(IG_USER_ID)} Token:{bool(PAGE_TOKEN)}", file=sys.stderr)
    mcp.run()
