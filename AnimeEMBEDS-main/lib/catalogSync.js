"use strict";
/**
 * Shared sync logic (used by server.js, sync-catalog.js and the Netlify function).
 *
 *  - fetches https://blakiteapi.xyz/api/getAllAnime.php
 *  - converts EVERY movie / series / drama (every season) into catalog entries
 *  - merges them into the existing catalog.json:
 *        * existing entries keep their id + episode URLs (metadata gets refreshed)
 *        * missing entries are ADDED (with full episode list)
 *        * custom entries that are not in the API (e.g. Bandbudh, embedType "video") are never touched
 */

const fs = require("fs");
const path = require("path");

const API_URL = process.env.ANIME_API_URL || "https://blakiteapi.xyz/api/getAllAnime.php";
const EMBED_BASE = "https://blakiteapi.xyz/embed";
const DOWNLOAD_BASE = "https://blakiteapi.xyz/download";
const WATCH_BASE = process.env.WATCH_BASE || "https://www.blakiteanime.buzz/2026/09/streaming.html";
const MAX_EPISODES = 5000; // safety cap per season

/* ---------------------------------- helpers --------------------------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isObj(v) {
  return v && typeof v === "object";
}

function strings(list) {
  return (Array.isArray(list) ? list : []).map(x => String(x).trim()).filter(Boolean);
}

function uniq(list) {
  return [...new Set(list)];
}

function isEmpty(v) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function pick(next, prev) {
  return isEmpty(next) ? prev : next;
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/* ------------------------------- fetch from API ------------------------------ */

