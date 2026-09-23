# ANIME EMBED

Netlify-ready anime catalog and embed player.

## Features

- Same ANIME EMBED UI and workflow.
- Uses the supplied `embeds.txt` / `data/catalog.json` as the seed catalog.
- Poster images, tags, genres, descriptions, ratings, status and language.
- Search by title, description, genre, tag, language and category.
- Series / Movie / Drama filters.
- Anime detail modal.
- Episode selector.
- Premium iframe embed player using explicit `embedUrl` values already present in the catalog.
- Live metadata sync from:
  `https://blakiteapi.xyz/api/getAllAnime.php`
- New metadata entries from the live API can appear automatically.
- Existing episode embeds from `embeds.txt` are preserved, and missing episode embeds are generated using the source pattern `https://blakiteapi.xyz/embed/{animeId}/{season}-{episode}`.
- Netlify Function avoids browser CORS problems.
- Local Node/Express mode is also included.
- No video files are re-hosted by this project.

## Local

Requires Node.js 18+.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

### Express 5 fix

The old `app.get("*", ...)` route has been replaced with an Express 5-compatible regex catch-all, so the:

```text
PathError: Missing parameter name at index 1: *
```

error is fixed.

## Netlify

### GitHub method

1. Upload this project to GitHub.
2. In Netlify, choose **Add new project → Import an existing project**.
3. Select the repository.
4. Build command: leave empty.
5. Publish directory:

```text
public
```

6. Deploy.

`netlify.toml` already configures the Functions directory and API redirects.

### Netlify CLI

```bash
npm install
npx netlify login
npx netlify deploy
```

For production:

```bash
npx netlify deploy --prod
```

## Automatic updating

On Netlify, the frontend calls `/api/catalog`.

That route is handled by:

```text
netlify/functions/catalog.js
```

The function fetches the configured public API on request and merges its current metadata with the local seed catalog.

Netlify/CDN caching is set to approximately 15 minutes, with stale-while-revalidate support.

Because serverless functions do not provide a permanent writable filesystem, the Netlify version does not try to save a refreshed JSON file on the server. This keeps the deployment reliable while still allowing the live catalog to refresh.

If the remote API is temporarily unavailable, the bundled seed catalog is returned.

## Important embed behavior

The player renders only explicit `embedUrl` values already supplied in the catalog.

The project does not download, upload, or re-host video files.

For newly discovered API-only titles, metadata can appear automatically, but an episode player requires an authorized/source-provided embed URL to exist.

## Project structure

```text
ANIME-EMBED/
├── data/
│   ├── catalog.json
│   └── sync-meta.json
├── netlify/
│   └── functions/
│       └── catalog.js
├── public/
│   └── index.html
├── embeds.txt
├── netlify.toml
├── package.json
├── server.js
└── README.md
```
