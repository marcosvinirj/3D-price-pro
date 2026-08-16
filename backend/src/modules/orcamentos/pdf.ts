/**
 * Geracao do PDF de orcamento (voltado ao CLIENTE).
 * Mostra peca, material e preco/desconto — NUNCA a composicao de custo nem a
 * margem, que sao informacoes internas.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { prisma } from '../../db/prisma.js';
import { naoEncontrado } from '../../http/errors.js';
import type { ResultadoPrecificacao } from '../../pricing/index.js';
import { arredondar2 } from '../../pricing/money.js';
import { debitar, CUSTO_PDF } from '../creditos/service.js';

/** Moeda de exibicao do PDF (valores na base sao convertidos). */
export interface MoedaPdf {
  simbolo: string;
  taxaParaBase: number;
}

/** Converte um valor na moeda base para a moeda dada e formata com o simbolo. */
function formatar(valorBase: number, moeda: MoedaPdf) {
  const v = valorBase / moeda.taxaParaBase;
  return `${moeda.simbolo} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Rotulo de uma peca no PDF: nome + so' a COR do filamento — nunca marca,
 * tipo/tecnologia do material, marca/modelo da impressora ou peso (o
 * cliente nao precisa desses detalhes tecnicos). Mostra a quantidade quando
 * maior que 1, ja que o VALOR ao lado e' o total das unidades, nao de uma so'.
 */
function rotuloItem(it: { nome: string | null; quantidade: number; material: { cor: string | null } }): string {
  const nome = it.nome ?? 'Peça';
  const comCor = it.material.cor ? `${nome} — ${it.material.cor}` : nome;
  return it.quantidade > 1 ? `${comCor} (${it.quantidade} un.)` : comCor;
}

const TINTA = rgb(0.04, 0.04, 0.04);
const SUAVE = rgb(0.32, 0.32, 0.3);
const MARCA = rgb(0.16, 0.28, 0.6);
const LINHA = rgb(0.88, 0.88, 0.85);

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
};

export async function gerarPdfOrcamento(
  id: number,
  usuarioId: number,
  moeda: MoedaPdf = { simbolo: '€', taxaParaBase: 1 },
): Promise<Uint8Array> {
  // Filtra por usuarioId aqui mesmo (nao so' no chamador) — a funcao fica
  // segura por si so' mesmo se um caminho futuro esquecer de checar dono
  // antes de chamar (defesa em profundidade pro isolamento multi-tenant).
  const orc = await prisma.orcamento.findFirst({
    where: { id, usuarioId },
    include: { itens: { include: { material: true }, orderBy: { ordem: 'asc' } } },
  });
  if (!orc) throw naoEncontrado('Orcamento');

  // So' debita DEPOIS de confirmar que o orcamento existe e e' do usuario —
  // nao cobra por um PDF que nao pode ser gerado.
  await debitar(usuarioId, CUSTO_PDF, 'consumo_pdf', String(id));

  const resultado = JSON.parse(orc.resultadoJson) as ResultadoPrecificacao;
  const fmt = (v: number) => formatar(v, moeda);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 retrato
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margem = 50;
  let y = height - margem;

  const texto = (
    s: string,
    x: number,
    yy: number,
    opts: { fonte?: PDFFont; tamanho?: number; cor?: typeof TINTA } = {},
  ) => page.drawText(s, { x, y: yy, size: opts.tamanho ?? 11, font: opts.fonte ?? font, color: opts.cor ?? TINTA });

  const linha = (yy: number) =>
    page.drawLine({ start: { x: margem, y: yy }, end: { x: width - margem, y: yy }, thickness: 1, color: LINHA });

  // Cabecalho
  texto('ORÇAMENTO', margem, y, { fonte: bold, tamanho: 22, cor: MARCA });
  const numero = `Nº ${String(orc.id).padStart(4, '0')}`;
  texto(numero, width - margem - bold.widthOfTextAtSize(numero, 12), y + 4, { fonte: bold, tamanho: 12 });
  y -= 18;
  const data = new Date(orc.criadoEm).toLocaleDateString('pt-BR');
  texto(`Emitido em ${data}`, width - margem - font.widthOfTextAtSize(`Emitido em ${data}`, 10), y, { tamanho: 10, cor: SUAVE });
  texto('Impressão 3D — Precificação', margem, y, { tamanho: 10, cor: SUAVE });
  y -= 16;
  linha(y);
  y -= 28;

  // Dados do cliente / peca
  const par = (rotulo: string, valor: string) => {
    texto(rotulo, margem, y, { tamanho: 9, cor: SUAVE });
    texto(valor, margem, y - 14, { fonte: bold, tamanho: 12 });
  };
  par('CLIENTE', orc.cliente || '—');
  texto('PEÇA', width / 2, y, { tamanho: 9, cor: SUAVE });
  texto(orc.descricaoPeca || '—', width / 2, y - 14, { fonte: bold, tamanho: 12 });
  y -= 50;

  // Tabela de valores
  linha(y);
  y -= 20;
  texto('DESCRIÇÃO', margem, y, { fonte: bold, tamanho: 9, cor: SUAVE });
  texto('VALOR', width - margem - 60, y, { fonte: bold, tamanho: 9, cor: SUAVE });
  y -= 18;

  const itemValor = (rotulo: string, valor: string, forte = false) => {
    texto(rotulo, margem, y, { fonte: forte ? bold : font, tamanho: forte ? 13 : 11 });
    const larg = (forte ? bold : font).widthOfTextAtSize(valor, forte ? 13 : 11);
    texto(valor, width - margem - larg, y, { fonte: forte ? bold : font, tamanho: forte ? 13 : 11 });
    y -= forte ? 24 : 18;
  };

  // Rateia o preco final entre as pecas, proporcional ao peso de custo de
  // cada uma (nunca mostra o custo em si — so' o preco resultante). O
  // ultimo item leva o resto, para a soma bater exatamente com o total.
  const somaCustoItens = orc.itens.reduce((s, it) => s + it.custoItem, 0);
  let restante = resultado.precoFinal;
  orc.itens.forEach((it, idx) => {
    const ultimo = idx === orc.itens.length - 1;
    const proporcao = somaCustoItens > 0 ? it.custoItem / somaCustoItens : 1 / orc.itens.length;
    const valorPeca = ultimo ? restante : arredondar2(resultado.precoFinal * proporcao);
    restante = arredondar2(restante - valorPeca);
    itemValor(rotuloItem(it), fmt(valorPeca));
  });
  if (resultado.desconto && resultado.desconto.valorDescontado > 0) {
    itemValor('Desconto', `- ${fmt(resultado.desconto.valorDescontado)}`);
  }
  y -= 4;
  linha(y);
  y -= 22;
  itemValor('TOTAL', fmt(orc.precoCobrado), true);

  // Rodape
  y -= 20;
  texto(`Status: ${STATUS_LABEL[orc.status] ?? orc.status}`, margem, y, { tamanho: 10, cor: SUAVE });
  texto('Validade da proposta: 15 dias.', margem, margem, { tamanho: 9, cor: SUAVE });

  return doc.save();
}

/** Nome de arquivo sugerido para download. */
export function nomeArquivoPdf(id: number): string {
  return `orcamento-${String(id).padStart(4, '0')}.pdf`;
}
