// v4-apqp: opsiyonel SCMH şablonları – 7.2.12 APQP Element Applicability (xlsx), 7.2.14 Maturity Matrix kanıt
// sütunu (xlsx) ve 7.2.20 Part Packaging/Preservation/Labeling Approval Form (docx). Şablonlar © IAQG; kullanıcı
// sağlar, depoda yoktur. Klasörde varsa SCMH paketine eklenir. Doldurma XML düzeyinde yapılır; diğer parçalar korunur.
// Kaynakta olmayan zorunlu değer "VERİ YOK – doğrulanmalı" yazılır. İmza alanları ve olgunluk puanı doldurulmaz.
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { APQP_CATALOG, applicabilityOf, maturityEvidence, type ApqpCatalogItem } from './apqp';
import { ScmhBook } from './scmhfill';
import type { Project } from './types';

const VY = 'VERİ YOK – doğrulanmalı';
const s = (v: string | null | undefined) => (v ?? '').trim();
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export type ApqpTemplateKind = 'apqp' | 'maturity' | 'packaging';
/** Klasördeki opsiyonel şablonlar dosya adı önekiyle bulunur (IAQG dosya adları revizyona göre değişebilir). */
export const APQP_TEMPLATE_PATTERNS: Record<ApqpTemplateKind, RegExp> = {
  apqp: /^SCMH[-_ ]?7\.2\.12.*\.xlsx$/i,
  maturity: /^SCMH[-_ ]?7\.2\.14.*\.xlsx$/i,
  packaging: /^SCMH[-_ ]?7\.2\.20.*\.docx$/i,
};
export const APQP_OUT_NAMES: Record<ApqpTemplateKind, string> = {
  apqp: 'SCMH-7.2.12_APQP-Element-Applicability',
  maturity: 'SCMH-7.2.14_Maturity-Matrix-Evidence',
  packaging: 'SCMH-7.2.20_Packaging-Approval',
};

export function findApqpTemplate(files: string[], kind: ApqpTemplateKind): string | undefined {
  return files.filter((f) => APQP_TEMPLATE_PATTERNS[kind].test(f)).sort().pop();
}

export function apqpFileName(kind: ApqpTemplateKind, p: Project, suffix = ''): string {
  const safe = (x: string) => x.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 60);
  const part = safe(p.meta.partNumber || p.meta.fmeaNumber || p.meta.name || 'FMEA');
  const rev = safe(p.meta.fmeaRevision || '');
  return `${APQP_OUT_NAMES[kind]}_${part}${rev ? '_' + rev : ''}${suffix}.${kind === 'packaging' ? 'docx' : 'xlsx'}`;
}

// ------------------------------------------------------------------ 7.2.12
export interface FillResult {
  data: Buffer;
  /** Şablonda satırı bulunamayan katalog elemanları. */
  unmatched: string[];
}

/** Sheet1: B2 proje adı, E2 proje lideri; satırlar C metni öneki + faz + tiple eşlenir; D–H yazılır. */
export async function fillApqpApplicability(p: Project, tpl: Uint8Array): Promise<FillResult> {
  const b = await ScmhBook.open(tpl);
  const sheet = b.hasSheet('Sheet1') ? 'Sheet1' : b.sheetNames()[0];
  const a = p.apqp;
  b.set(sheet, 'B2', s(p.meta.name) || s(p.meta.program) || VY);
  b.set(sheet, 'E2', s(a.projectLead) || VY);
  // şablon satırlarını oku
  const rows: { r: number; phase: number; type: string; text: string }[] = [];
  for (let r = 5; r <= 400; r++) {
    const c = b.get(sheet, `C${r}`);
    if (c == null || c === '') continue;
    rows.push({ r, phase: Number(b.get(sheet, `A${r}`)), type: /^act/i.test(String(b.get(sheet, `B${r}`) ?? '')) ? 'Activity' : 'Deliverable', text: norm(c) });
  }
  const used = new Set<number>();
  const rowFor = (c: ApqpCatalogItem): number | null => {
    const hit = rows.find((x) => !used.has(x.r) && x.phase === c.phase && x.type === c.type && x.text.startsWith(norm(c.match)));
    if (hit) return hit.r;
    const def = rows.find((x) => x.r === c.row && !used.has(x.r) && x.phase === c.phase && x.type === c.type);
    return def ? def.r : null;
  };
  const unmatched: string[] = [];
  // Önce uzun önekler: "design risk analysis" faaliyeti ile teslimatı aynı fazda farklı tiplerdedir.
  for (const c of [...APQP_CATALOG].sort((x, y) => norm(y.match).length - norm(x.match).length)) {
    const r = rowFor(c);
    if (r == null) {
      unmatched.push(c.key);
      continue;
    }
    used.add(r);
    const e = a.elements.find((x) => x.key === c.key);
    const mandatory = applicabilityOf(c, a.projectType) === 'Mandatory';
    const req = e?.required ?? '';
    const D = req || (mandatory ? VY : '');
    const E = req === 'N' ? s(e?.reason) || VY : '';
    const F = s(e?.approvedBy) || (req === 'N' ? VY : '');
    const G = req === 'Y' ? s(e?.assignedTo) || VY : s(e?.assignedTo);
    const H = req === 'Y' ? s(e?.targetDate) || VY : s(e?.targetDate);
    b.set(sheet, `D${r}`, D);
    b.set(sheet, `E${r}`, E, { wrap: !!E });
    b.set(sheet, `F${r}`, F);
    b.set(sheet, `G${r}`, G);
    b.set(sheet, `H${r}`, H);
  }
  return { data: await b.save(), unmatched };
}

