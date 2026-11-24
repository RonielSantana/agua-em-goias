// Auditoria: compara os dados PUBLICADOS no site com uma consulta nova e independente à API do SISAGUA.
// Não usa o código de transformação do site (sisagua.mjs): baixa os dados brutos de novo e confere
// registro por registro (vigilância, semestral, captação) e soma por soma (controle mensal).
// Uso: node scripts/auditar.mjs [ibge ...]   (sem argumentos = amostra de municípios)
// Saída: relatório no terminal e em auditoria/relatorio-<data>.json
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chaveDaSenha, decifra } from "./cofre.mjs";
// Site protegido: os dados publicados estão cifrados; a auditoria precisa de SENHA_SITE para abri-los.
const CHAVE = process.env.SENHA_SITE ? chaveDaSenha(process.env.SENHA_SITE) : null;
async function publicado(nome) {
  if (CHAVE) { const r = await fetch(`${SITE}dados/${nome}.bin`, { signal: AbortSignal.timeout(120000) }); if (r.ok) return decifra(CHAVE, Buffer.from(await r.arrayBuffer())); }
  return json(`${SITE}dados/${nome}.json`);
}

const SITE = process.env.SITE || "https://ronielsantana.github.io/agua-em-goias/";
const API = "https://apidadosabertos.saude.gov.br/sisagua";
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();
const numTxt = (v) => v == null || v === "" ? "" : String(Number(String(v).replace(",", ".")));

async function json(url) {
  for (let t = 1; t <= 4; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (r.ok) return r.json(); throw new Error("HTTP " + r.status); }
    catch (e) { if (t === 4) throw new Error(`${e.message} em ${url}`); await new Promise((ok) => setTimeout(ok, 3000 * t)); }
  }
}
// Paginação simples, uma página por vez (offset = número da página, conferido na API).
// Página com erro 500 é baixada em pedaços cada vez menores, até 1 registro, para isolar
// exatamente quais registros a própria API não consegue entregar ("ilegíveis").
async function pagina(conj, ibge, limite, n, ilegiveis) {
  try { return Object.values(await json(`${API}/${conj}?codigo_ibge=${ibge}&limit=${limite}&offset=${n}`)).find(Array.isArray) || []; }
  catch (e) {
    if (limite === 1) { ilegiveis.push(`${conj} registro nº ${n + 1}`); return Object.assign([], { ilegivel: true }); }
    const menor = Math.max(1, limite / 10), partes = [];
    for (let k = n * (limite / menor); k < (n + 1) * (limite / menor); k++) {
      const p = await pagina(conj, ibge, menor, k, ilegiveis);
      partes.push(...p);
      if (!p.ilegivel && p.length < menor && !p.temIlegivel) return Object.assign(partes, { temIlegivel: ilegiveis.length > 0 });
    }
    return Object.assign(partes, { temIlegivel: true });
  }
}
async function bruto(conj, ibge, ilegiveis = []) {
  const todas = [];
  for (let n = 0; ; n++) {
    const lista = await pagina(conj, ibge, 1000, n, ilegiveis);
    todas.push(...lista);
    if (lista.length < 1000 && !lista.temIlegivel) return todas;
    if (n > 500) throw new Error("paginação sem fim");
  }
}
const desempacota = (o) => o && o.__c ? o.__v.map((l) => Object.fromEntries(o.__c.map((c, i) => [c, l[i]]))) : (o || []);
function contagem(chaves) { const m = new Map(); for (const k of chaves) m.set(k, (m.get(k) || 0) + 1); return m; }
function compara(nome, chavesSite, chavesApi) {
  const s = contagem(chavesSite), a = contagem(chavesApi);
  let iguais = 0, soNoSite = 0, soNaApi = 0; const exSite = [], exApi = [];
  for (const [k, n] of s) { const na = a.get(k) || 0; iguais += Math.min(n, na); if (n > na) { soNoSite += n - na; if (exSite.length < 3) exSite.push(k); } }
  for (const [k, n] of a) { const ns = s.get(k) || 0; if (n > ns) { soNaApi += n - ns; if (exApi.length < 3) exApi.push(k); } }
  return { conjunto: nome, site: chavesSite.length, api: chavesApi.length, iguais, soNoSite, soNaApi, exSite, exApi };
}

const indice = await publicado("indice");
let alvo = process.argv.slice(2).filter((a) => /^\d{6}$/.test(a));
if (!alvo.length) {
  const fixos = ["520870", "520110", "520140", "521880", "521250", "520030", "521523"]; // Goiânia, Anápolis, Aparecida, Rio Verde, Luziânia, Alexânia, Novo Gama
  const comFalha = indice.municipios.filter((m) => m.falhas && !fixos.includes(m.i)).slice(0, 3).map((m) => m.i);
  const outros = indice.municipios.filter((m) => !fixos.includes(m.i) && !comFalha.includes(m.i));
  const sorteio = [0, 1, 2].map((i) => outros[Math.floor((i + 0.5) * outros.length / 3)].i);
  alvo = [...fixos, ...comFalha, ...sorteio];
}
console.log(`Auditando ${alvo.length} municípios contra a API (site atualizado em ${indice.atualizado}).\n`);

