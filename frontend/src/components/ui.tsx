/** Design system minimo: componentes consistentes reutilizados nas telas. */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/** Marca do produto (cubo 3D em SVG, sem dependência externa). */
export function Logo({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" className="fill-brand-600" />
      <path d="M12 2 21 7l-9 5-9-5 9-5Z" className="fill-brand-500" />
      <path d="M12 12 21 7v10l-9 5V12Z" className="fill-brand-700" />
    </svg>
  );
}

export function Button({
  variante = 'primario',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'secundario' | 'perigo';
}) {
  const base =
    'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';
  const estilos = {
    primario: 'bg-brand-gradient text-white shadow-glow hover:brightness-110 hover:shadow-lift',
    secundario:
      'bg-white/80 text-slate-700 border border-slate-200 shadow-soft hover:bg-white hover:border-slate-300 dark:bg-slate-800/70 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:border-slate-600',
    perigo: 'bg-red-600 text-white shadow-soft hover:bg-red-700',
  }[variante];
  return <button className={`${base} ${estilos} ${className}`} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-soft transition focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400 dark:focus:bg-slate-800 dark:[color-scheme:dark]';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputCls} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputCls} {...props} />;
}

export function Card({
  titulo,
  acoes,
  children,
  className = '',
}: {
  titulo?: string;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-soft backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 ${className}`}
    >
      {(titulo || acoes) && (
        <div className="mb-4 flex items-center justify-between">
          {titulo && (
            <h2 className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100">{titulo}</h2>
          )}
          {acoes}
        </div>
      )}
      {children}
    </div>
  );
}

export function Alerta({
  tipo = 'info',
  children,
}: {
  tipo?: 'info' | 'erro' | 'sucesso' | 'aviso';
  children: ReactNode;
}) {
  const estilos = {
    info: 'bg-brand-50 text-brand-700 border-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:border-brand-500/20',
    erro: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',
    sucesso: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
    aviso: 'bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  }[tipo];
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${estilos}`} role="status">
      {children}
    </div>
  );
}

/** Cartao de indicador (hero number). Cor opcional apenas como acento. */
export function StatTile({
  rotulo,
  valor,
  detalhe,
  acento,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  acento?: string;
}) {
  return (
    <div className="card-hover relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-soft backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60">
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: acento ?? 'linear-gradient(135deg,#6366f1,#7c3aed)' }}
      />
      <div className="flex items-center gap-2">
        {acento && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: acento }} />}
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{rotulo}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{detalhe}</div>}
    </div>
  );
}

/** Formatadores compartilhados. */
export const eur = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'EUR' });
export const pct = (fracao: number) => `${(fracao * 100).toFixed(1)}%`;
export const gramas = (g: number) => `${g.toLocaleString('pt-BR')} g`;
