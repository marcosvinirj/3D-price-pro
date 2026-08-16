/**
 * Contexto de creditos: saldo atual + assinatura, recarregado apos login e
 * exposto pra qualquer tela mostrar/atualizar (ex.: widget no topo, ou apos
 * salvar um orcamento/gerar PDF, que consomem credito).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import type { SaldoCreditos } from './types';

/** Espelha as constantes de backend/src/modules/creditos/service.ts. */
export const CUSTO_ORCAMENTO = 20;
export const CUSTO_PDF = 10;

interface CreditosContextValue {
  saldo: SaldoCreditos | null;
  carregando: boolean;
  recarregar: () => void;
}

const CreditosContext = createContext<CreditosContextValue | null>(null);

export function CreditosProvider({ children }: { children: ReactNode }) {
  const { autenticado } = useAuth();
  const [saldo, setSaldo] = useState<SaldoCreditos | null>(null);
  const [carregando, setCarregando] = useState(false);

  function carregar() {
    setCarregando(true);
    api
      .get<SaldoCreditos>('/creditos')
      .then(setSaldo)
      .catch(() => setSaldo(null))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    if (autenticado) carregar();
    else setSaldo(null);
  }, [autenticado]);

  const value = useMemo<CreditosContextValue>(
    () => ({ saldo, carregando, recarregar: carregar }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saldo, carregando],
  );

  return <CreditosContext.Provider value={value}>{children}</CreditosContext.Provider>;
}

export function useCreditos() {
  const ctx = useContext(CreditosContext);
  if (!ctx) throw new Error('useCreditos deve ser usado dentro de CreditosProvider');
  return ctx;
}
