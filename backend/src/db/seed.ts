/** Popula o banco com dados iniciais para desenvolvimento/testes. */
import { prisma } from './prisma.js';
import { gerarHash } from '../auth/password.js';

async function main() {
  // Usuario admin padrao
  const email = 'admin@exemplo.com';
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email, senhaHash: await gerarHash('senha1234'), role: 'admin' },
    });
    console.log(`Usuario admin criado: ${email} / senha1234`);
  }
  const usuarioId = admin.id;

  // Configuracao do admin (multi-tenant: uma linha por usuario)
  await prisma.configuracao.upsert({ where: { usuarioId }, update: {}, create: { usuarioId } });

  // Moeda base do admin e unica: Euro. Todo o calculo/armazenamento e em euros.
  await prisma.moeda.upsert({
    where: { usuarioId_codigo: { usuarioId, codigo: 'EUR' } },
    update: { nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true },
    create: { usuarioId, codigo: 'EUR', nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true },
  });
  // Mantem apenas o euro (remove moedas legadas como BRL/USD, se existirem).
  await prisma.moeda.deleteMany({ where: { usuarioId, codigo: { not: 'EUR' } } });

  // Material e impressora de exemplo (dados iniciais do admin)
  if ((await prisma.material.count({ where: { usuarioId } })) === 0) {
    await prisma.material.create({
      data: {
        usuarioId,
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
  if ((await prisma.impressora.count({ where: { usuarioId } })) === 0) {
    await prisma.impressora.create({
      data: { usuarioId, nome: 'Ender 3', potenciaW: 200, potenciaMediaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
    });
  }
  if ((await prisma.custoFixo.count({ where: { usuarioId } })) === 0) {
    await prisma.custoFixo.createMany({
      data: [
        { usuarioId, nome: 'Aluguel', valorMensal: 800 },
        { usuarioId, nome: 'Internet', valorMensal: 100 },
        { usuarioId, nome: 'Marketing', valorMensal: 100 },
      ],
    });
  }
  if ((await prisma.custoVariavel.count({ where: { usuarioId } })) === 0) {
    await prisma.custoVariavel.createMany({
      data: [
        { usuarioId, nome: 'Embalagem', valorUnitario: 0.5 },
        { usuarioId, nome: 'Etiqueta', valorUnitario: 0.1 },
        { usuarioId, nome: 'Saco zip', valorUnitario: 0.15 },
        { usuarioId, nome: 'Alcool isopropilico', valorUnitario: 0.2 },
        { usuarioId, nome: 'Frete/Correios', valorUnitario: 3.5 },
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
