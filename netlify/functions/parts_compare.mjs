// PARTS_COMPARE V2 — comparatif de pièces fiable (anti-hallucination)
// Améliorations :
// - Passe à Sonnet 4.6 (moins d'hallucinations que Haiku)
// - Prompt renforcé : interdit d'inventer des références
// - Ajoute des liens de vérification Autodoc/eBay
// - Disclaimer intégré dans la réponse
import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const MODEL = "claude-sonnet-4-6"; // Sonnet pour réduire les hallucinations

function safeJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const { part_name, vehicle, vehicle_marque, vehicle_modele } = JSON.parse(event.body || "{}");
    if (!part_name) return json(400, { error: "part_name requis" });

    // Débit : 1 jeton
    const { data: cons, error: cErr } = await supabase.rpc("consume_parts_comparison", { p_user_id: auth.userId });
    if (cErr) throw cErr;
    const c = cons && cons[0];
    if (!c || !c.success) {
      return json(402, { success: false, code: "insufficient_credits", message: "Crédits insuffisants.", remaining_balance: c ? c.remaining_balance : 0 });
    }

    const veh = vehicle || [vehicle_marque, vehicle_modele].filter(Boolean).join(" ");

    const system = `Tu es un expert en pièces automobiles. Tu dois être PRÉCIS et HONNÊTE.

RÈGLES ABSOLUES (ne jamais violer) :
1. Ne donne UNE référence que si tu es certain qu'elle existe (tu l'as vue dans ta base d'entraînement avec ce véhicule)
2. Si tu n'es pas certain d'une référence exacte, utilise reference_incertaine:true et donne une référence générique ou null
3. Ne confonds pas les familles de moteurs (ex: 1.6 TDI ne = pas 2.0 TDI)
4. Pour les marques Valeo/Bosch/NGK/SKF/Brembo : tu peux donner des références car leur catalogue est large
5. Pour les références constructeur (OEM) : ne donne que si tu es certain à 95%
6. Réponds STRICTEMENT en JSON valide sans markdown`;

    const prompt = `Véhicule: ${veh}
Pièce recherchée: ${part_name}

Donne 2 à 4 pièces réelles de qualités différentes (Origine/OEM/Aftermarket).
Pour chaque pièce, sois honnête : si tu n'es pas certain de la référence exacte, mets reference_incertaine:true.

JSON:
{"pieces":[{
  "nom": "nom exact de la pièce",
  "marque": "NGK ou Bosch ou Valeo ou Febi ou LuK ou SKF ou Brembo ou Gates ou Dayco ou Sachs",
  "reference": "REF-123 ou null si incertain",
  "reference_incertaine": false,
  "ref_origine": "référence constructeur OEM ou null si incertain",
  "prix_min": 15,
  "prix_max": 45,
  "compatibilite": "note de compatibilité précise avec le véhicule",
  "qualite": "Origine ou OEM ou Aftermarket",
  "conseil": "conseil de montage en 1 phrase",
  "urgence": "Immédiat ou Sous 1000km ou Entretien normal",
  "lien_recherche": "nom de pièce simplifié pour recherche sur Autodoc"
}]}

Ne dépasse pas 4 pièces. Privilégie la précision sur la quantité.`;

    let completion;
    try {
      completion = await anthropic.messages.create({ 
        model: MODEL, max_tokens: 1500, system, 
        messages: [{ role: "user", content: prompt }] 
      });
    } catch (e) {
      console.error("[PARTS] modèle:", e.message);
      return json(502, { success: false, error: "Service de comparatif indisponible, réessayez." });
    }

    const parsed = safeJSON((completion.content || []).map((b) => b.text || "").join(""));
    if (!parsed || !Array.isArray(parsed.pieces)) {
      return json(502, { success: false, error: "Réponse illisible, réessayez." });
    }

    // Enrichit chaque pièce avec des liens de recherche Autodoc
    const pieces = parsed.pieces.slice(0, 4).map(p => ({
      ...p,
      // Si référence incertaine → marquer clairement
      reference: p.reference_incertaine ? null : p.reference,
      ref_origine: p.reference_incertaine ? null : p.ref_origine,
      // Liens de vérification
      url_autodoc: p.reference && !p.reference_incertaine
        ? `https://www.autodoc.be/fr/search?query=${encodeURIComponent(p.reference)}`
        : `https://www.autodoc.be/fr/search?query=${encodeURIComponent((p.lien_recherche || p.nom) + ' ' + (veh.split(' ').slice(0,2).join(' ')))}`,
      url_ebay: `https://www.ebay.be/sch/i.html?_nkw=${encodeURIComponent(p.reference || p.nom + ' ' + veh.split(' ')[0])}`,
    }));

    return json(200, { 
      success: true, 
      pieces,
      fiabilite: "Les références sont issues de la base de connaissance IA. Vérifiez toujours la compatibilité avant commande.",
      remaining_balance: c.remaining_balance, 
      unlimited: c.unlimited 
    });
  } catch (error) {
    console.error("[PARTS]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