// ------------------------------------------------------------------ 7.2.14
/** Data sayfası J sütunu (Comment / Evidence), 4.1–4.7 satırları; I (Score) değerlendiricinindir, yazılmaz. */
export async function fillMaturityEvidence(p: Project, tpl: Uint8Array): Promise<FillResult> {
  const b = await ScmhBook.open(tpl);
  const sheet = b.hasSheet('Data') ? 'Data' : b.sheetNames()[0];
  const unmatched: string[] = [];
  for (const ev of maturityEvidence(p)) {
    const r = b.findRow(sheet, 'A', (v) => String(v ?? '').trim() === ev.item, 1, 200);
    if (r == null) {
      unmatched.push(ev.item);
      continue;
    }
    const prev = s(String(b.get(sheet, `J${r}`) ?? ''));
    b.set(sheet, `J${r}`, prev ? `${prev}\n${ev.text}` : ev.text, { wrap: true });
  }
  return { data: await b.save(), unmatched };
}

// ------------------------------------------------------------------ 7.2.20 (docx, eski FORMCHECKBOX alanları)
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

const LABELS: { key: string; re: RegExp }[] = [
  { key: 'customerPartRev', re: /^\s*Customer Part Number Revision\s*:/ },
  { key: 'customerPartNo', re: /^\s*Customer Part Number\s*:/ },
  { key: 'customerPartDesc', re: /^\s*Customer Part Description\s*:/ },
  { key: 'supplierPartNo', re: /^\s*Supplier Part Number/ },
  { key: 'supplierName', re: /^\s*Supplier Name\s*:/ },
  { key: 'supplierCode', re: /^\s*Supplier Code\s*:/ },
  { key: 'customerSpec', re: /\(SPECIFICATION\)\s*:/ },
  { key: 'approvedBy', re: /^\s*Approved by/ },
  { key: 'approvalDate', re: /^\s*Date\s/ },
];
/** Checkbox paragrafları (şablon sırası). Paragraf bulunamazsa w:ffData sırasına (2 temel + 12 × 3) düşülür. */
const BOX_PARAS: { key: string; re: RegExp }[] = [
  { key: 'basis:Standard commercial', re: /^\s*The applicable standard practice for commercial packaging/ },
  { key: 'basis:Customer unique', re: /^\s*Customer unique packaging requirement/ },
  { key: 'unique', re: /^\s*Packaging conforms to additional unique/ },
  { key: 'cleanliness', re: /^\s*Cleanliness/ },
  { key: 'preservation', re: /^\s*Preservation/ },
  { key: 'cushioning', re: /^\s*Cushioning/ },
  { key: 'unit', re: /^\s*Unit package/ },
  { key: 'intermediate', re: /^\s*Intermediate package/ },
  { key: 'unitization', re: /^\s*Unitization/ },
  { key: 'labeling', re: /^\s*Package label/ },
  { key: 'esd', re: /ESD Requirements/ },
  { key: 'msd', re: /moisture sensitive part control/ },
  { key: 'desiccant', re: /desiccants/ },
  { key: 'environment', re: /environmental factors such as light/ },
];

function textOfP(p: El): string {
  let out = '';
  const walk = (n: El) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === W && c.localName === 't') out += c.textContent ?? '';
      else if (c.namespaceURI === W && c.localName === 'tab') out += '\t';
      else if (!(c.namespaceURI === W && c.localName === 'p')) walk(c);
    }
  };
  walk(p);
  return out;
}

const ownEls = (p: El, local: string): El[] =>
  (Array.from(p.getElementsByTagNameNS(W, local)) as El[]).filter((e) => {
    for (let a = e.parentNode; a && a !== p; a = a.parentNode) if (a.namespaceURI === W && a.localName === 'p') return false;
    return true;
  });

