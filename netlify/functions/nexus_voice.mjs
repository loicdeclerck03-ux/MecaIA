// nexus_voice.mjs — NEXUS Voice (ADR-027 extension)
// Transcrit message vocal via Whisper (OpenAI).
// Extrait codes OBD et symptômes pour passer directement à nexus_orchestrator.
// Auth requise. Pas de débit crédit.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const WHISPER_MODEL = "whisper-1";
const VOICE_TIMEOUT_MS = 18000;
const MAX_AUDIO_B64 = 33_000_000;

const EXTRACTION_SYSTEM = `Tu reçois la transcription d'un message vocal d'un conducteur décrivant un problème avec sa voiture.
Extrait les informations pertinentes. Réponds UNIQUEMENT en JSON valide, sans texte autour :
{
  "symptomes": ["symptôme 1"],
  "codes_obd": ["P0401"],
  "vehicule": {"make": null, "model": null, "year": null, "fuel": null},
  "contexte_temporel": "depuis quand",
  "urgence_percue": "urgence décrite",
  "question_principale": "question reformulée",
  "pret_pour_diagnostic": true
}
Ne jamais inventer des codes ou symptômes non mentionnés.`;

async function transcribeWithWhisper(audioBase64, audioFormat, signal) {
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const boundary = "----nexus_voice_" + Date.now();
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${audioFormat}"\r\nContent-Type: audio/${audioFormat}\r\n\r\n`),
    audioBuffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${WHISPER_MODEL}\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nfr\r\n--${boundary}--\r\n`),
  ];
  const body = Buffer.concat(parts);
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length) },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  return data.text || "";
}

async function extractFromTranscription(transcription, signal) {
  const r = await anthropic.messages.create(
    { model: "claude-haiku-4-5-20251001", max_tokens: 500, system: EXTRACTION_SYSTEM, messages: [{ role: "user", content: `Transcription : "${transcription}"` }] },
    { signal }
  );
  const text = r?.content?.[0]?.text || "";
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return { symptomes: [], codes_obd: [], pret_pour_diagnostic: false };
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }
  const { audio, audioFormat = "webm", vehicle } = body;
  if (!audio || typeof audio !== "string" || audio.length < 50) return json(400, { error: "audio (base64) requis" });
  if (audio.length > MAX_AUDIO_B64) return json(413, { error: "Audio trop long (max ~24MB)" });
  if (!["webm", "mp3", "wav", "m4a", "ogg", "flac", "mp4"].includes(audioFormat)) return json(400, { error: "Format audio non supporté" });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VOICE_TIMEOUT_MS);
  const startTs = Date.now();
  let transcription, extraction;
  try {
    transcription = await transcribeWithWhisper(audio, audioFormat, ctrl.signal);
    if (!transcription || transcription.trim().length < 5) return json(422, { error: "Audio non intelligible ou trop court" });
    extraction = await extractFromTranscription(transcription, ctrl.signal);
  } catch (e) {
    const isAbort = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
    console.error("[nexus_voice] error:", isAbort ? "timeout" : e.message);
    return json(isAbort ? 504 : 502, { error: isAbort ? "Transcription trop lente" : "Service vocal indisponible" });
  } finally { clearTimeout(timer); }
  const elapsed = Date.now() - startTs;
  console.log(`[nexus_voice] elapsed=${elapsed}ms chars=${transcription.length} codes=${(extraction?.codes_obd || []).length}`);
  const vehIn = vehicle || {};
  const vehDet = extraction?.vehicule || {};
  const vehicleFinal = { make: vehIn.make || vehDet.make || null, model: vehIn.model || vehDet.model || null, year: vehIn.year || vehDet.year || null, fuel: vehIn.fuel || vehDet.fuel || null };
  return json(200, {
    success: true, transcription, extraction, vehicle: vehicleFinal,
    ready_for_orchestrator: !!(extraction?.pret_pour_diagnostic && (extraction?.symptomes?.length > 0 || extraction?.codes_obd?.length > 0)),
    symptoms_text: (extraction?.symptomes || []).join(". "),
    codes_detected: extraction?.codes_obd || [],
    elapsed_ms: elapsed, queried_at: new Date().toISOString(),
  });
}
