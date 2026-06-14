// VIN_LOOKUP V2 — décodage VIN enrichi
// Source 1 : API publique NHTSA vPIC (gratuite, sans clé)
// Source 2 : Claude Haiku pour enrichissement si données manquantes
import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const DAILY_LIMIT = 3;

// Table de décodage WMI européens non couverts par NHTSA
const WMI_EU = {
  VF1:'Renault',VF3:'Peugeot',VF7:'Citroën',VSS:'SEAT',TMB:'Škoda',
  WBA:'BMW',WBS:'BMW M',WBY:'BMW i',WDB:'Mercedes-Benz',WDC:'Mercedes-Benz',
  WDD:'Mercedes-Benz',WME:'smart',WVW:'Volkswagen',WAU:'Audi',WUA:'Audi Sport',
  WP0:'Porsche',WP1:'Porsche',SAJ:'Jaguar',SAL:'Land Rover',SAR:'Range Rover',
  SCC:'Lotus',SCB:'Bentley',SCA:'Rolls-Royce',ZAR:'Alfa Romeo',ZCF:'Iveco',
  ZFA:'Fiat',ZGA:'Alfa Romeo',ZLA:'Lancia',VSK:'Volvo',YS3:'Saab',
  XTA:'Lada',WVGZ:'Volkswagen',W0L:'Opel/Vauxhall',
};

// Décodage de l'année depuis le 10e caractère du VIN
const VIN_YEAR = {
  A:1980,B:1981,C:1982,D:1983,E:1984,F:1985,G:1986,H:1987,
  J:1988,K:1989,L:1990,M:1991,N:1992,P:1993,R:1994,S:1995,
  T:1996,V:1997,W:1998,X:1999,Y:2000,'1':2001,'2':2002,'3':2003,
  '4':2004,'5':2005,'6':2006,'7':2007,'8':2008,'9':2009,A:2010,
  B:2011,C:2012,D:2013,E:2014,F:2015,G:2016,H:2017,J:2018,
  K:2019,L:2020,M:2021,N:2022,P:2023,R:2024,S:2025,T:2026,
};

function decodeVinYear(vin) {
  if (vin.length < 10) return null;
  const c = vin[9].toUpperCase();
  return VIN_YEAR[c] || null;
}

