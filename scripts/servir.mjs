// Servidor estático só para ver o site no PC antes de publicar. Uso: node scripts/servir.mjs (porta 5190)
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const tipos = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const arq = path.join(site, p.endsWith("/") ? p + "index.html" : p);
  if (!arq.startsWith(site)) { res.writeHead(403); return res.end(); }
  try { const c = await readFile(arq); res.writeHead(200, { "content-type": tipos[path.extname(arq)] || "application/octet-stream" }); res.end(c); }
  catch { res.writeHead(404); res.end("Não encontrado"); }
}).listen(Number(process.env.PORT || 5190), () => console.log("Site em http://localhost:" + (process.env.PORT || 5190)));
