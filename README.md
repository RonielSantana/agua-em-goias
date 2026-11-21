# Água em Goiás

Painel da qualidade da água para consumo humano nos 246 municípios de Goiás, com dados abertos do
**SISAGUA** (Ministério da Saúde, [apidadosabertos.saude.gov.br](https://apidadosabertos.saude.gov.br/v1/#/SISAGUA)).

O site é estático (GitHub Pages) e se atualiza sozinho toda semana pelo GitHub Actions.

## O que o painel mostra

- **Visão geral**: análises da vigilância, % dentro do padrão, *E. coli*, cloro residual, comparação com o ano anterior,
  destaques automáticos, resultado por parâmetro, áreas com mais falhas e mapa de calor.
- **Vigilância**: distribuição dos resultados de cada parâmetro e tabela completa (busca, ordenação, CSV).
- **Controle do prestador**: análises mensais informadas pelo prestador (*E. coli*, coliformes, turbidez).
- **Controle semestral**: substâncias químicas, agrotóxicos e organolépticos comparados ao VMP, separando água bruta e tratada.
- **Cadastro**: sistemas, população atendida, tratamento e pontos de captação.

Filtros por sistema, ano, mês e parâmetro. O endereço guarda o município e os filtros (dá para compartilhar o link).

## Como funciona

| Arquivo | Para quê |
|---|---|
| `site/index.html` | o painel (lê `site/dados/`) |
| `scripts/atualizar.mjs` | baixa vigilância, controle mensal, controle semestral e captação de cada município (semanal) |
| `scripts/cadastro-go.mjs` | refaz o cadastro de população e tratamento de Goiás (mensal; a API não filtra esses dados por estado) |
| `cadastro/*.json` | cadastro de Goiás guardado no repositório |
| `.github/workflows/atualizar.yml` | roda tudo e publica no Pages (domingo, 03:00 de Brasília) |

A API do Ministério não permite consultas direto do navegador (CORS), por isso os dados são baixados
pelo GitHub Actions e publicados junto com o site.

### Rodar no computador

```bash
node scripts/atualizar.mjs 520030 521523   # só alguns municípios (códigos IBGE de 6 dígitos)
node scripts/servir.mjs                     # abre em http://localhost:5190
```

### Observações

- Referências da Portaria GM/MS nº 888/2021. Para coliformes totais, a Portaria avalia o conjunto do mês: uma presença isolada é alerta.
- O VMP do controle semestral vale para a água tratada; na captação (água bruta) serve só de comparação.
- Valores muito acima do VMP podem ser erro de unidade no envio ao SISAGUA; confira com o laudo.
- O GitHub suspende agendamentos de repositórios sem atividade por 60 dias; a atualização mensal do cadastro gera um commit e evita isso.
