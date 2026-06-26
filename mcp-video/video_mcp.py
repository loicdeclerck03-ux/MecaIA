#!/usr/bin/env python3
"""
MecaIA Video MCP — Génération vidéos TikTok propres
ElevenLabs (voix FR) + Pillow (frames) + FFmpeg (composition)
Format: 1080x1920 vertical · Couleurs brand MecaIA · Sous-titres auto
"""

import os, json, math, textwrap, subprocess, tempfile, shutil, sys
from pathlib import Path
from typing import Optional, List
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict

load_dotenv(Path(__file__).parent / ".env")

ELEVENLABS_API_KEY  = os.environ.get("ELEVENLABS_API_KEY", "")
VOICE_ID_FR_DEFAULT = os.environ.get("ELEVENLABS_VOICE_ID", "onwK4e9ZLuTAKqWW03F9")  # Daniel — FR
OUTPUT_DIR          = Path(os.environ.get("VIDEO_OUTPUT_DIR",
    r"C:\Users\pasmoi\Desktop\Meca ia\VIDEOS_TIKTOK"))

# Brand MecaIA
BG_COLOR      = "#060809"
ACCENT_COLOR  = "#e8a000"
TEXT_COLOR    = "#ffffff"
HOOK_COLOR    = "#e8a000"
W, H          = 1080, 1920

mcp = FastMCP("mecaia_video_mcp")

# ─── Imports conditionnels ────────────────────────────────────────────────────
try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_OK = True
except ImportError:
    PIL_OK = False

try:
    import httpx
    HTTPX_OK = True
except ImportError:
    HTTPX_OK = False

# ─── Helpers ──────────────────────────────────────────────────────────────────

def hex_to_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def ffmpeg_path() -> str:
    """Trouve ffmpeg dans PATH ou emplacements connus."""
    for p in ["ffmpeg",
              r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
              r"C:\ffmpeg\bin\ffmpeg.exe"]:
        try:
            subprocess.run([p, "-version"], capture_output=True, timeout=5)
            return p
        except Exception:
            continue
    return "ffmpeg"

def get_font(size: int):
    """Charge une police system, fallback robuste."""
    candidates = [
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\verdana.ttf",
    ]
    if PIL_OK:
        from PIL import ImageFont
        for c in candidates:
            if Path(c).exists():
                try:
                    return ImageFont.truetype(c, size)
                except Exception:
                    continue
        return ImageFont.load_default()
    return None

def parse_script(raw: str) -> List[dict]:
    """Parse un script en segments: hook, body[], cta."""
    segments = []
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    
    # Chercher markers strucurés
    hook_text = ""
    cta_text = ""
    body_lines = []
    
    in_hook = False
    in_cta = False
    
    for line in lines:
        lu = line.upper()
        if any(x in lu for x in ["[HOOK", "HOOK —", "HOOK:"]):
            in_hook = True; in_cta = False; continue
        if any(x in lu for x in ["[CTA", "CTA —", "CTA:", "[ACTE 2", "ACTE 1"]):
            in_hook = False
            if "CTA" in lu:
                in_cta = True
            continue
        if line.startswith("===") or line.startswith("---"):
            continue
        if in_hook and not hook_text:
            hook_text = line.strip('"')
        elif in_cta and not cta_text:
            cta_text = line.strip('"')
        elif not line.startswith("[") and len(line) > 20:
            body_lines.append(line.strip('"'))
    
    # Fallback: split au tiers si pas de markers
    if not hook_text and body_lines:
        hook_text = body_lines.pop(0)
    if not cta_text and body_lines:
        cta_text = body_lines.pop(-1)
    
    if hook_text:
        segments.append({"type": "hook", "text": hook_text})
    
    # Grouper les body lines (2 lignes par segment max)
    for i in range(0, len(body_lines), 2):
        chunk = " ".join(body_lines[i:i+2])
        if chunk.strip():
            segments.append({"type": "body", "text": chunk})
    
    if cta_text:
        segments.append({"type": "cta", "text": cta_text})
    
    # Fallback total
    if not segments:
        # Diviser le texte brut en ~4 segments
        all_text = " ".join(lines)
        words = all_text.split()
        chunk_size = len(words) // 4 or 1
        for i in range(0, len(words), chunk_size):
            segments.append({"type": "body", "text": " ".join(words[i:i+chunk_size])})
    
    return segments

