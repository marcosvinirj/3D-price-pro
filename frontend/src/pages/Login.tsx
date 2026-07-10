import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button, Field, Input, Alerta, Logo } from '../components/ui';

export function LoginPage() {
  const { login, registrar } = useAuth();
  const navegar = useNavigate();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [email, setEmail] = useState('admin@exemplo.com');
  const [senha, setSenha] = useState('senha1234');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      if (modo === 'login') await login(email, senha);
      else await registrar(email, senha);
      navegar('/');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao autenticar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-brand-950/40">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow ring-1 ring-white/20">
            <Logo tamanho={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
            3D Price <span className="text-gradient">Pro</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {modo === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}
          </p>
        </div>

        <form onSubmit={enviar} className="animate-fade-in space-y-4 rounded-2xl border border-white/60 bg-white/80 p-6 shadow-lift backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
          <Field label="E-mail">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={8}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
            />
          </Field>

          {erro && <Alerta tipo="erro">{erro}</Alerta>}

          <Button type="submit" className="w-full" disabled={carregando}>
            {carregando ? 'Aguarde...' : modo === 'login' ? 'Entrar' : 'Registrar'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setModo(modo === 'login' ? 'registro' : 'login');
              setErro(null);
            }}
            className="w-full text-center text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            {modo === 'login' ? 'Não tem conta? Registrar' : 'Já tem conta? Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
