/** Emissao e verificacao de tokens JWT (stateless). */
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface PayloadToken {
  sub: number; // id do usuario
  email: string;
  role: string;
}

export function assinarToken(payload: PayloadToken): string {
  // Cast do objeto de opcoes evita atrito com exactOptionalPropertyTypes.
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as SignOptions);
}

export function verificarToken(token: string): PayloadToken {
  return jwt.verify(token, env.JWT_SECRET) as unknown as PayloadToken;
}