function setBox(ff: El, checked: boolean) {
  const cb = (Array.from(ff.getElementsByTagNameNS(W, 'checkBox')) as El[])[0];
  if (!cb) return;
  const d = cb.ownerDocument;
  let def = (Array.from(cb.getElementsByTagNameNS(W, 'default')) as El[])[0];
  if (!def) {
    def = d.createElementNS(W, 'w:default');
    cb.appendChild(def);
  }
  def.setAttributeNS(W, 'w:val', checked ? '1' : '0');
  for (const c of Array.from(cb.getElementsByTagNameNS(W, 'checked')) as El[]) cb.removeChild(c);
  if (checked) {
    const c = d.createElementNS(W, 'w:checked');
    cb.appendChild(c);
  }
}

function fillBlank(p: El, value: string): boolean {
  const ts = ownEls(p, 't').filter((t) => /^_{2,}\s*$/.test(t.textContent ?? ''));
  if (!ts.length) return false;
  ts.forEach((t, i) => {
    while (t.firstChild) t.removeChild(t.firstChild);
    if (i === 0) {
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      t.appendChild(t.ownerDocument.createTextNode(value));
    }
  });
  return true;
}

export async function fillPackagingForm(p: Project, tpl: Uint8Array): Promise<FillResult> {
  const zip = await JSZip.loadAsync(tpl);
  const xml = await zip.file('word/document.xml')!.async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const k = p.apqp.packaging;
  const m = p.meta;
  const vals: Record<string, string> = {
    customerPartNo: s(k.customerPartNo) || s(m.partNumber) || VY,
    customerPartDesc: s(k.customerPartDesc) || s(m.partName) || VY,
    customerPartRev: s(k.customerPartRev) || s(m.drawingRevision) || VY,
    supplierPartNo: s(k.supplierPartNo), // "(if applicable)"
    supplierName: s(k.supplierName) || s(m.supplier) || s(m.organization) || VY,
    supplierCode: s(k.supplierCode) || s(p.apqp.cpAdmin.supplierCode) || VY,
    customerSpec: k.basis === 'Customer unique' ? s(k.customerSpec) || VY : s(k.customerSpec),
    // Müşteri onay alanları yalnızca kayıtlı bir onay varsa yazılır; imza alanı hiçbir zaman doldurulmaz.
    approvedBy: s(k.customerApprover),
    approvalDate: s(k.approvalDate),
  };
  const paras = (Array.from(doc.getElementsByTagNameNS(W, 'p')) as El[]);
  const unmatched: string[] = [];
  const done = new Set<string>();
  for (const para of paras) {
    const text = textOfP(para);
    const lab = LABELS.find((l) => !done.has(l.key) && l.re.test(text));
    if (lab) {
      done.add(lab.key);
      if (vals[lab.key]) fillBlank(para, vals[lab.key]);
    }
  }
  for (const l of LABELS) if (!done.has(l.key)) unmatched.push(l.key);

  // checkbox'lar
  const allBoxes = (Array.from(doc.getElementsByTagNameNS(W, 'ffData')) as El[]).filter((f) => f.getElementsByTagNameNS(W, 'checkBox').length);
  const want = new Map<string, boolean[]>();
  want.set('basis:Standard commercial', [k.basis === 'Standard commercial']);
  want.set('basis:Customer unique', [k.basis === 'Customer unique']);
  for (const it of k.items) if (!it.custom) want.set(it.key, [it.answer === 'Yes', it.answer === 'No', it.answer === 'N/A']);
  const seen = new Set<string>();
  for (const para of paras) {
    const text = textOfP(para);
    const bp = BOX_PARAS.find((x) => !seen.has(x.key) && x.re.test(text));
    if (!bp) continue;
    const boxes = ownEls(para, 'ffData').filter((f) => f.getElementsByTagNameNS(W, 'checkBox').length);
    if (!boxes.length) continue;
    seen.add(bp.key);
    const w = want.get(bp.key) ?? [];
    boxes.forEach((b, i) => setBox(b, !!w[i]));
  }
  // paragraf bulunamayanlar: belge sırasındaki indeks
  BOX_PARAS.forEach((bp, idx) => {
    if (seen.has(bp.key)) return;
    const w = want.get(bp.key) ?? [];
    const start = idx < 2 ? idx : 2 + (idx - 2) * 3;
    const n = idx < 2 ? 1 : 3;
    const boxes = allBoxes.slice(start, start + n);
    if (boxes.length !== n) return unmatched.push(bp.key);
    boxes.forEach((b, i) => setBox(b, !!w[i]));
  });
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { data, unmatched };
}
