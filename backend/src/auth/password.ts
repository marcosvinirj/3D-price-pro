/** Hash e verificacao de senha com bcrypt (senhas nunca em texto puro). */
import bcrypt from 'bcryptjs';

const CUSTO = 10;

export function gerarHash(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

export function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}
