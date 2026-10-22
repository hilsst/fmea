// IAQG SCMH dokümanları: proje verisini resmi SCMH şablonlarına (7.2.9 PFD, 7.2.10 DFMEA, 7.2.11 PFMEA,
// 7.2.13 Control Plan) yerinde yazar. Şablonun kendisi kullanıcıdan gelir (© IAQG; depoda yoktur).
// Hücre eşlemesi build_scmh_revC.py ile aynıdır. Kurallar:
//  - Şablonun beklediği bir değer kaynakta yoksa "VERİ YOK – doğrulanmalı" yazılır; değer uydurulmaz.
//  - RPN / SEV×OCC formülleri şablondaki gibi kalır (önbellek silinir, Excel açılışta hesaplar).
//  - Proje satırı şablon satırından fazlaysa, son şablon satırının stiliyle satır eklenir.
//  - Revision History, şablondaki mevcut satırların altına p.history'den eklenir.
import { ScmhBook, type CellValue } from './scmhfill';
import { scmhClassificationOf, scmhCpClassification, scmhPriority, scmhStepClassification } from './scmhScoring'; // v4-kc
import { commentText, decisionCols, lineNumbers, reactionExportText, splitRequirement, withRank } from './risk'; // v4-risk
import { LISTS } from './model';
import type { ActionRow, ControlPlanRow, DfmeaRow, HistoryRow, PfdStepType, PfmeaRow, ProcessStepRow, Project, Score } from './types';

export const VY = 'VERİ YOK – doğrulanmalı';

export type ScmhKind = 'pfd' | 'dfmea' | 'pfmea' | 'cp';

/** Çıktı dosya adlarının sabit önekleri (SCMH bölüm numarası + doküman tipi). */
export const SCMH_FILE_NAMES: Record<ScmhKind, string> = {
  pfd: 'SCMH-7.2.9_PFD',
  dfmea: 'SCMH-7.2.10_DFMEA',
  pfmea: 'SCMH-7.2.11_PFMEA',
  cp: 'SCMH-7.2.13_Control-Plan',
};

/** IAQG'den indirilen resmi şablonların dosya adları (kullanıcı sağlar). */
export const SCMH_TEMPLATE_FILES: Record<ScmhKind, string> = {
  pfd: 'SCMH-7.2.9-PFD-Template-RevA.xlsx',
  dfmea: 'SCMH-7.2.10-DFMEA-Template.xlsx',
  pfmea: 'SCMH-7.2.11-PFMEA-Template-RevA.xlsx',
  cp: 'SCMH-7.2.13-Control-Plan-Template-RevA.xlsx',
};

/** Proje için çıktı dosya adı, örn. "SCMH-7.2.10_DFMEA_FMEA-CP-001_RevA.xlsx". */
export function scmhFileName(kind: ScmhKind, p: Project): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 60);
  const part = safe(p.meta.partNumber || p.meta.fmeaNumber || p.meta.name || 'FMEA');
  const rev = safe(p.meta.fmeaRevision || '');
  return `${SCMH_FILE_NAMES[kind]}_${part}${rev ? '_' + rev : ''}.xlsx`;
}

// ------------------------------------------------------------------ şablon yerleşimi
interface Layout {
  sheet: string;
  /** İlk veri satırı. */
  first: number;
  /** Şablondaki son veri satırı (alt bilgi satırı bulunamazsa). */
  last: number;
  revSheet: string;
  revCols: string[];
  /** Tablonun sağındaki form dışı izlenebilirlik sütunu (opsiyonel) ve stil kaynağı. */
  trace: { col: string; n: number; styleFrom: string; headerRow: number };
}

