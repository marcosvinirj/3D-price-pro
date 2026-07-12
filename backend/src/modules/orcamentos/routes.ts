/** Rotas de orcamentos e simulador de precificacao. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/errors.js';
import { validarBody, obterId } from '../../http/validate.js';
import {
  orcamentoInputSchema,
  simular,
  criarOrcamento,
  editarOrcamento,
  aprovarOrcamento,
  recusarOrcamento,
  listarOrcamentos,
  obterOrcamento,
} from './service.js';
import { gerarPdfOrcamento, nomeArquivoPdf } from './pdf.js';
import { obterMoedaOuBase } from '../moedas/service.js';

/** Junta o nome+cor dos materiais das pecas de um orcamento (p/ CSV/XLSX). */
function materiaisResumo(o: { itens: { material: { nome: string; cor: string | null } }[] }): string {
  return o.itens.map((i) => i.material.nome + (i.material.cor ? ` (${i.material.cor})` : '')).join(' + ');
}

/** Escapa um campo para CSV (aspas duplas + envolve se tiver separador). */
function campoCsv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Escapa texto para XML (SpreadsheetML). */
function xmlEsc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Celula tipada para SpreadsheetML (numero vira Number; resto String). */
function celulaXls(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
}

export const orcamentosRouter = Router();

/** Simulador "e se" — recalcula o preco sem persistir. */
orcamentosRouter.post(
  '/simular',
  validarBody(orcamentoInputSchema),
  asyncHandler(async (req, res) => {
    res.json(await simular(req.body, req.usuario!.sub));
  }),
);

orcamentosRouter.post(
  '/',
  validarBody(orcamentoInputSchema),
  asyncHandler(async (req, res) => {
    const resultado = await criarOrcamento(req.body, req.usuario!.sub);
    res.status(201).json(resultado);
  }),
);

/** Edita um orcamento PENDENTE (recalcula tudo; aprovado/recusado sao imutaveis). */
orcamentosRouter.patch(
  '/:id',
  validarBody(orcamentoInputSchema),
  asyncHandler(async (req, res) => {
    res.json(await editarOrcamento(obterId(req), req.body, req.usuario!.sub));
  }),
);

const filtroSchema = z.object({
  status: z.enum(['pendente', 'aprovado', 'recusado']).optional(),
});

orcamentosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = filtroSchema.parse(req.query);
    res.json(await listarOrcamentos(req.usuario!.sub, status));
  }),
);

/** Exporta todos os orcamentos em CSV (Excel-friendly, separador ';'). */
orcamentosRouter.get(
  '/export/csv',
  asyncHandler(async (req, res) => {
    const itens = await listarOrcamentos(req.usuario!.sub);
    const cols = [
      'id',
      'criadoEm',
      'cliente',
      'peca',
      'pecas',
      'materiais',
      'impressora',
      'pesoTotalG',
      'precoFinal',
      'precoCobrado',
      'status',
    ];
    const linhas = itens.map((o) =>
      [
        o.id,
        new Date(o.criadoEm).toISOString(),
        o.cliente ?? '',
        o.descricaoPeca ?? '',
        o.itens.length,
        materiaisResumo(o),
        o.impressora.nome,
        o.itens.reduce((s, i) => s + i.pesoG, 0),
        o.precoFinal,
        o.precoCobrado,
        o.status,
      ]
        .map(campoCsv)
        .join(';'),
    );
    const csv = '﻿' + [cols.join(';'), ...linhas].join('\r\n'); // BOM p/ Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orcamentos.csv"');
    res.send(csv);
  }),
);

/** Exporta todos os orcamentos em Excel (SpreadsheetML, abre nativo no Excel). */
orcamentosRouter.get(
  '/export/xlsx',
  asyncHandler(async (req, res) => {
    const itens = await listarOrcamentos(req.usuario!.sub);
    const cols = [
      'id',
      'criadoEm',
      'cliente',
      'peca',
      'pecas',
      'materiais',
      'impressora',
      'pesoTotalG',
      'precoFinal',
      'precoCobrado',
      'status',
    ];
    const header = `<Row>${cols.map((c) => celulaXls(c)).join('')}</Row>`;
    const linhas = itens
      .map((o) =>
        `<Row>${[
          o.id,
          new Date(o.criadoEm).toISOString().slice(0, 10),
          o.cliente ?? '',
          o.descricaoPeca ?? '',
          o.itens.length,
          materiaisResumo(o),
          o.impressora.nome,
          o.itens.reduce((s, i) => s + i.pesoG, 0),
          o.precoFinal,
          o.precoCobrado,
          o.status,
        ]
          .map((v) => celulaXls(v))
          .join('')}</Row>`,
      )
      .join('');
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Worksheet ss:Name="Orcamentos"><Table>' +
      header +
      linhas +
      '</Table></Worksheet></Workbook>';
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orcamentos.xls"');
    res.send(xml);
  }),
);

orcamentosRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await obterOrcamento(obterId(req), req.usuario!.sub));
  }),
);

/** Gera o PDF do orcamento (voltado ao cliente). */
orcamentosRouter.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const usuarioId = req.usuario!.sub;
    const id = obterId(req);
    await obterOrcamento(id, usuarioId); // garante que o orcamento e' do usuario (404 senao)
    const codigo = typeof req.query.moeda === 'string' ? req.query.moeda : undefined;
    const moeda = await obterMoedaOuBase(usuarioId, codigo);
    const bytes = await gerarPdfOrcamento(id, moeda);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivoPdf(id)}"`);
    res.send(Buffer.from(bytes));
  }),
);

orcamentosRouter.post(
  '/:id/aprovar',
  asyncHandler(async (req, res) => {
    res.json(await aprovarOrcamento(obterId(req), req.usuario!.sub));
  }),
);

orcamentosRouter.post(
  '/:id/recusar',
  asyncHandler(async (req, res) => {
    res.json(await recusarOrcamento(obterId(req), req.usuario!.sub));
  }),
);
