// Gera site/index.html a partir do painel do PC (../sisagua-dashboard/painel.html), ligando o modo site
// (dados em site/dados/) e trocando o nome para "Água em Goiás". Uso: node scripts/montar-site.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let s = await readFile(path.join(raiz, "..", "sisagua-dashboard", "painel.html"), "utf8");
const troca = (a, b) => { if (!s.includes(a)) throw new Error("trecho não encontrado no painel: " + a.slice(0, 60)); s = s.split(a).join(b); };
troca("<title>Painel SISAGUA</title>", "<title>Água em Goiás · SISAGUA</title>\n<meta name=\"description\" content=\"Qualidade da água para consumo humano nos municípios de Goiás, com dados abertos do SISAGUA (Ministério da Saúde), atualizados toda semana.\">");
troca('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>\n<script>window.SISAGUA_SITE = { base: "dados/", estado: "Goiás" };</script>');
troca("<div><b>Painel SISAGUA</b><small>Qualidade da água para consumo humano</small></div>", "<div><b>Água em Goiás</b><small>Qualidade da água · dados abertos do SISAGUA</small></div>");
troca('<button class="icone-btn" id="b-atualizar"', '<button class="icone-btn" id="b-atualizar" hidden');
troca("· Painel SISAGUA`", "· Água em Goiás`");
await writeFile(path.join(raiz, "site", "index.html"), s);
console.log("site/index.html gerado,", s.length, "caracteres");
