/** Middleware de validacao Zod para body/params/query. */
import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors.js';

/** Extrai e valida um :id numerico positivo da rota. */
export function obterId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'id invalido', 'VALIDACAO');
  }
  return id;
}

/**
 * Valida `req.body` contra o schema e substitui por dados ja tipados/limpos.
 * Em caso de erro, o ZodError e encaminhado ao errorHandler (HTTP 400).
 */
export function validarBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data as z.infer<S>;
    next();
  };
}

/** Valida e converte params (ex.: :id numerico). */
export function validarParams<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return next(parsed.error);
    // params e read-only em alguns tipos; guardamos em locals para uso tipado.
    (req as Request & { paramsValidados: unknown }).paramsValidados = parsed.data;
    next();
  };
}
