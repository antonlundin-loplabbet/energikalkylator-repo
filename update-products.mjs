#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// update-products.mjs
//
// Hämtar Löplabbets produktfeed från Intersport-API:et, filtrerar fram
// energiprodukterna och sparar resultatet som produkter.json.
//
// Körs en gång i veckan av GitHub Actions (.github/workflows/update-products.yml)
// och kommitterar den uppdaterade filen tillbaka till repot om något ändrats.
//
// Kan också köras manuellt:
//   node update-products.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, existsSync } from "node:fs";

const API_URL = "https://services.intersport.se/api/noselake/searcher/website?q=&site=Loplabbet&hits=4000";
const OUTPUT_FILE = "produkter.json";

// ─── KLASSIFICERING ─────────────────────────────────────────────────────────
// Den här logiken speglar EXAKT motsvarigheten i energikalkylator.html.
// Om du ändrar något här, uppdatera även där (eller tvärtom).

const ENERGY_BRANDS = [
  "Umara", "Maurten", "Enervit", "Nomio",
  "High5", "High 5", "SiS", "Science in Sport", "32Gi",
  "Precision Fuel", "PrecisionFuel", "Precision Hydration", "Precision Fuel & Hydration", "PF&H",
  "Tailwind", "Tailwind Nutrition", "Vitargo", "Mountain Fuel",
  "Naak", "Näak", "GU", "GU Energy", "GU Energy Labs",
  "226ERS", "Veloforte", "Spring Energy", "VOOM", "VOOM Pocket Rocket",
  "Hammer", "Hammer Nutrition", "Pure Sports Nutrition", "Cliff", "Clif",
  "Energikakan"
];

// Typiska värden per produkttyp. Används av kalkylatorn för att räkna ut
// hur många gels/portioner som behövs när API:et inte ger exakta värden
// per produkt. Värdena ska matcha det som finns i energikalkylator.html.
const PRODUCT_TYPES = {
  pre_drink:   { matches: [/intend/i, /pre.?sport/i, /pre.?race/i, /pre.?workout/i],
                 typical_carbs: 30 },
  drink_mix:   { matches: [/u sport/i, /drink.?mix/i, /isotonic/i, /isocarb/i, /sportdryck/i, /energy drink/i, /u loader/i],
                 typical_carbs: 40 },
  gel_caf:     { matches: [
                   /(u gel|sport gel|liquid gel|^gel | gel ).{0,40}(caf|koffein)/i,
                   /(caf|koffein).{0,40}(u gel|sport gel|liquid gel|^gel | gel )/i,
                   /gel.{0,5}(100|160).{0,20}caf/i,
                 ],
                 typical_carbs: 25, typical_caf: 100 },
  gel:         { matches: [/u gel/i, /gel 100/i, /gel 160/i, /sport gel/i, /liquid gel/i, /^gel$/i, /isogel/i, /isotonic gel/i, / gel /i, / gel,/i, / gel$/i],
                 typical_carbs: 25 },
  bar:         { matches: [/u bar/i, /salty bar/i, /solid c? ?1[0-9]+/i, /solid c? ?2[0-9]+/i, /sport bar/i, /protein.?bar/i, /recover.?bar/i, /recover.{0,15}bar/i, /energy bar/i, /energibar/i, /power crunchy/i, /^bar$/i, / bar$/i, / bar /i, / bar -/i],
                 typical_carbs: 30 },
  chew:        { matches: [/chews/i, /energy chew/i, /jelly/i, /carbo tablets/i, /carbo tabletter/i, /sport carbo tabletter/i, /carbo chew/i, /godis/i],
                 typical_carbs: 10 },
  electrolyte: { matches: [/u salty/i, /salt.?tab/i, /salttab/i, /electrolyte/i, /elektrolyt/i, /hydrate/i, /salt cap/i],
                 typical_carbs: 0 },
  recovery:    { matches: [/recovery drink/i, /recovery dryck/i, /återhämtningsdryck/i, /atergiv/i, /protein.?drink/i, /post.?workout/i, /recover.{0,15}(dryck|drink|pulver|powder|kg\b)/i, /\d+\s*kg.{0,20}återhämtning/i],
                 typical_carbs: 30 },
  beetroot:    { matches: [/beet.?it/i, /rödbet/i, /beetroot/i, /nitrate/i],
                 typical_carbs: 0 },
  bicarb:      { matches: [/bicarb/i, /bikarb/i, /sodium bicarbonate/i, /natrium.?bikarbonat/i],
                 typical_carbs: 0 },
  itc:         { matches: [/itc/i, /nomio/i, /preformance/i, /performance shot/i],
                 typical_carbs: 0 },
};

const ACCESSORY_RX = /\b(soft.?flask|softflask|flaska|bottle|vattenflaska|löparbälte|midjebälte|springbelt|gelbälte|nutrition.?belt|belt|västs?|vest|h[åa]llare|holder|behållare|bälte|påse)\b/i;
const MULTIPACK_RX = /\b(box|kartong|carton|flerpack|multipack|\d+\s*[-]?\s*pack|\d+\s*pack|pack\s*\d+|10[\s-]?st|12[\s-]?st|16[\s-]?st|20[\s-]?st|24[\s-]?st|10er|12er|20er|sleeve)\b/i;