const relatorio = [];
for (const ibge of alvo) {
  const nome = indice.municipios.find((m) => m.i === ibge)?.n || ibge;
  const pub = await publicado(ibge);
  const ilegiveis = [];
  const [vig, ctl, cap, sem] = await Promise.all(["vigilancia-parametros-basicos", "controle-mensal-parametros-basicos", "pontos-de-captacao", "controle-semestral"].map((c) => bruto(c, ibge, ilegiveis)));
  const r = { ibge, nome, publicadoEm: pub.baixadoEm, falhasNaPublicacao: pub.falhas || 0, ilegiveisNaApi: ilegiveis, verificacoes: [] };

  // 1) a API devolveu só registros do município pedido?
  const outroMun = [...vig, ...ctl, ...sem].filter((x) => x.codigo_ibge != null && String(x.codigo_ibge).slice(0, 6) !== ibge).length
    + cap.filter((x) => x.codigo_do_ibge != null && String(x.codigo_do_ibge).slice(0, 6) !== ibge).length;
  r.registrosDeOutroMunicipio = outroMun;

  // 2) vigilância: registro por registro
  r.verificacoes.push(compara("vigilância",
    desempacota(pub.vigilancia).map((x) => [x.amostra, x.parametro, x.resultado, x.data, x.forma].map(norm).join("|")),
    vig.map((x) => [x.numero_da_amostra, x.parametro, x.resultado, x.data_da_coleta, x.codigo_forma_de_abastecimento].map(norm).join("|"))));

  // 3) semestral: registro por registro
  r.verificacoes.push(compara("controle semestral",
    desempacota(pub.semestral).map((x) => [x.data, x.forma, norm(x.ponto).toUpperCase(), x.parametro, numTxt(x.resultado), numTxt(x.vmp), x.unidade].map(norm).join("|")),
    sem.map((x) => [x.data_da_coleta, x.codigo_forma_de_abastecimento, norm(x.ponto_de_monitoramento).toUpperCase(), x.parametro, numTxt(x.resultado), numTxt(x.vmp), x.unidade].map(norm).join("|"))));

  // 4) captação: registro por registro
  r.verificacoes.push(compara("captação",
    desempacota(pub.captacao).map((x) => [x.ano, x.forma, x.manancial, numTxt(x.vazao), x.outorga].map(norm).join("|")),
    cap.map((x) => [x.ano_de_referencia, x.codigo_forma_de_abastecimento, x.nome_do_manancial_superficial || x.nome_do_ponto_de_captacao_subterraneo, numTxt(x.vazao), x.outorga].map(norm).join("|"))));

  // 5) controle mensal: o site guarda somas por ano/mês/sistema/ponto/parâmetro/campo (só os campos usados)
  const campoUsado = (c) => /^Número de amostras analisadas|presença|> ?5,0 ?uT/i.test(norm(c));
  const somaApi = new Map();
  for (const x of ctl) {
    if (!campoUsado(x.campo)) continue;
    const k = [x.ano_de_referencia, x.mes_de_referencia, x.codigo_forma_de_abastecimento, norm(x.ponto_de_monitoramento).toUpperCase(), norm(x.parametro), norm(x.campo)].join("|");
    somaApi.set(k, (somaApi.get(k) || 0) + (Number(x.valor) || 0));
  }
  r.verificacoes.push(compara("controle mensal (somas)",
    desempacota(pub.controle).map((x) => [x.ano, x.mes, x.forma, x.ponto, x.parametro, x.campo].join("|") + "=" + x.valor),
    [...somaApi].map(([k, v]) => k + "=" + v)));

  const ok = r.registrosDeOutroMunicipio === 0 && r.verificacoes.every((v) => !v.soNoSite);
  r.resultado = ok ? (r.verificacoes.some((v) => v.soNaApi) ? "ok, faltam registros no site" : "idêntico") : "DIVERGENTE";
  relatorio.push(r);
  console.log(`${nome} (${ibge}) → ${r.resultado}${r.falhasNaPublicacao ? ` [publicação teve ${r.falhasNaPublicacao} trecho(s) com erro na API]` : ""}`);
  for (const v of r.verificacoes) console.log(`   ${v.conjunto.padEnd(24)} site ${String(v.site).padStart(6)} · API ${String(v.api).padStart(6)} · iguais ${String(v.iguais).padStart(6)}${v.soNoSite ? ` · SÓ NO SITE ${v.soNoSite} (ex.: ${v.exSite[0]})` : ""}${v.soNaApi ? ` · só na API ${v.soNaApi} (ex.: ${v.exApi[0]})` : ""}`);
  if (ilegiveis.length) console.log(`   A própria API não entrega ${ilegiveis.length} registro(s) (erro 500 mesmo pedindo 1 por vez): ${ilegiveis.slice(0, 4).join(", ")}${ilegiveis.length > 4 ? "…" : ""}`);
  if (outroMun) console.log(`   ATENÇÃO: ${outroMun} registro(s) de outro município vieram no filtro`);
}

await mkdir(path.join(raiz, "auditoria"), { recursive: true });
const arq = path.join(raiz, "auditoria", `relatorio-${new Date().toISOString().slice(0, 10)}.json`);
await writeFile(arq, JSON.stringify({ site: SITE, publicadoEm: indice.atualizado, auditadoEm: new Date().toISOString(), municipios: relatorio }, null, 2));
const div = relatorio.filter((r) => r.resultado === "DIVERGENTE").length;
console.log(`\n${relatorio.length} municípios: ${relatorio.filter((r) => r.resultado === "idêntico").length} idênticos, ${relatorio.filter((r) => r.resultado.startsWith("ok")).length} com registros faltando no site, ${div} divergentes. Relatório: ${path.relative(raiz, arq)}`);
if (div) process.exit(1);
