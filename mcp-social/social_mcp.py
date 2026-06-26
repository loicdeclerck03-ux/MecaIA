#!/usr/bin/env python3
"""
MecaIA Social Media MCP Server v1.0
Gestion complete des reseaux sociaux de MecaIA depuis Claude Desktop.
Outils: creation, calendrier, metriques, brand kit, idees de contenu.
"""

import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from enum import Enum
from pathlib import Path

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict
from supabase import create_client, Client

# ─── .env ─────────────────────────────────────────────────────────────────────
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vexxjbpbfrvgszvzpmgu.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")

# ─── Server Init ──────────────────────────────────────────────────────────────
mcp = FastMCP("mecaia_social_mcp")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_sb() -> Client:
    """Lazy Supabase client (jamais top-level)."""
    if not SUPABASE_KEY:
        raise ValueError("SUPABASE_ANON_KEY ou SUPABASE_SERVICE_KEY manquant dans .env")
    return create_client(SUPABASE_URL, SUPABASE_KEY, options={"auth": {"auto_refresh_token": False, "persist_session": False}})

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def fmt_post(p: dict) -> str:
    """Format un post en markdown lisible."""
    status_icons = {"draft": "📝", "approved": "✅", "scheduled": "⏰", "published": "🟢", "archived": "🗄️"}
    icon = status_icons.get(p.get("status", ""), "?")
    lines = [
        f"### {icon} [{p.get('status','?').upper()}] {p.get('platform','?').upper()} — {p.get('topic','?')}",
        f"**ID:** `{p.get('id','?')}`  |  **Type:** {p.get('content_type','?')}",
    ]
    if p.get("hook"):
        lines.append(f"**🎣 Hook:** {p['hook']}")
    if p.get("content"):
        c = p["content"]
        lines.append(f"\n**Contenu:**\n{c[:800]}{'...' if len(c) > 800 else ''}")
    if p.get("hashtags"):
        tags = p["hashtags"] if isinstance(p["hashtags"], list) else []
        lines.append(f"**#️⃣ Hashtags:** {' '.join('#' + t for t in tags)}")
    if p.get("cta"):
        lines.append(f"**📣 CTA:** {p['cta']}")
    if p.get("scheduled_at"):
        lines.append(f"**📅 Programmé:** {p['scheduled_at'][:16].replace('T', ' ')}")
    if p.get("published_at"):
        lines.append(f"**✅ Publié:** {p['published_at'][:16].replace('T', ' ')}")
    if p.get("platform_url"):
        lines.append(f"**🔗 URL:** {p['platform_url']}")
    if p.get("notes"):
        lines.append(f"**📌 Notes:** {p['notes']}")
    lines.append(f"*Créé: {str(p.get('created_at','?'))[:10]}*")
    return "\n".join(lines)

def handle_err(e: Exception) -> str:
    msg = str(e)
    if "23505" in msg:
        return "❌ Doublon détecté — ce post existe déjà."
    if "42501" in msg or "permission" in msg.lower():
        return "❌ Permission refusée — vérifier les politiques RLS sur la table."
    if "connection" in msg.lower():
        return "❌ Impossible de joindre Supabase — vérifier la connexion internet."
    return f"❌ {type(e).__name__}: {msg}"

# ─── Enums ────────────────────────────────────────────────────────────────────

class Platform(str, Enum):
    TIKTOK = "tiktok"
    LINKEDIN = "linkedin"
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"

class ContentType(str, Enum):
    VIDEO_SCRIPT = "video_script"
    TEXT_POST = "text_post"
    CAROUSEL = "carousel"
    STORY = "story"
    REEL = "reel"
    ARTICLE = "article"

class PostStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    ARCHIVED = "archived"

# ─── Input Models ─────────────────────────────────────────────────────────────

class SavePostInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    platform: Platform = Field(..., description="Plateforme: tiktok | linkedin | instagram | facebook")
    content_type: ContentType = Field(..., description="Type: video_script | text_post | carousel | story | reel | article")
    topic: str = Field(..., description="Sujet court (ex: 'Voyant moteur jaune: que faire')", min_length=3, max_length=200)
    hook: Optional[str] = Field(None, description="Accroche - 3 premières secondes / 1ère ligne critique", max_length=300)
    content: str = Field(..., description="Contenu complet: script vidéo, texte du post, structure carrousel", min_length=10)
    hashtags: Optional[List[str]] = Field(default_factory=list, description="Hashtags SANS # (ex: ['mecaia', 'voiture', 'diagnosticauto'])", max_length=30)
    cta: Optional[str] = Field(None, description="Call-to-action final (ex: 'Teste gratuitement → lien en bio')", max_length=200)
    notes: Optional[str] = Field(None, description="Notes internes sur ce post", max_length=500)

class UpdatePostInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    post_id: str = Field(..., description="UUID du post à modifier")
    content: Optional[str] = Field(None, description="Nouveau contenu complet")
    hook: Optional[str] = Field(None, description="Nouvelle accroche")
    hashtags: Optional[List[str]] = Field(None, description="Nouveaux hashtags (sans #)")
    cta: Optional[str] = Field(None, description="Nouveau CTA")
    status: Optional[PostStatus] = Field(None, description="Nouveau statut: draft | approved | scheduled | published | archived")
    scheduled_at: Optional[str] = Field(None, description="Date ISO 8601 (ex: 2026-07-04T18:00:00Z)")
    published_at: Optional[str] = Field(None, description="Date réelle de publication")
    platform_url: Optional[str] = Field(None, description="URL du post publié sur la plateforme")
    platform_post_id: Optional[str] = Field(None, description="ID du post sur la plateforme")
    notes: Optional[str] = Field(None, description="Notes internes")

class ListPostsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: Optional[Platform] = Field(None, description="Filtrer par plateforme")
    status: Optional[PostStatus] = Field(None, description="Filtrer par statut")
    limit: int = Field(default=20, description="Nb max de résultats", ge=1, le=100)
    days_ahead: Optional[int] = Field(None, description="Posts programmés dans les N prochains jours", ge=1, le=90)
    days_back: Optional[int] = Field(None, description="Posts publiés dans les N derniers jours", ge=1, le=365)

class SaveIdeaInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    topic: str = Field(..., description="Sujet de l'idée de contenu", min_length=3, max_length=200)
    platform: Optional[Platform] = Field(None, description="Plateforme ciblée (None = toutes les plateformes)")
    angle: Optional[str] = Field(None, description="Angle unique (ex: 'montrer l erreur que font tous les garagistes')", max_length=300)
    hook: Optional[str] = Field(None, description="Accroche suggérée", max_length=300)
    target_audience: Optional[str] = Field(None, description="Audience cible (ex: 'propriétaire BMW anxieux')", max_length=200)
    priority: int = Field(default=5, description="Priorité 1-10 (10 = à faire immédiatement)", ge=1, le=10)

class TrackMetricsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    post_id: str = Field(..., description="UUID du post (obtenu via social_list_posts)")
    views: int = Field(default=0, description="Nombre de vues", ge=0)
    likes: int = Field(default=0, description="Nombre de likes / réactions", ge=0)
    comments: int = Field(default=0, description="Nombre de commentaires", ge=0)
    shares: int = Field(default=0, description="Nombre de partages / reposts", ge=0)
    saves: int = Field(default=0, description="Nombre de sauvegardes / favoris", ge=0)
    reach: int = Field(default=0, description="Portée (personnes uniques atteintes)", ge=0)
    followers_before: int = Field(default=0, description="Nb d'abonnés AVANT publication", ge=0)
    followers_after: int = Field(default=0, description="Nb d'abonnés APRES publication", ge=0)
    notes: Optional[str] = Field(None, description="Observations qualitatives sur ce post")

class AnalyticsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: Optional[Platform] = Field(None, description="Filtrer par plateforme (None = toutes)")
    days_back: int = Field(default=30, description="Analyser les N derniers jours", ge=1, le=365)

# ─── Tools — Gestion des posts ────────────────────────────────────────────────

