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
 * Auto-cadastro publico e permitido. O primeiro usuario do sistema vira
 * `admin` (bootstrap). Depois disso, quem se cadastra sozinho (sem estar
 * autenticado como admin) sempre vira `operador` — o campo `role` do corpo
 * so e respeitado quando quem chama ja e um admin autenticado, evitando que
 * qualquer visitante se auto-promova a admin.
 */
authRouter.post(
  '/registro',
  validarBody(registroSchema),
  asyncHandler(async (req, res) => {
    const { senha, role: papelSolicitado } = req.body as z.infer<typeof registroSchema>;
    // Normaliza p/ minuscula: sem isso "User@x.com" e "user@x.com" cadastram
    // como contas DIFERENTES (Postgres compara string com case-sensitivity).
    const email = (req.body as z.infer<typeof registroSchema>).email.toLowerCase();

    const total = await prisma.user.count();
    const bootstrap = total === 0;
    const solicitante = usuarioOpcional(req);
    const solicitanteEhAdmin = solicitante?.role === 'admin';

    const existe = await prisma.user.findUnique({ where: { email } });
    if (existe) throw conflito('E-mail ja cadastrado');

    // Primeiro usuario e sempre admin; um admin autenticado escolhe o papel;
    // qualquer outro auto-cadastro vira operador, ignorando o role pedido.
    const role = bootstrap ? 'admin' : solicitanteEhAdmin ? (papelSolicitado ?? 'operador') : 'operador';

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
    const { senha } = req.body as z.infer<typeof loginSchema>;
    const email = (req.body as z.infer<typeof loginSchema>).email.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    // Mesma resposta para email inexistente ou senha errada (evita enumeracao).
    if (!user || !(await conferirSenha(senha, user.senhaHash))) {
      throw new AppError(401, 'Credenciais invalidas', 'CREDENCIAIS_INVALIDAS');
    }

    const token = assinarToken({ sub: user.id, email: user.email, role: user.role });
    res.json({ token, usuario: { id: user.id, email: user.email, role: user.role } });
  }),
);
