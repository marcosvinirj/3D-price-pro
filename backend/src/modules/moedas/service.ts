/** Acesso a moedas de exibicao (por usuario). Garante que a base (EUR) sempre exista. */
import { prisma } from '../../db/prisma.js';

export async function garantirBase(usuarioId: number) {
  await prisma.moeda.upsert({
    where: { usuarioId_codigo: { usuarioId, codigo: 'EUR' } },
    update: { base: true, taxaParaBase: 1 },
    create: { usuarioId, codigo: 'EUR', nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true },
  });
}

export async function listarMoedas(usuarioId: number) {
  await garantirBase(usuarioId);
  const moedas = await prisma.moeda.findMany({ where: { usuarioId } });
  // Base primeiro, depois alfabetico.
  return moedas.sort((a, b) => Number(b.base) - Number(a.base) || a.codigo.localeCompare(b.codigo));
}

/** Busca uma moeda pelo codigo (ou a base, se nao informado/invalido), do usuario. */
export async function obterMoedaOuBase(usuarioId: number, codigo?: string) {
  await garantirBase(usuarioId);
  if (codigo) {
    const m = await prisma.moeda.findUnique({
      where: { usuarioId_codigo: { usuarioId, codigo: codigo.toUpperCase() } },
    });
    if (m) return m;
  }
  return prisma.moeda.findUniqueOrThrow({ where: { usuarioId_codigo: { usuarioId, codigo: 'EUR' } } });
}
