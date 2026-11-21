// Atualização mensal do cadastro de Goiás: população abastecida e tratamento de água.
// A API não filtra esses dois conjuntos por estado ou município, então percorre o Brasil todo
// e guarda só Goiás em cadastro/populacao-go.json e cadastro/tratamento-go.json.
// Dados pessoais (responsável técnico, e-mail, telefone, endereço) não são guardados.
// Uso: node scripts/cadastro-go.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { limpa } from "./sisagua.mjs";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://apidadosabertos.saude.gov.br/sisagua";
const PARALELAS = 6;
const num = (v) => v == null || v === "" || isNaN(Number(String(v).replace(",", "."))) ? null : Number(String(v).replace(",", "."));
const sn = (s) => /^(s|sim)$/i.test(limpa(s)) ? "S" : /^(n|não|nao)$/i.test(limpa(s)) ? "N" : "";

const ENXUGA = {
  "populacao-abastecida": (r) => ({
    ano: num(r.ano_de_referencia), ibge: limpa(r.codigo_ibge).slice(0, 6), forma: r.codigo_forma_de_abastecimento, nome: limpa(r.nome_da_forma_de_abastecimento),
    tipo: r.tipo_da_forma_de_abastecimento, instituicao: limpa(r.sigla_da_instituicao || r.nome_da_instituicao),
    pop: num(r.populacao_estimada), pop_urbana: num(r.populacao_urbana), pop_rural: num(r.populacao_rural), economias: num(r.numero_de_economias_residenciais_domicilios_permanentes),
    filtracao: sn(r.filtracao), desinfeccao: sn(r.desinfeccao), capt_superficial: sn(r.captacao_superficial), capt_subterranea: sn(r.captacao_subterranea),
  }),
  "tratamento-de-agua": (r) => {
    const etapas = [["pre_oxidacao", "pré-oxidação"], ["mistura_rap_e_coag", "coagulação"], ["floculacao", "floculação"], ["decantacao", "decantação"],
      ["flotacao", "flotação"], ["desinfeccao", "desinfecção"], ["fluoretacao", "fluoretação"], ["desfluoretacao", "desfluoretação"]].filter(([k]) => sn(r["etapa_" + k]) === "S").map(([, t]) => t);
    const desinf = [["cloro_gashipoc", "cloro"], ["cloramina", "cloramina"], ["dioxido_cloro", "dióxido de cloro"], ["ozonio", "ozônio"], ["uv", "UV"], ["isocianuratos_clorados", "isocianurato"]]
      .filter(([k]) => sn(r["desinf_com_" + k]) === "S").map(([, t]) => t);
    if (limpa(r.outro_desinfetante)) desinf.push(limpa(r.outro_desinfetante));
    return {
      ano: num(r.ano_de_referencia), ibge: limpa(r.codigo_ibge).slice(0, 6), forma: r.codigo_forma_de_abastecimento, nome: limpa(r.nome_da_forma_de_abastecimento),
      eta: limpa(r.nome_da_eta), tipo: r.tipo_da_forma_de_abastecimento, filtracao: limpa(r.tipo_de_filtracao), filtros: num(r.numero_de_filtros),
      vazao_tratada: num(r.vazao_de_agua_tratada), funcionamento: limpa(r.tempo_medio_diario_de_funcionamento), etapas: etapas.join(", "),
      outra_etapa: limpa(r.outra_etapa_tratamento), desinfetante: desinf.join(", "),
    };
  },
};

async function pagina(conj, n) {
  for (let t = 1; t <= 5; t++) {
    try {
      const r = await fetch(`${API}/${conj}?limit=1000&offset=${n}`, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return Object.values(await r.json()).find(Array.isArray) || [];
    } catch { await new Promise((ok) => setTimeout(ok, 3000 * t)); }
  }
  console.log(`  página ${n} de ${conj} pulada (erro na API)`);
  return Object.assign([], { falhou: true });
}

{
  await mkdir(path.join(raiz, "cadastro"), { recursive: true });
  for (const [conj, arquivo] of [["populacao-abastecida", "populacao-go.json"], ["tratamento-de-agua", "tratamento-go.json"]]) {
    const vistos = new Set(), linhas = [];
    let fim = null, total = 0;
    for (let n = 0; fim == null; n += PARALELAS) {
      const lote = Array.from({ length: PARALELAS }, (_, i) => n + i);
      const res = await Promise.all(lote.map((k) => pagina(conj, k)));
      res.forEach((ls, i) => {
        if (fim != null && lote[i] > fim) return;
        total += ls.length;
        for (const r of ls) if (r.uf === "GO") { const x = ENXUGA[conj](r); const k = JSON.stringify(x); if (!vistos.has(k)) { vistos.add(k); linhas.push(x); } }
        if (!ls.falhou && ls.length < 1000) fim = lote[i];
      });
      if (n % 60 === 0) console.log(`${conj}: ${total} registros lidos, ${linhas.length} de Goiás`);
    }
    linhas.sort((a, b) => a.ibge.localeCompare(b.ibge) || b.ano - a.ano);
    await writeFile(path.join(raiz, "cadastro", arquivo), JSON.stringify(linhas));
    console.log(`${conj}: pronto, ${linhas.length} registros de Goiás (de ${total} no Brasil).`);
  }
}