export const SCMH_LAYOUT: Record<ScmhKind, Layout> = {
  dfmea: { sheet: 'DFMEA', first: 18, last: 76, revSheet: 'Revision History', revCols: ['A', 'B', 'C', 'D'], trace: { col: 'AB', n: 28, styleFrom: 'AA', headerRow: 17 } },
  pfmea: { sheet: 'PFMEA', first: 17, last: 75, revSheet: 'Revision History', revCols: ['A', 'B', 'C'], trace: { col: 'AB', n: 28, styleFrom: 'Z', headerRow: 16 } },
  cp: { sheet: 'Control Plan', first: 19, last: 45, revSheet: 'Control Plan Revision History', revCols: ['A', 'B', 'C', 'D'], trace: { col: 'Q', n: 17, styleFrom: 'O', headerRow: 18 } },
  pfd: { sheet: 'PFD', first: 15, last: 49, revSheet: 'Revision History', revCols: ['A', 'B', 'C'], trace: { col: 'R', n: 18, styleFrom: 'P', headerRow: 13 } },
};

/** Başlık bloğu hücreleri (değer hücreleri; etiketler bir üst satırdadır). */
type HeaderKey =
  | 'org' | 'export' | 'location' | 'other' | 'program' | 'scope' | 'docNo' | 'partNo' | 'owner'
  | 'dateOrig' | 'partRev' | 'facilitator' | 'dateRev' | 'partName' | 'team';

export const SCMH_HEADER: Record<ScmhKind, Partial<Record<HeaderKey, string>>> = {
  dfmea: { org: 'B5', export: 'H5', location: 'B7', other: 'H7', program: 'G10', scope: 'L10', docNo: 'T10', partNo: 'B12', owner: 'G12', dateOrig: 'T12', partRev: 'B14', facilitator: 'G14', dateRev: 'T14', partName: 'B16', team: 'G16' },
  pfmea: { org: 'B4', export: 'I4', location: 'B6', other: 'I6', program: 'H9', docNo: 'M9', dateOrig: 'U9', partNo: 'B11', owner: 'H11', dateRev: 'U11', partRev: 'B13', facilitator: 'H13', partName: 'B15', team: 'H15' },
  cp: { org: 'B5', export: 'H5', docNo: 'K5', dateOrig: 'N5', dateRev: 'O5', location: 'B7', other: 'H7', partNo: 'B11', program: 'H11', partRev: 'B13', owner: 'H13', partName: 'B15', team: 'H15' },
  pfd: { org: 'B4', export: 'I4', location: 'B6', other: 'I6', partNo: 'B8', program: 'I8', docNo: 'O8', dateOrig: 'P8', partRev: 'B10', owner: 'I10', dateRev: 'P10', partName: 'B12', team: 'I12' },
};

/** Form kontrol checkbox'larının shapeId'leri (şablon sayfa XML'indeki <control shapeId>). */
export const SCMH_CHECKBOX = {
  dfmeaLevel: { System: 68611, Subsystem: 68609, Component: 68610 } as Record<string, number>,
  pfmeaPhase: { 'Pre-Production': 72706, Production: 72705 } as Record<string, number>,
  cpPhase: { 'Pre-Production': 20536, Production: 20497 } as Record<string, number>,
};

/** PFD sembol sütunları (şablon satır 14'teki şekillerle aynı sıra) ve hücreye yazılan işaret. */
export const PFD_STEP_COLUMNS: Record<PfdStepType, { col: string; mark: string }> = {
  Operation: { col: 'F', mark: '○' },
  Setup: { col: 'G', mark: '⬡' },
  Move: { col: 'H', mark: '⇨' },
  Store: { col: 'I', mark: '▽' },
  'Inspect/Test': { col: 'J', mark: '☐' },
  Other: { col: 'K', mark: '' }, // "Other (Specify)": açıklama yazılır
  Rework: { col: 'L', mark: '⬠' },
};