def create_frame(text: str, seg_type: str, progress: float,
                 total: int, index: int) -> Optional[object]:
    """Crée un frame PNG 1080x1920 avec design MecaIA."""
    if not PIL_OK:
        return None
    
    img = Image.new("RGB", (W, H), hex_to_rgb(BG_COLOR))
    draw = ImageDraw.Draw(img)
    
    # Header bar gradient effect
    draw.rectangle([0, 0, W, 90], fill=hex_to_rgb("#0d0f11"))
    # Logo MecaIA
    logo_font = get_font(36)
    draw.text((40, 27), "MecaIA", fill=hex_to_rgb(ACCENT_COLOR), font=logo_font)
    # Séparateur header
    draw.rectangle([0, 88, W, 92], fill=hex_to_rgb(ACCENT_COLOR))
    
    # Compteur segment
    counter_font = get_font(24)
    counter_text = f"{index + 1} / {total}"
    draw.text((W - 100, 32), counter_text, fill=hex_to_rgb("#888888"), font=counter_font)
    
    # Zone principale — card centrée
    card_y1, card_y2 = 150, H - 250
    card_mid = (card_y1 + card_y2) // 2
    
    # Ligne décorative orange
    if seg_type == "hook":
        draw.rectangle([40, card_y1, 46, card_y1 + 80], fill=hex_to_rgb(ACCENT_COLOR))
    
    # Texte principal
    text_color = hex_to_rgb(HOOK_COLOR) if seg_type in ("hook", "cta") else hex_to_rgb(TEXT_COLOR)
    font_size = 68 if seg_type == "hook" else 58 if seg_type == "cta" else 52
    text_font = get_font(font_size)
    
    # Wrap et centrer
    wrap_width = 22 if seg_type == "hook" else 26
    wrapped = textwrap.fill(text, width=wrap_width)
    lines = wrapped.splitlines()
    
    # Calculer hauteur totale du texte
    line_h = font_size + 16
    total_h = len(lines) * line_h
    start_y = card_mid - total_h // 2
    
    for i, line in enumerate(lines):
        # Shadow
        draw.text((W//2 - 1 + 2, start_y + i * line_h + 2), line,
                  fill=hex_to_rgb("#000000"), font=text_font, anchor="mm")
        draw.text((W//2 - 1, start_y + i * line_h), line,
                  fill=text_color, font=text_font, anchor="mm")
    
    # Badge type
    badge_colors = {
        "hook": hex_to_rgb(ACCENT_COLOR),
        "cta": hex_to_rgb("#16a34a"),
        "body": hex_to_rgb("#1e40af")
    }
    badge_labels = {"hook": "ACCROCHE", "cta": "ACTION", "body": ""}
    badge_col = badge_colors.get(seg_type, hex_to_rgb("#333"))
    badge_label = badge_labels.get(seg_type, "")
    if badge_label:
        badge_font = get_font(22)
        bx, by = 40, card_y2 - 60
        draw.rectangle([bx, by, bx + 130, by + 36], fill=badge_col)
        draw.text((bx + 65, by + 18), badge_label,
                  fill=hex_to_rgb("#000000"), font=badge_font, anchor="mm")
    
    # Barre de progression (bottom)
    bar_h = 12
    draw.rectangle([0, H - bar_h, W, H], fill=hex_to_rgb("#1a1a1a"))
    prog_w = int(W * progress)
    if prog_w > 0:
        draw.rectangle([0, H - bar_h, prog_w, H], fill=hex_to_rgb(ACCENT_COLOR))
    
    # watermark
    wm_font = get_font(20)
    draw.text((W - 20, H - 40), "mecaiaauto.com",
              fill=hex_to_rgb("#333333"), font=wm_font, anchor="rm")
    
    return img

async def elevenlabs_tts(text: str, voice_id: str, api_key: str) -> Optional[bytes]:
    """Appelle ElevenLabs TTS API, retourne bytes MP3."""
    if not api_key:
        return None
    if not HTTPX_OK:
        return None
    
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.65,
            "similarity_boost": 0.80,
            "style": 0.35,
            "use_speaker_boost": True
        }
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                return resp.content
            return None
    except Exception:
        return None

async def compose_video_ffmpeg(frames_dir: Path, audio_path: Optional[Path],
                                output_path: Path, fps: float = 0.4) -> bool:
    """Compose les frames + audio en MP4 via FFmpeg."""
    ff = ffmpeg_path()
    
    if audio_path and audio_path.exists():
        cmd = [
            ff, "-y",
            "-framerate", str(fps),
            "-i", str(frames_dir / "frame_%04d.png"),
            "-i", str(audio_path),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-shortest",
            "-movflags", "+faststart",
            str(output_path)
        ]
    else:
        # Sans audio: durée fixe par frame
        cmd = [
            ff, "-y",
            "-framerate", str(fps),
            "-i", str(frames_dir / "frame_%04d.png"),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(output_path)
        ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        return result.returncode == 0
    except Exception:
        return False

# ─── Input Models ─────────────────────────────────────────────────────────────

class GenerateVideoInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    script: str = Field(..., description="Script complet de la vidéo TikTok", min_length=20)
    hook: Optional[str] = Field(None, description="Accroche (override du script si fournie)", max_length=200)
    cta: Optional[str] = Field(None, description="CTA final (override)", max_length=150)
    topic: str = Field(..., description="Sujet court pour nommer le fichier", min_length=3, max_length=80)
    voice_id: Optional[str] = Field(None, description="ID voix ElevenLabs (défaut: voix FR configurée)")
    with_voice: bool = Field(default=True, description="True = générer voix via ElevenLabs · False = frames silencieuses")

class PostVideoInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    post_id: str = Field(..., description="UUID du post dans social_posts (pour récupérer le script)")
    voice_id: Optional[str] = Field(None, description="ID voix ElevenLabs optionnel")
    with_voice: bool = Field(default=True, description="Générer la voix IA")

# ─── Tools ────────────────────────────────────────────────────────────────────

@mcp.tool(name="video_generate_tiktok",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def video_generate_tiktok(params: GenerateVideoInput) -> str:
    """Génère une vidéo TikTok 1080x1920 propre depuis un script.

    Crée: frames Pillow (design MecaIA #060809/#e8a000) + voix ElevenLabs FR + composition FFmpeg.
    Output: fichier MP4 prêt à uploader sur TikTok.

    Args:
        params: script, hook, cta, topic, voice_id, with_voice

    Returns:
        str: Chemin vers le fichier MP4 généré + résumé des segments.
    """
    if not PIL_OK:
        return "❌ Pillow non installé. Lancer: pip install pillow"
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Construire le script complet
    full_script = params.script
    if params.hook:
        full_script = f"[HOOK] {params.hook}\n{full_script}"
    if params.cta:
        full_script = f"{full_script}\n[CTA] {params.cta}"
    
    # Parser en segments
    segments = parse_script(full_script)
    if not segments:
        return "❌ Script vide ou non parsable."
    
    # Nom de fichier sécurisé
    safe_name = "".join(c for c in params.topic if c.isalnum() or c in " -_")[:40].strip()
    safe_name = safe_name.replace(" ", "_").lower()
    
    tmpdir = Path(tempfile.mkdtemp())
    audio_combined = None
    
    try:
        # ── Générer frames PNG ──────────────────────────────────────────
        audio_chunks = []
        
        for i, seg in enumerate(segments):
            progress = (i + 1) / len(segments)
            frame = create_frame(seg["text"], seg["type"], progress, len(segments), i)
            if frame is None:
                return "❌ Erreur création frame Pillow"
            frame_path = tmpdir / f"frame_{i:04d}.png"
            frame.save(str(frame_path), "PNG")
            
            # Dupliquer chaque frame pour durée ~2.5s à 0.4fps (1 frame = 2.5s)
            # On duplique 3x pour avoir ~7-8s par segment vocal
            for dup in range(1, 4):
                dup_path = tmpdir / f"frame_{i:04d}_{dup:02d}.png"
                import shutil as sh
                sh.copy(str(frame_path), str(dup_path))
        
        # Renommer frames en séquence continue pour ffmpeg
        all_frames = sorted(tmpdir.glob("frame_*.png"))
        for j, fp in enumerate(all_frames):
            fp.rename(tmpdir / f"seq_{j:04d}.png")
        
        # Renommer le pattern pour ffmpeg
        seq_frames = sorted(tmpdir.glob("seq_*.png"))
        for j, fp in enumerate(seq_frames):
            fp.rename(tmpdir / f"f_{j:04d}.png")
        
        # ── Générer audio (ElevenLabs) ──────────────────────────────────
        if params.with_voice and ELEVENLABS_API_KEY:
            vid = params.voice_id or VOICE_ID_FR_DEFAULT
            full_text = " ".join(s["text"] for s in segments)
            audio_bytes = await elevenlabs_tts(full_text, vid, ELEVENLABS_API_KEY)
            if audio_bytes:
                audio_path = tmpdir / "voice.mp3"
                audio_path.write_bytes(audio_bytes)
                audio_combined = audio_path
        
        # ── Composer avec FFmpeg ────────────────────────────────────────
        output_path = OUTPUT_DIR / f"{safe_name}.mp4"
        n_frames = len(list(tmpdir.glob("f_*.png")))
        fps = 0.4  # 2.5 secondes par frame
        
        ff = ffmpeg_path()
        if audio_combined and audio_combined.exists():
            cmd = [ff, "-y",
                   "-framerate", str(fps),
                   "-i", str(tmpdir / "f_%04d.png"),
                   "-i", str(audio_combined),
                   "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                   "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "128k",
                   "-shortest", "-movflags", "+faststart",
                   str(output_path)]
        else:
            cmd = [ff, "-y",
                   "-framerate", str(fps),
                   "-i", str(tmpdir / "f_%04d.png"),
                   "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                   "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                   str(output_path)]
        
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            err = result.stderr.decode("utf-8", errors="ignore")[-300:]
            return f"❌ FFmpeg erreur:\n{err}"
        
        # ── Résultat ───────────────────────────────────────────────────
        size_mb = round(output_path.stat().st_size / 1_000_000, 1)
        voice_status = "✅ Voix FR ElevenLabs" if audio_combined else ("⚠️ Sans voix (clé ElevenLabs manquante)" if params.with_voice else "🔇 Silencieuse")
        
        seg_summary = "\n".join(
            f"  {i+1}. [{s['type'].upper()}] {s['text'][:60]}{'...' if len(s['text'])>60 else ''}"
            for i, s in enumerate(segments)
        )
        
        return (
            f"🎬 Vidéo TikTok générée ✅\n"
            f"**Fichier:** `{output_path}`\n"
            f"**Taille:** {size_mb} MB · **Format:** 1080x1920 MP4\n"
            f"**Audio:** {voice_status}\n"
            f"**Segments ({len(segments)}):**\n{seg_summary}\n\n"
            f"→ Ouvrir le dossier: `{OUTPUT_DIR}`\n"
            f"→ Uploader directement sur TikTok Creator Studio"
        )
    
    except subprocess.TimeoutExpired:
        return "❌ FFmpeg timeout (> 2 minutes). Vérifier installation FFmpeg."
    except Exception as e:
        return f"❌ Erreur génération: {type(e).__name__}: {str(e)}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@mcp.tool(name="video_from_post",
          annotations={"readOnlyHint": False, "destructiveHint": False})
async def video_from_post(params: PostVideoInput) -> str:
    """Génère une vidéo TikTok directement depuis un post Supabase (via post_id).

    Récupère automatiquement le script, le hook et le CTA depuis social_posts.
    Même résultat que video_generate_tiktok mais intégré au workflow social.

    Args:
        params: post_id (UUID social_posts), voice_id, with_voice

    Returns:
        str: Chemin MP4 généré.
    """
    try:
        from supabase import create_client
        sb_url = os.environ.get("SUPABASE_URL", "https://vexxjbpbfrvgszvzpmgu.supabase.co")
        sb_key = os.environ.get("SUPABASE_ANON_KEY", "")
        if not sb_key:
            return "❌ SUPABASE_ANON_KEY manquant dans .env"
        sb = create_client(sb_url, sb_key)
        
        res = sb.table("social_posts").select("topic,hook,content,cta").eq("id", params.post_id).execute()
        if not res.data:
            return f"❌ Post `{params.post_id}` non trouvé dans social_posts."
        
        p = res.data[0]
        gen_params = GenerateVideoInput(
            script=p.get("content", ""),
            hook=p.get("hook"),
            cta=p.get("cta"),
            topic=p.get("topic", "video"),
            voice_id=params.voice_id,
            with_voice=params.with_voice
        )
        return await video_generate_tiktok(gen_params)
    except Exception as e:
        return f"❌ {type(e).__name__}: {str(e)}"


@mcp.tool(name="video_list_voices",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def video_list_voices() -> str:
    """Liste les voix ElevenLabs disponibles, filtrées sur le français.

    Returns:
        str: Liste des voix FR avec leurs IDs à utiliser dans video_generate_tiktok.
    """
    if not ELEVENLABS_API_KEY:
        return (
            "⚠️ ELEVENLABS_API_KEY non configurée dans .env\n\n"
            "**Voix FR recommandées (IDs à utiliser sans API) :**\n"
            "- `onwK4e9ZLuTAKqWW03F9` — Daniel (homme, naturel, FR)\n"
            "- `EXAVITQu4vr4xnSDxMaL` — Bella (femme, douce, multilingue)\n"
            "- `pFZP5JQG7iQjIQuC4Bku` — Lily (femme, jeune, FR)\n"
            "- `21m00Tcm4TlvDq8ikWAM` — Rachel (femme, pro, multilingue)\n\n"
            "→ Configurer ELEVENLABS_API_KEY dans mcp-video/.env"
        )
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": ELEVENLABS_API_KEY}
            )
            if resp.status_code != 200:
                return f"❌ ElevenLabs API: {resp.status_code}"
            
            voices = resp.json().get("voices", [])
            fr_voices = [v for v in voices
                        if any(l in ["fr", "fr-FR", "fr-BE"]
                               for l in v.get("labels", {}).values())
                        or "french" in str(v.get("labels", {})).lower()]
            
            if not fr_voices:
                fr_voices = voices[:10]  # fallback: 10 premières
            
            lines = [f"## 🎤 {len(fr_voices)} voix disponibles\n"]
            for v in fr_voices:
                labels = v.get("labels", {})
                lines.append(
                    f"- **{v.get('name','?')}** | `{v.get('voice_id','?')}` "
                    f"| {labels.get('accent','?')} · {labels.get('gender','?')} · {labels.get('age','?')}"
                )
            lines.append("\n→ Utiliser l'ID dans `video_generate_tiktok(voice_id=...)`")
            return "\n".join(lines)
    except Exception as e:
        return f"❌ {type(e).__name__}: {str(e)}"


@mcp.tool(name="video_check_setup",
          annotations={"readOnlyHint": True, "destructiveHint": False})
async def video_check_setup() -> str:
    """Vérifie que tout est correctement configuré pour la génération vidéo.

    Teste: FFmpeg, Pillow, ElevenLabs API key, dossier output.

    Returns:
        str: Rapport de santé du système vidéo.
    """
    lines = ["## 🔍 Video MCP — Diagnostic setup\n"]
    
    # Pillow
    lines.append(f"{'✅' if PIL_OK else '❌'} Pillow (génération frames): {'OK' if PIL_OK else 'pip install pillow'}")
    
    # httpx
    lines.append(f"{'✅' if HTTPX_OK else '❌'} httpx (appels API): {'OK' if HTTPX_OK else 'pip install httpx'}")
    
    # FFmpeg
    try:
        r = subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        ff_ok = r.returncode == 0
        ff_ver = r.stdout.decode("utf-8", errors="ignore").split("\n")[0][:60] if ff_ok else "introuvable"
    except Exception:
        ff_ok = False
        ff_ver = "introuvable — winget install Gyan.FFmpeg"
    lines.append(f"{'✅' if ff_ok else '❌'} FFmpeg: {ff_ver}")
    
    # ElevenLabs key
    el_ok = bool(ELEVENLABS_API_KEY)
    lines.append(f"{'✅' if el_ok else '⚠️'} ElevenLabs API key: {'Configurée' if el_ok else 'Manquante → vidéo silencieuse seulement'}")
    
    # Voice ID
    lines.append(f"🎤 Voice ID par défaut: `{VOICE_ID_FR_DEFAULT}`")
    
    # Output dir
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lines.append(f"✅ Dossier output: `{OUTPUT_DIR}`")
    
    # Supabase (pour video_from_post)
    sb_key = os.environ.get("SUPABASE_ANON_KEY", "")
    lines.append(f"{'✅' if sb_key else '❌'} Supabase (pour video_from_post): {'OK' if sb_key else 'Manquant'}")
    
    all_ok = PIL_OK and HTTPX_OK and ff_ok
    lines.append(f"\n**Statut global:** {'✅ Prêt à générer' if all_ok else '⚠️ Corriger les erreurs ci-dessus'}")
    
    if el_ok:
        lines.append("\n✅ Voix FR disponible — vidéos avec narration IA activées")
    else:
        lines.append("\n⚠️ Sans ElevenLabs → vidéos silencieuses générées (ajouter ta voix en post-prod)")
    
    return "\n".join(lines)

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[mecaia-video] Démarrage · Output: {OUTPUT_DIR}", file=sys.stderr)
    mcp.run()
