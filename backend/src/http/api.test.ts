/**
 * Testes de integracao da API (Express + Prisma + SQLite de teste).
 *
 * Exercitam ponta a ponta as regras de negocio que dependem de persistencia
 * (2, 4, 5, 6) e as garantias de autorizacao (papeis nas escritas + registro
 * fechado). Rodam contra prisma/test.db, recriado pelo globalSetup.
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

  await prisma.configuracao.create({
    data: { id: 1, precoKwh: 1, valorHoraTrabalho: 20, horasProdutivasMes: 160, margemMinima: 0.2 },
  });
  const material = await prisma.material.create({
    data: { nome: 'PLA', tipo: 'PLA', precoKg: 120, estoqueG: 100, estoqueMinimoG: 10, taxaDesperdicio: 0.05 },
  });
  const impressora = await prisma.impressora.create({
    data: { nome: 'Ender 3', potenciaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
  });

  ctx = {
    materialId: material.id,
    impressoraId: impressora.id,
    tokenAdmin: assinarToken({ sub: admin.id, email: admin.email, role: 'admin' }),
    tokenOperador: assinarToken({ sub: operador.id, email: operador.email, role: 'operador' }),
  };
});

/** Entrada padrao de orcamento (peso 50g => consumo 52.5g com 5% de desperdicio). */
function inputOrcamento(over: Record<string, unknown> = {}) {
  return {
    materialId: ctx.materialId,
    impressoraId: ctx.impressoraId,
    peca: { pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 },
    parametros: { taxaFalha: 0.1, margemLucro: 0.5 },
    ...over,
  };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Autorizacao (papeis nas escritas)', () => {
  it('operador LE materiais (200)', async () => {
    await request(app).get('/materiais').set(auth(ctx.tokenOperador)).expect(200);
  });

  it('operador NAO pode criar material (403)', async () => {
    await request(app)
      .post('/materiais')
      .set(auth(ctx.tokenOperador))
      .send({ nome: 'X', tipo: 'PLA', precoKg: 10 })
      .expect(403);
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

  it('operador NAO pode alterar configuracao (403); admin pode (200)', async () => {
    await request(app).patch('/configuracao').set(auth(ctx.tokenOperador)).send({ precoKwh: 2 }).expect(403);
    await request(app).patch('/configuracao').set(auth(ctx.tokenAdmin)).send({ precoKwh: 2 }).expect(200);
  });
});

describe('Registro de usuarios (fechado apos bootstrap)', () => {
  it('registro publico sem token e recusado quando ja ha usuarios (401)', async () => {
    await request(app).post('/auth/registro').send({ email: 'x@x.com', senha: 'senha1234' }).expect(401);
  });

  it('operador nao pode registrar usuarios (403)', async () => {
    await request(app)
      .post('/auth/registro')
      .set(auth(ctx.tokenOperador))
      .send({ email: 'y@y.com', senha: 'senha1234' })
      .expect(403);
  });

  it('admin registra operador por padrao (201)', async () => {
    const r = await request(app)
      .post('/auth/registro')
      .set(auth(ctx.tokenAdmin))
      .send({ email: 'novo@y.com', senha: 'senha1234' })
      .expect(201);
    expect(r.body.usuario.role).toBe('operador');
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

    // Admin reajusta o material para o dobro do preco.
    await request(app).patch(`/materiais/${ctx.materialId}`).set(auth(ctx.tokenAdmin)).send({ precoKg: 240 }).expect(200);

    // O orcamento emitido mantem o preco/resultado do momento da emissao.
    const depois = await request(app).get(`/orcamentos/${orc.id}`).set(auth(ctx.tokenOperador)).expect(200);
    expect(depois.body.precoFinal).toBe(precoOriginal);
    expect(depois.body.resultado.precoFinal).toBe(precoOriginal);
  });
});
