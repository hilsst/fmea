// IAQG SCMH dokümanları: proje verisini resmi SCMH şablonlarına (7.2.9 PFD, 7.2.10 DFMEA, 7.2.11 PFMEA,
// 7.2.13 Control Plan) yerinde yazar. Şablonun kendisi kullanıcıdan gelir (© IAQG; depoda yoktur).
// Hücre eşlemesi build_scmh_revC.py ile aynıdır. Kurallar:
//  - Şablonun beklediği bir değer kaynakta yoksa "VERİ YOK – doğrulanmalı" yazılır; değer uydurulmaz.
//  - RPN / SEV×OCC formülleri şablondaki gibi kalır (önbellek silinir, Excel açılışta hesaplar).
//  - Proje satırı şablon satırından fazlaysa, son şablon satırının stiliyle satır eklenir.
//  - Revision History, şablondaki mevcut satırların altına p.history'den eklenir.
import { ScmhBook, type CellValue } from './scmhfill';
import { scmhClassificationOf } from './scmhScoring';
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
async function fillDfmea(p: Project, tpl: Uint8Array, trace: boolean): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.dfmea;
  const ctx: Ctx = { b, L, trace };
  headerBlock(b, 'dfmea', p);
  const lvl = SCMH_CHECKBOX.dfmeaLevel[p.meta.dfmeaLevel];
  if (lvl) b.checkBox(L.sheet, lvl, true);
  const rows = p.dfmea;
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, rows.length, footer);
  setupTrace(ctx);
  const fn = new Map(p.structure.map((x) => [x.id, x]));
  const req = new Map(p.requirements.map((x) => [x.id, x]));
  rows.forEach((d, i) => {
    const r = L.first + i;
    const f = fn.get(d.functionId);
    const item = or([d.system, d.subsystem, d.component].map(s).filter(Boolean).join(' / '), f?.element);
    const reqText = or(d.requirement, d.reqIds.map((id) => (req.get(id) ? `${id}: ${s(req.get(id)!.text)}` : id)));
    const eff = [d.localEffect && `(L) ${s(d.localEffect)}`, d.higherEffect && `(N) ${s(d.higherEffect)}`, d.effect && (d.localEffect || d.higherEffect ? `(E) ${s(d.effect)}` : s(d.effect))]
      .filter(Boolean)
      .join('\n');
    const a = actionCols(p, d);
    writeRow(ctx, r, {
      B: i + 1,
      C: item || VY,
      D: need(d.function, f?.function),
      E: reqText || VY,
      F: need(d.failureMode),
      G: eff || VY,
      H: score(d.s),
      I: need(d.cause),
      J: need(d.prevention),
      K: score(d.o),
      L: need(d.detection),
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
    writeTrace(ctx, r, [d.id, d.functionId, ...d.reqIds, d.actionId].filter(Boolean).join(' | '));
  });
  b.stripFormulaCache(L.sheet);
  revisionHistory(b, L, p.history);
  return b.save();
}

// ------------------------------------------------------------------ PFMEA
/** PFMEA gereksinimi proses gereksinimi mi? (Model tek alan tutar; bağlantılardan türetilir.) */
function isProcessRequirement(p: Project, row: PfmeaRow): boolean {
  if (p.processParams.some((pp) => pp.pfIds.includes(row.id))) return true;
  const cps = p.controlPlan.filter((c) => c.pfId === row.id);
  return cps.length > 0 && cps.every((c) => (c.charType === 'Process Characteristic' || c.charType === 'Process Parameter' || (!c.productChar && !!c.processChar)));
}

function sortedPfmea(p: Project): PfmeaRow[] {
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  const op = (r: PfmeaRow) => or(step.get(r.stepId)?.opNo, r.opNo);
  return [...p.pfmea].sort((a, b) => opNum(op(a)) - opNum(op(b)) || op(a).localeCompare(op(b)) || a.id.localeCompare(b.id));
}

async function fillPfmea(p: Project, tpl: Uint8Array, trace: boolean): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.pfmea;
  const ctx: Ctx = { b, L, trace };
  headerBlock(b, 'pfmea', p);
  const ph = SCMH_CHECKBOX.pfmeaPhase[p.meta.scmhPhase];
  if (ph) b.checkBox(L.sheet, ph, true);
  const rows = sortedPfmea(p);
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, rows.length, footer);
  setupTrace(ctx);
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  rows.forEach((x, i) => {
    const r = L.first + i;
    const st = step.get(x.stepId);
    const label = stepLabel(or(st?.opNo, x.opNo), or(st?.name, x.stepName));
    const reqText = s(x.requirement);
    const proc = isProcessRequirement(p, x);
    const prevention = or(x.prevention, x.errorProofing && !/^None/.test(x.errorProofing) ? x.errorProofing : '');
    const a = actionCols(p, x);
    writeRow(ctx, r, {
      B: i + 1,
      C: label || VY,
      D: need(x.processFunction, st?.description),
      E: proc ? '' : reqText || VY,
      F: proc ? reqText : '',
      G: need(x.failureMode),
      H: need(x.effect),
      I: score(x.s),
      J: need(x.cause),
      K: prevention || VY,
      L: score(x.o),
      M: need(x.detection),
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
    writeTrace(ctx, r, [x.id, x.stepId, ...x.dfIds, x.actionId].filter(Boolean).join(' | '));
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

async function fillCp(p: Project, tpl: Uint8Array, trace: boolean): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.cp;
  const ctx: Ctx = { b, L, trace };
  headerBlock(b, 'cp', p);
  const ph = SCMH_CHECKBOX.cpPhase[p.meta.scmhPhase];
  if (ph) b.checkBox(L.sheet, ph, true);
  const rows = sortedCp(p);
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, rows.length, footer);
  setupTrace(ctx);
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
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
      B: i + 1,
      C: label || VY,
      D: need(st?.description),
      E: machine || VY,
      F: need(c.reference),
      G: prod || (procC ? '' : VY),
      H: procC,
      I: s(c.kcId),
      J: spec || VY,
      K: meas || VY,
      L: need(c.sampleSize),
      M: need(c.frequency),
      N: need(c.controlMethod),
      O: need(c.reactionPlan),
    });
    writeTrace(ctx, r, [c.id, c.stepId, c.pfId, c.kcId, c.ppId].filter(Boolean).join(' | '));
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

async function fillPfd(p: Project, tpl: Uint8Array, trace: boolean): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = SCMH_LAYOUT.pfd;
  const ctx: Ctx = { b, L, trace };
  headerBlock(b, 'pfd', p);
  const steps = [...p.processSteps].sort((a, c) => opNum(a.opNo) - opNum(c.opNo) || s(a.opNo).localeCompare(s(c.opNo)) || a.id.localeCompare(c.id));
  const footer = footerRow(b, L.sheet, 'B', L.first, L.last + 1);
  ensureRows(b, L.sheet, L.first, steps.length, footer);
  setupTrace(ctx);
  steps.forEach((st, i) => {
    const r = L.first + i;
    const pf = p.pfmea.filter((x) => x.stepId === st.id);
    const cps = p.controlPlan.filter((c) => c.stepId === st.id);
    const cls = or(st.classification, uniq([...pf.flatMap((x) => scmhClassificationOf(p, x.id).split('; ')), ...cps.map((c) => c.kcId)]).join('; '));
    const prod = or(st.productChars, uniq(cps.map((c) => s(c.productChar))).join('; '));
    const proc = or(st.processChars, uniq(cps.map((c) => s(c.processChar))).join('; '));
    const types = inferStepType(st);
    const vals: Record<string, CellValue> = {
      B: i + 1,
      C: stepLabel(s(st.opNo), s(st.name)) || VY,
      D: need(st.description),
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
    writeRow(ctx, r, vals, 20.15);
    writeTrace(ctx, r, [st.id, ...pf.map((x) => x.id), ...cps.map((c) => c.id)].join(' | '));
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
}

/** Projeyi dört SCMH şablonuna yazar ve doldurulmuş paketleri döndürür. Şablonlar değiştirilmez. */
export async function buildScmhPackage(p: Project, templates: ScmhTemplates, opts: ScmhOptions = {}): Promise<{ pfd: Buffer; dfmea: Buffer; pfmea: Buffer; cp: Buffer }> {
  const trace = !!opts.traceColumn;
  const [pfd, dfmea, pfmea, cp] = await Promise.all([
    fillPfd(p, templates.pfd, trace),
    fillDfmea(p, templates.dfmea, trace),
    fillPfmea(p, templates.pfmea, trace),
    fillCp(p, templates.cp, trace),
  ]);
  return { pfd, dfmea, pfmea, cp };
}