@mcp.tool(
    name="social_save_post",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False}
)
async def social_save_post(params: SavePostInput) -> str:
    """Sauvegarde un nouveau post réseaux sociaux en statut 'draft' dans Supabase.

    Utiliser pour enregistrer tout contenu créé pour TikTok, LinkedIn, Instagram ou Facebook.
    Utiliser social_update_post pour changer le statut (approbation, programmation, publication).

    Args:
        params (SavePostInput): platform, content_type, topic, hook, content, hashtags, cta, notes

    Returns:
        str: Confirmation avec UUID du post créé.
    """
    try:
        sb = get_sb()
        row = {
            "platform": params.platform.value,
            "content_type": params.content_type.value,
            "topic": params.topic,
            "hook": params.hook,
            "content": params.content,
            "hashtags": params.hashtags or [],
            "cta": params.cta,
            "notes": params.notes,
            "status": "draft",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        res = sb.table("social_posts").insert(row).execute()
        p = res.data[0]
        return (
            f"✅ Post sauvegardé en draft\n"
            f"**ID:** `{p['id']}`\n"
            f"**Plateforme:** {p['platform'].upper()} | **Type:** {p['content_type']}\n"
            f"**Topic:** {p['topic']}\n"
            f"→ Utiliser `social_update_post` pour approuver / programmer / marquer comme publié."
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_update_post",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True}
)
async def social_update_post(params: UpdatePostInput) -> str:
    """Met à jour un post existant: contenu, statut, date programmée, URL publiée.

    Workflow typique:
    - draft → approved (contenu validé)
    - approved → scheduled + scheduled_at (date de publication fixée)
    - scheduled → published + published_at + platform_url (après publication manuelle)

    Args:
        params (UpdatePostInput): post_id obligatoire + champs à modifier

    Returns:
        str: Confirmation des champs modifiés.
    """
    try:
        sb = get_sb()
        updates: dict = {"updated_at": now_iso()}
        changed = []
        for field, val in [
            ("content", params.content),
            ("hook", params.hook),
            ("hashtags", params.hashtags),
            ("cta", params.cta),
            ("notes", params.notes),
            ("platform_url", params.platform_url),
            ("platform_post_id", params.platform_post_id),
            ("scheduled_at", params.scheduled_at),
            ("published_at", params.published_at),
        ]:
            if val is not None:
                updates[field] = val
                changed.append(field)
        if params.status is not None:
            updates["status"] = params.status.value
            changed.append("status")

        if len(updates) == 1:
            return "⚠️ Aucun champ à modifier fourni."

        res = sb.table("social_posts").update(updates).eq("id", params.post_id).execute()
        if not res.data:
            return f"❌ Post `{params.post_id}` non trouvé."
        p = res.data[0]
        return (
            f"✅ Post mis à jour\n"
            f"**ID:** `{p['id']}`\n"
            f"**Statut:** {p['status']} | **Champs:** {', '.join(changed)}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_get_post",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_get_post(post_id: str) -> str:
    """Récupère le contenu complet d'un post par son UUID.

    Args:
        post_id (str): UUID du post (obtenu via social_list_posts)

    Returns:
        str: Détails complets du post en markdown.
    """
    try:
        sb = get_sb()
        res = sb.table("social_posts").select("*").eq("id", post_id).execute()
        if not res.data:
            return f"❌ Post `{post_id}` non trouvé."
        return fmt_post(res.data[0])
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_list_posts",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_list_posts(params: ListPostsInput) -> str:
    """Liste les posts avec filtres optionnels. Retourne ID + résumé (pas le contenu complet).

    Utiliser social_get_post avec l'UUID pour voir le contenu complet.

    Args:
        params (ListPostsInput): platform, status, limit, days_ahead, days_back

    Returns:
        str: Liste des posts avec statuts et UUIDs.
    """
    try:
        sb = get_sb()
        q = (
            sb.table("social_posts")
            .select("id,platform,content_type,topic,status,hook,scheduled_at,published_at,created_at")
            .order("created_at", desc=True)
            .limit(params.limit)
        )
        if params.platform:
            q = q.eq("platform", params.platform.value)
        if params.status:
            q = q.eq("status", params.status.value)
        if params.days_ahead:
            ts_now = datetime.now(timezone.utc).isoformat()
            ts_end = (datetime.now(timezone.utc) + timedelta(days=params.days_ahead)).isoformat()
            q = q.gte("scheduled_at", ts_now).lte("scheduled_at", ts_end)
        if params.days_back:
            ts_cut = (datetime.now(timezone.utc) - timedelta(days=params.days_back)).isoformat()
            q = q.gte("published_at", ts_cut)

        res = q.execute()
        if not res.data:
            return "Aucun post trouvé avec ces critères."

        icons = {"draft": "📝", "approved": "✅", "scheduled": "⏰", "published": "🟢", "archived": "🗄️"}
        lines = [f"## {len(res.data)} post(s) trouvé(s)\n"]
        for p in res.data:
            date_str = p.get("scheduled_at") or p.get("published_at") or p.get("created_at", "")
            date = date_str[:10] if date_str else "?"
            icon = icons.get(p.get("status", ""), "?")
            uid = p.get("id", "")
            lines.append(
                f"{icon} `{uid[:8]}...` | **{p.get('platform','?').upper()}** "
                f"| {p.get('content_type','?')} | {p.get('topic','?')[:55]} | {date}"
            )
        lines.append("\n*→ `social_get_post <UUID complet>` pour voir le contenu.*")
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_delete_post",
    annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False}
)
async def social_delete_post(post_id: str) -> str:
    """Supprime définitivement un post (uniquement les drafts et archives).

    Pour les posts approuvés/programmés/publiés: utiliser social_update_post(status='archived').

    Args:
        post_id (str): UUID du post à supprimer

    Returns:
        str: Confirmation de suppression.
    """
    try:
        sb = get_sb()
        check = sb.table("social_posts").select("status,topic,platform").eq("id", post_id).execute()
        if not check.data:
            return f"❌ Post `{post_id}` non trouvé."
        p = check.data[0]
        if p.get("status") not in ("draft", "archived"):
            return (
                f"❌ Impossible de supprimer un post au statut '{p.get('status')}'.\n"
                f"→ Archiver d'abord: `social_update_post(post_id=..., status='archived')`"
            )
        sb.table("social_posts").delete().eq("id", post_id).execute()
        return f"🗑️ Post supprimé: [{p.get('platform','?').upper()}] {p.get('topic','?')}"
    except Exception as e:
        return handle_err(e)