function qualiteScore(v) {
  // Compte les champs non-null pour évaluer la qualité NHTSA
  const champs = [v.Make, v.Model, v.ModelYear, v.FuelTypePrimary, v.BodyClass, v.EngineCylinders];
  return champs.filter(x => x && String(x).trim() !== '0' && x !== '').length;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const vinRaw = event.httpMethod === "GET"
      ? event.queryStringParameters?.vin
      : JSON.parse(event.body || "{}").vin;
    const vin = (vinRaw || "").trim().toUpperCase();

    if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) {
      return json(400, { error: "VIN invalide (11 à 17 caractères, sans I, O, Q)" });
    }

    // Limite journalière
    const { data: usedToday, error: cErr } = await supabase.rpc("vin_count_today", { p_user_id: auth.userId });
    if (cErr) throw cErr;
    if ((usedToday || 0) >= DAILY_LIMIT) {
      return json(429, {
        success: false, code: "daily_limit_reached",
        message: `Limite de ${DAILY_LIMIT} VIN par jour atteinte. Réessaie demain.`,
        used: usedToday, max: DAILY_LIMIT,
      });
    }

    // Source 1 : NHTSA vPIC
    let nhtsaData = null;
    try {
      const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`);
      const j = await r.json();
      nhtsaData = j && Array.isArray(j.Results) ? j.Results[0] : null;
    } catch (e) {
      console.error("[VIN] NHTSA:", e.message);
    }

    // Décodage WMI européen (préfixe 3 caractères)
    const wmi3 = vin.substring(0, 3);
    const wmi2 = vin.substring(0, 2);
    const marqueWMI = WMI_EU[wmi3] || WMI_EU[wmi2] || null;

    // Évaluation qualité NHTSA
    const nhtsaQualite = nhtsaData ? qualiteScore(nhtsaData) : 0;
    const anneeVIN = decodeVinYear(vin);

    // Construction du résultat de base
    let vehicle = {
      marque: (nhtsaData?.Make || marqueWMI || null),
      modele: nhtsaData?.Model || null,
      annee: nhtsaData?.ModelYear || (anneeVIN ? String(anneeVIN) : null),
      carburant: nhtsaData?.FuelTypePrimary || null,
      carrosserie: nhtsaData?.BodyClass || null,
      cylindres: nhtsaData?.EngineCylinders || null,
      cylindree_l: nhtsaData?.DisplacementL || null,
      moteur: nhtsaData?.EngineModel || null,
      pays_fabrication: nhtsaData?.PlantCountry || null,
      transmission: nhtsaData?.TransmissionStyle || null,
      nb_portes: nhtsaData?.Doors || null,
      puissance_cv: nhtsaData?.EnginePower_kW
        ? Math.round(parseFloat(nhtsaData.EnginePower_kW) * 1.36) : null,
    };

    // Source 2 : Claude Haiku si données NHTSA insuffisantes (score < 3)
    let enrichi = false;
    if (nhtsaQualite < 3) {
      try {
        const completion = await anthropic.messages.create({
          model: MODEL, max_tokens: 400,
          system: "Tu es un expert en décodage VIN. Donne UNIQUEMENT les informations certaines. Si tu ne sais pas avec certitude, mets null. Réponds en JSON strict sans markdown.",
          messages: [{
            role: "user",
            content: `Décode ce VIN : ${vin}\nWMI: ${wmi3} (marque probable: ${marqueWMI || 'inconnue'})\nAnnée probable depuis position 10: ${anneeVIN || 'inconnue'}\n\nJSON: {"marque": string|null, "modele": string|null, "annee": string|null, "carburant": string|null, "carrosserie": string|null, "pays_fabrication": string|null, "note": "max 1 phrase si info utile"|null}\n\nNe devine jamais une référence de moteur ou cylindrée — mets null si incertain.`
          }]
        }, { timeout: 5000 });
        const text = (completion.content || []).map(b => b.text || "").join("");
        const clean = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(clean);
        // Enrichit uniquement les champs vides
        if (parsed.marque && !vehicle.marque) vehicle.marque = parsed.marque;
        if (parsed.modele && !vehicle.modele) vehicle.modele = parsed.modele;
        if (parsed.annee && !vehicle.annee) vehicle.annee = parsed.annee;
        if (parsed.carburant && !vehicle.carburant) vehicle.carburant = parsed.carburant;
        if (parsed.carrosserie && !vehicle.carrosserie) vehicle.carrosserie = parsed.carrosserie;
        if (parsed.pays_fabrication && !vehicle.pays_fabrication) vehicle.pays_fabrication = parsed.pays_fabrication;
        vehicle.note_ia = parsed.note || null;
        enrichi = true;
      } catch (e) {
        console.error("[VIN] enrichissement IA:", e.message);
      }
    }

    // Log seulement si on a un résultat utile
    if (!vehicle.marque && !vehicle.modele) {
      return json(404, { success: false, error: "VIN introuvable ou format non reconnu" });
    }

    try {
      await supabase.rpc("record_vin_lookup", { p_user_id: auth.userId, p_vin: vin });
    } catch (e) {
      console.error("[VIN] record:", e.message);
    }

    return json(200, {
      success: true, vin, vehicle,
      source: enrichi ? "NHTSA+IA" : nhtsaQualite >= 3 ? "NHTSA" : "WMI",
      qualite: nhtsaQualite >= 5 ? "complète" : nhtsaQualite >= 3 ? "partielle" : "minimale",
      quota: { used: (usedToday || 0) + 1, max: DAILY_LIMIT },
    });
  } catch (error) {
    console.error("[VIN]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
