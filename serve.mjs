import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = 3456;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  let url = new URL(req.url, `http://localhost:${PORT}`);
  let path = url.pathname;
  // Redirect a bare directory path to its trailing-slash form (production
  // static-host semantics), then resolve directories to index.html.
  if (path !== "/" && !path.endsWith("/") && !extname(path)) {
    res.writeHead(301, { Location: path + "/" });
    res.end();
    return;
  }
  if (path.endsWith("/")) path += "index.html";
  let filePath = join(__dirname, path);
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  }
}).listen(PORT, () => console.log(`Serving on http://localhost:${PORT}`));
