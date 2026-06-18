// vin_decoder.mjs — Décodeur VIN ultra-rapide
// Décodage local (0 appel IA) + enrichissement NHTSA gratuit
// Coût : 0€ en tokens

import { json, preflight } from "../lib/auth.mjs";

// ── WMI Database (World Manufacturer Identifier) ──────────────────────────────
const WMI = {
  // France
  VF1:"Renault",VF2:"Citroën",VF3:"Peugeot",VF6:"Renault",VF7:"Citroën",VF8:"Peugeot",
  VFA:"Renault",VFB:"Peugeot",VFC:"Citroën",VFF:"Renault",
  // Allemagne
  WBA:"BMW",WBS:"BMW M",WBY:"BMW i",WDC:"Mercedes SUV",WDD:"Mercedes-Benz",
  WEB:"Mercedes-Benz",WME:"Smart",WP0:"Porsche",WP1:"Porsche",
  WVW:"Volkswagen",VWV:"Volkswagen",WAU:"Audi",WAZ:"Audi",WV1:"Volkswagen",
  WV2:"Volkswagen Utilitaire",VSS:"SEAT",VSK:"SEAT",TMB:"Škoda",TM9:"Škoda",
  // Italie
  ZAR:"Alfa Romeo",ZFA:"Fiat",ZFE:"Fiat",ZFF:"Ferrari",ZHW:"Lamborghini",
  ZLA:"Lancia",
  // Japon
  JHM:"Honda",JYA:"Yamaha",JN1:"Nissan",JN6:"Nissan",JT1:"Toyota",JT2:"Toyota",
  JT3:"Toyota",JT4:"Toyota",JT6:"Toyota",JTD:"Toyota",JF1:"Subaru",JF2:"Subaru",
  JMB:"Mitsubishi",KMH:"Hyundai",KMJ:"Hyundai",KNA:"Kia",KNB:"Kia",
  // Corée
  KMH:"Hyundai",KMJ:"Hyundai",KNA:"Kia",KNB:"Kia",
  // UK
  SAJ:"Jaguar",SAL:"Land Rover",SAR:"Range Rover",SCB:"Bentley",
  SCC:"Lotus",SFD:"Alexander Dennis",
  // Suède
  YS2:"Scania",YS3:"Saab",YS4:"Scania",YV1:"Volvo",YV4:"Volvo",
  // Espagne/Belgique/Pays-Bas
  TRU:"Audi (Hongrie)",VS6:"SEAT España",VNK:"Toyota (Belgique)",
  XLR:"DAF",
  // USA
  "1FA":"Ford",  "1FB":"Ford",  "1FC":"Ford",  "1FD":"Ford",
  "1G1":"Chevrolet","1G6":"Cadillac","1GC":"Chevrolet Truck","1HD":"Harley-Davidson",
  "1HG":"Honda USA","2HG":"Honda Canada","3HG":"Honda Mexique",
  "1N4":"Nissan USA","1VW":"Volkswagen USA",
};

// ── Décodeur d'année (position 10 du VIN) ─────────────────────────────────────
const YEAR_MAP = {
  A:1980,B:1981,C:1982,D:1983,E:1984,F:1985,G:1986,H:1987,J:1988,K:1989,
  L:1990,M:1991,N:1992,P:1993,R:1994,S:1995,T:1996,V:1997,W:1998,X:1999,
  Y:2000,
  1:2001,2:2002,3:2003,4:2004,5:2005,6:2006,7:2007,8:2008,9:2009,
  // Post-2010 répète les lettres
};
// 2010+ : A=2010, B=2011 ... repeating with offset 30
const YEAR_MAP2 = {
  A:2010,B:2011,C:2012,D:2013,E:2014,F:2015,G:2016,H:2017,J:2018,K:2019,
  L:2020,M:2021,N:2022,P:2023,R:2024,S:2025,T:2026,
};

