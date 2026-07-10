/** Acesso aos parametros globais de precificacao (linha unica, id = 1). */
import { prisma } from '../../db/prisma.js';

export async function obterConfiguracao() {
  return prisma.configuracao.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}