// ------------------------------------------------------------------ yardımcılar
const s = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(s).filter(Boolean).join('; ');
  if (typeof v === 'object') return '';
  return String(v).trim();
};
const or = (...v: unknown[]): string => {
  for (const x of v) {
    const t = s(x);
    if (t) return t;
  }
  return '';
};
const need = (...v: unknown[]): string => or(...v) || VY;
const score = (v: Score): number | string => (typeof v === 'number' && Number.isFinite(v) ? v : VY);
const optScore = (v: Score): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const uniq = (xs: unknown[]) => [...new Set(xs.map(s).filter(Boolean))];
const opNum = (op: string) => {
  const n = parseFloat(String(op).replace(',', '.'));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};
const stepLabel = (op: string, name: string) => (op && name ? `${op} – ${name}` : op || name);

interface Ctx {
  b: ScmhBook;
  L: Layout;
  trace: boolean;
  // v4-risk
  ranks?: boolean;
  comments?: boolean;
}

/** v4-risk: form dışı "Comments" sütunu (SCMH 7.2.19 Z/AA "Comments"); izlenebilirlik sütununun solunda. */
export const SCMH_COMMENTS: Record<ScmhKind, { col: string; n: number; styleFrom: string }> = {
  dfmea: { col: 'AA', n: 27, styleFrom: 'Z' },
  pfmea: { col: 'AA', n: 27, styleFrom: 'Z' },
  cp: { col: 'P', n: 16, styleFrom: 'O' },
  pfd: { col: 'Q', n: 17, styleFrom: 'P' },
};

function writeComment(ctx: Ctx, kind: ScmhKind, r: number, text: string) {
  if (!ctx.comments) return;
  const c = SCMH_COMMENTS[kind];
  if (r === 0) {
    ctx.b.setColWidth(ctx.L.sheet, c.n, 45);
    ctx.b.set(ctx.L.sheet, `${c.col}${ctx.L.trace.headerRow}`, 'Comments', { styleFrom: `${c.styleFrom}${ctx.L.trace.headerRow}`, wrap: true });
    return;
  }
  if (text) ctx.b.set(ctx.L.sheet, `${c.col}${r}`, text, { styleFrom: `${c.styleFrom}${r}`, wrap: true });
}

/** Satırın hücrelerini yazar; metin hücreleri sarılır, satır yüksekliği metne göre ayarlanır. */
function writeRow(ctx: Ctx, r: number, vals: Record<string, CellValue>, minH = 18) {
  const texts: Record<string, string> = {};
  for (const [col, v] of Object.entries(vals)) {
    const isText = typeof v === 'string' && v.length > 0;
    ctx.b.set(ctx.L.sheet, `${col}${r}`, v, { wrap: isText });
    if (isText) texts[col] = v as string;
  }
  ctx.b.fitRow(ctx.L.sheet, r, texts, 13, minH);
}

function writeTrace(ctx: Ctx, r: number, text: string) {
  if (!ctx.trace) return;
  const t = ctx.L.trace;
  ctx.b.set(ctx.L.sheet, `${t.col}${r}`, text, { styleFrom: `${t.styleFrom}${r}`, wrap: true });
}

function setupTrace(ctx: Ctx) {
  if (!ctx.trace) return;
  const t = ctx.L.trace;
  ctx.b.setColWidth(ctx.L.sheet, t.n, 40);
  ctx.b.set(ctx.L.sheet, `${t.col}${t.headerRow}`, 'FMEA Studio ID / izlenebilirlik (form dışı)', { styleFrom: `${t.styleFrom}${t.headerRow}`, wrap: true });
}

/** Alt bilgi (©) satırını bulur; bulunamazsa yerleşimdeki son satır + 1. */
function footerRow(b: ScmhBook, sheet: string, col: string, from: number, fallback: number): number {
  return b.findRow(sheet, col, (v) => typeof v === 'string' && v.trim().startsWith('©'), from) ?? fallback;
}

/**
 * [first, first+count) satırlarını kullanılabilir yapar: şablonda yeterli satır yoksa son şablon
 * satırının kopyaları tablonun içine (alt bilgiden önce) eklenir; aralıklar ve formüller genişler.
 */
