// Funções comuns: baixar da API de dados abertos do SISAGUA e resumir os dados de um município
// no formato que o painel (site/index.html) lê.
const API = "https://apidadosabertos.saude.gov.br/sisagua";
export const CONJUNTOS = ["vigilancia-parametros-basicos", "controle-mensal-parametros-basicos", "pontos-de-captacao", "controle-semestral"];
const PARALELAS = 4;
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const limpa = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();

// Uma página da API. Se a página der erro repetido (costuma ser um registro com problema),
// baixa em pedaços menores e pula só o que continuar falhando.
async function pagina(url, falhas, limite = 1000, n = 0) {
  const u = `${url}&limit=${limite}&offset=${n}`;
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return Object.values(await r.json()).find(Array.isArray) || [];
    } catch { await espera(2000 * t); }
  }
  if (limite > 10) {
    const menor = limite / 10, partes = [];
    let incompleto = false;
    for (let k = n * 10; k < n * 10 + 10; k++) {
      const p = await pagina(url, falhas, menor, k);
      partes.push(...p);
      if (p.falhou) incompleto = true; else if (p.length < menor) return partes;
    }
    return Object.assign(partes, { falhou: incompleto });
  }
  falhas.push(u);
  return Object.assign([], { falhou: true });
}

// Todas as páginas de um conjunto filtrado (ex.: "?codigo_ibge=520030").
export async function baixarTudo(conjunto, filtro, falhas = []) {
  const url = `${API}/${conjunto}${filtro}`;
  const paginas = [];
  let fim = null;
  for (let n = 0; fim == null; n += PARALELAS) {
    const lote = Array.from({ length: PARALELAS }, (_, i) => n + i);
    const res = await Promise.all(lote.map((k) => pagina(url, falhas, 1000, k)));
    res.forEach((linhas, i) => {
      if (fim != null && lote[i] > fim) return;
      paginas[lote[i]] = linhas;
      if (!linhas.falhou && linhas.length < 1000) fim = lote[i];
    });
  }
  return paginas.flat();
}

// Lista de objetos → {__c: colunas, __v: valores} (bem menor em JSON). O painel desfaz isso.
export function empacota(lista) {
  if (!lista.length) return lista;
  const c = Object.keys(lista[0]);
  return { __c: c, __v: lista.map((o) => c.map((k) => o[k] ?? null)) };
}

const num = (v) => v == null || v === "" || isNaN(Number(String(v).replace(",", "."))) ? null : Number(String(v).replace(",", "."));

// Resume os dados brutos de um município (mesmo formato do servidor local).
export function resumir(ibge, bruto, cad) {
  const { vig, ctl, cap, sem } = bruto;
  const formas = {};
  const nota = (cod, nome, ano, tipo) => {
    if (!cod) return;
    const a = formas[cod];
    if (!a || Number(ano) >= a.ano) formas[cod] = { nome: limpa(nome), ano: Number(ano) || 0, tipo };
  };
  vig.forEach((r) => nota(r.codigo_forma_de_abastecimento, r.nome_da_forma_de_abastecimento, r.ano, r.tipo_da_forma_de_abastecimento));
  ctl.forEach((r) => nota(r.codigo_forma_de_abastecimento, r.nome_da_forma_de_abastecimento, r.ano_de_referencia, r.tipo_da_forma_de_abastecimento));
  cap.forEach((r) => nota(r.codigo_forma_de_abastecimento, r.nome_da_forma_de_abastecimento, r.ano_de_referencia, r.tipo_da_forma_de_abastecimento));
  sem.forEach((r) => nota(r.codigo_forma_de_abastecimento, r.nome_da_forma_de_abastecimento, r.ano_de_referencia, r.tipo_da_forma_de_abastecimento));
  for (const r of [...cad.populacao, ...cad.tratamento]) if (r.forma && !formas[r.forma]) formas[r.forma] = { nome: r.nome, ano: r.ano, tipo: r.tipo };

  // Controle mensal: só os campos que o painel usa (total analisado, presenças, turbidez > 5 uT, faixas de cloro).
  const controle = new Map();
  for (const r of ctl) {
    const campo = limpa(r.campo);
    if (!/^Número de amostras analisadas|presença|> ?5,0 ?uT/i.test(campo)) continue;
    const linha = { ano: Number(r.ano_de_referencia), mes: Number(r.mes_de_referencia), forma: r.codigo_forma_de_abastecimento,
      ponto: limpa(r.ponto_de_monitoramento).toUpperCase(), parametro: limpa(r.parametro), campo };
    const k = Object.values(linha).join("|");
    const atual = controle.get(k) || { ...linha, valor: 0 };
    atual.valor += Number(r.valor) || 0;
    controle.set(k, atual);
  }

  return {
    ibge, baixadoEm: new Date().toISOString(),
    municipio: vig[0]?.municipio || ctl[0]?.municipio || cap[0]?.municipio || sem[0]?.municipio || null,
    uf: "GO", formas,
    vigilancia: empacota(vig.map((r) => ({
      amostra: r.numero_da_amostra, data: r.data_da_coleta, ano: Number(r.ano), mes: Number(r.mes),
      forma: r.codigo_forma_de_abastecimento, procedencia: limpa(r.procedencia_da_coleta), ponto: limpa(r.ponto_de_coleta),
      bairro: limpa(r.area), zona: limpa(r.zona), parametro: limpa(r.parametro), resultado: limpa(r.resultado),
    }))),
    controle: empacota([...controle.values()]),
    semestral: empacota(sem.map((r) => ({
      ano: Number(r.ano_de_referencia), semestre: Number(r.semestre_de_referencia), data: r.data_da_coleta, forma: r.codigo_forma_de_abastecimento,
      ponto: limpa(r.ponto_de_monitoramento).toUpperCase(), grupo: limpa(r.grupo_de_parametros).replace(/\s*-\s*\d+\s*[º°o]\s*(tri|bi)mestre\s*$/i, ""),
      parametro: limpa(r.parametro), unidade: limpa(r.unidade), vmp: num(r.vmp), resultado: num(r.resultado),
    }))),
    captacao: empacota(cap.map((r) => ({
      ano: Number(r.ano_de_referencia), forma: r.codigo_forma_de_abastecimento, tipo: r.tipo_de_captacao,
      manancial: limpa(r.nome_do_manancial_superficial || r.nome_do_ponto_de_captacao_subterraneo),
      categoria: limpa(r.categoria_do_manancial_superficial || r.categoria_do_ponto_de_captacao_subterraneo),
      vazao: num(r.vazao), outorga: r.outorga,
    }))),
    cad: { status: { completo: true, rodando: false, populacao: { registros: cad.populacao.length, concluido: true }, tratamento: { registros: cad.tratamento.length, concluido: true } },
      populacao: empacota(cad.populacao), tratamento: empacota(cad.tratamento) },
  };
}
