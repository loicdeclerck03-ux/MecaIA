// ============================================================
// PARTS_SEARCH V2 — Références pièces fiables
// Stratégie :
//  1. Claude Sonnet génère les refs avec score de confiance
//  2. Validation légère sur Autodoc.be (ref existe vraiment ?)
//  3. Badge VÉRIFIÉ / PROBABLE / INDICATIF sur chaque ref
//  4. Liens belges (autodoc.be, oscaro.com)
//  5. Si confiance < 70 → lien recherche, pas de ref inventée
// ============================================================
import Anthropic from "@anthropic-ai/sdk";
import { getUser, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
// Sonnet pour meilleure connaissance des références pièces
const MODEL_PARTS = "claude-sonnet-4-6";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Non authentifié" });

  const { marque, modele, annee, carburant, puissance_ch, engine_code, km, piece } = JSON.parse(event.body || "{}");
  if (!marque || !modele || !piece) return json(400, { error: "Champs requis: marque, modele, piece" });

  const vehicule = [marque, modele, annee, carburant,
    puissance_ch && puissance_ch + " ch",
    engine_code && "Code moteur: " + engine_code,
    km && km + " km",
  ].filter(Boolean).join(" — ");

  // ── 1. Génération Sonnet avec score de confiance ──────────────
  const systemPrompt = `Tu es un expert pièces automobiles avec connaissance des catalogues TecDoc, ETKA (VAG), MICROCAT (Ford), ETK (BMW), PAD (PSA/Stellantis).
RÈGLE ABSOLUE : Ne jamais inventer une référence. Si tu n'es pas certain à 80%+, mets reference: null.
Le champ confidence (0-100) est ta vraie certitude que cette référence correspond exactement à ce véhicule.
JSON strict sans markdown.`;

  const userPrompt = `Véhicule : ${vehicule}
Pièce : ${piece}

3 niveaux (Origine, Équivalent OEM, Aftermarket). confidence = certitude 0-100.
Mets reference: null si confidence < 75. Ne jamais inventer.

JSON :
{
  "piece_normalisee": "nom exact canonique",
  "conseil_montage": "conseil pratique 2 phrases max",
  "niveaux": [
    {
      "tier": "Origine",
      "description": "Pièce constructeur origine",
      "marque": "vrai fournisseur OE (Bosch/Valeo/Sachs/SKF/LuK/Brembo/NGK/Continental)",
      "reference": "référence exacte ou null",
      "ref_oe": "ref OE constructeur ou null",
      "confidence": 0,
      "prix_indicatif_min": 0,
      "prix_indicatif_max": 0,
      "garantie": "24 mois",
      "pour_qui": "1 phrase pour qui"
    },
    { "tier": "Équivalent OEM", "description": "", "marque": "", "reference": null, "ref_oe": null, "confidence": 0, "prix_indicatif_min": 0, "prix_indicatif_max": 0, "garantie": "", "pour_qui": "" },
    { "tier": "Aftermarket", "description": "", "marque": "", "reference": null, "ref_oe": null, "confidence": 0, "prix_indicatif_min": 0, "prix_indicatif_max": 0, "garantie": "", "pour_qui": "" }
  ],
  "avertissement": ""
}`;

  let data;
  try {
    const completion = await anthropic.messages.create({
      model: MODEL_PARTS, max_tokens: 1400,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = completion.content.map(b => b.text || "").join("").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    data = JSON.parse(raw);
  } catch (e) {
    console.error("[PARTS_V2] Génération IA:", e.message);
    return json(500, { error: "Erreur génération: " + e.message });
  }

  // ── 2. Validation Autodoc.be + badges ─────────────────────────
  const niveauxEnrichis = await Promise.all((data.niveaux || []).map(async (n) => {
    const ref = n.reference;
    const conf = n.confidence || 0;
    let badge = "INDICATIF";
    let autodocUrl = null;

    const pieceQ = encodeURIComponent(data.piece_normalisee || piece);
    const vmQ = encodeURIComponent(`${marque} ${modele}${annee ? " " + annee : ""}`);

    if (ref) {
      autodocUrl = `https://www.autodoc.be/recherche?q=${encodeURIComponent(ref)}`;
      // Tentative validation Autodoc
      try {
        const resp = await fetch(autodocUrl, {
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html", "Accept-Language": "fr-BE,fr;q=0.9" },
          signal: AbortSignal.timeout(3500),
        });
        if (resp.ok) {
          const html = await resp.text();
          const found = html.includes('"@type":"Product"') || html.includes("data-article-id") ||
                        html.includes("article-number") || html.includes(ref.replace(/\s/g,""));
          badge = found ? "VÉRIFIÉ" : (conf >= 80 ? "PROBABLE" : "INDICATIF");
          // URL directe si on la trouve
          const m = html.match(/href="(\/auto-parts\/[^"]+)"/);
          if (m) autodocUrl = "https://www.autodoc.be" + m[1];
        } else {
          badge = conf >= 80 ? "PROBABLE" : "INDICATIF";
        }
      } catch {
        badge = conf >= 80 ? "PROBABLE" : "INDICATIF";
      }
    } else {
      // Pas de référence → lien recherche générique
      autodocUrl = `https://www.autodoc.be/recherche?q=${pieceQ}+${vmQ}`;
      badge = "RECHERCHER";
    }

    const q = ref ? encodeURIComponent(ref) : pieceQ;
    return {
      ...n,
      badge,
      liens: [
        { shop: "Autodoc", logo: "🔵", url: autodocUrl },
        { shop: "Oscaro", logo: "🟠", url: `https://www.oscaro.com/recherche?q=${q}&vehicule=${vmQ}` },
        { shop: "Mister-Auto", logo: "🟣", url: `https://www.mister-auto.be/catalogsearch/result/?q=${q}+${vmQ}` },
        { shop: "Amazon.be", logo: "🟡", url: `https://www.amazon.com.be/s?k=${q}+${vmQ}` },
      ],
    };
  }));

  data.niveaux = niveauxEnrichis;
  return json(200, { success: true, vehicule, piece, source: "sonnet-v2+validation", ...data });
};
