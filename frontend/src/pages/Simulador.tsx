import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import type {
  CustoVariavel,
  Impressora,
  Material,
  ModoArredondamento,
  OrcamentoInput,
  ResultadoPrecificacao,
  RespostaSimulacao,
} from '../lib/types';
import { Alerta, Button, Card, Field, Input, pct, Select } from '../components/ui';
import { useMoeda } from '../lib/moeda';

/** Estado do formulario (numeros como string para edicao fluida). */
interface FormState {
  cliente: string;
  telefone: string;
  descricaoPeca: string;
  materialId: string;
  impressoraId: string;
  pesoG: string;
  tempoImpressaoH: string;
  tempoPosProcessamentoH: string;
  taxaFalhaPct: string;
  margemLucroPct: string;
  descontoPct: string;
  arredondamento: ModoArredondamento;
  custosVariaveisIds: number[];
}

const inicial: FormState = {
  cliente: '',
  telefone: '',
  descricaoPeca: '',
  materialId: '',
  impressoraId: '',
  pesoG: '50',
  tempoImpressaoH: '4',
  tempoPosProcessamentoH: '0.5',
  taxaFalhaPct: '10',
  margemLucroPct: '50',
  descontoPct: '0',
  arredondamento: 'psicologico',
  custosVariaveisIds: [],
};

/** Monta o payload da API a partir do formulario, ou null se incompleto. */
function montarInput(f: FormState): OrcamentoInput | null {
  const materialId = Number(f.materialId);
  const impressoraId = Number(f.impressoraId);
  if (!materialId || !impressoraId) return null;

  const desconto = Number(f.descontoPct) / 100;
  return {
    materialId,
    impressoraId,
    peca: {
      pesoG: Number(f.pesoG),
      tempoImpressaoH: Number(f.tempoImpressaoH),
      tempoPosProcessamentoH: Number(f.tempoPosProcessamentoH),
    },
    parametros: {
      taxaFalha: Number(f.taxaFalhaPct) / 100,
      margemLucro: Number(f.margemLucroPct) / 100,
    },
    ...(desconto > 0 ? { desconto: { tipo: 'percentual' as const, valor: desconto } } : {}),
    ...(f.custosVariaveisIds.length ? { custosVariaveisIds: f.custosVariaveisIds } : {}),
    ...(f.cliente.trim() ? { cliente: f.cliente.trim() } : {}),
    ...(f.telefone.trim() ? { telefone: f.telefone.trim() } : {}),
    ...(f.descricaoPeca.trim() ? { descricaoPeca: f.descricaoPeca.trim() } : {}),
    arredondamento:
      f.arredondamento === 'psicologico'
        ? { modo: 'psicologico', terminacao: 0.9 }
        : f.arredondamento === 'maisProximo'
          ? { modo: 'maisProximo', passo: 0.5 }
          : f.arredondamento === 'paraCima'
            ? { modo: 'paraCima', passo: 1 }
            : { modo: 'nenhum' },
  };
}

/** Orcamento recem-salvo, para as acoes de PDF/WhatsApp. */
interface Salvo {
  id: number;
  cliente: string;
  telefone: string;
  descricaoPeca: string;
  materialNome: string;
  precoCobrado: number;
}

