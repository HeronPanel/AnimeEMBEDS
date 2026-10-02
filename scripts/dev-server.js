// Local server (no Vercel needed):  npm start  ->  http://localhost:3000
// Serves /public and the same /api/catalog function that Vercel runs.
const http = require("http");
const fs = require("fs");
const path = require("path");
const catalog = require("../api/catalog.js");

const PUBLIC = path.join(__dirname, "..", "public");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/catalog" || url.pathname === "/api/sync-status" || url.pathname === "/api/sync") {
    if (url.pathname !== "/api/catalog") req.url = "/api/catalog?action=status";
    return catalog(req, res);
  }
  let file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; return res.end("Not found");
  }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("animelHUB running on http://localhost:" + PORT));
