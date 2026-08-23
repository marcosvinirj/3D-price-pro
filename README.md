# Price 3D — Precificação para Impressão 3D

Monorepo. O **backend** (Node + Express + Prisma + PostgreSQL + JWT + Zod) é
construído em volta de um **motor de cálculo puro e testável** (53 testes:
motor + integração de API). O
**frontend** (React + Vite + Tailwind) é um SaaS com **sidebar moderna**,
**tema claro/escuro** (persistido), dashboard, simulador em tempo real e
CRUD de filamentos, impressoras, custos fixos, **custos variáveis** e
**insumos** (consumíveis por peça, com estoque em unidades).

```
Testand/
  backend/     # API + motor de precificação
  frontend/    # React + Vite + Tailwind (login + simulador + orçamentos)
  README.md
```

## Rodar o frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173  (o backend precisa estar no ar em :3333)
npm run build    # tsc + vite build (verificação de tipos + bundle)
```

Login inicial (do seed): `admin@exemplo.com` / `senha1234`.

## Rodar o backend

```bash
cd backend
npm install
npm run db:generate   # gera o Prisma Client
npm run db:push       # sincroniza o schema no Postgres (ver DATABASE_URL em .env)
npm run seed          # dados iniciais + admin@exemplo.com / senha1234
npm run dev           # sobe a API em http://localhost:3333 (hot-reload)

npm test              # 53 testes: motor + integração de API (Vitest + supertest);
                       # a integração roda contra um banco Postgres de TESTE
                       # separado (mesmo host de DATABASE_URL, banco "<nome>_test",
                       # criado automaticamente na 1a execução — nunca toca no banco
                       # de desenvolvimento/produção)
