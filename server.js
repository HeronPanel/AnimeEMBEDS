const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_URL = "https://blakiteapi.xyz/api/getAllAnime.php";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const META_FILE = path.join(DATA_DIR, "sync-meta.json");

app.use(express.json({limit: "2mb"}));
app.use(express.static(path.join(ROOT, "public")));

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function saveJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

// Convert the live API's metadata shape into the catalog shape used by the UI.
// Existing episode embed URLs from embeds.txt are deliberately preserved.
function normalizeLive(raw) {
  const data = raw?.data || raw;
  const groups = [
    ["movies", data?.movies],
    ["series", data?.series],
    ["dramas", data?.dramas]
  ];
  const out = [];

  for (const [group, obj] of groups) {
    for (const item of asArray(obj)) {
      const tmdbId = String(item?.originalTmdbId || item?.tmdbId || item?.sourceId || "");
      if (!tmdbId) continue;
      const tmdb = item.TMDB_DATA || {};
      const images = item.IMAGES || {};
      const seasons = item.seasons || {};
      out.push({
        sourceId: tmdbId,
        tmdbId,
        title: item.title || "Untitled",
        category: group === "movies" ? "movie" : (group === "dramas" ? "drama" : "series"),
        posterUrl: images.poster || "",
        backdropUrl: images.backdrop || "",
        tags: Array.isArray(tmdb.keywords) ? tmdb.keywords : [],
        genres: Array.isArray(tmdb.genres) ? tmdb.genres : [],
        description: tmdb.synopsis || "",
        year: tmdb.releaseDate ? Number(String(tmdb.releaseDate).slice(0,4)) : null,
        rating: tmdb.rating ?? "0.0",
        status: item.status || "Unknown",
        language: item.language || "",
        type: item.type || "",
        seasons
      });
    }
  }
  return out;
}

function mergeCatalog(seed, live) {
  const oldEntries = Array.isArray(seed?.anime) ? seed.anime : [];
  const byKey = new Map();

  for (const x of oldEntries) {
    const key = `${String(x.tmdbId || x.sourceId || x.id)}::${String(x.seasonNumber ?? "")}`;
    byKey.set(key, x);
  }

  // Update metadata without throwing away the user's supplied episode embeds.
  for (const x of live) {
    const matching = oldEntries.filter(y =>
      String(y.tmdbId || y.sourceId || "") === String(x.tmdbId || x.sourceId || "")
    );

    if (matching.length) {
      for (const old of matching) {
        Object.assign(old, {
          title: x.title || old.title,
          posterUrl: x.posterUrl || old.posterUrl,
          backdropUrl: x.backdropUrl || old.backdropUrl,
          tags: x.tags?.length ? x.tags : old.tags,
          genres: x.genres?.length ? x.genres : old.genres,
          description: x.description || old.description,
          year: x.year || old.year,
          rating: x.rating ?? old.rating,
          status: x.status || old.status,
          language: x.language || old.language
        });
      }
    }
  }

  return {
    ...(seed || {}),
    name: "ANIME EMBED Catalog",
    sourceApi: API_URL,
    description: "Catalog seeded from embeds.txt and refreshed from the configured public API.",
    anime: oldEntries,
    counts: {
      entries: oldEntries.length,
      seriesSeasons: oldEntries.filter(x => x.category === "series").length,
      movies: oldEntries.filter(x => x.category === "movie").length,
      dramaSeasons: oldEntries.filter(x => x.category === "drama").length,
      episodes: oldEntries.reduce((n, x) => n + (Array.isArray(x.episodes) ? x.episodes.length : 0), 0)
    }
  };
}

let syncBusy = false;

async function syncNow() {
  if (syncBusy) return {ok:false, busy:true};
  syncBusy = true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(API_URL, {
      signal: controller.signal,
      headers: {"User-Agent": "ANIME-EMBED/1.0"}
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    const json = await res.json();
    const live = normalizeLive(json);
    const current = readJSON(CATALOG_FILE, {anime:[]});
    const merged = mergeCatalog(current, live);
    saveJSON(CATALOG_FILE, merged);

    const meta = {lastSync: new Date().toISOString(), sourceApi: API_URL, liveItems: live.length, ok:true};
    saveJSON(META_FILE, meta);
    return meta;
  } catch (err) {
    const meta = {lastSync: new Date().toISOString(), sourceApi: API_URL, ok:false, error: err.message};
    saveJSON(META_FILE, meta);
    return meta;
  } finally {
    syncBusy = false;
  }
}

app.get("/api/catalog", (req,res) => {
  res.json(readJSON(CATALOG_FILE, {anime:[],counts:{}}));
});

app.get("/api/sync-status", (req,res) => {
  res.json(readJSON(META_FILE, {lastSync:null, sourceApi:API_URL}));
});

app.post("/api/sync", async (req,res) => {
  const result = await syncNow();
  res.json(result);
});

// Automatic refresh. The local catalog remains available even if the remote API is down.
syncNow();
setInterval(syncNow, 15 * 60 * 1000);

app.get(/.*/, (req,res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ANIME EMBED running at http://0.0.0.0:${PORT}`);
});