# ─── Tools — Calendrier ───────────────────────────────────────────────────────

@mcp.tool(
    name="social_get_calendar",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_get_calendar(days_ahead: int = 14) -> str:
    """Affiche le calendrier éditorial: posts programmés + drafts en attente.

    Args:
        days_ahead (int): Horizon du calendrier en jours (défaut: 14, max: 60)

    Returns:
        str: Calendrier visuel en markdown avec posts par jour.
    """
    try:
        days_ahead = min(days_ahead, 60)
        sb = get_sb()
        now = datetime.now(timezone.utc)
        end = now + timedelta(days=days_ahead)

        # Posts programmés / approuvés
        sched = (
            sb.table("social_posts")
            .select("id,platform,content_type,topic,status,scheduled_at,hook")
            .in_("status", ["approved", "scheduled", "published"])
            .gte("scheduled_at", now.isoformat())
            .lte("scheduled_at", end.isoformat())
            .order("scheduled_at")
            .execute()
        )

        # Drafts en attente
        drafts = (
            sb.table("social_posts")
            .select("id,platform,content_type,topic,created_at")
            .eq("status", "draft")
            .order("created_at", desc=True)
            .limit(15)
            .execute()
        )

        plat_icons = {"tiktok": "🎵", "linkedin": "💼", "instagram": "📸", "facebook": "👤"}
        status_icons = {"approved": "✅", "scheduled": "⏰", "published": "🟢"}

        lines = [f"## 📅 Calendrier éditorial MecaIA — {days_ahead} prochains jours\n"]

        if sched.data:
            current_week = None
            for p in sched.data:
                dt = datetime.fromisoformat(p["scheduled_at"].replace("Z", "+00:00"))
                week = dt.isocalendar()[1]
                if week != current_week:
                    current_week = week
                    lines.append(f"\n### Semaine {week} ({dt.strftime('%d %b')})")
                day = dt.strftime("%A %d/%m %H:%M")
                plat_icon = plat_icons.get(p.get("platform", ""), "📱")
                stat_icon = status_icons.get(p.get("status", ""), "?")
                lines.append(f"- {stat_icon} {plat_icon} **{day}** | {p.get('topic','?')}")
        else:
            lines.append("*Aucun post programmé sur cette période.*\n")

        if drafts.data:
            lines.append(f"\n### 📝 {len(drafts.data)} draft(s) à approuver / programmer")
            for p in drafts.data:
                plat_icon = plat_icons.get(p.get("platform", ""), "📱")
                uid = p.get("id", "")
                lines.append(
                    f"- {plat_icon} `{uid[:8]}...` | {p.get('content_type','?')} | {p.get('topic','?')}"
                )
            lines.append("\n→ `social_update_post(post_id=..., status='approved')` pour approuver.")
        else:
            lines.append("\n*Aucun draft en attente.*")

        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)