export function SimuladorPage() {
  const { fmt, codigoAtual } = useMoeda();
  const [materiais, setMateriais] = useState<Material[]>([]);
  const [impressoras, setImpressoras] = useState<Impressora[]>([]);
  const [custosVariaveis, setCustosVariaveis] = useState<CustoVariavel[]>([]);
  const [form, setForm] = useState<FormState>(inicial);
  const [sim, setSim] = useState<RespostaSimulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msgSalvo, setMsgSalvo] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<Salvo | null>(null);

  // Carrega cadastros e pre-seleciona o primeiro de cada.
  useEffect(() => {
    Promise.all([
      api.get<Material[]>('/materiais'),
      api.get<Impressora[]>('/impressoras'),
      api.get<CustoVariavel[]>('/custos-variaveis'),
    ])
      .then(([mats, imps, vars]) => {
        setMateriais(mats);
        setImpressoras(imps);
        setCustosVariaveis(vars);
        setForm((f) => ({
          ...f,
          materialId: mats[0] ? String(mats[0].id) : '',
          impressoraId: imps[0] ? String(imps[0].id) : '',
          taxaFalhaPct: imps[0] ? String(Math.round(imps[0].taxaFalhaPadrao * 100)) : f.taxaFalhaPct,
        }));
      })
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Erro ao carregar cadastros'));
  }, []);

  function alternarCustoVariavel(id: number) {
    setForm((f) => ({
      ...f,
      custosVariaveisIds: f.custosVariaveisIds.includes(id)
        ? f.custosVariaveisIds.filter((x) => x !== id)
        : [...f.custosVariaveisIds, id],
    }));
    setMsgSalvo(null);
    setSalvo(null);
  }

  const input = useMemo(() => montarInput(form), [form]);
  const inputDebounced = useDebounce(input, 300);

  // Recalcula em tempo real (com debounce) sempre que a entrada valida muda.
  useEffect(() => {
    if (!inputDebounced) return;
    let cancelado = false;
    api
      .post<RespostaSimulacao>('/orcamentos/simular', inputDebounced)
      .then((r) => !cancelado && (setSim(r), setErro(null)))
      .catch((e) => !cancelado && setErro(e instanceof ApiError ? e.message : 'Erro ao simular'));
    return () => {
      cancelado = true;
    };
  }, [inputDebounced]);

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setMsgSalvo(null);
    setSalvo(null);
  }

  async function salvar() {
    if (!input) return;
    setSalvando(true);
    setErro(null);
    setMsgSalvo(null);
    try {
      const r = await api.post<{
        orcamento: {
          id: number;
          cliente: string | null;
          telefone: string | null;
          descricaoPeca: string | null;
          precoCobrado: number;
        };
        aviso: string | null;
      }>('/orcamentos', input);
      setMsgSalvo(`Orçamento #${r.orcamento.id} salvo${r.aviso ? ` — ${r.aviso}` : ''}.`);
      setSalvo({
        id: r.orcamento.id,
        cliente: r.orcamento.cliente ?? '',
        telefone: r.orcamento.telefone ?? '',
        descricaoPeca: r.orcamento.descricaoPeca ?? '',
        materialNome: materiais.find((m) => String(m.id) === form.materialId)?.nome ?? '',
        precoCobrado: r.orcamento.precoCobrado,
      });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao salvar orçamento');
    } finally {
      setSalvando(false);
    }
  }

  async function baixarPdf(id: number) {
    const q = codigoAtual !== 'EUR' ? `?moeda=${codigoAtual}` : '';
    await api.baixar(`/orcamentos/${id}/pdf${q}`, `orcamento-${String(id).padStart(4, '0')}.pdf`);
  }

  /** Baixa o PDF e abre o WhatsApp do cliente com um resumo pronto para enviar. */
  async function enviarWhatsApp(s: Salvo) {
    // Usa o telefone informado no orçamento; só pergunta se estiver vazio.
    const tel = (
      s.telefone || prompt('WhatsApp do cliente (com DDI, só números):') || ''
    ).replace(/\D/g, '');
    const linhas = [
      `*Orçamento Nº ${String(s.id).padStart(4, '0')}*`,
      s.cliente ? `Cliente: ${s.cliente}` : null,
      s.descricaoPeca ? `Peça: ${s.descricaoPeca}` : null,
      s.materialNome ? `Material: ${s.materialNome}` : null,
      `Valor: ${fmt(s.precoCobrado)}`,
      '',
      'Segue o orçamento em anexo (PDF). Validade: 15 dias.',
    ].filter(Boolean);
    const texto = encodeURIComponent(linhas.join('\n'));
    try {
      await baixarPdf(s.id);
    } catch {
      /* ignora: o resumo em texto segue mesmo sem o PDF */
    }
    const base = tel ? `https://wa.me/${tel}` : 'https://wa.me/';
    window.open(`${base}?text=${texto}`, '_blank', 'noopener');
  }

  const r = sim?.resultado;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      {/* Formulario */}
      <Card titulo="Parâmetros da peça">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome do cliente">
            <Input value={form.cliente} onChange={(e) => set('cliente', e.target.value)} placeholder="Ex.: Maria Silva" />
          </Field>
          <Field label="Telefone (WhatsApp)">
            <Input type="tel" value={form.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="Ex.: +351 912 345 678" />
          </Field>
          <Field label="Peça">
            <Input value={form.descricaoPeca} onChange={(e) => set('descricaoPeca', e.target.value)} placeholder="Ex.: Suporte de fone" />
          </Field>
          <Field label="Material">
            <Select value={form.materialId} onChange={(e) => set('materialId', e.target.value)}>
              {materiais.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} ({m.tipo})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Impressora">
            <Select
              value={form.impressoraId}
              onChange={(e) => {
                const imp = impressoras.find((i) => String(i.id) === e.target.value);
                setForm((f) => ({
                  ...f,
                  impressoraId: e.target.value,
                  // Prefill da taxa de falha com a taxa media da impressora escolhida.
                  taxaFalhaPct: imp ? String(Math.round(imp.taxaFalhaPadrao * 100)) : f.taxaFalhaPct,
                }));
                setMsgSalvo(null);
                setSalvo(null);
              }}
            >
              {impressoras.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nome}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Peso (g)">
            <Input type="number" min="0" step="0.1" value={form.pesoG} onChange={(e) => set('pesoG', e.target.value)} />
          </Field>
          <Field label="Tempo de impressão (h)">
            <Input type="number" min="0" step="0.1" value={form.tempoImpressaoH} onChange={(e) => set('tempoImpressaoH', e.target.value)} />
          </Field>
          <Field label="Pós-processamento (h)">
            <Input type="number" min="0" step="0.1" value={form.tempoPosProcessamentoH} onChange={(e) => set('tempoPosProcessamentoH', e.target.value)} />
          </Field>
          <Field label="Taxa de falha (%)">
            <Input type="number" min="0" max="100" step="1" value={form.taxaFalhaPct} onChange={(e) => set('taxaFalhaPct', e.target.value)} />
          </Field>
          <Field label="Margem de lucro (%)">
            <Input type="number" min="0" step="1" value={form.margemLucroPct} onChange={(e) => set('margemLucroPct', e.target.value)} />
          </Field>
          <Field label="Desconto (%)">
            <Input type="number" min="0" max="100" step="1" value={form.descontoPct} onChange={(e) => set('descontoPct', e.target.value)} />
          </Field>
          <Field label="Arredondamento">
            <Select value={form.arredondamento} onChange={(e) => set('arredondamento', e.target.value as ModoArredondamento)}>
              <option value="psicologico">Terminar em ,90</option>
              <option value="maisProximo">Múltiplo de 0,50</option>
              <option value="paraCima">Para cima (€1)</option>
              <option value="nenhum">Nenhum</option>
            </Select>
          </Field>
        </div>

        {/* Custos variaveis por peca (selecionaveis) */}
        {custosVariaveis.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-400">
              Custos variáveis por peça
            </div>
            <div className="flex flex-wrap gap-2">
              {custosVariaveis.map((c) => {
                const ativo = form.custosVariaveisIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => alternarCustoVariavel(c.id)}
                    aria-pressed={ativo}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      ativo
                        ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                        : 'border-slate-200 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-brand-500'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-[4px] border text-center text-[9px] leading-[13px] ${
                        ativo ? 'border-white/70 bg-white/20' : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {ativo ? '✓' : ''}
                    </span>
                    {c.nome}
                    <span className={ativo ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}>
                      {fmt(c.valorUnitario)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Resultado */}
      <div className="space-y-4">
        <Card>
          <div className="flex items-end justify-between">
            <div>
              <span className="text-sm text-slate-500 dark:text-slate-400">Preço final</span>
              <div className="text-4xl font-bold text-slate-800 dark:text-slate-100">
                {r ? fmt(r.precoFinal) : '—'}
              </div>
              {r && r.precoCobrado !== r.precoFinal && (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Com desconto: <span className="font-semibold text-slate-700 dark:text-slate-200">{fmt(r.precoCobrado)}</span>
                </div>
              )}
            </div>
            {r && (
              <div className="text-right">
                <div className="text-sm text-slate-500 dark:text-slate-400">Margem real</div>
                <div className={`text-xl font-semibold ${r.margem.real < r.margem.minima ? 'text-red-600' : 'text-emerald-600'}`}>
                  {pct(r.margem.real)}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500">planejada {pct(r.margem.planejada)}</div>
              </div>
            )}
          </div>

          {r && !r.margem.atingeMinima && (
            <div className="mt-3">
              <Alerta tipo="aviso">
                Margem do preço de tabela ({pct(r.margem.aposArredondamento)}) abaixo da mínima ({pct(r.margem.minima)}). Não será possível salvar.
              </Alerta>
            </div>
          )}
          {erro && <div className="mt-3"><Alerta tipo="erro">{erro}</Alerta></div>}
          {msgSalvo && <div className="mt-3"><Alerta tipo="sucesso">{msgSalvo}</Alerta></div>}
          {salvo && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variante="secundario" onClick={() => baixarPdf(salvo.id)}>
                Baixar PDF
              </Button>
              <Button variante="secundario" onClick={() => enviarWhatsApp(salvo)}>
                Enviar no WhatsApp
              </Button>
            </div>
          )}
        </Card>

        {r && (
          <Card titulo="Composição do custo">
            <dl className="space-y-2 text-sm">
              <Linha rotulo="Material" valor={r.custos.custoMaterial} fmt={fmt} />
              <Linha rotulo="Energia" valor={r.custos.custoEnergia} fmt={fmt} />
              <Linha rotulo="Depreciação" valor={r.custos.depreciacao} fmt={fmt} />
              <Linha rotulo="Mão de obra" valor={r.custos.maoDeObra} fmt={fmt} />
              <Linha rotulo="Custo fixo rateado" valor={r.custos.custoFixoRateado} fmt={fmt} />
              {r.custos.custoVariavel > 0 && (
                <Linha rotulo="Custos variáveis" valor={r.custos.custoVariavel} fmt={fmt} />
              )}
              <div className="my-2 border-t border-slate-100 dark:border-slate-800" />
              <Linha rotulo="Custo total" valor={r.custos.custoTotal} fmt={fmt} forte />
              <Linha rotulo="Custo + provisão de falha" valor={r.custos.custoComFalha} fmt={fmt} />
              <Linha rotulo="Lucro" valor={r.margem.lucro} fmt={fmt} />
            </dl>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3 text-sm text-slate-500 dark:text-slate-400">
              <span>
                Consumo: <strong className="text-slate-700 dark:text-slate-200">{sim?.consumoG.toFixed(1)} g</strong>
                {sim && !sim.estoqueSuficiente && <span className="ml-2 text-amber-600">(estoque insuficiente)</span>}
              </span>
              <Button onClick={salvar} disabled={salvando || !r.margem.atingeMinima}>
                {salvando ? 'Salvando...' : 'Salvar orçamento'}
              </Button>
            </div>
          </Card>
        )}

        {r && <InteligenciaNegocio r={r} tempoImpressaoH={Number(form.tempoImpressaoH)} fmt={fmt} />}
      </div>
    </div>
  );
}

/**
 * Inteligencia de negocio: preco minimo/recomendado, lucro por hora e alertas
 * (margem baixa, preco abaixo do recomendado, lucro insuficiente).
 */
function InteligenciaNegocio({
  r,
  tempoImpressaoH,
  fmt,
}: {
  r: ResultadoPrecificacao;
  tempoImpressaoH: number;
  fmt: (v: number) => string;
}) {
  const custoComFalha = r.custos.custoComFalha;
  const margemRecomendada = Math.max(0.5, r.margem.minima + 0.3);
  const precoMinimo = custoComFalha * (1 + r.margem.minima);
  const precoRecomendado = custoComFalha * (1 + margemRecomendada);
  const lucroPorHora = tempoImpressaoH > 0 ? r.margem.lucro / tempoImpressaoH : 0;

  const alertas: { tipo: 'erro' | 'aviso'; msg: string }[] = [];
  if (r.margem.lucro <= 0) alertas.push({ tipo: 'erro', msg: 'Lucro insuficiente — o preço não cobre o custo.' });
  if (r.margem.real < r.margem.minima)
    alertas.push({ tipo: 'erro', msg: `Margem muito baixa (${pct(r.margem.real)} < mínima ${pct(r.margem.minima)}).` });
  if (r.precoCobrado < precoRecomendado - 0.005)
    alertas.push({ tipo: 'aviso', msg: `Preço abaixo do recomendado (${fmt(precoRecomendado)}).` });

  return (
    <Card titulo="Inteligência de negócio">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi rotulo="Preço mínimo" valor={fmt(precoMinimo)} />
        <Kpi rotulo="Preço recomendado" valor={fmt(precoRecomendado)} destaque />
        <Kpi rotulo="Lucro líquido" valor={fmt(r.margem.lucro)} />
        <Kpi rotulo="Lucro / hora" valor={fmt(lucroPorHora)} />
      </div>
      {alertas.length > 0 ? (
        <div className="mt-4 space-y-2">
          {alertas.map((a, i) => (
            <Alerta key={i} tipo={a.tipo}>
              {a.msg}
            </Alerta>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <Alerta tipo="sucesso">Precificação saudável — margem e lucro dentro do recomendado.</Alerta>
        </div>
      )}
    </Card>
  );
}

function Kpi({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        destaque
          ? 'border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10'
          : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40'
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {rotulo}
      </div>
      <div
        className={`mt-0.5 text-lg font-bold tracking-tight ${
          destaque ? 'text-brand-700 dark:text-brand-300' : 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {valor}
      </div>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  fmt,
  forte = false,
}: {
  rotulo: string;
  valor: number;
  fmt: (v: number) => string;
  forte?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className={forte ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}>{rotulo}</dt>
      <dd className={forte ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}>{fmt(valor)}</dd>
    </div>
  );
}
