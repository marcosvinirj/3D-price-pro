/** Rotas de autenticacao: registro e login. */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, AppError, conflito } from '../http/errors.js';
import { validarBody } from '../http/validate.js';
import { usuarioOpcional } from './middleware.js';
import { gerarHash, conferirSenha } from './password.js';
import { assinarToken } from './jwt.js';

export const authRouter = Router();

const registroSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(8, 'Senha deve ter ao menos 8 caracteres'),
  /** Papel do novo usuario (apenas admin pode definir; default operador). */
  role: z.enum(['admin', 'operador']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

/**
 * Registro de usuarios.
 *
 * Bootstrap seguro: se ainda NAO existe nenhum usuario, a primeira conta e
 * criada livremente e vira `admin`. A partir dai, apenas um `admin` autenticado
 * pode cadastrar novos usuarios (e escolher o papel; default `operador`).
 * Isso fecha o auto-cadastro publico sem risco de lockout inicial.
 */
authRouter.post(
  '/registro',
  validarBody(registroSchema),
  asyncHandler(async (req, res) => {
    const { email, senha, role: papelSolicitado } = req.body as z.infer<typeof registroSchema>;

    const total = await prisma.user.count();
    const bootstrap = total === 0;

    // Depois do primeiro usuario, exige um admin autenticado.
    if (!bootstrap) {
      const solicitante = usuarioOpcional(req);
      if (!solicitante) {
        throw new AppError(401, 'Autenticacao necessaria para cadastrar usuarios', 'NAO_AUTENTICADO');
      }
      if (solicitante.role !== 'admin') {
        throw new AppError(403, 'Apenas administradores podem cadastrar usuarios', 'SEM_PERMISSAO');
      }
    }

    const existe = await prisma.user.findUnique({ where: { email } });
    if (existe) throw conflito('E-mail ja cadastrado');

    // O primeiro usuario e sempre admin; depois, o admin escolhe (default operador).
    const role = bootstrap ? 'admin' : (papelSolicitado ?? 'operador');

    const user = await prisma.user.create({
      data: { email, senhaHash: await gerarHash(senha), role },
    });

    const token = assinarToken({ sub: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, usuario: { id: user.id, email: user.email, role: user.role } });
  }),
);

authRouter.post(
  '/login',
  validarBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, senha } = req.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findUnique({ where: { email } });
    // Mesma resposta para email inexistente ou senha errada (evita enumeracao).
    if (!user || !(await conferirSenha(senha, user.senhaHash))) {
      throw new AppError(401, 'Credenciais invalidas', 'CREDENCIAIS_INVALIDAS');
    }

    const token = assinarToken({ sub: user.id, email: user.email, role: user.role });
    res.json({ token, usuario: { id: user.id, email: user.email, role: user.role } });
  }),
);
