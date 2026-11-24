// Atualização semanal: baixa da API do SISAGUA os dados de todos os municípios de Goiás e grava
// site/dados/<ibge>.json (um por município) e site/dados/indice.json.
// Uso: node scripts/atualizar.mjs [ibge ...]   (sem argumentos = todos os municípios de Goiás)
// Variáveis opcionais: SIMULTANEOS (municípios ao mesmo tempo, padrão 2), PRAZO_MUNICIPIO (min, padrão 12),
// TEMPO_TOTAL (min, padrão 280), SITE_ANTERIOR (endereço do site publicado, para reaproveitar
// os dados da semana anterior de um município que falhar).
// O cadastro (população e tratamento) vem de cadastro/*.json, atualizado por scripts/cadastro-go.mjs.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONJUNTOS, Prazo, baixarTudo, registro, resumir } from "./sisagua.mjs";
import { chaveDaSenha, decifra } from "./cofre.mjs";
// Com SENHA_SITE, o site anterior está cifrado: usa a chave para ler o índice anterior.
const CHAVE = process.env.SENHA_SITE ? chaveDaSenha(process.env.SENHA_SITE) : null;

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const saida = path.join(raiz, "site", "dados");
await mkdir(saida, { recursive: true });
const SIMULTANEOS = Number(process.env.SIMULTANEOS || 2);
const PRAZO_MUNICIPIO = Number(process.env.PRAZO_MUNICIPIO || 12) * 60 * 1000;
const FIM_TOTAL = Date.now() + Number(process.env.TEMPO_TOTAL || 280) * 60 * 1000;
const SITE_ANTERIOR = (process.env.SITE_ANTERIOR || "").replace(/\/?$/, "/");
const inicio = Date.now();
const min = () => ((Date.now() - inicio) / 60000).toFixed(1) + " min";

const r = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados/GO/municipios", { signal: AbortSignal.timeout(60000) });
if (!r.ok) throw new Error("IBGE respondeu HTTP " + r.status);
const municipios = (await r.json()).map((m) => ({ i: String(m.id).slice(0, 6), n: m.nome, u: "GO" })).sort((a, b) => a.n.localeCompare(b.n, "pt-BR"));
const pedidos = process.argv.slice(2).filter((a) => /^\d{6}$/.test(a));
const alvo = pedidos.length ? municipios.filter((m) => pedidos.includes(m.i)) : municipios;
console.log(`${alvo.length} município(s) a atualizar, ${SIMULTANEOS} ao mesmo tempo.`);

const lerCadastro = async (nome) => existsSync(path.join(raiz, "cadastro", nome)) ? JSON.parse(await readFile(path.join(raiz, "cadastro", nome), "utf8")) : [];
const pop = await lerCadastro("populacao-go.json"), trat = await lerCadastro("tratamento-go.json");

// índice anterior: o local (rodando no PC) ou o do site publicado
let indiceAnt = {};
try { for (const m of JSON.parse(await readFile(path.join(saida, "indice.json"), "utf8")).municipios) indiceAnt[m.i] = m; } catch {}
if (!Object.keys(indiceAnt).length && SITE_ANTERIOR.startsWith("http")) {
  try {
    const ri = await fetch(SITE_ANTERIOR + "dados/indice.bin", { signal: AbortSignal.timeout(30000) });
    if (ri.ok && CHAVE) for (const m of decifra(CHAVE, Buffer.from(await ri.arrayBuffer())).municipios) indiceAnt[m.i] = m;
    else { const rj = await fetch(SITE_ANTERIOR + "dados/indice.json", { signal: AbortSignal.timeout(30000) }); if (rj.ok) for (const m of (await rj.json()).municipios) indiceAnt[m.i] = m; }
  } catch {}
}

const resumo = {}, reaproveitados = [], semDados = [];
let feitos = 0;