async function fetchLive({ timeoutMs = 60000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(API_URL, {
        signal: controller.signal,
        headers: { "User-Agent": "ANIME-EMBED/3.0", Accept: "application/json" }
      });
      if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
      const json = await res.json();
      if (!isObj(json)) throw new Error("API returned invalid JSON");
      if (json.success === false) throw new Error(json.message || "API reported failure");
      return json;
    } catch (err) {
      lastErr = err.name === "AbortError" ? new Error(`API timeout after ${timeoutMs}ms`) : err;
      if (attempt < retries) await sleep(1500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ------------------------------- normalisation ------------------------------- */

function mapLanguage(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s === "org" || s === "original") return { language: "Hindi", type: "ORG" };
  if (s.includes("fan")) return { language: "FanDub", type: "DUB" };
  const language = s.includes("english") ? "English" : s.includes("hindi") ? "Hindi" : String(raw).trim();
  const type = s.includes("sub") ? "SUB" : s.includes("dub") ? "DUB" : "ORG";
  return { language, type };
}

function categoryOf(groupKey, item) {
  const t = String(item.type || "").toLowerCase();
  if (t === "movie") return "movie";
  if (t === "drama") return "drama";
  const g = String(groupKey).toLowerCase();
  if (g.includes("movie")) return "movie";
  if (g.includes("drama")) return "drama";
  return "series";
}

function makeEpisode(category, id, season, n) {
  const enc = encodeURIComponent(id);
  if (category === "movie") {
    return {
      number: 1,
      watchUrl: `${WATCH_BASE}?type=Movie&id=${enc}&episode=1`,
      embedUrl: `${EMBED_BASE}/${enc}`,
      downloadUrl: `${DOWNLOAD_BASE}/${enc}`
    };
  }
  const kind = category === "drama" ? "Drama" : "Series";
  return {
    number: n,
    watchUrl: `${WATCH_BASE}?type=${kind}&id=${enc}&s=${season}&episode=${n}`,
    embedUrl: `${EMBED_BASE}/${enc}/${season}-${n}`,
    downloadUrl: `${DOWNLOAD_BASE}/${enc}/${season}-${n}`
  };
}

function seasonList(seasons) {
  if (Array.isArray(seasons)) return seasons.map((s, i) => [String(isObj(s) && s.seasonNumber != null ? s.seasonNumber : i + 1), s]);
  if (isObj(seasons)) return Object.entries(seasons);
  return [];
}

function buildEntry(item, tmdbId, category, seasonNumber, episodeCount, seasonStatus) {
  const tmdb = item.TMDB_DATA || {};
  const images = item.IMAGES || {};
  const genres = uniq(strings(tmdb.genres));
  const keywords = strings(tmdb.keywords);
  const { language, type } = mapLanguage(item.language);
  const isMovie = category === "movie";

  let title = String(item.title || "Untitled").trim();
  if (!isMovie && !new RegExp(`season\\s+${seasonNumber}$`, "i").test(title)) title += ` Season ${seasonNumber}`;

  let status = seasonStatus || item.status || (isMovie ? "Completed" : "Ongoing");
  if (String(status).toLowerCase() === "released") status = "Completed";

  const year = tmdb.releaseDate ? Number(String(tmdb.releaseDate).slice(0, 4)) : null;
  const count = isMovie ? 1 : Math.min(Math.max(0, Number(episodeCount) || 0), MAX_EPISODES);
  const episodes = [];
  for (let n = 1; n <= count; n++) episodes.push(makeEpisode(category, tmdbId, seasonNumber, n));

  return {
    sourceId: tmdbId,
    tmdbId,
    title,
    category,
    seasonNumber: isMovie ? null : seasonNumber,
    label: title.charAt(0).toUpperCase(),
    posterUrl: images.poster || "",
    backdropUrl: images.backdrop || "",
    trailerUrl: tmdb.trailer || "",
    tags: uniq([...genres, ...keywords]).slice(0, 30),
    genres,
    description: tmdb.synopsis || "",
    year: Number.isFinite(year) ? year : null,
    rating: tmdb.rating != null && tmdb.rating !== "" ? String(tmdb.rating) : "0.0",
    status,
    language,
    type,
    episodeCount: episodes.length,
    sourceUrl: episodes[0] ? episodes[0].watchUrl : "",
    embedType: "direct",
    episodes
  };
}

/** API json -> flat list of catalog entries (one per movie / per season). */
function normalizeLive(raw) {
  const data = isObj(raw?.data) ? raw.data : raw;
  const out = [];
  const stats = { skippedEmpty: 0 };
  if (!isObj(data)) return { entries: out, stats };

  for (const [groupKey, group] of Object.entries(data)) {
    if (!isObj(group)) continue;
    for (const [key, item] of Object.entries(group)) {
      if (!isObj(item) || !item.title) continue;

      const tmdbId = String(item.tmdbId ?? key).trim();
      if (!tmdbId) continue;
      const category = categoryOf(groupKey, item);

      if (category === "movie") {
        out.push(buildEntry(item, tmdbId, "movie", null, 1, item.status));
        continue;
      }

      for (const [sKey, season] of seasonList(item.seasons)) {
        const s = isObj(season) ? season : {};
        const seasonNumber = Number(s.seasonNumber ?? sKey) || 1;
        const total = Number(s.totalEpisodes ?? s.episodeCount ?? s.episodes ?? 0) || 0;
        out.push(buildEntry(item, tmdbId, category, seasonNumber, total, s.status));
      }
    }
  }
  return { entries: out, stats };
}

/* ---------------------------------- merging ---------------------------------- */

// TMDB movie and tv ids overlap, so movies and series/dramas get separate namespaces.
function entryKey(x) {
  const movie = x.category === "movie";
  const id = String(x.tmdbId ?? x.sourceId ?? "");
  const season = movie ? "" : String(Number(x.seasonNumber) || 1);
  return `${movie ? "m" : "t"}:${id}:${season}`;
}

function mergeEpisodes(old, live) {
  if (live.category === "movie") return old.episodes && old.episodes.length ? old.episodes : live.episodes;
  const byNum = new Map((old.episodes || []).map(e => [Number(e.number), e]));
  const maxOld = Math.max(0, ...byNum.keys());
  const max = Math.min(Math.max(maxOld, live.episodeCount), MAX_EPISODES);
  const out = [];
  for (let n = 1; n <= max; n++) {
    out.push(byNum.get(n) || live.episodes[n - 1] || makeEpisode(live.category, live.tmdbId, live.seasonNumber, n));
  }
  return out;
}

function countsOf(list) {
  return {
    entries: list.length,
    seriesSeasons: list.filter(x => x.category === "series").length,
    movies: list.filter(x => x.category === "movie").length,
    dramaSeasons: list.filter(x => x.category === "drama").length,
    episodes: list.reduce((n, x) => n + (Array.isArray(x.episodes) ? x.episodes.length : 0), 0)
  };
}

function mergeCatalog(current, liveEntries, extraStats = {}) {
  const old = (Array.isArray(current?.anime) ? current.anime : []).map(x => ({ ...x }));
  const index = new Map();
  for (const x of old) {
    const k = entryKey(x);
    if (!index.has(k)) index.set(k, x);
  }

  let nextId = old.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  const seen = new Set();
  let added = 0;
  let updated = 0;
  let skippedEmpty = extraStats.skippedEmpty || 0;

  for (const live of liveEntries) {
    const k = entryKey(live);
    if (seen.has(k)) continue; // duplicate inside the API response
    seen.add(k);

    const existing = index.get(k);

    if (existing) {
      if (existing.embedType === "video") continue; // custom hosted entry, leave untouched
      const episodes = mergeEpisodes(existing, live);
      Object.assign(existing, {
        title: live.title,
        label: live.label,
        posterUrl: pick(live.posterUrl, existing.posterUrl),
        backdropUrl: pick(live.backdropUrl, existing.backdropUrl),
        trailerUrl: pick(live.trailerUrl, existing.trailerUrl),
        tags: pick(live.tags, existing.tags),
        genres: pick(live.genres, existing.genres),
        description: pick(live.description, existing.description),
        year: pick(live.year, existing.year),
        rating: pick(live.rating, existing.rating),
        status: live.status,
        language: live.language,
        type: live.type,
        episodes,
        episodeCount: episodes.length,
        sourceUrl: episodes[0] ? episodes[0].watchUrl : existing.sourceUrl
      });
      updated++;
      continue;
    }

    if (live.category !== "movie" && live.episodeCount === 0) {
      skippedEmpty++; // nothing playable yet
      continue;
    }

    const entry = { id: nextId++, ...live }; // id first, like the existing catalog.json
    old.push(entry);
    index.set(k, entry);
    added++;
  }

  const catalog = {
    ...(current || {}),
    sourceApi: API_URL,
    description: "Complete public catalog with posters, metadata, tags, seasons, episodes, embeds, and download links. Auto-synced from the source API.",
    counts: countsOf(old),
    anime: old
  };
  if (!catalog.name) catalog.name = "ANIME EMBED Catalog";

  return { catalog, stats: { liveEntries: liveEntries.length, added, updated, skippedEmpty, total: old.length } };
}

/* --------------------------------- public API -------------------------------- */

/** fetch + normalise + merge (no disk access) */
async function syncCatalog(current, fetchOptions) {
  const raw = await fetchLive(fetchOptions);
  const { entries, stats } = normalizeLive(raw);
  if (!entries.length) throw new Error("API returned no anime entries - catalog left unchanged");
  return mergeCatalog(current, entries, stats);
}

/** full cycle for server / CLI: read catalog.json, sync, write catalog.json + sync-meta.json */
async function syncToDisk(dataDir) {
  const catalogFile = path.join(dataDir, "catalog.json");
  const metaFile = path.join(dataDir, "sync-meta.json");
  const prevMeta = readJSON(metaFile, {});
  const now = new Date().toISOString();

  try {
    const current = readJSON(catalogFile, { anime: [] });
    const { catalog, stats } = await syncCatalog(current);
    writeJSONAtomic(catalogFile, catalog);
    const meta = { lastSync: now, sourceApi: API_URL, ok: true, ...stats, counts: catalog.counts };
    writeJSONAtomic(metaFile, meta);
    return { ...meta, catalog };
  } catch (err) {
    const meta = { ...prevMeta, sourceApi: API_URL, ok: false, lastAttempt: now, error: err.message };
    try { writeJSONAtomic(metaFile, meta); } catch { /* read-only fs */ }
    return meta;
  }
}

module.exports = {
  API_URL,
  fetchLive,
  normalizeLive,
  mergeCatalog,
  syncCatalog,
  syncToDisk,
  readJSON,
  writeJSONAtomic,
  countsOf,
  entryKey
};
