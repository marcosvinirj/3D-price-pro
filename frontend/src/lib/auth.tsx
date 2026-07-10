/** Contexto de autenticacao: guarda token/usuario e expoe login/logout. */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
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
      logout: () => {
        tokenStore.clear();
        localStorage.removeItem(USER_KEY);
        setUsuario(null);
      },
    }),
    [usuario],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
