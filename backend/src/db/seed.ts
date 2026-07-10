/** Popula o banco com dados iniciais para desenvolvimento/testes. */
import { prisma } from './prisma.js';
import { gerarHash } from '../auth/password.js';

async function main() {
  // Usuario admin padrao
  const email = 'admin@exemplo.com';
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({
      data: { email, senhaHash: await gerarHash('senha1234'), role: 'admin' },
    });
    console.log(`Usuario admin criado: ${email} / senha1234`);
  }

  // Configuracao global
  await prisma.configuracao.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // Moeda base e unica: Euro. Todo o calculo/armazenamento e em euros.
  await prisma.moeda.upsert({
    where: { codigo: 'EUR' },
    update: { nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true },
    create: { codigo: 'EUR', nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true },
  });
  // Mantem apenas o euro (remove moedas legadas como BRL/USD, se existirem).
  await prisma.moeda.deleteMany({ where: { codigo: { not: 'EUR' } } });

  // Material e impressora de exemplo
  if ((await prisma.material.count()) === 0) {
    await prisma.material.create({
      data: {
        nome: 'PLA Branco',
        tipo: 'PLA',
        precoKg: 120,
        densidade: 1.24,
        cor: 'Branco',
        estoqueG: 1000,
        estoqueMinimoG: 200,
        taxaDesperdicio: 0.05,
      },
    });
  }
  if ((await prisma.impressora.count()) === 0) {
    await prisma.impressora.create({
      data: { nome: 'Ender 3', potenciaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
    });
  }
  if ((await prisma.custoFixo.count()) === 0) {
    await prisma.custoFixo.createMany({
      data: [
        { nome: 'Aluguel', valorMensal: 800 },
        { nome: 'Internet', valorMensal: 100 },
        { nome: 'Marketing', valorMensal: 100 },
      ],
    });
  }
  if ((await prisma.custoVariavel.count()) === 0) {
    await prisma.custoVariavel.createMany({
      data: [
        { nome: 'Embalagem', valorUnitario: 0.5 },
        { nome: 'Etiqueta', valorUnitario: 0.1 },
        { nome: 'Saco zip', valorUnitario: 0.15 },
        { nome: 'Alcool isopropilico', valorUnitario: 0.2 },
        { nome: 'Frete/Correios', valorUnitario: 3.5 },
      ],
    });
  }

  console.log('Seed concluido.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
