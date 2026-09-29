const express = require("express");
const path = require("path");
const sync = require("./lib/catalog-sync");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SYNC_EVERY_MS = 15 * 60 * 1000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));

let syncBusy = false;

// API se saare anime laakar data/catalog.json mein save karta hai
async function syncNow() {
  if (syncBusy) return { ok: false, busy: true };
  syncBusy = true;
  try {
    const meta = await sync.syncToFile();
    if (meta.ok) console.log(`[sync] OK live=${meta.liveEntries} added=${meta.added} updated=${meta.updated} total=${meta.counts.entries} eps=${meta.counts.episodes}`);
    else console.error("[sync] FAILED:", meta.error);
    return meta;
  } finally {
    syncBusy = false;
  }
}

app.get("/api/catalog", (req, res) => {
  res.json(sync.readJSON(sync.CATALOG_FILE, { anime: [], counts: {} }));
});

app.get("/api/sync-status", (req, res) => {
  res.json(sync.readJSON(sync.META_FILE, { lastSync: null, sourceApi: sync.API_URL }));
});

app.all("/api/sync", async (req, res) => {
  res.json(await syncNow());
});

// Server start hote hi sync + har 15 min mein auto-refresh.
// API down ho toh purana catalog.json chalta rehta hai.
syncNow();
setInterval(syncNow, SYNC_EVERY_MS);

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ANIME EMBED running at http://0.0.0.0:${PORT}`);
});
