const seed = require("../../data/catalog.json");
const { API_URL, syncCatalog } = require("../../lib/catalogSync");

// Netlify's filesystem is read-only, so the function merges the live API into the
// bundled data/catalog.json in memory. Warm instances reuse the result for 15 minutes.
const TTL_MS = 15 * 60 * 1000;
let cache = { at: 0, result: null };

async function getCatalog() {
  if (cache.result && Date.now() - cache.at < TTL_MS) return cache.result;

  try {
    // Netlify functions time out after ~10s, so fail fast and fall back to the bundled catalog.
    const { catalog, stats } = await syncCatalog(seed, { timeoutMs: 8000, retries: 1 });
    cache = {
      at: Date.now(),
      result: {
        catalog,
        sync: { lastSync: new Date().toISOString(), sourceApi: API_URL, ok: true, ...stats }
      }
    };
    return cache.result;
  } catch (error) {
    if (cache.result) {
      return { catalog: cache.result.catalog, sync: { ...cache.result.sync, ok: false, error: error.message } };
    }
    return {
      catalog: seed,
      sync: { lastSync: null, sourceApi: API_URL, ok: false, error: error.message }
    };
  }
}

exports.handler = async event => {
  const action =
    event?.queryStringParameters?.action || (event?.path || "").split("/").pop();

  const result = await getCatalog();

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=3600",
    "Access-Control-Allow-Origin": "*"
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(action === "status" ? result.sync : result.catalog)
  };
};