function ensureRows(b: ScmhBook, sheet: string, first: number, count: number, footer: number) {
  const lastTemplate = footer - 1;
  const extra = first + count - footer;
  if (extra > 0) b.insertRows(sheet, lastTemplate, extra, lastTemplate);
}

function headerBlock(b: ScmhBook, kind: ScmhKind, p: Project) {
  const m = p.meta;
  const sheet = SCMH_LAYOUT[kind].sheet;
  const docNo = [m.fmeaNumber, m.fmeaRevision].map(s).filter(Boolean).join(' ');
  const vals: Record<HeaderKey, string> = {
    org: need(m.organization, m.supplier),
    export: need(m.exportControl),
    location: need(m.location),
    other: need(m.otherRestrictions, m.confidentiality),
    program: need(m.program),
    scope: need(m.scope),
    docNo: docNo || VY,
    partNo: need(m.partNumber),
    owner: need(kind === 'dfmea' ? m.productOwner : m.processOwner),
    dateOrig: need(m.startDate),
    partRev: need(m.drawingRevision),
    facilitator: need(m.facilitator, m.preparedBy),
    dateRev: need(m.revisionDate),
    partName: need(m.partName),
    team: need(m.team),
  };
  for (const [k, ref] of Object.entries(SCMH_HEADER[kind]) as [HeaderKey, string][]) {
    const long = k === 'scope' || k === 'team';
    b.set(sheet, ref, vals[k], long ? { wrap: true } : {});
  }
}

function revisionHistory(b: ScmhBook, L: Layout, history: HistoryRow[]) {
  const sheet = L.revSheet;
  if (!b.hasSheet(sheet) || !history.length) return;
  const start = b.firstEmptyRow(sheet, L.revCols.slice(0, 3), 4);
  const footer = footerRow(b, sheet, 'A', 4, 36);
  ensureRows(b, sheet, Math.min(start, footer), history.length, footer);
  history.forEach((h, i) => {
    const r = Math.min(start, footer) + i;
    const changes = [h.added && `Eklenen: ${h.added}`, h.modified && `Değişen: ${h.modified}`, h.deleted && `Silinen: ${h.deleted}`].filter(Boolean).join('; ');
    const summary = [s(h.description), changes].filter(Boolean).join(' – ');
    const vals = [need(h.date), need(h.revision), summary || VY, need(h.approvedBy)];
    L.revCols.forEach((c, k) => b.set(sheet, `${c}${r}`, vals[k], { wrap: k === 2 }));
    b.fitRow(sheet, r, { C: vals[2] });
  });
}

function actionOf(p: Project, row: { id: string; actionId: string }): ActionRow | undefined {
  return p.actions.find((a) => (row.actionId && a.id === row.actionId) || a.sourceId === row.id);
}

/** Öneri/aksiyon ve sonuç sütunları (DFMEA Q–X, PFMEA R–Y ortak mantığı). */
function actionCols(p: Project, row: DfmeaRow | PfmeaRow) {
  const a = actionOf(p, row);
  const rec = or(row.recommendedAction, a?.description);
  const taken = or(row.actionTaken, a?.actionTaken);
  return {
    rec,
    owner: rec ? need(row.owner, a?.owner) : or(row.owner, a?.owner),
    due: rec ? need(row.dueDate, a?.dueDate) : or(row.dueDate, a?.dueDate),
    taken,
    done: or(a?.completionDate),
    newS: optScore(row.newS ?? a?.newS ?? null),
    newO: optScore(row.newO ?? a?.newO ?? null),
    newD: optScore(row.newD ?? a?.newD ?? null),
  };
}

function classificationFor(p: Project, rowId: string, specialChar?: string): string {
  void specialChar; // Özel karakteristik tipi tek başına benzersiz ID değildir; yalnızca KC ID'leri yazılır.
  return scmhClassificationOf(p, rowId);
}

