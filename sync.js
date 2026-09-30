// Shared sync logic: used by the Vercel function (api/catalog.js) and by the
// GitHub Action script (scripts/sync.js).
const API_URL = "https://blakiteapi.xyz/api/getAllAnime.php";
const BASE = "https://blakiteapi.xyz";

function entriesOf(value) {
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function parseApi(text) {
  const raw = JSON.parse(String(text).replace(/^\uFEFF/, "").trim());
  const data = raw?.data || raw || {};
  const groups = {
    movies: entriesOf(data.movies),
    series: entriesOf(data.series),
    dramas: entriesOf(data.dramas)
  };
  const total = groups.movies.length + groups.series.length + groups.dramas.length;
  if (raw?.success === false || total === 0) {
    throw new Error("API response is empty or unsuccessful");
  }
  return { groups, total };
}

async function fetchLiveText(timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "ANIME-EMBED/3.0", Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const seasonKey = (id, cat, season) =>
  `${id}|${cat === "movie" ? "m" : "s" + (Number(season) || 1)}`;

function metaOf(item) {
  const t = item.TMDB_DATA || {};
  const im = item.IMAGES || {};
  return {
    posterUrl: im.poster || "",
    backdropUrl: im.backdrop || "",
    tags: Array.isArray(t.keywords) ? t.keywords : [],
    genres: Array.isArray(t.genres) ? t.genres : [],
    description: t.synopsis || "",
    year: t.releaseDate ? Number(String(t.releaseDate).slice(0, 4)) || null : null,
    rating: t.rating ?? ""
  };
}

function applyMeta(entry, m) {
  if (m.posterUrl) entry.posterUrl = m.posterUrl;
  if (m.backdropUrl) entry.backdropUrl = m.backdropUrl;
  if (m.tags.length) entry.tags = m.tags;
  if (m.genres.length) entry.genres = m.genres;
  if (m.description) entry.description = m.description;
  if (m.year) entry.year = m.year;
  if (m.rating !== "") entry.rating = m.rating;
}

function buildEpisode(id, season, n, isMovie) {
  const suffix = isMovie ? `${id}` : `${id}/${season}-${n}`;
  return {
    number: n,
    embedUrl: `${BASE}/embed/${suffix}`,
    downloadUrl: `${BASE}/download/${suffix}`
  };
}

// Add missing episodes 1..total, but only for entries hosted on the API's own
// embed host (custom-hosted entries from catalog.json are never touched).
function fillEpisodes(entry, total, id, season, stats) {
  const eps = Array.isArray(entry.episodes) ? entry.episodes.slice() : [];
  const ownHost = eps.every(e => String(e.embedUrl || "").startsWith(BASE + "/embed/"));
  if (ownHost && total > 0) {
    const have = new Set(eps.map(e => Number(e.number)));
    for (let n = 1; n <= total; n++) {
      if (!have.has(n)) {
        eps.push(buildEpisode(id, season, n, false));
        stats.addedEpisodes++;
      }
    }
    eps.sort((a, b) => Number(a.number) - Number(b.number));
    entry.episodes = eps;
  }
  entry.episodeCount = Math.max(
    Number(entry.episodeCount) || 0,
    Array.isArray(entry.episodes) ? entry.episodes.length : 0,
    total || 0
  );
}

function langOf(item) {
  const l = String(item.language || "");
  if (!l || l === "ORG") return { language: "Hindi", type: "ORG" };
  if (/fan/i.test(l)) return { language: "FanDub", type: "DUB" };
  if (/sub/i.test(l)) return { language: l.replace(/\s*subbed/i, "").trim() || "Hindi", type: "SUB" };
  if (/dub/i.test(l)) return { language: l.replace(/\s*dubbed/i, "").trim() || "Hindi", type: "DUB" };
  return { language: l, type: item.type || "" };
}

// seed = data/catalog.json, parsed = parseApi() result.
// Never deletes anything from the seed: it only refreshes metadata, adds new
// episodes and adds brand-new anime / seasons.
function mergeCatalog(seed, parsed) {
  const anime = (Array.isArray(seed?.anime) ? seed.anime : []).map(x => ({ ...x }));
  const stats = { liveItems: parsed.total, addedEntries: 0, addedEpisodes: 0 };
  const byKey = new Map();
  const byId = new Map();
  let nextId = 0;

  for (const e of anime) {
    const id = String(e.tmdbId || e.sourceId || "");
    byKey.set(seasonKey(id, e.category, e.seasonNumber), e);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(e);
    nextId = Math.max(nextId, Number(e.id) || 0);
  }

  const groupList = [
    ["movie", parsed.groups.movies],
    ["series", parsed.groups.series],
    ["drama", parsed.groups.dramas]
  ];

  for (const [category, list] of groupList) {
    for (const [key, item] of list) {
      if (!item) continue;
      const id = String(item.tmdbId || key || "");
      if (!id) continue;
      const meta = metaOf(item);

      for (const e of byId.get(id) || []) applyMeta(e, meta);

      const seasons =
        category === "movie"
          ? [{ seasonNumber: null, status: item.status, total: 1, createdAt: item.createdAt }]
          : entriesOf(item.seasons).map(([k, s]) => ({
              seasonNumber: Number(s.seasonNumber ?? k) || 1,
              status: s.status,
              total: Number(s.totalEpisodes ?? s.episodeCount ?? 0) || 0,
              createdAt: s.createdAt
            }));

      for (const s of seasons) {
        const k = seasonKey(id, category, s.seasonNumber);
        let entry = byKey.get(k);

        if (entry) {
          if (s.status) entry.status = s.status;
          if (category !== "movie") fillEpisodes(entry, s.total, id, s.seasonNumber, stats);
          continue;
        }

        if (s.total <= 0) continue; // nothing to play yet

        const title = String(item.title || "Untitled");
        entry = {
          id: ++nextId,
          sourceId: id,
          tmdbId: id,
          title: category === "movie" ? title : `${title} Season ${s.seasonNumber}`,
          category,
          seasonNumber: category === "movie" ? null : s.seasonNumber,
          label: title.charAt(0).toUpperCase(),
          ...meta,
          status: s.status || item.status || "Unknown",
          ...langOf(item),
          episodeCount: s.total,
          embedType: "direct",
          episodes: category === "movie" ? [buildEpisode(id, null, 1, true)] : []
        };
        if (s.createdAt) entry.addedAt = String(s.createdAt).replace(" ", "T") + "Z";
        if (category === "movie") stats.addedEpisodes++;
        else fillEpisodes(entry, s.total, id, s.seasonNumber, stats);

        anime.push(entry);
        byKey.set(k, entry);
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(entry);
        stats.addedEntries++;
      }
    }
  }

  const catalog = {
    ...(seed || {}),
    sourceApi: API_URL,
    anime,
    counts: {
      entries: anime.length,
      seriesSeasons: anime.filter(x => x.category === "series").length,
      movies: anime.filter(x => x.category === "movie").length,
      dramaSeasons: anime.filter(x => x.category === "drama").length,
      episodes: anime.reduce((n, x) => n + (Array.isArray(x.episodes) ? x.episodes.length : 0), 0)
    }
  };
  return { catalog, stats };
}

module.exports = { API_URL, parseApi, fetchLiveText, mergeCatalog };
