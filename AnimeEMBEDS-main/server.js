const express = require("express");
const path = require("path");
const { API_URL, syncToDisk, readJSON } = require("./lib/catalogSync");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const META_FILE = path.join(DATA_DIR, "sync-meta.json");
const SYNC_EVERY_MS = 15 * 60 * 1000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));

// Catalog is kept in memory and refreshed after every successful sync.
let catalogCache = readJSON(CATALOG_FILE, { anime: [], counts: {} });
let syncBusy = false;

async function syncNow() {
  if (syncBusy) return { ok: false, busy: true };
  syncBusy = true;
  try {
    const { catalog, ...meta } = await syncToDisk(DATA_DIR);
    if (catalog) catalogCache = catalog;
    if (meta.ok) {
      console.log(`[sync] OK  entries=${meta.total} added=${meta.added} updated=${meta.updated}`);
    } else {
      console.warn(`[sync] FAILED: ${meta.error}`);
    }
    return meta;
  } finally {
    syncBusy = false;
  }
}

app.get("/api/catalog", (req, res) => {
  res.json(catalogCache);
});

app.get("/api/sync-status", (req, res) => {
  res.json(readJSON(META_FILE, { lastSync: null, sourceApi: API_URL }));
});

app.all("/api/sync", async (req, res) => {
  res.json(await syncNow());
});

// Sync on start + every 15 minutes. The local catalog stays available even if the API is down.
syncNow();
setInterval(syncNow, SYNC_EVERY_MS);

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ANIME EMBED running at http://0.0.0.0:${PORT}`);
});