// ------------------------------------------------------------------ DFMEA
async function fillDfmea(p: Project, tpl: Uint8Array, trace: boolean, opt: Pick<Ctx, 'ranks' | 'comments'> = {}): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.dfmea;
  const ctx: Ctx = { b, L, trace, ...opt };
  headerBlock(b, 'dfmea', p);
  const lvl = SCMH_CHECKBOX.dfmeaLevel[p.meta.dfmeaLevel];
  if (lvl) b.checkBox(L.sheet, lvl, true);
  const rows = p.dfmea;
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, rows.length, footer);
  setupTrace(ctx);
  const fn = new Map(p.structure.map((x) => [x.id, x]));
  const req = new Map(p.requirements.map((x) => [x.id, x]));
  const lines = lineNumbers(rows); // v4-risk
  writeComment(ctx, 'dfmea', 0, '');
  rows.forEach((d, i) => {
    const r = L.first + i;
    const f = fn.get(d.functionId);
    const item = or([d.system, d.subsystem, d.component].map(s).filter(Boolean).join(' / '), f?.element);
    const reqText = or(d.requirement, d.reqIds.map((id) => (req.get(id) ? `${id}: ${s(req.get(id)!.text)}` : id)));
    const rk = (t: string, v: Score) => withRank(t, v, !!ctx.ranks); // v4-risk: (n) puanı
    const eff = [d.localEffect && rk(`(L) ${s(d.localEffect)}`, d.localEffectS), d.higherEffect && rk(`(N) ${s(d.higherEffect)}`, d.higherEffectS), d.effect && rk(d.localEffect || d.higherEffect ? `(E) ${s(d.effect)}` : s(d.effect), d.s)]
      .filter(Boolean)
      .join('\n');
    const a = decisionCols(p, d, actionCols(p, d)); // v4-risk: ALARP / öngörülen sonuç
    writeRow(ctx, r, {
      B: lines.get(d.id) ?? i + 1, // v4-risk: sabit satır numarası
      C: item || VY,
      D: need(d.function, f?.function),
      E: reqText || VY,
      F: need(d.failureMode),
      G: eff || VY,
      H: score(d.s),
      I: need(d.cause),
      J: rk(need(d.prevention), d.o),
      K: score(d.o),
      L: rk(need(d.detection), d.d),
      M: score(d.d),
      P: classificationFor(p, d.id, d.specialChar),
      Q: a.rec,
      R: a.owner,
      S: a.due,
      T: a.taken,
      U: a.done,
      V: a.newS,
      W: a.newO,
      X: a.newD,
    });
    writeTrace(ctx, r, [d.id, d.functionId, ...d.reqIds, d.actionId, sdText(d)].filter(Boolean).join(' | ')); // v4-risk: SO/SD
    writeComment(ctx, 'dfmea', r, commentText(p, d)); // v4-risk
  });
  b.stripFormulaCache(L.sheet);
  revisionHistory(b, L, p.history);
  return b.save();
}

// ------------------------------------------------------------------ PFMEA
/** v4-risk: SCMH 7.2.10/7.2.11'de S×D sütunu yok; izlenebilirlik sütununa yazılır (SCMH 7.2.3 p59). */
function sdText(r: DfmeaRow | PfmeaRow): string {
  const pr = scmhPriority(r);
  return [pr.so != null && `S×O ${pr.so}`, pr.sd != null && `S×D ${pr.sd}`].filter(Boolean).join(', ');
}

function sortedPfmea(p: Project): PfmeaRow[] {
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  const op = (r: PfmeaRow) => or(step.get(r.stepId)?.opNo, r.opNo);
  return [...p.pfmea].sort((a, b) => opNum(op(a)) - opNum(op(b)) || op(a).localeCompare(op(b)) || a.id.localeCompare(b.id));
}