npm run typecheck     # checagem de tipos (tsc)
npx tsx src/exemplo.ts  # exemplo do motor isolado
```

## API

Todas as rotas (exceto `/auth/*` e `/health`) exigem header
`Authorization: Bearer <token>`.

| Método | Rota | O quê |
|--------|------|-------|
| POST | `/auth/registro` | auto-cadastro público → token (ver Multi-tenant abaixo) |
| POST | `/auth/login` | login → token JWT |
| CRUD | `/materiais` | materiais; `GET /materiais/alertas/estoque-baixo` |
| CRUD | `/impressoras` | impressoras |
| CRUD | `/custos-fixos` | custos fixos mensais (retorna `totalMensal`) |
| CRUD | `/custos-variaveis` | custos variáveis por orçamento (embalagem, frete…); cobrados uma vez |
| CRUD | `/insumos` | insumos por PEÇA (argola, escovinha…), com estoque em unidades; `GET /insumos/alertas/estoque-baixo`; o custo escala pela quantidade da peça no orçamento |
| GET/PATCH | `/configuracao` | parâmetros globais (kWh, hora, horas produtivas/mês, margem mín.) |
| POST | `/orcamentos/simular` | simulador "e se" (não persiste) |
| POST | `/orcamentos` | cria orçamento (pendente) |
| GET | `/orcamentos?status=` | lista/filtra |
| POST | `/orcamentos/:id/aprovar` | aprova → baixa estoque, torna imutável |
| POST | `/orcamentos/:id/recusar` | recusa |
| GET | `/orcamentos/:id/pdf` | PDF do orçamento (voltado ao cliente; sem custos/margem internos) |
| GET | `/orcamentos/export/csv` | exporta todos os orçamentos em CSV (BOM p/ Excel) |
| GET | `/orcamentos/export/xlsx` | exporta em Excel (SpreadsheetML, abre nativo no Excel) |
| GET | `/dashboard` | métricas agregadas (faturamento, custo médio, margem real vs. planejada, consumo/mês, por material, série mensal) |
| CRUD | `/moedas` | moedas de exibição (EUR base protegida); taxas configuráveis. PDF aceita `?moeda=USD` |

**Multi-tenant:** cada usuário tem seu próprio espaço de dados, isolado dos
demais — materiais, impressoras, custos, configuração, moedas e orçamentos
pertencem a quem os criou. Qualquer usuário autenticado tem acesso total
(leitura e escrita) **apenas ao que é seu**; não há papel privilegiado sobre
dados de outro usuário. Auto-cadastro é público (`POST /auth/registro`, sem
token) — todo usuário começa com um espaço vazio, pronto para cadastrar seus
próprios materiais/impressoras/custos.

Regras de negócio cobertas por **testes de integração automatizados**
(`src/http/api.test.ts`, supertest): **2** margem mínima bloqueia salvar (422) ·
**4** estoque nunca negativo (422 na aprovação) · **5** orçamento aprovado é
imutável (409) · **6** snapshots (`entradaJson`/`resultadoJson`) preservam
orçamentos antigos em reajustes · **7** desconto só sobre o preço final.

## O motor isolado

`precificar(entrada)` valida com Zod e devolve um detalhamento determinista.

## Uso

```ts
import { precificar } from './src/pricing/index.js';

const r = precificar({
  peca: { pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 },
  material: { precoKg: 120, taxaDesperdicio: 0.05 }, // 5% de purga/desperdício
  impressora: { potenciaMediaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 }, // consumo MEDIO, nao a potencia maxima
  custos: {
    precoKwh: 0.95,
    valorHoraTrabalho: 20,
    custosFixosMensais: 1000,
    horasProdutivasMes: 160,
  },
  parametros: { taxaFalha: 0.1, margemLucro: 0.5, margemMinima: 0.2 },
  desconto: { tipo: 'percentual', valor: 0.1 }, // opcional
  arredondamento: { modo: 'psicologico', terminacao: 0.9 }, // 101.90
});

r.precoFinal;             // preço de tabela após arredondamento
r.precoCobrado;           // após desconto
r.margem.real;            // margem REAL sobre o preço cobrado (cai quando há desconto)
r.margem.markupSobreCusto; // o mesmo lucro, lido como markup sobre o custo (lucro / custo)
```

`precificar` valida a entrada e **lança `ErroValidacaoPrecificacao`** (com os
`issues` do Zod) se algo estiver inválido. Se você já tem dados confiáveis e
validados, use `calcular` diretamente.

## Fórmulas (spec §3)

```
Custo Material     = (pesoG × precoKg / 1000) × (1 + taxaDesperdicio)
Custo Energia      = (potenciaMediaW / 1000) × tempoImpressaoH × precoKwh   (consumo MEDIO, nao a potencia maxima/nominal)
Depreciação        = (valorAquisicao / vidaUtilH) × tempoImpressaoH
Mão de Obra        = tempoPosProcessamentoH × valorHoraTrabalho
Custo Fixo/Hora    = custosFixosMensais / horasProdutivasMes
Custo Fixo Rateado = Custo Fixo/Hora × tempoImpressaoH
Custo Núcleo       = Material + Energia + Depreciação + Mão de Obra + Custo Fixo Rateado
Custo Insumos      = Σ (insumo.valorUnitario × insumo.quantidade) — argola, escovinha, lâmpada…
Custo Variável     = Σ dos custos variáveis selecionados (embalagem, frete, etiqueta…)
Custo Repassado    = Custo Insumos + Custo Variável
Custo Total        = Custo Núcleo + Custo Repassado           (exibição, sem margem)
Custo Total c/ Falha = Custo Núcleo × (1+taxaFalha) + Custo Repassado   (custo TOTAL real)
Preço Final        = arredondar( Custo Total c/ Falha / (1 − margemLucro) )
Preço Cobrado      = Preço Final − desconto
```

Provisão de falha incide **só sobre o Custo Núcleo** (material, energia,
depreciação, mão de obra, custo fixo) — o que de fato se perde numa
impressão malsucedida; insumos ficam intactos no estoque e custo variável só
é gasto quando a peça de fato sai.

**Margem de lucro é sobre o PREÇO FINAL DE VENDA, não markup sobre o custo.**
`margemLucro` é a fração do preço de venda que vira lucro — daí a fórmula
`preço = custo / (1 − margem)` (isolando P em `margem = (P − custo) / P`).
Consequência direta: **todo** custo real entra no cálculo, inclusive o Custo
Variável (frete, embalagem) — que no modelo antigo era repassado "por fora",
sem levar margem. `margemLucro`/`margemMinima` precisam ser **< 100%**: nessa
margem a fórmula diverge (denominador zero ou negativo). `r.margem.real` /
`r.margem.planejada` / `r.margem.minima` são todos margem-sobre-preço; pra
quem quer enxergar o mesmo lucro como "quanto multipliquei o custo", use
`r.margem.markupSobreCusto` (lucro / custo) — os dois números nunca coincidem
(ex.: 50% de margem sobre o preço = 100% de markup sobre o custo).

## Regras de negócio implementadas

| # | Regra | Onde |
|---|-------|------|
| 2 | Margem mínima obrigatória (bloqueia salvar abaixo) | `schema.ts` (`superRefine`) |
| 3 | Taxa de falha configurável | `parametros.taxaFalha` |
| 7 | Desconto só sobre o preço final; margem real registrada à parte | `engine.ts` |
| — | Arredondamento configurável (ex.: terminar em ,90) | `money.ts` |
| — | Validação de toda entrada (sem peso negativo, sem divisão por zero) | `schema.ts` |

Regras 4, 5, 6 (estoque nunca negativo, imutabilidade do orçamento aprovado,
snapshots que preservam orçamentos antigos em reajustes) vivem na **camada de
persistência/API** (`modules/orcamentos/service.ts`) e têm testes de integração.

## Estrutura

```
backend/
  prisma/schema.prisma   # modelos: User, Material, Impressora, CustoFixo, Configuracao, Orcamento
  src/
    pricing/             # MOTOR (puro, testado — 29 testes)
      money.ts           #   arredondamento (2 casas, psicológico, etc.)
      schema.ts          #   validação Zod da entrada
      engine.ts          #   calcular() / precificar()
      engine.test.ts
    config/env.ts        # env validado com Zod
    db/prisma.ts, seed.ts
    http/errors.ts       # AppError, asyncHandler, errorHandler central
    http/validate.ts     # middleware Zod + obterId
    auth/                # bcrypt, JWT, guarda de rotas, registro/login
    modules/             # materiais, impressoras, custosFixos, configuracao, orcamentos
    app.ts, server.ts    # montagem do Express e bootstrap
frontend/
  src/
    lib/                 # api (fetch + JWT), auth (contexto), types, useDebounce
    lib/theme.tsx        # tema claro/escuro (classe .dark no <html>, persistido)
    lib/moeda.tsx        # contexto de moeda de exibição (converte valores mostrados)
    components/          # ui.tsx (design system dark-aware), Layout.tsx (sidebar), icons.tsx
    pages/               # Login, Dashboard (Recharts), Simulador (tempo real + inteligência de
                         #   negócio), Orcamentos, Materiais, Impressoras, CustosFixos,
                         #   CustosVariaveis, Moedas, Configuracao (CRUD)
    App.tsx, main.tsx    # rotas protegidas + bootstrap (Tema/Auth/Moeda providers)
  tailwind.config.js, vite.config.ts
```
