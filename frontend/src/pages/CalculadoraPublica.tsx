/**
 * Calculadora publica (sem login) — a porta de entrada do site.
 *
 * O visitante calcula uma estimativa sem criar conta; o PRECO FINAL aparece
 * embaçado ate' ele se cadastrar. No cadastro ele ganha os creditos de bonus
 * e a liberacao consome 20 creditos pelo mesmo caminho de sempre
 * (POST /creditos/revelar -> `debitar`).
 *
 * Nao usa o catalogo de ninguem: manda numeros crus pra /publico/simular, que
 * roda o motor puro com premissas de demonstracao.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce } from '../lib/useDebounce';
import { Alerta, Button, Card, Field, Input } from '../components/ui';
import { IconBolt } from '../components/icons';

/** Resposta de POST /publico/simular (motor single-peca: sem `itens`). */
interface RespostaPublica {
  resultado: {
    precoFinal: number;
    precoBruto: number;
    custos: {
      custoMaterial: number;
      custoEnergia: number;
      depreciacao: number;
      maoDeObra: number;
      custoFixoRateado: number;
      custoVariavel: number;
      custoInsumos: number;
      custoTotal: number;
      custoComFalha: number;
    };
    margem: { lucro: number; real: number; markupSobreCusto: number };
  };
  premissas: Record<string, number>;
}

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

interface FormPublico {
  pesoG: string;
  precoKg: string;
  horas: string;
  minutos: string;
  margemPct: string;
}

const inicial: FormPublico = { pesoG: '50', precoKg: '20', horas: '4', minutos: '0', margemPct: '60' };