async function fillPfmea(p: Project, tpl: Uint8Array, trace: boolean, opt: Pick<Ctx, 'ranks' | 'comments'> = {}): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.pfmea;
  const ctx: Ctx = { b, L, trace, ...opt };
  headerBlock(b, 'pfmea', p);
  const ph = SCMH_CHECKBOX.pfmeaPhase[p.meta.scmhPhase];
  if (ph) b.checkBox(L.sheet, ph, true);
  const rows = sortedPfmea(p);
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, rows.length, footer);
  setupTrace(ctx);
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  const lines = lineNumbers(rows); // v4-risk
  writeComment(ctx, 'pfmea', 0, '');
  rows.forEach((x, i) => {
    const r = L.first + i;
    const st = step.get(x.stepId);
    const label = stepLabel(or(st?.opNo, x.opNo), or(st?.name, x.stepName));
    const req = splitRequirement(p, x); // v4-risk: SCMH 7.2.11 Rev A E/F sütunları
    const prevention = or(x.prevention, x.errorProofing && !/^None/.test(x.errorProofing) ? x.errorProofing : '');
    const a = decisionCols(p, x, actionCols(p, x)); // v4-risk
    const rk = (t: string, v: Score) => withRank(t, v, !!ctx.ranks); // v4-risk
    writeRow(ctx, r, {
      B: lines.get(x.id) ?? i + 1, // v4-risk
      C: label || VY,
      D: need(x.processFunction, st?.description),
      E: req.product || (req.process ? '' : VY),
      F: req.process,
      G: need(x.failureMode),
      H: rk(need(x.effect), x.s),
      I: score(x.s),
      J: need(x.cause),
      K: rk(prevention || VY, x.o),
      L: score(x.o),
      M: rk(need(x.detection), x.d),
      N: score(x.d),
      Q: classificationFor(p, x.id, x.specialChar),
      R: a.rec,
      S: a.owner,
      T: a.due,
      U: a.taken,
      V: a.done,
      W: a.newS,
      X: a.newO,
      Y: a.newD,
    });
    writeTrace(ctx, r, [x.id, x.stepId, ...x.dfIds, x.actionId, sdText(x)].filter(Boolean).join(' | ')); // v4-risk
    writeComment(ctx, 'pfmea', r, commentText(p, x)); // v4-risk
  });
  b.stripFormulaCache(L.sheet);
  revisionHistory(b, L, p.history);
  return b.save();
}

// ------------------------------------------------------------------ Control Plan
function sortedCp(p: Project): ControlPlanRow[] {
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  const op = (r: ControlPlanRow) => or(step.get(r.stepId)?.opNo, r.opNo);
  return [...p.controlPlan].sort((a, b) => opNum(op(a)) - opNum(op(b)) || op(a).localeCompare(op(b)) || a.id.localeCompare(b.id));
}

