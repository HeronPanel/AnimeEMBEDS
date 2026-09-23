const seed = require("../../data/catalog.json");

const API_URL = "https://blakiteapi.xyz/api/getAllAnime.php";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function normalizeLive(raw) {
  const data = raw?.data || raw || {};
  const groups = [
    ["movies", data.movies],
    ["series", data.series],
    ["dramas", data.dramas]
  ];
  const out = [];

  for (const [group, obj] of groups) {
    for (const item of asArray(obj)) {
      const tmdbId = String(
        item?.originalTmdbId || item?.tmdbId || item?.sourceId || ""
      );
      if (!tmdbId) continue;

      const tmdb = item.TMDB_DATA || {};
      const images = item.IMAGES || {};

      out.push({
        sourceId: tmdbId,
        tmdbId,
        title: item.title || "Untitled",
        category:
          group === "movies"
            ? "movie"
            : group === "dramas"
              ? "drama"
              : "series",
        posterUrl: images.poster || "",
        backdropUrl: images.backdrop || "",
        tags: Array.isArray(tmdb.keywords) ? tmdb.keywords : [],
        genres: Array.isArray(tmdb.genres) ? tmdb.genres : [],
        description: tmdb.synopsis || "",
        year: tmdb.releaseDate
          ? Number(String(tmdb.releaseDate).slice(0, 4))
          : null,
        rating: tmdb.rating ?? "0.0",
        status: item.status || "Unknown",
        language: item.language || "",
        type: item.type || ""
      });
    }
  }

  return out;
}

function mergeCatalog(seedCatalog, live) {
  const oldEntries = Array.isArray(seedCatalog?.anime)
    ? seedCatalog.anime.map(x => ({ ...x }))
    : [];

  const byId = new Map();

  for (const old of oldEntries) {
    const id = String(old.tmdbId || old.sourceId || old.id || "");
    if (id) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(old);
    }
  }

  for (const item of live) {
    const matches = byId.get(String(item.tmdbId || item.sourceId)) || [];

    if (matches.length) {
      for (const old of matches) {
        Object.assign(old, {
          title: item.title || old.title,
          posterUrl: item.posterUrl || old.posterUrl,
          backdropUrl: item.backdropUrl || old.backdropUrl,
          tags: item.tags?.length ? item.tags : old.tags,
          genres: item.genres?.length ? item.genres : old.genres,
          description: item.description || old.description,
          year: item.year || old.year,
          rating: item.rating ?? old.rating,
          status: item.status || old.status,
          language: item.language || old.language,
          type: item.type || old.type
        });
      }
    } else {
      // New API-only entries are added automatically. They can show metadata
      // immediately; episode buttons appear when an authorized/source embed
      // exists in the supplied catalog.
      oldEntries.push({
        id: `api-${item.tmdbId}`,
        sourceId: item.sourceId,
        tmdbId: item.tmdbId,
        title: item.title,
        category: item.category,
        seasonNumber: null,
        label: item.category === "movie" ? "Movie" : item.category,
        posterUrl: item.posterUrl,
        backdropUrl: item.backdropUrl,
        tags: item.tags,
        genres: item.genres,
        description: item.description,
        year: item.year,
        rating: item.rating,
        status: item.status,
        language: item.language,
        type: item.type,
        episodeCount: 0,
        sourceUrl: "",
        embedType: "",
        episodes: []
      });
    }
  }

  return {
    ...(seedCatalog || {}),
    name: "ANIME EMBED Catalog",
    sourceApi: API_URL,
    description:
      "Catalog seeded from embeds.txt and refreshed from the configured public API.",
    anime: oldEntries,
    counts: {
      entries: oldEntries.length,
      seriesSeasons: oldEntries.filter(x => x.category === "series").length,
      movies: oldEntries.filter(x => x.category === "movie").length,
      dramaSeasons: oldEntries.filter(x => x.category === "drama").length,
      episodes: oldEntries.reduce(
        (n, x) => n + (Array.isArray(x.episodes) ? x.episodes.length : 0),
        0
      )
    }
  };
}

async function getCatalog() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ANIME-EMBED/2.0 Netlify"
      }
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const live = normalizeLive(await response.json());
    return {
      catalog: mergeCatalog(seed, live),
      sync: {
        lastSync: new Date().toISOString(),
        sourceApi: API_URL,
        liveItems: live.length,
        ok: true
      }
    };
  } catch (error) {
    return {
      catalog: seed,
      sync: {
        lastSync: null,
        sourceApi: API_URL,
        liveItems: 0,
        ok: false,
        error: error.message
      }
    };
  }
}

exports.handler = async (event) => {
  const action =
    event?.queryStringParameters?.action ||
    (event?.path || "").split("/").pop();

  const result = await getCatalog();

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control":
      "public, max-age=60, s-maxage=900, stale-while-revalidate=3600",
    "Access-Control-Allow-Origin": "*"
  };

  if (action === "status") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result.sync)
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(result.catalog)
  };
};
