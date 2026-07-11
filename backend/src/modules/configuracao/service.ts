/** Acesso aos parametros de precificacao de um usuario (uma linha por usuario). */
import { prisma } from '../../db/prisma.js';

export async function obterConfiguracao(usuarioId: number) {
  return prisma.configuracao.upsert({
    where: { usuarioId },
    update: {},
    create: { usuarioId },
  });
}
