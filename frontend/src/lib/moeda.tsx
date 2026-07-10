/**
 * Contexto de moeda de EXIBICAO. O sistema calcula sempre na moeda base (EUR);
 * aqui apenas convertemos e formatamos os valores mostrados na tela (e passamos
 * o código para o PDF). As taxas vêm do backend (/moedas).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';

export interface Moeda {
  codigo: string;
  nome: string;
  simbolo: string;
  taxaParaBase: number;
  base: boolean;
}

interface MoedaContextValue {
  moedas: Moeda[];
  atual: Moeda;
  codigoAtual: string;
  setCodigo: (codigo: string) => void;
  recarregar: () => void;
  /** Converte um valor na moeda base (EUR) para a moeda atual e formata com o símbolo. */
  fmt: (valorBase: number) => string;
}

const EUR: Moeda = { codigo: 'EUR', nome: 'Euro', simbolo: '€', taxaParaBase: 1, base: true };
const CHAVE = 'precificacao3d.moeda';

const MoedaContext = createContext<MoedaContextValue | null>(null);

export function MoedaProvider({ children }: { children: ReactNode }) {
  const { autenticado } = useAuth();
  const [moedas, setMoedas] = useState<Moeda[]>([EUR]);
  const [codigoAtual, setCodigoAtual] = useState<string>(localStorage.getItem(CHAVE) ?? 'EUR');

  function carregar() {
    api
      .get<Moeda[]>('/moedas')
      .then((ms) => setMoedas(ms.length ? ms : [EUR]))
      .catch(() => setMoedas([EUR]));
  }

  useEffect(() => {
    if (autenticado) carregar();
  }, [autenticado]);

  const value = useMemo<MoedaContextValue>(() => {
    const atual = moedas.find((m) => m.codigo === codigoAtual) ?? moedas[0] ?? EUR;
    return {
      moedas,
      atual,
      codigoAtual: atual.codigo,
      setCodigo: (codigo) => {
        localStorage.setItem(CHAVE, codigo);
        setCodigoAtual(codigo);
      },
      recarregar: carregar,
      fmt: (valorBase: number) => {
        const v = valorBase / atual.taxaParaBase;
        return `${atual.simbolo} ${v.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      },
    };
  }, [moedas, codigoAtual]);

  return <MoedaContext.Provider value={value}>{children}</MoedaContext.Provider>;
}

export function useMoeda() {
  const ctx = useContext(MoedaContext);
  if (!ctx) throw new Error('useMoeda deve ser usado dentro de MoedaProvider');
  return ctx;
}
