# ToonFLIX

Self-updating anime catalog, ready for **Vercel** (GitHub → Import → Deploy).

## How auto-update works
1. **Live (instant):** `/api/catalog` (Vercel function) fetches
   `https://blakiteapi.xyz/api/getAllAnime.php`, merges it with `data/catalog.json`
   and returns the result. New anime / new episodes appear on the site automatically
   (cached ~10 min at the edge; the browser refreshes every 5 min).
2. **Repo files (hourly):** GitHub Action `.github/workflows/sync-catalog.yml` runs
   `scripts/sync.js`, which rewrites `data/getAllAnime.php` (raw API snapshot) and
   `data/catalog.json` and commits them. That commit makes Vercel redeploy automatically.
   Run it manually from GitHub → Actions → "Sync anime catalog" → Run workflow.

Nothing is ever deleted from `data/catalog.json`; the sync only refreshes metadata,
adds missing episodes (`embed/<id>/<season>-<ep>`) and adds brand-new anime/seasons.

## Deploy
1. Push this folder to a GitHub repo.
2. vercel.com → Add New Project → import the repo → Deploy (no settings needed).
3. GitHub repo → Settings → Actions → General → Workflow permissions → **Read and write** (if push fails).

## Local run (bina Vercel ke)
`npm start` -> http://localhost:3000 (public/ + same /api/catalog function)

## Manual sync
`npm run sync` (Node 18+)

## Frontend files
- `public/index.html` - layout
- `public/style.css` - purple/white theme (poster fit fix included)
- `public/app.js` - catalog load + 5 min auto-refresh, hero, trending, A-Z, filters, search, player, seasons, share, cinema mode