function isAccessory(name) { return ACCESSORY_RX.test(name || ""); }
function isMultiPack(name) { return MULTIPACK_RX.test(name || ""); }

function classifyProduct(name) {
  const n = name || "";
  if (isAccessory(n)) return null;
  if (/salty bar/i.test(n)) return "bar";
  if (/pre.?sport.{0,5}gel/i.test(n)) return "gel";
  const order = ["bicarb", "itc", "beetroot", "electrolyte", "recovery", "pre_drink", "gel_caf", "drink_mix", "bar", "chew", "gel"];
  for (const t of order) {
    if (PRODUCT_TYPES[t].matches.some(rx => rx.test(n))) return t;
  }
  return null;
}

function isEnergyDoc(doc) {
  const docName = (doc.commercialname || doc.itemname || doc.name || "").toLowerCase();
  if (isAccessory(docName)) return false;

  const catVals = [
    doc.categories, doc.category, doc.maincategory,
    doc.itemcategory, doc.itemcategorypaths, doc.itemcategoryname,
    doc.category_paths, doc.categorypath, doc.categorypaths,
    doc.categorynames, doc.categoryname,
    doc.facet_category, doc.facetcategory,
    doc.productcategory, doc.productcategories,
    doc.productcategorypath, doc.productcategorypaths,
    doc.productcategory_str_mv, doc.productcategoryname,
    doc.urlpath, doc.urlpaths, doc.itemurl, doc.url
  ];
  const catBlob = catVals
    .filter(v => v !== undefined && v !== null && v !== "")
    .map(v => Array.isArray(v) ? v.join(" ") : (typeof v === "object" ? JSON.stringify(v) : String(v)))
    .join(" ")
    .toLowerCase();

  const catKeywords = ["energi", "sportdryck", "sport-dryck", "sports-drink", "sportsdrink", "nutrition", "sportnutrition", "supplement", "kolhydrat", "energi-sportdryck", "energi & sportdryck"];
  if (catKeywords.some(k => catBlob.includes(k))) return true;

  const brandRaw = (doc.brand || doc.brand_name || doc.brandname || doc.manufacturer || doc.itembrand || "").toLowerCase().trim();
  if (brandRaw && ENERGY_BRANDS.some(b => {
    const bn = b.toLowerCase();
    // Exakt match eller "vårt brand-namn ÄR HELA brand-namnet i feeden"
    // (för att fånga "Maurten Group AB" → "Maurten").
    // Tidigare användes också brandRaw.includes(bn) men det gav falskt
    // positivt: "on".includes("on") finns i "precisi-on", "tailwind nutriti-on" osv.
    if (brandRaw === bn) return true;
    // Substring åt bara ett håll: vårt korta brandnamn finns i feedens
    // (potentiellt längre) brandnamn med ordgräns runt.
    return new RegExp(`\\b${bn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(brandRaw);
  })) return true;

  const name = (doc.commercialname || doc.itemname || doc.name || "").toLowerCase();
  if (name) {
    if (/\b(energigel|energy gel|drink mix|sportdryck|sportsdryck|salttab|salt.?tabletter|electrolyte|elektrolyt|återhämtning|recovery drink|carbo gel|bicarb|bikarbonat|kolhydrat)\b/i.test(name)) {
      return true;
    }
    if (classifyProduct(name)) return true;
  }
  return false;
}

function isInStock(doc) {
  const candidates = [doc.salable, doc.saleable, doc.instock, doc.in_stock, doc.available];
  if (candidates.every(v => v === undefined || v === null)) return true;
  return candidates.some(v => v === true || v === 1 || v === "1" || v === "true" || v === "yes");
}

function transformAPIResponse(data) {
  const docs = data?.data?.products?.documents || data?.documents || data?.products || [];
  const result = [];
  const seen = new Set();
  const dropped = { notEnergy: 0, noStock: 0, dup: 0, noClass: 0 };

  for (const doc of docs) {
    if (!isEnergyDoc(doc)) { dropped.notEnergy++; continue; }
    if (!isInStock(doc)) { dropped.noStock++; continue; }

    const pNum = doc.productnumber || doc.product_number || doc.id || doc.itemnumber;
    if (pNum && seen.has(pNum)) { dropped.dup++; continue; }

    const name = doc.commercialname || doc.itemname || doc.name || "";
    const brand = doc.brand || doc.brand_name || doc.brandname || doc.manufacturer || "";
    const fullName = brand ? `${brand} ${name}`.trim() : name;
    const type = classifyProduct(name) || classifyProduct(fullName);
    if (!type) { dropped.noClass++; continue; }

    let displayName = fullName;
    if (type === "bicarb" && /maurten/i.test(brand)) {
      displayName = "Maurten Bicarb System";
    }

    // Bygg produkt-URL till loplabbet.se. Olika produkter i feeden har URL:n
    // i olika format:
    //   - Vissa har full URL i doc.url (t.ex. "https://www.loplabbet.se/...")
    //   - Vissa har relativ path i doc.url (t.ex. "/tillbehor/...")
    //   - Vissa har bara "<pNum>/<colorid>" i doc.itemurl (t.ex. "1615099/01")
    //   - Vissa saknar URL-fält helt
    // Vi normaliserar allt till en absolut URL på loplabbet.se.
    const LL_BASE = "https://www.loplabbet.se";
    let url;
    const rawUrl = doc.url || doc.itemurl || "";
    if (typeof rawUrl === "string" && rawUrl.startsWith("http")) {
      // Redan absolut — använd som är (men säkra att den pekar på loplabbet.se,
      // inte intersport.se eller annan domän)
      url = rawUrl.includes("loplabbet.se") ? rawUrl : rawUrl.replace(/^https?:\/\/[^/]+/, LL_BASE);
    } else if (typeof rawUrl === "string" && rawUrl.startsWith("/")) {
      // Relativ path med inledande slash — prefixa med domän
      url = LL_BASE + rawUrl;
    } else if (typeof rawUrl === "string" && /^\d+\/\d+$/.test(rawUrl)) {
      // Format "<pNum>/<colorid>" från doc.itemurl — bygg products-URL
      url = `${LL_BASE}/products/${rawUrl}`;
    } else if (pNum) {
      // Sista fallback: bygg från produktnummer
      url = `${LL_BASE}/products/${pNum}/01`;
    } else {
      url = LL_BASE;
    }
    
    // CDN-bilder. Intersport-API:et returnerar `itemimages` som en array
    // av filnamn (t.ex. ["116529701000_00.jpg", "116529701000_10.jpg"]) —
    // suffix _00, _10, _101 m.m. varierar mellan produkter, så det är
    // viktigt att vi läser FAKTISKT filnamn istället för att gissa.
    let imgFile = "";
    if (Array.isArray(doc.itemimages) && doc.itemimages.length) {
      imgFile = doc.itemimages[0];  // första bilden = primär produktbild
    } else if (Array.isArray(doc.images) && doc.images.length) {
      // Fallback: 'images'-arrayen har {image: "filnamn", url: "/productimages/"}
      const first = doc.images[0];
      imgFile = (first && (first.image || first.name)) || "";
      // Säkerställ .jpg-suffix
      if (imgFile && !/\.\w+$/.test(imgFile)) imgFile += ".jpg";
    }
    
    let img;
    if (imgFile) {
      img = `https://cdn.intersport.se/productimages/690x600/${imgFile}`;
    } else if (pNum) {
      // Sista nödfallback om bildfält saknas helt - gissa default _10
      const pStr = String(pNum);
      const cdnId = pStr.length >= 12 ? pStr : `${pStr}01000`;
      img = `https://cdn.intersport.se/productimages/690x600/${cdnId}_10.jpg`;
    } else {
      img = "";
    }

    seen.add(pNum);
    result.push({
      id: pNum || displayName,
      brand: brand || "Övrigt",
      name: displayName,
      type,
      carbs: PRODUCT_TYPES[type].typical_carbs || null,
      caf: PRODUCT_TYPES[type].typical_caf || null,
      dose: "",
      price: doc.price || doc.salesprice || null,
      url,
      img,
      inStock: true,
    });
  }

  return { products: result, dropped };
}

// ─── HUVUDFLÖDET ────────────────────────────────────────────────────────────

async function main() {
  console.log(`Hämtar ${API_URL}…`);
  const res = await fetch(API_URL, { headers: { "User-Agent": "Loplabbet-Energikalkylator/1.0" } });
  if (!res.ok) {
    console.error(`API-fel: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const data = await res.json();
  const { products, dropped } = transformAPIResponse(data);

  if (products.length < 10) {
    console.error(`För få produkter (${products.length}) — något kan vara fel med API:et eller filtreringen.`);
    console.error("Avbryter för säkerhets skull, så vi inte skriver över en bra produkter.json med en trasig.");
    console.error("Dropped:", dropped);
    process.exit(1);
  }

  // Sortera deterministiskt så diff:en i Git blir hanterbar
  products.sort((a, b) => {
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });

  const output = {
    updated: new Date().toISOString().replace(/T/, " ").replace(/\..+/, "Z"),
    source: API_URL,
    count: products.length,
    products,
  };

  // Kolla om något faktiskt ändrats sedan förra körningen
  if (existsSync(OUTPUT_FILE)) {
    const prev = JSON.parse(readFileSync(OUTPUT_FILE, "utf8"));
    const prevHash = JSON.stringify(prev.products);
    const newHash = JSON.stringify(output.products);
    if (prevHash === newHash) {
      console.log(`Inga produktändringar (${products.length} produkter, samma som förra körningen).`);
      console.log("Skriver inte över filen.");
      return;
    }
    console.log(`Förändringar upptäckta. Tidigare: ${prev.count} produkter, nu: ${products.length}.`);
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + "\n");
  console.log(`Sparade ${OUTPUT_FILE} med ${products.length} produkter.`);
  console.log("Filtreringsstatistik:", dropped);
}

main().catch(e => {
  console.error("Oväntat fel:", e);
  process.exit(1);
});
