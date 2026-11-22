// Auditoria do cadastro: sorteia páginas da API nacional (população abastecida e tratamento),
// pega os registros de Goiás que aparecerem e confere se estão em cadastro/*.json com os mesmos valores.
// Uso: node scripts/auditar-cadastro.mjs [paginas=25]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://apidadosabertos.saude.gov.br/sisagua";
const N = Number(process.argv[2] || 25);
const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();
const num = (v) => v == null || v === "" ? "" : String(Number(String(v).replace(",", ".")));

const conjuntos = [
  { conj: "populacao-abastecida", arq: "populacao-go.json", total: 1680,
    api: (r) => [r.ano_de_referencia, String(r.codigo_ibge).slice(0, 6), r.codigo_forma_de_abastecimento, num(r.populacao_estimada), num(r.numero_de_economias_residenciais_domicilios_permanentes)].map(norm).join("|"),
    site: (r) => [r.ano, r.ibge, r.forma, num(r.pop), num(r.economias)].map(norm).join("|") },
  { conj: "tratamento-de-agua", arq: "tratamento-go.json", total: 868,
    api: (r) => [r.ano_de_referencia, String(r.codigo_ibge).slice(0, 6), r.codigo_forma_de_abastecimento, norm(r.nome_da_eta), num(r.vazao_de_agua_tratada)].map(norm).join("|"),
    site: (r) => [r.ano, r.ibge, r.forma, norm(r.eta), num(r.vazao_tratada)].map(norm).join("|") },
];
for (const c of conjuntos) {
  const site = new Set(JSON.parse(await readFile(path.join(raiz, "cadastro", c.arq), "utf8")).map(c.site));
  let lidos = 0, go = 0, achados = 0; const faltando = [];
  for (let i = 0; i < N; i++) {
    const n = Math.floor(Math.random() * c.total);
    let lista = [];
    try { const r = await fetch(`${API}/${c.conj}?limit=1000&offset=${n}`, { signal: AbortSignal.timeout(120000) }); if (r.ok) lista = Object.values(await r.json()).find(Array.isArray) || []; } catch {}
    lidos += lista.length;
    for (const r of lista.filter((x) => x.uf === "GO")) { go++; if (site.has(c.api(r))) achados++; else if (faltando.length < 5) faltando.push(c.api(r)); }
  }
  console.log(`${c.conj}: ${lidos} registros sorteados na API, ${go} de Goiás, ${achados} encontrados no site com os mesmos valores${go - achados ? `, ${go - achados} NÃO encontrados (ex.: ${faltando.join(" ; ")})` : ""}`);
}
