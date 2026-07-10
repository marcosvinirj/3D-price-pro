/**
 * Tema claro/escuro. Aplica a classe `dark` no <html> (Tailwind darkMode:'class')
 * e persiste a escolha. Default segue a preferência do sistema.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Tema = 'claro' | 'escuro';

interface TemaCtx {
  tema: Tema;
  alternar: () => void;
  setTema: (t: Tema) => void;
}

const Ctx = createContext<TemaCtx | null>(null);
const CHAVE = 'p3d.tema';

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === 'claro' || salvo === 'escuro') return salvo;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

function aplicar(t: Tema) {
  const raiz = document.documentElement;
  raiz.classList.toggle('dark', t === 'escuro');
  raiz.style.colorScheme = t === 'escuro' ? 'dark' : 'light';
}

export function TemaProvider({ children }: { children: ReactNode }) {
  const [tema, setTemaState] = useState<Tema>(temaInicial);

  useEffect(() => {
    aplicar(tema);
    localStorage.setItem(CHAVE, tema);
  }, [tema]);

  const value: TemaCtx = {
    tema,
    setTema: setTemaState,
    alternar: () => setTemaState((t) => (t === 'escuro' ? 'claro' : 'escuro')),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTema() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTema deve ser usado dentro de <TemaProvider>');
  return ctx;
}