function decodeYear(char) {
  const c = char.toUpperCase();
  // Si déjà une année précise grâce aux 2 cartes, on cherche la plus récente plausible
  // On retourne les deux possibilités si ambiguïté (lettre A peut être 1980 ou 2010)
  const y1 = YEAR_MAP[c];
  const y2 = YEAR_MAP2[c];
  if (y2 && y2 >= 2010) return y2; // Préférer l'année récente
  if (y1) return y1;
  return null;
}

function decodeWMI(vin) {
  const wmi3 = vin.substring(0, 3).toUpperCase();
  const wmi2 = vin.substring(0, 2).toUpperCase();
  return WMI[wmi3] || WMI[wmi2] || null;
}

// ── Validation VIN ─────────────────────────────────────────────────────────────
function validateVIN(vin) {
  if (!vin || typeof vin !== "string") return false;
  const clean = vin.toUpperCase().replace(/\s/g, "");
  // Le VIN ne doit pas contenir I, O, Q
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(clean);
}

// ── Enrichissement NHTSA (gratuit, pas besoin de clé) ─────────────────────────
async function fetchNHTSA(vin) {
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const results = data.Results || [];
    const get = (var_) => results.find(r => r.Variable === var_)?.Value || null;
    return {
      make:         get("Make"),
      model:        get("Model"),
      year:         parseInt(get("Model Year")) || null,
      fuel:         get("Fuel Type - Primary"),
      engine_size:  get("Engine Displacement (L)"),
      cylinders:    get("Engine Number of Cylinders"),
      body:         get("Body Class"),
      doors:        get("Number of Doors"),
      country:      get("Plant Country"),
      transmission: get("Transmission Style"),
      driveType:    get("Drive Type"),
      trim:         get("Trim"),
    };
  } catch { return null; }
}

// ── Traduction carburant EN→FR ─────────────────────────────────────────────────
const FUEL_FR = {
  "Gasoline": "Essence", "Diesel": "Diesel", "Electric": "Électrique",
  "Hybrid": "Hybride", "Natural Gas": "Gaz naturel", "Flex Fuel": "Flex E85",
  "Plug-In Hybrid Electric": "Hybride rechargeable",
};

// ── Handler ────────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  try {
    const { vin } = JSON.parse(event.body || "{}");
    if (!vin) return json(400, { error: "VIN requis" });

    const cleanVIN = vin.toUpperCase().replace(/\s/g, "");
    const valid = validateVIN(cleanVIN);

    // Décodage local immédiat (0 latence, 0 coût)
    const localMake = decodeWMI(cleanVIN);
    const localYear = decodeYear(cleanVIN[9]);
    const origin = cleanVIN[0]; // Zone géographique
    const originMap = { S:"UK",W:"Allemagne",V:"France/Espagne",Z:"Italie",
      J:"Japon",K:"Corée",1:"USA",2:"Canada",3:"Mexique",9:"Brésil",Y:"Suède/Finlande" };

    // Enrichissement NHTSA en parallèle (si VIN valide)
    const nhtsa = valid ? await fetchNHTSA(cleanVIN) : null;

    // Fusion local + NHTSA
    const make  = nhtsa?.make  || localMake || "Inconnu";
    const model = nhtsa?.model || null;
    const year  = nhtsa?.year  || localYear || null;
    const fuel  = nhtsa?.fuel  ? (FUEL_FR[nhtsa.fuel] || nhtsa.fuel) : null;

    return json(200, {
      vin: cleanVIN,
      valid,
      make,
      model,
      year,
      fuel,
      engine_size:  nhtsa?.engine_size  || null,
      cylinders:    nhtsa?.cylinders    || null,
      body:         nhtsa?.body         || null,
      transmission: nhtsa?.transmission || null,
      driveType:    nhtsa?.driveType    || null,
      trim:         nhtsa?.trim         || null,
      country:      nhtsa?.country      || originMap[origin] || null,
      // Résumé lisible pour l'UI
      summary: [year, make, model, fuel].filter(Boolean).join(" "),
      source: nhtsa ? "NHTSA + local" : "local",
    });
  } catch (e) {
    console.error("[VIN]", e.message);
    return json(500, { error: e.message });
  }
};
