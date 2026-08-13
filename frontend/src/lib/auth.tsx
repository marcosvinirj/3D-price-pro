/** Contexto de autenticacao: guarda token/usuario e expoe login/logout. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, EVENTO_SESSAO_EXPIRADA, tokenStore } from './api';
import type { RespostaAuth, Usuario } from './types';

interface AuthContextValue {
  usuario: Usuario | null;
  autenticado: boolean;
  login: (email: string, senha: string) => Promise<void>;
  registrar: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = 'precificacao3d.usuario';

function lerUsuario(): Usuario | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as Usuario) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(
    tokenStore.get() ? lerUsuario() : null,
  );

  function limparSessao() {
    tokenStore.clear();
    localStorage.removeItem(USER_KEY);
    setUsuario(null);
  }

  // Quando o api.ts leva um 401 (token ausente/expirado) em QUALQUER
  // requisicao, ele dispara esse evento — sem isso, `autenticado` continuava
  // `true` (o token ja tinha sido descartado, mas o estado React nao sabia),
  // e a tela ficava "logada" so' dando erro ate' o usuario atualizar a pagina.
  useEffect(() => {
    const aoExpirar = () => limparSessao();
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function autenticar(rota: 'login' | 'registro', email: string, senha: string) {
    const resp = await api.post<RespostaAuth>(`/auth/${rota}`, { email, senha });
    tokenStore.set(resp.token);
    localStorage.setItem(USER_KEY, JSON.stringify(resp.usuario));
    setUsuario(resp.usuario);
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      usuario,
      autenticado: !!usuario,
      login: (email, senha) => autenticar('login', email, senha),
      registrar: (email, senha) => autenticar('registro', email, senha),
      logout: limparSessao,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usuario],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
