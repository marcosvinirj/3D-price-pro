/** Acesso a moedas de exibicao. Garante que a base (EUR) sempre exista. */
import { prisma } from '../../db/prisma.js';

export async function garantirBase() {
  await prisma.moeda.upsert({
    where: { codigo: 'EUR' },
    update: { base: true, taxaParaBase: 1 },
    create: { codigo: 'EUR', nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true },
  });
}

export async function listarMoedas() {
  await garantirBase();
  const moedas = await prisma.moeda.findMany();
  // Base primeiro, depois alfabetico.
  return moedas.sort((a, b) => Number(b.base) - Number(a.base) || a.codigo.localeCompare(b.codigo));
}

/** Busca uma moeda pelo codigo (ou a base, se nao informado/invalido). */
export async function obterMoedaOuBase(codigo?: string) {
  await garantirBase();
  if (codigo) {
    const m = await prisma.moeda.findUnique({ where: { codigo: codigo.toUpperCase() } });
    if (m) return m;
  }
  return prisma.moeda.findUniqueOrThrow({ where: { codigo: 'EUR' } });
}
