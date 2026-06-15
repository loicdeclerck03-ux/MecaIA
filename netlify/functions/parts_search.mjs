import Anthropic from "@anthropic-ai/sdk";
import { getUser, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Non authentifié" });

  const { marque, modele, annee, carburant, puissance_ch, engine_code, km, piece } = JSON.parse(event.body || "{}");
  if (!marque || !modele || !piece) return json(400, { error: "Champs requis: marque, modele, piece" });

  const vehicule = [marque, modele, annee, carburant,
    puissance_ch && puissance_ch + "ch",
    engine_code && "Code:" + engine_code,
    km && km + "km"
  ].filter(Boolean).join(" ");

  const systemPrompt = `Tu es un expert pièces automobiles avec accès aux catalogues ETKA, Autodata et TecDoc.
Réponds UNIQUEMENT en JSON valide, sans texte autour ni markdown.
Tes références doivent être réelles et précises pour le véhicule donné.`;

  const userPrompt = `Véhicule : ${vehicule}
Pièce recherchée : ${piece}

Retourne exactement ce JSON avec 3 niveaux de qualité :
{
  "piece_normalisee": "nom canonique de la pièce",
  "conseil_montage": "conseil court montage/remplacement (1-2 phrases max)",
  "niveaux": [
    {
      "tier": "Origine",
      "description": "Pièce constructeur d'origine",
      "marque": "marque OEM réelle ex: Bosch/Valeo/Sachs/SKF/LuK/Brembo/NGK",
      "reference": "référence exacte ex: 0 281 002 398",
      "ref_oe": "référence OE constructeur si connue",
      "prix_indicatif_min": 0,
      "prix_indicatif_max": 0,
      "garantie": "ex: 24 mois",
      "pour_qui": "conseil en 1 phrase sur pour qui cette option est idéale"
    },
    {
      "tier": "Équivalent OEM",
      "description": "Équivalent qualité constructeur, marque premium",
      "marque": "",
      "reference": "",
      "ref_oe": "",
      "prix_indicatif_min": 0,
      "prix_indicatif_max": 0,
      "garantie": "",
      "pour_qui": ""
    },
    {
      "tier": "Aftermarket",
      "description": "Bon rapport qualité/prix, marque sérieuse",
      "marque": "",
      "reference": "",
      "ref_oe": "",
      "prix_indicatif_min": 0,
      "prix_indicatif_max": 0,
      "garantie": "",
      "pour_qui": ""
    }
  ],
  "avertissement": "Note courte sur la compatibilité ou le montage si nécessaire, sinon chaîne vide"
}`;

  try {
    const completion = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = completion.content.map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
    const data = JSON.parse(raw);

    // Ajouter liens boutiques pour chaque niveau
    data.niveaux = (data.niveaux || []).map((n) => ({
      ...n,
      liens: genererLiens(n.reference || piece, marque, modele),
    }));

    return json(200, { success: true, vehicule, piece, ...data });
  } catch (e) {
    console.error("[PARTS_SEARCH] Erreur:", e.message);
    return json(500, { error: "Erreur recherche pièces: " + e.message });
  }
};

function genererLiens(reference, marque, modele) {
  const q = encodeURIComponent(reference);
  const vm = encodeURIComponent(marque + " " + modele);
  return [
    { shop: "Autodoc", url: `https://www.autodoc.fr/recherche?q=${q}`, logo: "🔵" },
    { shop: "Oscaro", url: `https://www.oscaro.com/recherche?q=${q}&vehicule=${vm}`, logo: "🟠" },
    { shop: "Mister-Auto", url: `https://www.mister-auto.com/catalogsearch/result/?q=${q}`, logo: "🟣" },
    { shop: "Amazon", url: `https://www.amazon.fr/s?k=${q}+${vm}`, logo: "🟡" },
  ];
}
