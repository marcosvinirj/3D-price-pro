/** Guarda de autenticacao/autorizacao baseada em JWT. */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../http/errors.js';
import { verificarToken, type PayloadToken } from './jwt.js';

/** Anexa o usuario autenticado a `req.usuario`; exige token valido. */
export function autenticar(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Token ausente', 'NAO_AUTENTICADO');
  }
  const token = header.slice('Bearer '.length);
  try {
    req.usuario = verificarToken(token);
    next();
  } catch {
    throw new AppError(401, 'Token invalido ou expirado', 'NAO_AUTENTICADO');
  }
}

/**
 * Extrai e valida o usuario de uma requisicao SEM exigir autenticacao.
 * Retorna o payload se houver um Bearer token valido; caso contrario, `null`.
 * Util para rotas com regra condicional (ex.: bootstrap do primeiro admin).
 */
export function usuarioOpcional(req: Request): PayloadToken | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    return verificarToken(header.slice('Bearer '.length));
  } catch {
    return null;
  }
}

// Augmenta o Request do Express para carregar o usuario autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: PayloadToken;
    }
  }
}