async function fillCp(p: Project, tpl: Uint8Array, trace: boolean, opt: Pick<Ctx, 'ranks' | 'comments'> = {}): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.cp;
  const ctx: Ctx = { b, L, trace, ...opt };
  headerBlock(b, 'cp', p);
  const ph = SCMH_CHECKBOX.cpPhase[p.meta.scmhPhase];
  if (ph) b.checkBox(L.sheet, ph, true);
  const rows = sortedCp(p);
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, rows.length, footer);
  setupTrace(ctx);
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  const lines = lineNumbers(rows); // v4-risk
  writeComment(ctx, 'cp', 0, '');
  rows.forEach((c, i) => {
    const r = L.first + i;
    const st = step.get(c.stepId);
    const label = stepLabel(or(st?.opNo, c.opNo), or(st?.name, c.processName));
    const machine = or([c.machine, c.tool].map(s).filter(Boolean).join(' / '), [st?.machine, st?.tool].map(s).filter(Boolean).join(' / '));
    const spec = [s(c.specification), s(c.tolerance)].filter(Boolean).join(' | ');
    const meas = [s(c.method), s(c.gauge)].filter(Boolean).join(' – ');
    const prod = s(c.productChar);
    const procC = s(c.processChar);
    writeRow(ctx, r, {
      B: lines.get(c.id) ?? i + 1, // v4-risk
      C: label || VY,
      D: need(st?.description),
      E: machine || VY,
      F: need(c.reference, c.charId), // v4-risk: boşsa karakteristik ID (CP Q&A Q31)
      G: prod || (procC ? '' : VY),
      H: procC,
      I: scmhCpClassification(p, c), // v4-kc
      J: spec || VY,
      K: meas || VY,
      L: need(c.sampleSize),
      M: need(c.frequency),
      N: need(c.controlMethod, c.controlKind ? [c.controlKind, c.epDevice, c.epVerification].map(s).filter((x) => x && x !== VY).join(' – ') : ''), // v4-risk
      O: reactionExportText(c), // v4-risk: reaksiyon + sorumlu (şablonda sorumlu sütunu yok)
    });
    writeTrace(ctx, r, [c.id, c.stepId, c.pfId, c.kcId, c.ppId, c.charId && `ID ${c.charId}`, ...(c.controlsCpIds ?? []).map((x) => `→ ${x}`), c.wiDocId && `WI ${c.wiDocId}${c.wiSection ? ' ' + c.wiSection : ''}`].filter(Boolean).join(' | ')); // v4-risk
    writeComment(ctx, 'cp', r, s(c.notes)); // v4-risk
  });
  revisionHistory(b, L, p.history);
  return b.save();
}

// ------------------------------------------------------------------ PFD
/** Adım tipi verilmemişse yalnızca uygulamadaki standart adım adlarından türetilir; aksi halde boş. */
export function inferStepType(step: Pick<ProcessStepRow, 'name' | 'stepType'>): PfdStepType[] {
  if (step.stepType?.length) return step.stepType;
  const n = s(step.name);
  if (!n) return [];
  if (/^(storage|store)$/i.test(n)) return ['Store'];
  if (/^(incoming material|inspection|final inspection)$/i.test(n)) return ['Inspect/Test'];
  if ((LISTS.processStep as string[]).includes(n)) return ['Operation'];
  return [];
}

