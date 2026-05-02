# Energikalkylator

Personlig nutritionskalkylator för löpning från 5K till ultra. Bäddas in på
loplabbet.se via ett HTML-block i EpiServer.

## Filer

```
.
├── energikalkylator.html              ← själva kalkylatorn
├── produkter.json                     ← produktkatalog (uppdateras av Actions)
├── update-products.mjs                ← script som hämtar Intersport-API:et
├── episerver-html-block.html          ← klistras in i EpiServer
└── .github/workflows/update-products.yml
```

## Hur produktdatan fungerar

`produkter.json` är en snapshot av Löplabbets energiprodukter, hämtad från
Intersport-API:et och filtrerad genom samma logik som finns i
`energikalkylator.html`. Filen uppdateras automatiskt **varje måndagsmorgon
kl 07:00** av en GitHub Action.

Fördelarna med snapshot framför live-API:
- Sidan laddar direkt (inget API-anrop när användaren klickar)
- Garanterat samma produkter idag som imorgon (ingen risk för plötsliga
  förändringar i feeden mitt under en kampanj)
- Versionerad historik i Git så vi ser vilka produkter som tillkommit/försvunnit
- Om Intersport-API:et går ner på en söndag märker vi det måndag morgon
  istället för live på sajten

## Manuell körning

Behöver du uppdatera direkt (t.ex. när en ny produkt precis lanserats)?

1. Gå till **Actions**-fliken i GitHub
2. Välj **Uppdatera energiprodukter** i listan
3. Klicka **Run workflow** → **Run workflow**

Eller lokalt:

```bash
node update-products.mjs
git add produkter.json
git commit -m "Manuell uppdatering"
git push
```

## Felsöka

**"För få produkter"** — om scriptet hittar färre än 10 produkter avbryter det
och behåller den gamla `produkter.json`. Det är medvetet skydd mot att skriva
över en bra fil med en trasig. Kolla logs i Actions-fliken för att se vad som
hänt.

**Ingen ny produkt syns trots att den lagts upp på sajten** — produkten kan
ha hamnat i `dropped.notEnergy` eller `dropped.noClass` om kategori/namn inte
matchar våra regex. Lägg till mönstret i både `update-products.mjs` och
`energikalkylator.html` (sektionen `PRODUCT_TYPES`).

**Specialfall för en specifik produkt** — t.ex. att Maurten Bicarb ska peka
på landningssidan istället för produktsidan. Se `URL_OVERRIDES` i
`energikalkylator.html`.

**Slå på debug-loggning** — sätt `const DEBUG_API = true;` i
`energikalkylator.html` så loggar konsolen hur många produkter som laddats
och när snapshoten är från.

## EpiServer-integration

Klistra in innehållet i `episerver-html-block.html` i ett HTML-block på
sidan där kalkylatorn ska visas. Uppdatera `src`-URL:en till er GitHub Pages-URL.
