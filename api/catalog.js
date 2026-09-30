// Vercel serverless function: /api/catalog
// Fetches the live API (cached at the edge) and merges it with the committed
// data/catalog.json, so new anime/episodes appear without a redeploy.
const { API_URL, parseApi, fetchLiveText, mergeCatalog } = require("../lib/sync");
const seed = require("../data/catalog.json");

module.exports = async (req, res) => {
  const action = new URL(req.url, "http://localhost").searchParams.get("action");
  let catalog = seed;
  let sync;

  try {
    const parsed = parseApi(await fetchLiveText());
    const merged = mergeCatalog(seed, parsed);
    catalog = merged.catalog;
    sync = { ok: true, lastSync: new Date().toISOString(), sourceApi: API_URL, ...merged.stats };
  } catch (err) {
    sync = { ok: false, lastSync: null, sourceApi: API_URL, error: err.message };
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.statusCode = 200;
  res.end(JSON.stringify(action === "status" ? sync : { ...catalog, sync }));
};
