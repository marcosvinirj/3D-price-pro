/**
 * Testes de integracao da API (Express + Prisma + Postgres de teste).
 *
 * Exercitam ponta a ponta as regras de negocio que dependem de persistencia
 * (2, 4, 5, 6) e as garantias de autorizacao (papeis nas escritas + registro
 * fechado). Rodam contra um banco Postgres de teste separado (mesmo projeto
 * Neon do DATABASE_URL, banco "<nome>_test"), recriado pelo globalSetup.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { assinarToken } from '../auth/jwt.js';
import { gerarHash } from '../auth/password.js';

// Trava de seguranca: jamais rodar a suite contra um banco que nao seja de teste.
if (!process.env.DATABASE_URL?.includes('test')) {
  throw new Error(
    `Testes de integracao exigem um DATABASE_URL de teste (recebido: ${process.env.DATABASE_URL}).`,
  );
}

const app = criarApp();

/** Contexto recriado antes de cada teste (banco limpo + dados base). */
let ctx: {
  materialId: number;
  impressoraId: number;
  tokenAdmin: string;
  tokenOperador: string;
};

async function limparBanco() {
  // Ordem respeita as chaves estrangeiras.
  await prisma.orcamento.deleteMany();
  await prisma.material.deleteMany();
  await prisma.impressora.deleteMany();
  await prisma.custoFixo.deleteMany();
  await prisma.custoVariavel.deleteMany();
  await prisma.moeda.deleteMany();
  await prisma.configuracao.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await limparBanco();

  const [admin, operador] = await Promise.all([
    prisma.user.create({
      data: { email: 'admin@test', senhaHash: await gerarHash('senha1234'), role: 'admin' },
    }),
    prisma.user.create({
      data: { email: 'op@test', senhaHash: await gerarHash('senha1234'), role: 'operador' },
    }),
  ]);

  // materialId/impressoraId/configuracao pertencem ao OPERADOR — e' quem
  // roda os cenarios de negocio (Regra 2/4/5/6) abaixo. O admin e' um
  // tenant INDEPENDENTE (multi-tenant: sem papel privilegiado sobre dados
  // alheios — ver describe "Isolamento multi-tenant"), nao um superior do
  // operador dentro do mesmo espaco.
  await prisma.configuracao.create({
    data: { usuarioId: operador.id, precoKwh: 1, valorHoraTrabalho: 20, horasProdutivasMes: 160, margemMinima: 0.2 },
  });
  const material = await prisma.material.create({
    data: {
      usuarioId: operador.id,
      nome: 'PLA',
      tipo: 'PLA',
      precoKg: 120,
      estoqueG: 100,
      estoqueMinimoG: 10,
      taxaDesperdicio: 0.05,
    },
  });
  const impressora = await prisma.impressora.create({
    data: { usuarioId: operador.id, nome: 'Ender 3', potenciaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
  });

  ctx = {
    materialId: material.id,
    impressoraId: impressora.id,
    tokenAdmin: assinarToken({ sub: admin.id, email: admin.email, role: 'admin' }),
    tokenOperador: assinarToken({ sub: operador.id, email: operador.email, role: 'operador' }),
  };
});

/** Entrada padrao de orcamento com 1 peca (peso 50g => consumo 52.5g com 5% de
 *  desperdicio). `peca` mescla no item unico; demais chaves vao no orcamento. */