# ─── Tools — Idées de contenu ─────────────────────────────────────────────────

@mcp.tool(
    name="social_save_idea",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False}
)
async def social_save_idea(params: SaveIdeaInput) -> str:
    """Sauvegarde une idée de contenu pour l'utiliser plus tard.

    Les idées sont triées par priorité dans social_get_ideas.
    Marquer comme utilisée avec social_mark_idea_used après avoir créé le post.

    Args:
        params (SaveIdeaInput): topic, platform, angle, hook, target_audience, priority (1-10)

    Returns:
        str: Confirmation avec UUID de l'idée.
    """
    try:
        sb = get_sb()
        row = {
            "platform": params.platform.value if params.platform else None,
            "topic": params.topic,
            "angle": params.angle,
            "hook": params.hook,
            "target_audience": params.target_audience,
            "priority": params.priority,
            "used": False,
            "created_at": now_iso(),
        }
        res = sb.table("social_ideas").insert(row).execute()
        idea = res.data[0]
        plat = (params.platform.value.upper() if params.platform else "TOUTES PLATEFORMES")
        return (
            f"💡 Idée sauvegardée\n"
            f"**ID:** `{idea['id']}`\n"
            f"**Plateforme:** {plat} | **Priorité:** {params.priority}/10\n"
            f"**Topic:** {params.topic}"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_get_ideas",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_get_ideas(platform: Optional[str] = None, limit: int = 20) -> str:
    """Récupère les idées de contenu non utilisées, triées par priorité décroissante.

    Args:
        platform (str, optional): 'tiktok' | 'linkedin' | 'instagram' | 'facebook' | None (toutes)
        limit (int): Max d'idées à retourner (défaut: 20)

    Returns:
        str: Liste des idées avec angles, hooks et priorités.
    """
    try:
        sb = get_sb()
        q = sb.table("social_ideas").select("*").eq("used", False).order("priority", desc=True).limit(limit)
        if platform and platform in ("tiktok", "linkedin", "instagram", "facebook"):
            # OR: plateforme spécifique OU null (toutes plateformes)
            q = q.or_(f"platform.eq.{platform},platform.is.null")
        res = q.execute()

        if not res.data:
            return "Aucune idée disponible. Utiliser `social_save_idea` pour en ajouter."

        lines = [f"## 💡 {len(res.data)} idée(s) non utilisée(s)\n"]
        for idea in res.data:
            plat = (idea.get("platform") or "toutes").upper()
            prio = idea.get("priority", 0)
            fire = "🔥" * (prio // 4)
            lines.append(f"### {fire} [{plat}] {idea.get('topic','?')} — Prio {prio}/10")
            lines.append(f"**ID:** `{idea.get('id','')}`")
            if idea.get("angle"):
                lines.append(f"**Angle:** {idea['angle']}")
            if idea.get("hook"):
                lines.append(f"**Hook:** {idea['hook']}")
            if idea.get("target_audience"):
                lines.append(f"**Audience:** {idea['target_audience']}")
            lines.append("")
        lines.append("→ `social_mark_idea_used(idea_id=...)` après avoir créé le post.")
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_mark_idea_used",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True}
)
async def social_mark_idea_used(idea_id: str) -> str:
    """Marque une idée comme utilisée — elle disparaît de social_get_ideas.

    Args:
        idea_id (str): UUID de l'idée

    Returns:
        str: Confirmation.
    """
    try:
        sb = get_sb()
        res = sb.table("social_ideas").update({"used": True}).eq("id", idea_id).execute()
        if not res.data:
            return f"❌ Idée `{idea_id}` non trouvée."
        return f"✅ Idée `{idea_id[:8]}...` marquée comme utilisée."
    except Exception as e:
        return handle_err(e)

# ─── Tools — Analytics ────────────────────────────────────────────────────────

@mcp.tool(
    name="social_track_metrics",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False}
)
async def social_track_metrics(params: TrackMetricsInput) -> str:
    """Enregistre les métriques de performance d'un post publié.

    Appeler 24h, 7j et 30j après publication pour tracker l'évolution.
    Calcule automatiquement le taux d'engagement et les abonnés gagnés.

    Args:
        params (TrackMetricsInput): post_id + views, likes, comments, shares, saves, reach, followers

    Returns:
        str: Récapitulatif des métriques avec taux d'engagement calculé.
    """
    try:
        sb = get_sb()
        check = sb.table("social_posts").select("platform,topic,status").eq("id", params.post_id).execute()
        if not check.data:
            return f"❌ Post `{params.post_id}` non trouvé."
        p = check.data[0]

        row = {
            "post_id": params.post_id,
            "platform": p.get("platform"),
            "recorded_at": now_iso(),
            "views": params.views,
            "likes": params.likes,
            "comments": params.comments,
            "shares": params.shares,
            "saves": params.saves,
            "reach": params.reach,
            "followers_before": params.followers_before,
            "followers_after": params.followers_after,
            "notes": params.notes,
        }
        sb.table("social_analytics").insert(row).execute()

        eng = round(((params.likes + params.comments + params.shares + params.saves) / params.views * 100), 2) if params.views > 0 else 0
        gained = params.followers_after - params.followers_before

        return (
            f"📊 Métriques enregistrées: **{p.get('topic','?')}**\n"
            f"👁️ Vues: {params.views:,}\n"
            f"❤️ {params.likes:,} likes | 💬 {params.comments} commentaires | 🔁 {params.shares} partages | 🔖 {params.saves} sauvegardes\n"
            f"📈 Taux d'engagement: **{eng}%**\n"
            f"👥 Abonnés gagnés: **+{gained}**"
        )
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_analytics_report",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_analytics_report(params: AnalyticsInput) -> str:
    """Rapport de performance agrégé par plateforme sur une période donnée.

    Args:
        params (AnalyticsInput): platform (optionnel), days_back (défaut: 30)

    Returns:
        str: Rapport avec métriques totales, taux d'engagement, abonnés gagnés par plateforme.
    """
    try:
        sb = get_sb()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=params.days_back)).isoformat()
        q = sb.table("social_analytics").select("*").gte("recorded_at", cutoff)
        if params.platform:
            q = q.eq("platform", params.platform.value)
        res = q.execute()

        if not res.data:
            return f"Aucune métrique enregistrée sur les {params.days_back} derniers jours.\n→ Utiliser `social_track_metrics` après chaque publication."

        # Agrégation par plateforme
        agg: dict = {}
        for r in res.data:
            pl = r.get("platform", "unknown")
            if pl not in agg:
                agg[pl] = {"posts": 0, "views": 0, "likes": 0, "comments": 0, "shares": 0, "saves": 0, "fol_gained": 0}
            agg[pl]["posts"] += 1
            agg[pl]["views"] += r.get("views", 0)
            agg[pl]["likes"] += r.get("likes", 0)
            agg[pl]["comments"] += r.get("comments", 0)
            agg[pl]["shares"] += r.get("shares", 0)
            agg[pl]["saves"] += r.get("saves", 0)
            agg[pl]["fol_gained"] += r.get("followers_after", 0) - r.get("followers_before", 0)

        lines = [f"## 📊 Rapport Social MecaIA — {params.days_back} derniers jours\n"]
        for pl, m in agg.items():
            total_eng = m["likes"] + m["comments"] + m["shares"] + m["saves"]
            eng_rate = round(total_eng / m["views"] * 100, 2) if m["views"] > 0 else 0
            avg_views = m["views"] // m["posts"] if m["posts"] > 0 else 0
            lines += [
                f"### {pl.upper()}",
                f"- Posts analysés: **{m['posts']}** | Vues totales: **{m['views']:,}** | Vues moy./post: **{avg_views:,}**",
                f"- ❤️ {m['likes']:,} likes | 💬 {m['comments']:,} commentaires | 🔁 {m['shares']:,} partages | 🔖 {m['saves']:,} sauvegardes",
                f"- Taux d'engagement: **{eng_rate}%**",
                f"- Abonnés gagnés: **+{m['fol_gained']}**",
                "",
            ]
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)


