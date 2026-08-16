/** Erros HTTP tipados e utilitarios de tratamento de erro. */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ErroValidacaoPrecificacao } from '../pricing/index.js';

/** Erro de aplicacao com status HTTP e codigo semantico. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo = 'ERRO',
    readonly detalhes?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const naoEncontrado = (recurso: string) =>
  new AppError(404, `${recurso} nao encontrado`, 'NAO_ENCONTRADO');

export const conflito = (msg: string) => new AppError(409, msg, 'CONFLITO');

export const regraDeNegocio = (msg: string, detalhes?: unknown) =>
  new AppError(422, msg, 'REGRA_DE_NEGOCIO', detalhes);

/** 402 Payment Required — saldo de creditos nao cobre a acao. */
export const creditosInsuficientes = (necessarios: number, disponiveis: number) =>
  new AppError(
    402,
    `Creditos insuficientes: essa acao custa ${necessarios}, voce tem ${disponiveis}.`,
    'CREDITOS_INSUFICIENTES',
    { necessarios, disponiveis },
  );

/** Envolve handlers async para encaminhar erros ao errorHandler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** Middleware central de erros — sempre a ultima camada do app. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ codigo: err.codigo, mensagem: err.message, detalhes: err.detalhes });
  }
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ codigo: 'VALIDACAO', mensagem: 'Dados invalidos', detalhes: err.flatten() });
  }
  if (err instanceof ErroValidacaoPrecificacao) {
    return res
      .status(422)
      .json({ codigo: 'PRECIFICACAO_INVALIDA', mensagem: err.message, detalhes: err.issues });
  }
  // Corrida entre duas requisicoes quase simultaneas (ex.: duplo-clique num
  // cadastro/registro) pode passar pela checagem previa e so' esbarrar na
  // constraint unica do banco — sem isso, virava 500 generico em vez de um
  // 409 com mensagem legivel.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const alvo = Array.isArray(err.meta?.target) ? (err.meta.target as string[]).join(', ') : undefined;
    return res.status(409).json({
      codigo: 'CONFLITO',
      mensagem: alvo ? `Já existe um registro com esse ${alvo}.` : 'Registro duplicado.',
    });
  }
  console.error('Erro nao tratado:', err);
  return res.status(500).json({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' });
}