export function CalculadoraPublicaPage() {
  const { autenticado, registrar } = useAuth();
  const navegar = useNavigate();

  const [form, setForm] = useState<FormPublico>(inicial);
  const [resp, setResp] = useState<RespostaPublica | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Revelado = cadastrou e os creditos foram debitados.
  const [revelado, setRevelado] = useState(false);
  const [mostrarCadastro, setMostrarCadastro] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);

  const payload = useMemo(() => {
    const pesoG = Number(form.pesoG);
    const precoKg = Number(form.precoKg);
    const tempoImpressaoH = (Number(form.horas) || 0) + (Number(form.minutos) || 0) / 60;
    const margemLucro = (Number(form.margemPct) || 0) / 100;
    if (!pesoG || pesoG <= 0 || margemLucro >= 1 || margemLucro < 0) return null;
    return { pesoG, precoKg: precoKg || 0, tempoImpressaoH, margemLucro };
  }, [form]);

  const payloadDebounced = useDebounce(payload, 350);

  useEffect(() => {
    if (!payloadDebounced) return;
    let cancelado = false;
    api
      .post<RespostaPublica>('/publico/simular', payloadDebounced)
      .then((r) => !cancelado && (setResp(r), setErro(null)))
      .catch((e) => !cancelado && setErro(e instanceof ApiError ? e.message : 'Erro ao calcular'));
    return () => {
      cancelado = true;
    };
  }, [payloadDebounced]);

  function set<K extends keyof FormPublico>(campo: K, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }));
    // Mudou a entrada depois de revelar: o numero segue visivel (ja' foi pago).
  }

  async function cadastrarERevelar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErroCadastro(null);
    try {
      await registrar(email, senha);
      // Mesmo custo e mesmo mecanismo de um orcamento (20 creditos).
      await api.post('/creditos/revelar');
      setRevelado(true);
      setMostrarCadastro(false);
    } catch (err) {
      setErroCadastro(
        err instanceof ApiError
          ? err.status === 409
            ? 'Esse e-mail já tem conta. Entre para ver o preço.'
            : err.message
          : 'Não foi possível criar a conta',
      );
    } finally {
      setEnviando(false);
    }
  }

  const r = resp?.resultado;
  // Ja' logado (ou acabou de cadastrar): preco liberado.
  const precoLiberado = revelado || autenticado;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Topo */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow">
              <IconBolt />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Price <span className="text-brand-600 dark:text-brand-400">3D</span>
              </div>
              <div className="hidden text-[11px] text-slate-400 sm:block dark:text-slate-500">
                Precificação para impressão 3D
              </div>
            </div>
          </div>
          {autenticado ? (
            <Button onClick={() => navegar('/')}>Abrir meu painel</Button>
          ) : (
            <Link
              to="/login"
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
            >
              Entrar
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl dark:text-slate-100">
            Quanto cobrar pela sua peça 3D?
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base dark:text-slate-400">
            Faça uma estimativa rápida agora. Crie sua conta grátis para ver o preço final e calcular com os
            seus custos reais — filamento, energia, depreciação, mão de obra, falhas, embalagem e frete.
          </p>
        </div>

        {erro && (
          <div className="mb-4">
            <Alerta tipo="erro">{erro}</Alerta>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          {/* Formulario */}
          <Card titulo="Sua peça">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Peso da peça (g)">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={form.pesoG}
                  onChange={(e) => set('pesoG', e.target.value)}
                />
              </Field>
              <Field label="Preço do filamento (€/kg)">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={form.precoKg}
                  onChange={(e) => set('precoKg', e.target.value)}
                />
              </Field>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tempo de impressão">
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={form.horas}
                    onChange={(e) => set('horas', e.target.value)}
                    aria-label="Horas"
                  />
                  <span className="self-center text-sm text-slate-400">h</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="59"
                    value={form.minutos}
                    onChange={(e) => set('minutos', e.target.value)}
                    aria-label="Minutos"
                  />
                  <span className="self-center text-sm text-slate-400">min</span>
                </div>
              </Field>
              <Field label="Margem desejada (%)">
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="99"
                  value={form.margemPct}
                  onChange={(e) => set('margemPct', e.target.value)}
                />
              </Field>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
              Estimativa com premissas médias (150 W de consumo, €0,20/kWh, 5% de desperdício, 10% de provisão
              de falha, 15 min de pós-processamento, depreciação de €0,50/h). Na sua conta você configura tudo
              isso com os números reais da sua operação.
            </p>
          </Card>

          {/* Resultado */}
          <Card titulo="Estimativa">
            {!r ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Preencha os dados ao lado.</p>
            ) : (
              <>
                <dl className="space-y-2 text-sm">
                  <Linha rotulo="Material" valor={r.custos.custoMaterial} />
                  <Linha rotulo="Energia" valor={r.custos.custoEnergia} />
                  <Linha rotulo="Depreciação" valor={r.custos.depreciacao} />
                  <Linha rotulo="Mão de obra" valor={r.custos.maoDeObra} />
                  <div className="my-2 border-t border-slate-100 dark:border-slate-800" />
                  <Linha rotulo="Custo total (com provisão de falha)" valor={r.custos.custoComFalha} forte />
                </dl>

                <div className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="text-sm text-slate-500 dark:text-slate-400">Preço de venda sugerido</div>
                  <div
                    className={`mt-1 text-4xl font-bold text-slate-800 transition-all dark:text-slate-100 ${
                      precoLiberado ? '' : 'select-none blur-md'
                    }`}
                    aria-hidden={!precoLiberado}
                  >
                    {fmt(r.precoFinal)}
                  </div>
                  {precoLiberado && (
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Lucro estimado: {fmt(r.margem.lucro)}
                    </div>
                  )}

                  {!precoLiberado && (
                    <div className="mt-4">
                      <Button className="w-full" onClick={() => setMostrarCadastro(true)}>
                        Criar conta grátis e ver o preço
                      </Button>
                      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                        100 créditos grátis no cadastro. Ver este preço usa 20.
                      </p>
                    </div>
                  )}
                </div>

                {precoLiberado && (
                  <Button className="mt-4 w-full" onClick={() => navegar('/simulador')}>
                    Fazer um orçamento completo
                  </Button>
                )}
              </>
            )}
          </Card>
        </div>

        {/* Cadastro inline */}
        {mostrarCadastro && !precoLiberado && (
          <div className="mt-4">
            <Card titulo="Criar conta grátis">
              <form onSubmit={cadastrarERevelar} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="E-mail">
                    <Input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Senha (mín. 8 caracteres)">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                    />
                  </Field>
                </div>
                {erroCadastro && <Alerta tipo="erro">{erroCadastro}</Alerta>}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" className="w-full sm:w-auto" disabled={enviando}>
                    {enviando ? 'Criando conta...' : 'Criar conta e ver o preço'}
                  </Button>
                  <Button
                    type="button"
                    variante="secundario"
                    className="w-full sm:w-auto"
                    onClick={() => setMostrarCadastro(false)}
                    disabled={enviando}
                  >
                    Cancelar
                  </Button>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Já tem conta?{' '}
                  <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    Entrar
                  </Link>
                </p>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function Linha({ rotulo, valor, forte = false }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={forte ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}>
        {rotulo}
      </dt>
      <dd className={forte ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}>
        {fmt(valor)}
      </dd>
    </div>
  );
}
