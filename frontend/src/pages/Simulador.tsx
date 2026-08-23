import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import type {
  CustoVariavel,
  Impressora,
  Insumo,
  Material,
  ModoArredondamento,
  OrcamentoInput,
  OrcamentoItemInput,
  ResultadoPrecificacao,
  RespostaSimulacao,
} from '../lib/types';
import { Alerta, Button, Card, DuracaoInput, Field, Input, gramas, pct, Select } from '../components/ui';
import { useMoeda } from '../lib/moeda';
import { useCreditos, CUSTO_ORCAMENTO } from '../lib/creditos';

/** Um insumo selecionado numa peca, com a quantidade TOTAL usada nela (número final). */
interface ItemInsumoForm {
  insumoId: string;
  quantidade: string;
}

/** Uma peca do formulario (numeros como string para edicao fluida). */
interface ItemForm {
  nome: string;
  materialId: string;
  pesoG: string;
  /** Tempo de impressao e pos-processamento entram como horas + minutos inteiros
   *  (mais claro que uma fracao decimal) e sao combinados em horas decimais
   *  — a unidade que o motor de precificacao usa — na hora de montar o payload. */
  tempoImpressaoHoras: string;
  tempoImpressaoMinutos: string;
  tempoPosProcessamentoHoras: string;
  tempoPosProcessamentoMinutos: string;
  /** Unidades identicas que esta peca representa (25 canudos = 25). Peso e
   *  insumos escalam por ela; tempo de impressao/pos-processamento NAO. */
  quantidade: string;
  insumosSelecionados: ItemInsumoForm[];
}

/** Combina horas + minutos (strings do formulario) em horas decimais, para a API. */
function paraHorasDecimais(horas: string, minutos: string): number {
  return (Number(horas) || 0) + (Number(minutos) || 0) / 60;
}

/** Converte horas decimais (vindas da API) de volta para horas + minutos inteiros, para prefill. */
function paraHorasEMinutos(decimal: number): { horas: string; minutos: string } {
  const totalMin = Math.round(decimal * 60);
  return { horas: String(Math.floor(totalMin / 60)), minutos: String(totalMin % 60) };
}

/** Estado do formulario. */
interface FormState {
  cliente: string;
  telefone: string;
  descricaoPeca: string;
  impressoraId: string;
  itens: ItemForm[];
  taxaFalhaPct: string;
  margemLucroPct: string;
  descontoPct: string;
  arredondamento: ModoArredondamento;
  custosVariaveisIds: number[];
  /** Quantos produtos/conjuntos COMPLETOS esta encomenda representa (pode
   *  diferir do nº de peças) — só exibição, ver `montarInput`. */
  quantidadeProdutosFinais: string;
}

const itemInicial: ItemForm = {
  nome: '',
  materialId: '',
  pesoG: '50',
  tempoImpressaoHoras: '4',
  tempoImpressaoMinutos: '0',
  tempoPosProcessamentoHoras: '0',
  tempoPosProcessamentoMinutos: '30',
  quantidade: '1',
  insumosSelecionados: [],
};

const inicial: FormState = {
  cliente: '',
  telefone: '',
  descricaoPeca: '',
  impressoraId: '',
  itens: [{ ...itemInicial }],
  taxaFalhaPct: '10',
  margemLucroPct: '50',
  descontoPct: '0',
  arredondamento: 'psicologico',
  custosVariaveisIds: [],
  quantidadeProdutosFinais: '1',
};

/** Rotulo do material com tipo e cor, para deixar a escolha inequivoca. */
function rotuloMaterial(m: Material): string {
  // Nao repete a cor se ela ja' fizer parte do nome (ex.: "PLA Verde").
  const corRedundante = m.cor && m.nome.toLowerCase().includes(m.cor.toLowerCase());
  const detalhes = [m.tipo, corRedundante ? null : m.cor].filter(Boolean).join(', ');
  return detalhes ? `${m.nome} (${detalhes})` : m.nome;
}

