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

/** Exige que o usuario tenha um dos papeis informados. */
export function exigirPapel(...papeis: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario) throw new AppError(401, 'Nao autenticado', 'NAO_AUTENTICADO');
    if (!papeis.includes(req.usuario.role)) {
      throw new AppError(403, 'Sem permissao', 'SEM_PERMISSAO');
    }
    next();
  };
}

/** Metodos HTTP que apenas leem (nao alteram estado). */
const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Exige papel `admin` para metodos de escrita (POST/PUT/PATCH/DELETE),
 * mas libera leituras (GET/HEAD) a qualquer usuario autenticado. Usado nos
 * recursos de configuracao de negocio, que o operador precisa consultar para
 * montar orcamentos, mas nao deve poder alterar.
 */
export function exigirAdminParaEscrita(req: Request, res: Response, next: NextFunction) {
  if (METODOS_LEITURA.has(req.method)) return next();
  return exigirPapel('admin')(req, res, next);
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