@mcp.tool(
    name="social_top_content",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_top_content(platform: Optional[str] = None, metric: str = "views", limit: int = 5) -> str:
    """Identifie les meilleurs posts par vues, engagement ou partages.

    Args:
        platform (str, optional): 'tiktok' | 'linkedin' | 'instagram' | 'facebook' | None
        metric (str): Métrique de tri: 'views' | 'likes' | 'shares' | 'comments' | 'saves'
        limit (int): Nombre de posts à retourner (défaut: 5)

    Returns:
        str: Top N posts avec leurs métriques clés.
    """
    try:
        valid_metrics = ("views", "likes", "shares", "comments", "saves")
        if metric not in valid_metrics:
            return f"❌ Métrique invalide. Choisir parmi: {', '.join(valid_metrics)}"

        sb = get_sb()
        q = sb.table("social_analytics").select("post_id,platform,views,likes,comments,shares,saves,recorded_at").order(metric, desc=True).limit(limit)
        if platform and platform in ("tiktok", "linkedin", "instagram", "facebook"):
            q = q.eq("platform", platform)
        res = q.execute()

        if not res.data:
            return "Aucune métrique enregistrée. Utiliser `social_track_metrics` après chaque publication."

        lines = [f"## 🏆 Top {limit} posts par **{metric}**\n"]
        for i, r in enumerate(res.data, 1):
            eng = round(((r.get("likes",0) + r.get("comments",0) + r.get("shares",0) + r.get("saves",0)) / r.get("views",1) * 100), 1)
            lines.append(
                f"**#{i}** | {r.get('platform','?').upper()} | "
                f"👁️ {r.get('views',0):,} vues | ❤️ {r.get('likes',0):,} | "
                f"🔁 {r.get('shares',0)} | 📊 {eng}% eng. | "
                f"`{str(r.get('post_id',''))[:8]}...`"
            )
        lines.append("\n→ `social_get_post <UUID>` pour voir le contenu du meilleur post.")
        return "\n".join(lines)
    except Exception as e:
        return handle_err(e)

# ─── Tool — Brand Kit ─────────────────────────────────────────────────────────

@mcp.tool(
    name="social_get_brand_kit",
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}
)
async def social_get_brand_kit(section: Optional[str] = None) -> str:
    """Retourne le Brand Kit MecaIA complet pour la creation de contenu.

    Contient: positionnement, voix de marque, pain points, audiences,
    hashtags par plateforme, CTAs, formats optimaux, types de contenu.

    Utiliser AVANT de creer du contenu pour rester dans la charte de marque.

    Args:
        section (str, optional): Section specifique: 'voice' | 'hashtags' | 'formats' | 'ctas' | 'ideas'
                                  None = tout le brand kit

    Returns:
        str: Brand Kit en markdown.
    """
    kit = {
        "voice": """## 🎤 Voix de Marque MecaIA

**Positionnement:** "Le mechano IA que tout conducteur belge et français merite"
**Tagline:** *"Comprends ta voiture en 30 secondes."*

**Ton:** Expert accessible · Mechano de confiance · Jamais condescendant
**Langue:** Francais naturel BE + FR — zero jargon inutile
**Perspective:** Toujours du cote du conducteur (contre l'opacite des garages)
**Emotions cibles:** Soulagement · Confiance · Moment "Ah voila!" · Economie d'argent

**A eviter:**
- Trop technique (alienants)
- Trop formel/corporate
- Promettre des diagnostics parfaits (risque legal)
- Denigrer les garagistes (mauvaise image)""",

        "hashtags": """## #️⃣ Hashtags MecaIA

**TikTok (5-7 max):**
Core: `#mecaia` `#diagnosticauto` `#voyantmoteur` `#conseilmecanique`
Viral: `#pourtoi` `#astucevoiture` `#garagiste` `#ctvoiture` `#problemevoiture`
Volume FR: `#voiture` `#automoto` `#mecanique` `#conducteur`

**LinkedIn (3-5 max):**
B2B: `#mecaia` `#diagnosticautomobile` `#intelligenceartificielle` `#startupbelge`
Secteur: `#automotive` `#SaaS` `#GarageIntelligent` `#innovation` `#techbelge`

**Instagram:**
Lifestyle: `#mecaia` `#voiture` `#conducteur` `#diagnosticrapide` `#problemevoiture`
Visual: `#autocare` `#carproblems` `#mechanic` `#automotivefr`""",

        "ctas": """## 📣 CTAs par Plateforme

**TikTok:**
- "Teste MecaIA gratuitement → lien en bio 🔗"
- "1€ pour diagnostiquer ta voiture → lien en bio"
- "Clique sur le lien en bio, c'est gratuit"
- "Commente TON code DTC, je t'explique"
- "Partage si t'as deja vecu ca!"

**LinkedIn (B2B garages):**
- "Decouvrez comment MecaIA peut equiper votre garage → mecaiaauto.com"
- "Essai gratuit pour les garages independants → lien en commentaire"
- "DM pour une demo personnalisee"

**Prix a mettre en avant:**
- Decouverte: 1€ (accroche prix)
- Standard: 9,99€/20 diagnostics
- Expert: 19,99€/50 diagnostics
- Garage Pro: 29,99€/mois illimite""",

        "formats": """## 🎬 Formats Optimaux par Plateforme

**TikTok (PRIORITE #1):**
- Durees: 30-60 sec (sweet spot engagement) | 3 min (educatif profond)
- Structure obligatoire:
  1. Hook (0-3 sec) → accroche visuelle ET verbale
  2. Probleme/Tension (3-15 sec)
  3. Solution/Revelation (15-50 sec)
  4. CTA (5 dernières sec)
- Format: Vertical 9:16 · Sous-titres auto obligatoires · Eclairage naturel
- Audio: Trending sound OU voix claire · Musique basse en fond
- Frequence cible: 3-5 posts/semaine minimum

**LinkedIn (B2B):**
- Post texte court: 150-300 mots · 1 seule idee forte
- Article long: 800-1500 mots · Expertise approfondie
- Carrousel: 8-10 slides · Titre percutant · Stats/chiffres
- Timing optimal: Mar-Jeu 8h-9h ou 12h-13h (BE/FR)
- Frequence cible: 2-3 posts/semaine

**Instagram:**
- Reels: 15-30 sec (viral) | 60-90 sec (educatif)
- Carrousels: 5-10 slides · Premier slide = accroche
- Stories: 7-15 sec par frame · Sondages/Questions pour engagement
- Frequence cible: 3-4 posts/semaine""",

        "ideas": """## 💡 Types de Contenu Qui Fonctionnent pour MecaIA

**TikTok — Formules eprouvees:**
1. "Le voyant X (P0XXX) veut dire..." → educatif, partages eleves
2. "Ce que le garagiste NE VOUS DIT PAS sur..." → polemique, commentaires
3. "J'ai teste MecaIA sur ma vraie voiture" → demo authentique produit
4. "Combien ca coute VRAIMENT de reparer X" → transparence, confiance
5. "BMW/Renault/Peugeot: l'erreur que font 90% des conducteurs" → marque specifique
6. "Voyant moteur: URGENCE ou pas?" → tension + solution
7. "Le mechano IA vs le devis garage" → comparaison, ROI visible

**LinkedIn — Angles B2B:**
1. "Comment les garages independants perdent 30% de leur CA sans IA"
2. "Etude de cas: X diagnostics en Y minutes avec MecaIA"
3. "Le futur du diagnostic automobile en Europe"
4. "Pourquoi j'ai cree MecaIA (histoire fondateur)" → storytelling

**Audiences Principales:**
- B2C: Proprietaire voiture 25-50 ans BE/FR · Anxieux face aux pannes
- B2C2: Jeune conducteur 18-28 ans · Premiere voiture seul
- B2B: Gerant garage independant · 10-50 voitures/mois""",
    }

    if section and section in kit:
        return f"# 🎯 MecaIA Brand Kit — {section.upper()}\n\n" + kit[section]

    full = "# 🎯 MecaIA Brand Kit Complet\n\n"
    for s in ("voice", "hashtags", "ctas", "formats", "ideas"):
        full += kit[s] + "\n\n---\n\n"
    return full


# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    print(f"[mecaia-social] Demarrage · Supabase: {SUPABASE_URL[:40]}...", file=sys.stderr)
    mcp.run()