/** Monta o payload da API a partir do formulario, ou null se incompleto. */
function montarInput(f: FormState): OrcamentoInput | null {
  const impressoraId = Number(f.impressoraId);
  if (!impressoraId) return null;
  if (f.itens.length === 0 || f.itens.some((it) => !Number(it.materialId))) return null;

  const desconto = Number(f.descontoPct) / 100;
  const itens: OrcamentoItemInput[] = f.itens.map((it) => ({
    ...(it.nome.trim() ? { nome: it.nome.trim() } : {}),
    materialId: Number(it.materialId),
    pesoG: Number(it.pesoG),
    tempoImpressaoH: paraHorasDecimais(it.tempoImpressaoHoras, it.tempoImpressaoMinutos),
    tempoPosProcessamentoH: paraHorasDecimais(it.tempoPosProcessamentoHoras, it.tempoPosProcessamentoMinutos),
    quantidade: Number(it.quantidade) || 1,
    ...(it.insumosSelecionados.length
      ? {
          insumos: it.insumosSelecionados.map((x) => ({
            insumoId: Number(x.insumoId),
            quantidade: Number(x.quantidade) || 1,
          })),
        }
      : {}),
  }));

  return {
    impressoraId,
    itens,
    parametros: {
      taxaFalha: Number(f.taxaFalhaPct) / 100,
      margemLucro: Number(f.margemLucroPct) / 100,
    },
    quantidadeProdutosFinais: Number(f.quantidadeProdutosFinais) || 1,
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
  precoCobrado: number;
}

/** Resposta da API ao criar/editar um orcamento. */
interface RespostaOrcamentoSalvo {
  orcamento: {
    id: number;
    cliente: string | null;
    telefone: string | null;
    descricaoPeca: string | null;
    precoCobrado: number;
    itens: { nome: string | null; material: { nome: string; cor: string | null } }[];
  };
  aviso: string | null;
}

/** Orcamento existente (para o modo edicao), incluindo o snapshot da entrada. */
interface OrcamentoParaEditar {
  id: number;
  status: 'pendente' | 'aprovado' | 'recusado';
  cliente: string | null;
  telefone: string | null;
  descricaoPeca: string | null;
  impressoraId: number;
  /** Quantos produtos/conjuntos COMPLETOS esta encomenda representa. */
  quantidadeProdutosFinais: number;
  entradaJson: string;
  itens: {
    nome: string | null;
    materialId: number;
    pesoG: number;
    tempoImpressaoH: number;
    tempoPosProcessamentoH: number;
    quantidade: number;
    insumos: { insumoId: number; quantidadePorPeca: number }[];
  }[];
  custosVariaveisSelecionados: { custoVariavelId: number }[];
  resultado: ResultadoPrecificacao;
}

export function SimuladorPage() {
  const { fmt, codigoAtual } = useMoeda();
  const { saldo, recarregar: recarregarCreditos } = useCreditos();
  const navegar = useNavigate();
  const [searchParams] = useSearchParams();
  const orcamentoIdEdicao = searchParams.get('orcamento');

  const [materiais, setMateriais] = useState<Material[]>([]);
  const [impressoras, setImpressoras] = useState<Impressora[]>([]);
  const [custosVariaveis, setCustosVariaveis] = useState<CustoVariavel[]>([]);
  const [insumosDisponiveis, setInsumosDisponiveis] = useState<Insumo[]>([]);
  const [form, setForm] = useState<FormState>(inicial);
  const [sim, setSim] = useState<RespostaSimulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msgSalvo, setMsgSalvo] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<Salvo | null>(null);
  const [carregandoEdicao, setCarregandoEdicao] = useState(!!orcamentoIdEdicao);
  const [bloqueadoEdicao, setBloqueadoEdicao] = useState<string | null>(null);

  const editando = !!orcamentoIdEdicao && !bloqueadoEdicao;

  // Carrega cadastros e, se for edicao, o orcamento existente (prefill).
  useEffect(() => {
    async function carregar() {
      const [mats, imps, vars, insumosDisp] = await Promise.all([
        api.get<Material[]>('/materiais'),
        api.get<Impressora[]>('/impressoras'),
        api.get<CustoVariavel[]>('/custos-variaveis'),
        api.get<Insumo[]>('/insumos'),
      ]);
      setMateriais(mats);
      setImpressoras(imps);
      setCustosVariaveis(vars);
      setInsumosDisponiveis(insumosDisp);

      if (orcamentoIdEdicao) {
        const o = await api.get<OrcamentoParaEditar>(`/orcamentos/${orcamentoIdEdicao}`);
        if (o.status !== 'pendente') {
          setBloqueadoEdicao(
            `Este orçamento já foi ${o.status === 'aprovado' ? 'aprovado' : 'recusado'} e não pode mais ser editado.`,
          );
          setCarregandoEdicao(false);
          return;
        }
        const entrada = JSON.parse(o.entradaJson) as {
          parametros: { taxaFalha: number };
          desconto?: { tipo: 'percentual' | 'valor'; valor: number };
          arredondamento?: { modo: ModoArredondamento };
        };
        setForm({
          cliente: o.cliente ?? '',
          telefone: o.telefone ?? '',
          descricaoPeca: o.descricaoPeca ?? '',
          impressoraId: String(o.impressoraId),
          itens: o.itens.map((it) => {
            const impressao = paraHorasEMinutos(it.tempoImpressaoH);
            const posProcessamento = paraHorasEMinutos(it.tempoPosProcessamentoH);
            return {
              nome: it.nome ?? '',
              materialId: String(it.materialId),
              pesoG: String(it.pesoG),
              tempoImpressaoHoras: impressao.horas,
              tempoImpressaoMinutos: impressao.minutos,
              tempoPosProcessamentoHoras: posProcessamento.horas,
              tempoPosProcessamentoMinutos: posProcessamento.minutos,
              quantidade: String(it.quantidade ?? 1),
              insumosSelecionados: (it.insumos ?? []).map((iu) => ({
                insumoId: String(iu.insumoId),
                quantidade: String(iu.quantidadePorPeca),
              })),
            };
          }),
          taxaFalhaPct: String(Math.round(entrada.parametros.taxaFalha * 100)),
          margemLucroPct: String(Math.round(o.resultado.margem.planejada * 100)),
          descontoPct:
            entrada.desconto?.tipo === 'percentual' ? String(Math.round(entrada.desconto.valor * 100)) : '0',
          arredondamento: entrada.arredondamento?.modo ?? 'nenhum',
          custosVariaveisIds: o.custosVariaveisSelecionados.map((cv) => cv.custoVariavelId),
          quantidadeProdutosFinais: String(o.quantidadeProdutosFinais ?? 1),
        });
        setCarregandoEdicao(false);
      } else {
        setForm((f) => ({
          ...f,
          impressoraId: imps[0] ? String(imps[0].id) : '',
          itens: [{ ...itemInicial, materialId: mats[0] ? String(mats[0].id) : '' }],
          taxaFalhaPct: imps[0] ? String(Math.round(imps[0].taxaFalhaPadrao * 100)) : f.taxaFalhaPct,
        }));
      }
    }
    carregar().catch((e) => {
      setErro(e instanceof ApiError ? e.message : 'Erro ao carregar cadastros');
      setCarregandoEdicao(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcamentoIdEdicao]);

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

  function setItem<K extends keyof ItemForm>(idx: number, campo: K, valor: ItemForm[K]) {
    setForm((f) => ({
      ...f,
      itens: f.itens.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)),
    }));
    setMsgSalvo(null);
    setSalvo(null);
  }

  /** Liga/desliga um insumo numa peca (comeca com quantidade total 1). */
  function alternarInsumoItem(idx: number, insumoId: number) {
    setForm((f) => ({
      ...f,
      itens: f.itens.map((it, i) => {
        if (i !== idx) return it;
        const ligado = it.insumosSelecionados.some((x) => x.insumoId === String(insumoId));
        return {
          ...it,
          insumosSelecionados: ligado
            ? it.insumosSelecionados.filter((x) => x.insumoId !== String(insumoId))
            : [...it.insumosSelecionados, { insumoId: String(insumoId), quantidade: '1' }],
        };
      }),
    }));
    setMsgSalvo(null);
    setSalvo(null);
  }

  /** Ajusta o total direto de unidades do insumo usado na peca (ex.: 15 argolas nesta peca). */
  function setInsumoQuantidade(idx: number, insumoId: number, quantidade: string) {
    setForm((f) => ({
      ...f,
      itens: f.itens.map((it, i) =>
        i !== idx
          ? it
          : {
              ...it,
              insumosSelecionados: it.insumosSelecionados.map((x) =>
                x.insumoId === String(insumoId) ? { ...x, quantidade } : x,
              ),
            },
      ),
    }));
    setMsgSalvo(null);
    setSalvo(null);
  }

  function adicionarPeca() {
    setForm((f) => ({
      ...f,
      itens: [...f.itens, { ...itemInicial, materialId: materiais[0] ? String(materiais[0].id) : '' }],
    }));
  }

  function removerPeca(idx: number) {
    setForm((f) => ({ ...f, itens: f.itens.filter((_, i) => i !== idx) }));
  }

  async function salvar() {
    if (!input) return;
    setSalvando(true);
    setErro(null);
    setMsgSalvo(null);
    try {
      if (editando && orcamentoIdEdicao) {
        const r = await api.patch<RespostaOrcamentoSalvo>(`/orcamentos/${orcamentoIdEdicao}`, input);
        setMsgSalvo(`Orçamento #${r.orcamento.id} atualizado${r.aviso ? ` — ${r.aviso}` : ''}.`);
        navegar('/orcamentos');
        return;
      }
      const r = await api.post<RespostaOrcamentoSalvo>('/orcamentos', input);
      recarregarCreditos(); // criar orcamento consome credito — atualiza o saldo no topo
      setMsgSalvo(`Orçamento #${r.orcamento.id} salvo${r.aviso ? ` — ${r.aviso}` : ''}.`);
      setSalvo({
        id: r.orcamento.id,
        cliente: r.orcamento.cliente ?? '',
        telefone: r.orcamento.telefone ?? '',
        descricaoPeca: r.orcamento.descricaoPeca ?? '',
        precoCobrado: r.orcamento.precoCobrado,
      });
    } catch (e) {
      setErro(
        e instanceof ApiError && e.status === 402
          ? 'Créditos insuficientes pra salvar este orçamento. Veja a página de Créditos pra recarregar.'
          : e instanceof ApiError
            ? e.message
            : 'Erro ao salvar orçamento',
      );
    } finally {
      setSalvando(false);
    }
  }

  async function baixarPdf(id: number) {
    const q = codigoAtual !== 'EUR' ? `?moeda=${codigoAtual}` : '';
    try {
      await api.baixar(`/orcamentos/${id}/pdf${q}`, `orcamento-${String(id).padStart(4, '0')}.pdf`);
      recarregarCreditos();
    } catch (e) {
      setErro(
        e instanceof ApiError && e.status === 402
          ? 'Créditos insuficientes para gerar o PDF. Veja a página de Créditos pra recarregar.'
          : e instanceof ApiError
            ? e.message
            : 'Erro ao gerar PDF',
      );
      throw e;
    }
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
      s.descricaoPeca ? `Produto: ${s.descricaoPeca}` : null,
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

  if (carregandoEdicao) {
    return (
      <Card>
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando orçamento...</p>
      </Card>
    );
  }

  if (bloqueadoEdicao) {
    return (
      <Card titulo="Não é possível editar">
        <Alerta tipo="aviso">{bloqueadoEdicao}</Alerta>
        <div className="mt-4">
          <Link to="/orcamentos" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            Voltar para Orçamentos
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      {/* Formulario */}
      <div className="space-y-4">
        {editando && (
          <Alerta tipo="info">
            Editando o orçamento #{orcamentoIdEdicao}.{' '}
            <Link to="/orcamentos" className="font-medium underline">
              Cancelar
            </Link>
          </Alerta>
        )}

        <Card titulo="Dados do orçamento">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nome do cliente">
              <Input value={form.cliente} onChange={(e) => set('cliente', e.target.value)} placeholder="Ex.: Maria Silva" />
            </Field>
            <Field label="Telefone (WhatsApp)">
              <Input type="tel" value={form.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="Ex.: +351 912 345 678" />
            </Field>
            <Field label="Produto">
              <Input value={form.descricaoPeca} onChange={(e) => set('descricaoPeca', e.target.value)} placeholder="Ex.: Dinossauro articulado" />
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
            <Field label="Quantidade de produtos/conjuntos">
              <Input
                type="number"
                min="1"
                step="1"
                value={form.quantidadeProdutosFinais}
                onChange={(e) => set('quantidadeProdutosFinais', e.target.value)}
              />
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                <strong className="font-semibold text-slate-500 dark:text-slate-400">Quantidade de produtos/conjuntos:</strong>{' '}
                quantidade de produtos completos que esta encomenda representa. Este campo serve apenas para calcular
                o preço por produto e não multiplica automaticamente peso, tempo ou custos das peças.
              </span>
            </Field>
          </div>
        </Card>

        {/* Pecas do orcamento */}
        <Card titulo="Peças">
          <div className="space-y-4">
            {form.itens.map((it, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Peça {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removerPeca(idx)}
                    disabled={form.itens.length === 1}
                    className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600"
                  >
                    Remover
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome da peça (opcional)">
                    <Input
                      value={it.nome}
                      onChange={(e) => setItem(idx, 'nome', e.target.value)}
                      placeholder="Ex.: Cauda"
                    />
                  </Field>
                  <Field label="Material">
                    <Select value={it.materialId} onChange={(e) => setItem(idx, 'materialId', e.target.value)}>
                      {materiais.map((m) => (
                        <option key={m.id} value={m.id}>
                          {rotuloMaterial(m)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Peso (g)">
                    <Input type="number" min="0" step="0.1" value={it.pesoG} onChange={(e) => setItem(idx, 'pesoG', e.target.value)} />
                  </Field>
                  <Field label="Quantidade">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={it.quantidade}
                      onChange={(e) => setItem(idx, 'quantidade', e.target.value)}
                    />
                    <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                      <strong className="font-semibold text-slate-500 dark:text-slate-400">Quantidade da peça:</strong>{' '}
                      número de unidades desta peça representadas pelos valores de peso e tempo informados. A
                      quantidade não multiplica automaticamente peso, tempo ou custo. Se informar 10 unidades, o
                      peso e o tempo devem ser os totais das 10 unidades.
                    </span>
                  </Field>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Tempo de impressão">
                    <DuracaoInput
                      horas={it.tempoImpressaoHoras}
                      minutos={it.tempoImpressaoMinutos}
                      onHorasChange={(v) => setItem(idx, 'tempoImpressaoHoras', v)}
                      onMinutosChange={(v) => setItem(idx, 'tempoImpressaoMinutos', v)}
                    />
                    <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                      = {paraHorasDecimais(it.tempoImpressaoHoras, it.tempoImpressaoMinutos).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h do LOTE (não multiplica) · energia, depreciação e custo fixo
                    </span>
                  </Field>
                  <Field label="Pós-processamento">
                    <DuracaoInput
                      horas={it.tempoPosProcessamentoHoras}
                      minutos={it.tempoPosProcessamentoMinutos}
                      onHorasChange={(v) => setItem(idx, 'tempoPosProcessamentoHoras', v)}
                      onMinutosChange={(v) => setItem(idx, 'tempoPosProcessamentoMinutos', v)}
                    />
                    <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                      = {paraHorasDecimais(it.tempoPosProcessamentoHoras, it.tempoPosProcessamentoMinutos).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h do LOTE (não multiplica) · mão de obra
                    </span>
                  </Field>
                </div>

                {/* Insumos desta peca (argola, escovinha...); a quantidade e' o total direto. */}
                {insumosDisponiveis.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      Insumos
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {insumosDisponiveis.map((ins) => {
                        const sel = it.insumosSelecionados.find((x) => x.insumoId === String(ins.id));
                        const ativo = !!sel;
                        return (
                          <div
                            key={ins.id}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                              ativo
                                ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                                : 'border-slate-200 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-brand-500'
                            }`}
                          >
                            <button type="button" onClick={() => alternarInsumoItem(idx, ins.id)} className="flex items-center gap-1.5">
                              <span
                                className={`inline-block h-3.5 w-3.5 rounded-[4px] border text-center text-[9px] leading-[13px] ${
                                  ativo ? 'border-white/70 bg-white/20' : 'border-slate-300 dark:border-slate-600'
                                }`}
                              >
                                {ativo ? '✓' : ''}
                              </span>
                              {ins.nome}
                              <span className={ativo ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}>{fmt(ins.valorUnitario)}</span>
                            </button>
                            {ativo && (
                              <>
                                <span className={ativo ? 'text-white/70' : 'text-slate-400'}>×</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={sel!.quantidade}
                                  onChange={(e) => setInsumoQuantidade(idx, ins.id, e.target.value)}
                                  className="w-10 rounded-md border-0 bg-white/20 px-1 py-0.5 text-center text-white [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-white/50"
                                  title="Quantidade total deste insumo nesta peça (número final, já é o total)"
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={adicionarPeca}
            className="mt-3 w-full rounded-xl border border-dashed border-slate-300 py-2 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
          >
            + Adicionar peça
          </button>
        </Card>

        <Card titulo="Parâmetros">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Taxa de falha (%)">
              <Input type="number" min="0" max="100" step="1" value={form.taxaFalhaPct} onChange={(e) => set('taxaFalhaPct', e.target.value)} />
            </Field>
            <Field label="Margem desejada sobre o preço (%)">
              <Input
                type="number"
                min="0"
                max="99"
                step="1"
                value={form.margemLucroPct}
                onChange={(e) => set('margemLucroPct', e.target.value)}
              />
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                fatia do preço de venda que fica de lucro — não um % somado sobre o custo
              </span>
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

          {/* Custos variaveis por orcamento (selecionaveis) */}
          {custosVariaveis.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                Custos variáveis (embalagem, frete...)
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
      </div>

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
              {r && (() => {
                // Puramente visual: preço final da ENCOMENDA (ja com tudo — nucleo
                // com falha, insumos, variavel/embalagem — ver engine.ts) dividido
                // pela quantidade de PRODUTOS/CONJUNTOS finais (campo proprio,
                // independente da quantidade de cada peca/componente — ver doc no
                // topo de orcamentos/service.ts). NAO soma quantidade de pecas
                // diferentes (isso conflaria "3 componentes de 1 produto" com "3
                // produtos"), nao redistribui nem recalcula nenhum custo/margem.
                const qtdProdutos = Number(form.quantidadeProdutosFinais) || 1;
                return qtdProdutos > 1 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    Preço por produto:{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {fmt(r.precoFinal / qtdProdutos)}
                    </span>
                  </div>
                ) : null;
              })()}
            </div>
            {r && (
              <div className="text-right">
                <div className="text-sm text-slate-500 dark:text-slate-400">Margem sobre o preço</div>
                <div className={`text-xl font-semibold ${r.margem.real < r.margem.minima ? 'text-red-600' : 'text-emerald-600'}`}>
                  {pct(r.margem.real)}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500">planejada {pct(r.margem.planejada)}</div>
              </div>
            )}
          </div>

          {r && (
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Kpi rotulo="Custo total" valor={fmt(r.custos.custoComFalha)} />
              <Kpi rotulo="Lucro" valor={fmt(r.margem.lucro)} />
              <Kpi rotulo="Markup sobre o custo" valor={pct(r.margem.markupSobreCusto)} />
            </div>
          )}

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
              <Button variante="secundario" onClick={() => baixarPdf(salvo.id).catch(() => {})}>
                Baixar PDF
              </Button>
              <Button variante="secundario" onClick={() => enviarWhatsApp(salvo)}>
                Enviar no WhatsApp
              </Button>
            </div>
          )}
        </Card>

        {r && sim && (
          <Card titulo="Peças">
            <div className="space-y-2">
              {r.itens.map((it, idx) => {
                const formItem = form.itens[idx];
                const material = formItem ? materiais.find((m) => String(m.id) === formItem.materialId) : undefined;
                const estoque = sim.itens[idx];
                const desperdicio = material?.taxaDesperdicio ?? 0;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800"
                  >
                    <div>
                      <div className="font-medium text-slate-700 dark:text-slate-200">
                        {it.nome || `Peça ${idx + 1}`}
                        {it.quantidade > 1 && (
                          <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">× {it.quantidade}</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {material ? rotuloMaterial(material) : '—'} · peso {it.pesoG.toLocaleString('pt-BR')} g
                        {estoque && desperdicio > 0 && (
                          <> · consumo {estoque.consumoG.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g (+{pct(desperdicio)} desperdício do material)</>
                        )}
                        {it.custoInsumos > 0 && <> · insumos {fmt(it.custoInsumos)}</>}
                        {estoque && !estoque.estoqueSuficiente && (
                          <span className="ml-2 text-amber-600">(material insuficiente)</span>
                        )}
                        {estoque?.insumos.some((x) => !x.estoqueSuficiente) && (
                          <span className="ml-2 text-amber-600">(insumo insuficiente)</span>
                        )}
                      </div>
                    </div>
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{fmt(it.custoItemTotal)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {r && (
          <Card titulo="Composição do custo">
            <dl className="space-y-2 text-sm">
              <Linha rotulo="Material" valor={r.custos.custoMaterial} fmt={fmt} />
              <Linha rotulo="Energia" valor={r.custos.custoEnergia} fmt={fmt} />
              <Linha rotulo="Depreciação" valor={r.custos.depreciacao} fmt={fmt} />
              <Linha rotulo="Mão de obra" valor={r.custos.maoDeObra} fmt={fmt} />
              <Linha rotulo="Custo fixo rateado" valor={r.custos.custoFixoRateado} fmt={fmt} />
              {r.custos.custoInsumos > 0 && (
                <Linha rotulo="Insumos (leva margem, sem provisão de falha)" valor={r.custos.custoInsumos} fmt={fmt} />
              )}
              {r.custos.custoVariavel > 0 && (
                <Linha rotulo="Custos variáveis (leva margem, sem provisão de falha)" valor={r.custos.custoVariavel} fmt={fmt} />
              )}
              <div className="my-2 border-t border-slate-100 dark:border-slate-800" />
              <Linha rotulo="Subtotal (sem provisão de falha)" valor={r.custos.custoTotal} fmt={fmt} />
              <Linha rotulo="Custo total (com provisão de falha)" valor={r.custos.custoComFalha} fmt={fmt} forte />
              <Linha rotulo="Lucro" valor={r.margem.lucro} fmt={fmt} />
              <Linha rotulo="Margem sobre o preço" valor={r.margem.real} fmt={pct} />
              <Linha rotulo="Markup sobre o custo" valor={r.margem.markupSobreCusto} fmt={pct} />
            </dl>
            {(() => {
              const pesoTotal = r.itens.reduce((s, i) => s + i.pesoG, 0);
              const consumoTotal = sim?.itens.reduce((s, i) => s + i.consumoG, 0) ?? pesoTotal;
              const temDesperdicio = Math.abs(consumoTotal - pesoTotal) > 0.05;
              return (
                <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {temDesperdicio && (
                      <div>
                        Peso das peças: <strong className="text-slate-700 dark:text-slate-200">{gramas(pesoTotal)}</strong>
                      </div>
                    )}
                    <div title="Consumo total = peso das peças + a taxa de desperdício (perda de purga/suporte) configurada em cada material. É o que é baixado do estoque.">
                      Consumo total{temDesperdicio ? ' (com desperdício do material)' : ''}:{' '}
                      <strong className="text-slate-700 dark:text-slate-200">{gramas(consumoTotal)}</strong>
                      {sim && !sim.estoqueSuficiente && <span className="ml-2 text-amber-600">(estoque insuficiente)</span>}
                    </div>
                  </div>
                  {(() => {
                    // Editar nao consome credito (so' criar) — nao bloqueia por saldo.
                    const semCredito =
                      !editando && saldo !== null && !saldo.ilimitado && saldo.creditos < CUSTO_ORCAMENTO;
                    return (
                      <div className="mt-3 flex items-center justify-end gap-3">
                        {semCredito && (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            Saldo insuficiente ({saldo!.creditos} de {CUSTO_ORCAMENTO} créditos) —{' '}
                            <Link to="/creditos" className="underline">
                              recarregar
                            </Link>
                          </span>
                        )}
                        <Button onClick={salvar} disabled={salvando || !r.margem.atingeMinima || semCredito}>
                          {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Salvar orçamento'}
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </Card>
        )}

        {r && (
          <InteligenciaNegocio
            r={r}
            tempoImpressaoH={form.itens.reduce(
              (s, it) => s + paraHorasDecimais(it.tempoImpressaoHoras, it.tempoImpressaoMinutos),
              0,
            )}
            fmt={fmt}
          />
        )}
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
  // Margem SOBRE O PRECO TOTAL: preco = custo / (1 - margem) — replica
  // exatamente a formula do backend (finalizarPreco em engine.ts) pra
  // sugerir preco minimo/recomendado. custoComFalha ja soma TODOS os custos
  // reais (inclusive o variavel — frete/embalagem), entao nenhum componente
  // fica de fora da conta.
  const precoMinimo = custoComFalha / (1 - r.margem.minima);
  // Sugestao de margem "confortavel": pelo menos 50%, ou 30 pontos acima da
  // minima — nunca >= 90% (perto de 100% a formula diverge; um teto
  // sanitario evita sugerir um preco absurdo quando a minima ja e' alta).
  const margemRecomendada = Math.min(0.9, Math.max(0.5, r.margem.minima + 0.3));
  const precoRecomendado = custoComFalha / (1 - margemRecomendada);
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