async function fillPfd(p: Project, tpl: Uint8Array, trace: boolean, opt: Pick<Ctx, 'ranks' | 'comments'> = {}): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.pfd;
  const ctx: Ctx = { b, L, trace, ...opt };
  headerBlock(b, 'pfd', p);
  const steps = [...p.processSteps].sort((a, c) => opNum(a.opNo) - opNum(c.opNo) || s(a.opNo).localeCompare(s(c.opNo)) || a.id.localeCompare(c.id));
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, steps.length, footer);
  setupTrace(ctx);
  const lines = lineNumbers(steps); // v4-risk
  const byId = new Map(p.processSteps.map((x) => [x.id, x]));
  writeComment(ctx, 'pfd', 0, '');
  steps.forEach((st, i) => {
    const r = L.first + i;
    const pf = p.pfmea.filter((x) => x.stepId === st.id);
    const cps = p.controlPlan.filter((c) => c.stepId === st.id);
    // v4-risk: PFD çıktıları (ürün karakteristiği) ve değişkenlik kaynağı girdileri (proses karakteristiği), PF webinar p14/p31
    const io = p.pfdItems.filter((x) => x.stepId === st.id && s(x.text));
    const ioText = (k: 'Input' | 'Output') => io.filter((x) => x.kind === k && (k === 'Output' || x.sourceOfVariation || !io.some((y) => y.kind === 'Input' && y.sourceOfVariation))).map((x) => (x.charId ? `${s(x.charId)}: ${s(x.text)}` : s(x.text))).join('; ');
    const cls = or(st.classification, scmhStepClassification(p, st)); // v4-kc: KC/CI numaraları (DFMEA akışı ve PFD girdi/çıktıları dahil)
    const prod = or(st.productChars, ioText('Output'), uniq(cps.map((c) => s(c.productChar))).join('; '));
    const proc = or(st.processChars, ioText('Input'), uniq(cps.map((c) => s(c.processChar))).join('; '));
    const types = inferStepType(st);
    const alt = st.alternateOf ? byId.get(st.alternateOf) : undefined;
    const ret = st.returnTo ? byId.get(st.returnTo) : undefined;
    const desc = [alt ? `Alternatif rota (${or(alt.opNo, alt.id)} yerine): ` : '', need(st.description), ret ? ` → dönüş: ${or(ret.opNo, ret.id)}` : ''].join('');
    const vals: Record<string, CellValue> = {
      B: lines.get(st.id) ?? i + 1, // v4-risk
      C: stepLabel(s(st.opNo), s(st.name)) || VY,
      D: desc, // v4-risk
      N: cls,
      O: prod,
      P: proc,
    };
    for (const t of Object.keys(PFD_STEP_COLUMNS) as PfdStepType[]) vals[PFD_STEP_COLUMNS[t].col] = '';
    if (!types.length) vals.F = VY;
    for (const t of types) {
      const c = PFD_STEP_COLUMNS[t];
      if (!c) continue;
      vals[c.col] = t === 'Other' ? need(st.stepTypeOther) : c.mark;
    }
    if (st.external) vals.K = [s(vals.K), `External – ${need(st.externalSupplier)}`].filter(Boolean).join('; '); // v4-risk: dış operasyon
    if (st.external && vals.F === VY) vals.F = '';
    writeRow(ctx, r, vals, 20.15);
    writeTrace(ctx, r, [st.id, ...pf.map((x) => x.id), ...cps.map((c) => c.id), ...io.map((x) => x.id)].join(' | ')); // v4-risk
    writeComment(ctx, 'pfd', r, s(st.notes)); // v4-risk
  });
  revisionHistory(b, L, p.history);
  return b.save();
}

// ------------------------------------------------------------------ paket
export interface ScmhTemplates {
  pfd: Uint8Array;
  dfmea: Uint8Array;
  pfmea: Uint8Array;
  cp: Uint8Array;
}

export interface ScmhOptions {
  /**
   * Tablonun sağına form dışı bir izlenebilirlik sütunu (FMEA Studio ID'leri) ekle. Varsayılan false:
   * şablon yapısı birebir korunur.
   */
  traceColumn?: boolean;
  /** v4-risk: kontrol/etki metnine "(n)" puanı (varsayılan settings.scmhInlineRanks). */
  inlineRanks?: boolean;
  /** v4-risk: form dışı Comments sütunu (varsayılan settings.scmhCommentsColumn). */
  commentsColumn?: boolean;
}

/** Projeyi dört SCMH şablonuna yazar ve doldurulmuş paketleri döndürür. Şablonlar değiştirilmez. */
export async function buildScmhPackage(p: Project, templates: ScmhTemplates, opts: ScmhOptions = {}): Promise<{ pfd: Buffer; dfmea: Buffer; pfmea: Buffer; cp: Buffer }> {
  const trace = !!opts.traceColumn;
  const opt = { ranks: opts.inlineRanks ?? !!p.settings.scmhInlineRanks, comments: opts.commentsColumn ?? !!p.settings.scmhCommentsColumn }; // v4-risk
  const [pfd, dfmea, pfmea, cp] = await Promise.all([
    fillPfd(p, templates.pfd, trace, opt),
    fillDfmea(p, templates.dfmea, trace, opt),
    fillPfmea(p, templates.pfmea, trace, opt),
    fillCp(p, templates.cp, trace, opt),
  ]);
  return { pfd, dfmea, pfmea, cp };
}
