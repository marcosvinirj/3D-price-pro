import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useMoeda } from '../lib/moeda';
import { useCreditos } from '../lib/creditos';
import { useTema } from '../lib/theme';
import { Logo } from './ui';
import {
  IconBolt,
  IconBox,
  IconCalc,
  IconClose,
  IconCoins,
  IconDashboard,
  IconDoc,
  IconGear,
  IconHome,
  IconLogout,
  IconMenu,
  IconMoon,
  IconPrinter,
  IconSpool,
  IconSun,
  IconWallet,
} from './icons';

type Item = { to: string; label: string; end?: boolean; icon: (p: any) => JSX.Element };

const GRUPOS: { titulo: string; itens: Item[] }[] = [
  {
    titulo: 'Operação',
    itens: [
      { to: '/', label: 'Dashboard', end: true, icon: IconDashboard },
      { to: '/simulador', label: 'Novo orçamento', icon: IconCalc },
      { to: '/orcamentos', label: 'Orçamentos', icon: IconDoc },
    ],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { to: '/materiais', label: 'Filamentos', icon: IconSpool },
      { to: '/impressoras', label: 'Impressoras', icon: IconPrinter },
      { to: '/custos-fixos', label: 'Custos fixos', icon: IconHome },
      { to: '/custos-variaveis', label: 'Custos variáveis', icon: IconBolt },
      { to: '/insumos', label: 'Insumos', icon: IconBox },
    ],
  },
  {
    titulo: 'Ajustes',
    itens: [
      { to: '/creditos', label: 'Créditos', icon: IconWallet },
      { to: '/moedas', label: 'Moedas', icon: IconCoins },
      { to: '/configuracao', label: 'Configuração', icon: IconGear },
    ],
  },
];

function TituloPagina() {
  const { pathname } = useLocation();
  const todos = GRUPOS.flatMap((g) => g.itens);
  const atual =
    todos.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== '/')) ??
    todos.find((i) => i.to === '/');
  return <span>{atual?.label ?? 'Price 3D'}</span>;
}

/** Indicador de creditos no topo (estilo "⚡100") + atalho pra assinar. */
function WidgetCreditos() {
  const { saldo } = useCreditos();
  const baixo = !saldo?.ilimitado && saldo !== null && saldo.creditos < 20; // menos que 1 orcamento

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/creditos"
        title={saldo?.ilimitado ? 'Conta isenta — créditos ilimitados' : 'Ver créditos'}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
          baixo
            ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
      >
        <IconBolt className={baixo ? 'text-amber-500' : 'text-brand-500'} />
        {saldo?.ilimitado ? '∞' : (saldo?.creditos ?? '—')}
      </Link>
      {!saldo?.assinaturaAtiva && !saldo?.ilimitado && (
        <Link
          to="/creditos"
          className="hidden h-9 items-center rounded-lg bg-brand-gradient px-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 sm:inline-flex"
        >
          Assinar
        </Link>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { tema, alternar } = useTema();
  const escuro = tema === 'escuro';
  return (
    <button
      onClick={alternar}
      title={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-label="Alternar tema"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {escuro ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function SidebarConteudo({ onNavegar }: { onNavegar?: () => void }) {
  const { usuario, logout } = useAuth();

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-brand-gradient text-white shadow-glow'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
    }`;

  return (
    <div className="flex h-full flex-col">
      {/* Marca */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="rounded-xl bg-brand-gradient p-1.5 shadow-glow">
          <Logo tamanho={22} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
            Price <span className="text-gradient">3D</span>
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Precificação inteligente
          </div>
        </div>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {GRUPOS.map((g) => (
          <div key={g.titulo}>
            <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
              {g.titulo}
            </div>
            <div className="space-y-0.5">
              {g.itens.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={linkCls} onClick={onNavegar}>
                  <i.icon />
                  <span>{i.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Rodapé: usuário + sair */}
      <div className="border-t border-slate-200/70 p-3 dark:border-slate-800">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
            {(usuario?.email ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
              {usuario?.email}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-600">
              {usuario?.role ?? 'operador'}
            </div>
          </div>
          <button
            onClick={logout}
            title="Sair"
            aria-label="Sair"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <IconLogout />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const { moedas, codigoAtual, setCodigo } = useMoeda();
  const [aberto, setAberto] = useState(false);

  const seletorMoeda = (
    <select
      value={codigoAtual}
      onChange={(e) => setCodigo(e.target.value)}
      title="Moeda de exibição"
      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
    >
      {moedas.map((m) => (
        <option key={m.codigo} value={m.codigo}>
          {m.codigo} · {m.simbolo}
        </option>
      ))}
    </select>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Sidebar fixa (desktop) */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-64 border-r lg:block">
        <SidebarConteudo />
      </aside>

      {/* Drawer (mobile) */}
      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setAberto(false)}
          />
          <aside className="glass absolute inset-y-0 left-0 w-72 border-r shadow-2xl animate-fade-in">
            <button
              onClick={() => setAberto(false)}
              aria-label="Fechar menu"
              className="absolute right-3 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <IconClose />
            </button>
            <SidebarConteudo onNavegar={() => setAberto(false)} />
          </aside>
        </div>
      )}

      {/* Topbar */}
      <header className="glass sticky top-0 z-20 border-b">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAberto(true)}
              aria-label="Abrir menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <IconMenu />
            </button>
            <h1 className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100">
              <TituloPagina />
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <WidgetCreditos />
            {seletorMoeda}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main
        key={useLocation().pathname}
        className="mx-auto max-w-6xl animate-fade-in px-4 py-6 lg:px-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
