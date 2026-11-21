// Atualização semanal: baixa da API do SISAGUA os dados de todos os municípios de Goiás e grava
// site/dados/<ibge>.json (um por município) e site/dados/indice.json.
// Uso: node scripts/atualizar.mjs [ibge ...]   (sem argumentos = todos os municípios de Goiás)
// O cadastro (população e tratamento) vem de cadastro/*.json, atualizado por scripts/cadastro-go.mjs.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONJUNTOS, baixarTudo, resumir } from "./sisagua.mjs";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const saida = path.join(raiz, "site", "dados");
await mkdir(saida, { recursive: true });
const SIMULTANEOS = Number(process.env.SIMULTANEOS || 3); // municípios ao mesmo tempo

const r = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados/GO/municipios", { signal: AbortSignal.timeout(60000) });
if (!r.ok) throw new Error("IBGE respondeu HTTP " + r.status);
let municipios = (await r.json()).map((m) => ({ i: String(m.id).slice(0, 6), n: m.nome, u: "GO" })).sort((a, b) => a.n.localeCompare(b.n, "pt-BR"));
const pedidos = process.argv.slice(2).filter((a) => /^\d{6}$/.test(a));
const alvo = pedidos.length ? municipios.filter((m) => pedidos.includes(m.i)) : municipios;

const lerCadastro = async (nome) => existsSync(path.join(raiz, "cadastro", nome)) ? JSON.parse(await readFile(path.join(raiz, "cadastro", nome), "utf8")) : [];
const pop = await lerCadastro("populacao-go.json"), trat = await lerCadastro("tratamento-go.json");

// índice anterior (para manter os números de quem não foi atualizado agora, quando se pede só alguns)
let indiceAnt = {};
try { for (const m of JSON.parse(await readFile(path.join(saida, "indice.json"), "utf8")).municipios) indiceAnt[m.i] = m; } catch {}

const resumo = {};
let feitos = 0;
async function processa(m) {
  const falhas = [];
  const filtro = `?codigo_ibge=${m.i}`;
  const [vig, ctl, cap, sem] = await Promise.all(CONJUNTOS.map((c) => baixarTudo(c, filtro, falhas)));
  const cad = { populacao: pop.filter((x) => x.ibge === m.i), tratamento: trat.filter((x) => x.ibge === m.i) };
  const dados = resumir(m.i, { vig, ctl, cap, sem }, cad);
  dados.falhas = falhas.length;
  await writeFile(path.join(saida, m.i + ".json"), JSON.stringify(dados));
  resumo[m.i] = { vig: vig.length, ctl: ctl.length, sem: sem.length, cap: cap.length, falhas: falhas.length };
  feitos++;
  console.log(`[${feitos}/${alvo.length}] ${m.n}: vigilância ${vig.length}, controle ${ctl.length}, semestral ${sem.length}, captação ${cap.length}${falhas.length ? `, ${falhas.length} trecho(s) com erro` : ""}`);
}

const fila = [...alvo];
await Promise.all(Array.from({ length: SIMULTANEOS }, async () => {
  while (fila.length) {
    const m = fila.shift();
    try { await processa(m); } catch (e) { console.log(`ERRO em ${m.n}: ${e.message}`); }
  }
}));

const indice = {
  atualizado: new Date().toISOString(), estado: "GO",
  municipios: municipios.map((m) => ({ ...m, ...(resumo[m.i] || indiceAnt[m.i] ? { ...indiceAnt[m.i], ...resumo[m.i], i: m.i, n: m.n, u: m.u } : {}) }))
    .filter((m) => existsSync(path.join(saida, m.i + ".json"))),
};
await writeFile(path.join(saida, "indice.json"), JSON.stringify(indice));
console.log(`Pronto: ${indice.municipios.length} municípios com dados em site/dados.`);
