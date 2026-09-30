// Run by GitHub Actions (or manually: `npm run sync`).
// Downloads the live API, then updates data/getAllAnime.php (raw snapshot),
// data/catalog.json (merged catalog) and data/sync-meta.json - only when
// something actually changed. Committing those files triggers a Vercel deploy.
//   node scripts/sync.js                 -> fetch from the API
//   node scripts/sync.js --file x.php    -> use a local file (offline test)
const fs = require("fs");
const path = require("path");
const { API_URL, parseApi, fetchLiveText, mergeCatalog } = require("../lib/sync");

const DATA = path.join(__dirname, "..", "data");
const read = f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");

(async () => {
  const i = process.argv.indexOf("--file");
  const text = i > -1 ? fs.readFileSync(process.argv[i + 1], "utf8") : await fetchLiveText(30000);
  const parsed = parseApi(text);

  const catalogFile = path.join(DATA, "catalog.json");
  const oldCatalogText = read(catalogFile);
  const { catalog, stats } = mergeCatalog(JSON.parse(oldCatalogText), parsed);
  const newCatalogText = JSON.stringify(catalog);

  const snapFile = path.join(DATA, "getAllAnime.php");
  let changed = false;
  if (read(snapFile) !== text) { fs.writeFileSync(snapFile, text); changed = true; }
  if (oldCatalogText !== newCatalogText) { fs.writeFileSync(catalogFile, newCatalogText); changed = true; }
  if (changed) {
    fs.writeFileSync(
      path.join(DATA, "sync-meta.json"),
      JSON.stringify({ lastSync: new Date().toISOString(), sourceApi: API_URL, ...stats, ...catalog.counts }, null, 2)
    );
  }
  console.log(changed ? "Updated." : "No changes.", JSON.stringify(stats));
})().catch(e => { console.error("Sync failed:", e.message); process.exit(1); });