// Se um município não puder ser atualizado, tenta manter os dados publicados da semana anterior.
async function reaproveita(m, motivo) {
  if (existsSync(path.join(saida, m.i + ".json")) || existsSync(path.join(saida, m.i + ".bin"))) { reaproveitados.push(m.n); console.log(`  ${m.n}: mantidos os dados anteriores (${motivo})`); return; }
  if (SITE_ANTERIOR.startsWith("http")) {
    try {
      // site anterior cifrado (.bin, copiado como está) ou aberto (.json)
      let ra = await fetch(`${SITE_ANTERIOR}dados/${m.i}.bin`, { signal: AbortSignal.timeout(60000) }), ext = ".bin";
      if (!ra.ok) { ra = await fetch(`${SITE_ANTERIOR}dados/${m.i}.json`, { signal: AbortSignal.timeout(60000) }); ext = ".json"; }
      if (ra.ok) { await writeFile(path.join(saida, m.i + ext), Buffer.from(await ra.arrayBuffer())); reaproveitados.push(m.n); console.log(`  ${m.n}: mantidos os dados da semana anterior (${motivo})`); return; }
    } catch {}
  }
  semDados.push(m.n);
  console.log(`  ${m.n}: sem dados (${motivo})`);
}

async function processa(m) {
  const falhas = [], prazo = new Prazo(PRAZO_MUNICIPIO), t0 = Date.now();
  const filtro = `?codigo_ibge=${m.i}`;
  const [vig, ctl, cap, sem] = await Promise.all(CONJUNTOS.map((c) => baixarTudo(c, filtro, falhas, prazo)));
  const cad = { populacao: pop.filter((x) => x.ibge === m.i), tratamento: trat.filter((x) => x.ibge === m.i) };
  const dados = resumir(m.i, { vig, ctl, cap, sem }, cad);
  dados.falhas = falhas.length;
  await writeFile(path.join(saida, m.i + ".json"), JSON.stringify(dados));
  resumo[m.i] = { vig: vig.length, ctl: ctl.length, sem: sem.length, cap: cap.length, falhas: falhas.length, atualizado: new Date().toISOString() };
  console.log(`[${++feitos}/${alvo.length}] ${m.n} em ${((Date.now() - t0) / 1000).toFixed(0)} s: vigilância ${vig.length}, controle ${ctl.length}, semestral ${sem.length}, captação ${cap.length}${falhas.length ? `, ${falhas.length} trecho(s) com erro` : ""} (${min()})`);
}

const batida = setInterval(() => console.log(`… ${feitos}/${alvo.length} municípios, ${registro.pedidos} pedidos à API, ${registro.erros} com erro, ${registro.lentos} lentos (${min()})`), 60000);
const fila = [...alvo];
await Promise.all(Array.from({ length: SIMULTANEOS }, async () => {
  while (fila.length) {
    const m = fila.shift();
    if (Date.now() > FIM_TOTAL) { await reaproveita(m, "tempo total da atualização esgotado"); continue; }
    try { await processa(m); } catch (e) { console.log(`ERRO em ${m.n}: ${e.message}`); await reaproveita(m, e.message); }
  }
}));
clearInterval(batida);

const indice = {
  atualizado: new Date().toISOString(), estado: "GO",
  municipios: municipios.filter((m) => existsSync(path.join(saida, m.i + ".json")) || existsSync(path.join(saida, m.i + ".bin"))).map((m) => ({ ...(indiceAnt[m.i] || {}), ...(resumo[m.i] || {}), i: m.i, n: m.n, u: m.u })),
};
await writeFile(path.join(saida, "indice.json"), JSON.stringify(indice));
console.log(`Pronto em ${min()}: ${Object.keys(resumo).length} atualizados, ${reaproveitados.length} com dados anteriores, ${semDados.length} sem dados; ${indice.municipios.length} municípios no site.`);
if (semDados.length) console.log("Sem dados: " + semDados.join(", "));
// Falha a execução (sem publicar) se quase nada foi atualizado: melhor manter o site anterior no ar.
if (alvo.length >= 20 && Object.keys(resumo).length < alvo.length * 0.5) { console.log("Menos da metade dos municípios foi atualizada; o site anterior continua no ar."); process.exit(1); }
