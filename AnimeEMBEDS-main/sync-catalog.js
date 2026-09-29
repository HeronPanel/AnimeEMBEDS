#!/usr/bin/env node
"use strict";
// Usage:
//   npm run sync                      -> fetch ALL anime, write data/catalog.json
//   node sync-catalog.js --soft --public   (used by Vercel build)
//     --soft   : never fail the build if the API is down (keeps the old catalog)
//     --public : also write public/catalog.json + public/sync-meta.json (static files served by Vercel)

const fs = require("fs");
const path = require("path");
const { syncToDisk, readJSON } = require("./lib/catalogSync");

const args = process.argv.slice(2);
const soft = args.includes("--soft");
const toPublic = args.includes("--public");
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

(async () => {
  console.log("Fetching all anime from the API...");
  const { catalog, ...r } = await syncToDisk(DATA_DIR);

  if (r.ok) {
    console.log("Sync OK");
    console.log(`  API entries : ${r.liveEntries}`);
    console.log(`  added       : ${r.added}`);
    console.log(`  updated     : ${r.updated}`);
    if (r.skippedEmpty) console.log(`  skipped     : ${r.skippedEmpty} (seasons with 0 episodes)`);
    console.log(`  catalog.json: ${r.counts.entries} entries, ${r.counts.episodes} episodes`);
  } else {
    console.error("Sync FAILED:", r.error);
    if (soft) console.error("--soft: continuing with the existing data/catalog.json");
  }

  if (toPublic) {
    const cat = catalog || readJSON(path.join(DATA_DIR, "catalog.json"), { anime: [], counts: {} });
    const meta = readJSON(path.join(DATA_DIR, "sync-meta.json"), { lastSync: null });
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    fs.writeFileSync(path.join(PUBLIC_DIR, "catalog.json"), JSON.stringify(cat));
    fs.writeFileSync(path.join(PUBLIC_DIR, "sync-meta.json"), JSON.stringify(meta));
    console.log(`public/catalog.json written (${cat.anime.length} entries)`);
  }

  if (!r.ok && !soft) process.exit(1);
})();