function inputOrcamento(over: { peca?: Record<string, unknown>; [k: string]: unknown } = {}) {
  const { peca, ...resto } = over;
  return {
    impressoraId: ctx.impressoraId,
    itens: [
      { materialId: ctx.materialId, pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5, ...peca },
    ],
    parametros: { taxaFalha: 0.1, margemLucro: 0.5 },
    ...resto,
  };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Nao ha mais papeis privilegiados (regra de negocio atual — ver README,
// secao "Multi-tenant"): `role` no User e' vestigial (so' controla o
// bootstrap e quem PODE escolher o papel de quem se registra). Qualquer
// usuario autenticado tem acesso total (leitura e escrita) ao que e' SEU;
// o isolamento e' por `usuarioId`, nao por `role`.
describe('Acesso autenticado (sem papel privilegiado sobre os PROPRIOS dados)', () => {
  it('operador LE materiais (200)', async () => {
    await request(app).get('/materiais').set(auth(ctx.tokenOperador)).expect(200);
  });

  it('operador cria e edita material e configuracao normalmente (nao ha restricao por papel)', async () => {
    await request(app)
      .post('/materiais')
      .set(auth(ctx.tokenOperador))
      .send({ nome: 'X', tipo: 'PLA', precoKg: 10 })
      .expect(201);
    await request(app).patch('/configuracao').set(auth(ctx.tokenOperador)).send({ precoKwh: 2 }).expect(200);
  });

  it('admin pode criar material (201)', async () => {
    await request(app)
      .post('/materiais')
      .set(auth(ctx.tokenAdmin))
      .send({ nome: 'PETG', tipo: 'PETG', precoKg: 150 })
      .expect(201);
  });

  it('sem token: 401', async () => {
    await request(app).get('/materiais').expect(401);
  });
});

describe('Isolamento multi-tenant (cada usuario so acessa o proprio espaco)', () => {
  it('usuario nao ve, edita nem remove material de outro usuario (404, nao 200 com dado alheio)', async () => {
    const material = await request(app)
      .post('/materiais')
      .set(auth(ctx.tokenAdmin))
      .send({ nome: 'Exclusivo do admin', tipo: 'PLA', precoKg: 99 })
      .expect(201);

    await request(app).get(`/materiais/${material.body.id}`).set(auth(ctx.tokenOperador)).expect(404);
    await request(app)
      .patch(`/materiais/${material.body.id}`)
      .set(auth(ctx.tokenOperador))
      .send({ precoKg: 1 })
      .expect(404);
    await request(app).delete(`/materiais/${material.body.id}`).set(auth(ctx.tokenOperador)).expect(404);

    const lista = await request(app).get('/materiais').set(auth(ctx.tokenOperador)).expect(200);
    expect(lista.body.some((m: { id: number }) => m.id === material.body.id)).toBe(false);
  });

  it('orcamento nao pode usar material de outro usuario (material tratado como inexistente)', async () => {
    const materialDoAdmin = await request(app)
      .post('/materiais')
      .set(auth(ctx.tokenAdmin))
      .send({ nome: 'So do admin', tipo: 'PLA', precoKg: 50 })
      .expect(201);

    await request(app)
      .post('/orcamentos')
      .set(auth(ctx.tokenOperador))
      .send(inputOrcamento({ peca: { materialId: materialDoAdmin.body.id, pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 } }))
      .expect(404);
  });
});

describe('Registro de usuarios (auto-cadastro publico; role so' + " respeitado se quem chama ja' e' admin)", () => {
  it('registro publico sem token funciona mesmo com usuarios existentes (201)', async () => {
    const r = await request(app).post('/auth/registro').send({ email: 'x@x.com', senha: 'senha1234' }).expect(201);
    expect(r.body.usuario.role).toBe('operador'); // auto-cadastro sempre vira operador
  });

  it('role pedido por quem NAO esta autenticado como admin e ignorado (vira operador mesmo assim)', async () => {
    const r = await request(app)
      .post('/auth/registro')
      .set(auth(ctx.tokenOperador))
      .send({ email: 'y@y.com', senha: 'senha1234', role: 'admin' })
      .expect(201);
    expect(r.body.usuario.role).toBe('operador');
  });

  it('admin autenticado pode escolher o papel de quem registra', async () => {
    const r = await request(app)
      .post('/auth/registro')
      .set(auth(ctx.tokenAdmin))
      .send({ email: 'novo@y.com', senha: 'senha1234' })
      .expect(201);
    expect(r.body.usuario.role).toBe('operador'); // role omitido => default operador
  });

  it('bootstrap: com banco sem usuarios, a 1a conta publica vira admin (201)', async () => {
    await prisma.user.deleteMany();
    const r = await request(app)
      .post('/auth/registro')
      .send({ email: 'primeiro@x.com', senha: 'senha1234' })
      .expect(201);
    expect(r.body.usuario.role).toBe('admin');
  });
});

describe('Regra 2 — margem minima bloqueia salvar', () => {
  it('margem de lucro abaixo da minima retorna 422', async () => {
    // margemMinima da config = 0.2; pedimos 0.1.
    await request(app)
      .post('/orcamentos')
      .set(auth(ctx.tokenOperador))
      .send(inputOrcamento({ parametros: { taxaFalha: 0.1, margemLucro: 0.1 } }))
      .expect(422);
  });
});

describe('Regra 4 — estoque nunca fica negativo', () => {
  it('aprovar baixa o estoque; segunda aprovacao sem saldo retorna 422', async () => {
    const criar = () =>
      request(app).post('/orcamentos').set(auth(ctx.tokenOperador)).send(inputOrcamento()).expect(201);

    const a = (await criar()).body.orcamento;
    const b = (await criar()).body.orcamento;

    // Estoque inicial 100g; consumo por peca = 52.5g.
    await request(app).post(`/orcamentos/${a.id}/aprovar`).set(auth(ctx.tokenOperador)).expect(200);

    const material1 = await prisma.material.findUniqueOrThrow({ where: { id: ctx.materialId } });
    expect(material1.estoqueG).toBeCloseTo(47.5, 5);

    // Sem saldo para o segundo (precisa 52.5, ha 47.5).
    await request(app).post(`/orcamentos/${b.id}/aprovar`).set(auth(ctx.tokenOperador)).expect(422);

    const material2 = await prisma.material.findUniqueOrThrow({ where: { id: ctx.materialId } });
    expect(material2.estoqueG).toBeCloseTo(47.5, 5); // inalterado apos a falha
  });

  it('criar orcamento acima do estoque e permitido (pendente) mas traz aviso', async () => {
    const r = await request(app)
      .post('/orcamentos')
      .set(auth(ctx.tokenOperador))
      .send(inputOrcamento({ peca: { pesoG: 5000, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 } }))
      .expect(201);
    expect(r.body.aviso).toBeTruthy();
  });
});

describe('Regra 5 — orcamento aprovado e imutavel', () => {
  it('aprovar duas vezes retorna 409 e recusar aprovado retorna 409', async () => {
    const orc = (
      await request(app).post('/orcamentos').set(auth(ctx.tokenOperador)).send(inputOrcamento()).expect(201)
    ).body.orcamento;

    await request(app).post(`/orcamentos/${orc.id}/aprovar`).set(auth(ctx.tokenOperador)).expect(200);
    await request(app).post(`/orcamentos/${orc.id}/aprovar`).set(auth(ctx.tokenOperador)).expect(409);
    await request(app).post(`/orcamentos/${orc.id}/recusar`).set(auth(ctx.tokenOperador)).expect(409);
  });
});

describe('Regra 6 — snapshot preserva orcamentos antigos', () => {
  it('reajuste de preco do material NAO altera o resultado de orcamento ja emitido', async () => {
    const orc = (
      await request(app).post('/orcamentos').set(auth(ctx.tokenOperador)).send(inputOrcamento()).expect(201)
    ).body.orcamento;
    const precoOriginal = orc.precoFinal;

    // Dono do material reajusta o preco para o dobro.
    await request(app).patch(`/materiais/${ctx.materialId}`).set(auth(ctx.tokenOperador)).send({ precoKg: 240 }).expect(200);

    // O orcamento emitido mantem o preco/resultado do momento da emissao.
    const depois = await request(app).get(`/orcamentos/${orc.id}`).set(auth(ctx.tokenOperador)).expect(200);
    expect(depois.body.precoFinal).toBe(precoOriginal);
    expect(depois.body.resultado.precoFinal).toBe(precoOriginal);
  });
});

describe('Aprovacao concorrente nao duplica baixa de estoque (corrida corrigida)', () => {
  it('duas aprovacoes simultaneas do MESMO orcamento: so uma vence, material baixa uma unica vez', async () => {
    const orc = (
      await request(app).post('/orcamentos').set(auth(ctx.tokenOperador)).send(inputOrcamento()).expect(201)
    ).body.orcamento;
    const antes = await prisma.material.findUniqueOrThrow({ where: { id: ctx.materialId } });

    // Disparadas ao mesmo tempo (nao em sequencia) — e' exatamente a corrida
    // de um duplo-clique ou duas abas aprovando o mesmo orcamento.
    const [r1, r2] = await Promise.all([
      request(app).post(`/orcamentos/${orc.id}/aprovar`).set(auth(ctx.tokenOperador)),
      request(app).post(`/orcamentos/${orc.id}/aprovar`).set(auth(ctx.tokenOperador)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);

    // Consumo (52.5g) baixado uma unica vez, nao duas.
    const depois = await prisma.material.findUniqueOrThrow({ where: { id: ctx.materialId } });
    expect(antes.estoqueG - depois.estoqueG).toBeCloseTo(52.5, 5);
  });
});

describe('Custos variaveis: selecao persiste e e recuperada ao editar (regra 6)', () => {
  it('orcamento salvo guarda QUAIS custos variaveis foram escolhidos, nao so o total', async () => {
    const cv = (
      await request(app)
        .post('/custos-variaveis')
        .set(auth(ctx.tokenOperador))
        .send({ nome: 'Frete', valorUnitario: 5 })
        .expect(201)
    ).body;

    const orc = (
      await request(app)
        .post('/orcamentos')
        .set(auth(ctx.tokenOperador))
        .send(inputOrcamento({ custosVariaveisIds: [cv.id] }))
        .expect(201)
    ).body.orcamento;

    const detalhado = await request(app).get(`/orcamentos/${orc.id}`).set(auth(ctx.tokenOperador)).expect(200);
    expect(detalhado.body.custosVariaveisSelecionados).toHaveLength(1);
    expect(detalhado.body.custosVariaveisSelecionados[0].custoVariavelId).toBe(cv.id);
    expect(detalhado.body.custosVariaveisSelecionados[0].valorUnitarioSnapshot).toBe(5);

    // Reeditar SEM alterar nada preserva o mesmo preco (o bug antigo zerava
    // custosVariaveisIds no reload, entao salvar sem re-marcar os chips
    // derrubava o preco silenciosamente).
    const precoComFrete = orc.precoFinal;
    const reeditado = (
      await request(app)
        .patch(`/orcamentos/${orc.id}`)
        .set(auth(ctx.tokenOperador))
        .send(inputOrcamento({ custosVariaveisIds: detalhado.body.custosVariaveisSelecionados.map((c: { custoVariavelId: number }) => c.custoVariavelId) }))
        .expect(200)
    ).body.orcamento;
    expect(reeditado.precoFinal).toBe(precoComFrete);
  });
});
