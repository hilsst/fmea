// v4-kc: SCMH 7.2.16 Key Characteristic (KC) Traceability Form – kullanıcının IAQG şablonuna yerinde yazılır
// (© IAQG; depoda yoktur). Alan tanımları SCMH 7.2.17 KC Traceability Form Guidance §1.1–1.2.9:
//  - B KC No. (PN-KC-XXX), C açıklama, D değer + tolerans, E referans, F etki, G severity, H kaynak doküman, I notlar.
//  - Elenen KC formda kalır: E/F/G "N/A", I'da eleme yolu ve gerekçe (§1.2.4–1.2.6, §1.2.8).
//  - Comments bloğu formun revizyon geçmişidir (§1.2.9).
// Kaynakta olmayan değer "VERİ YOK – doğrulanmalı" olur.
import { ScmhBook } from './scmhfill';
import { isCi, isListed, kcDisplayNo } from './kcScmh';
import { kcOrigins, kcReference } from './kcTrace';
import type { KcRow, Project } from './types';

export const VY = 'VERİ YOK – doğrulanmalı';
const NA = 'N/A';

/** Şablon klasöründe aranan dosya adı (opsiyonel 5. şablon). */
export const KC_FORM_TEMPLATE_FILE = 'SCMH-7.2.16-KC-Traceability-Form.xlsx';
export const KC_FORM_FILE_PREFIX = 'SCMH-7.2.16_KC-Traceability';

export const KC_FORM_LAYOUT = {
  sheet: 'KC Traceability Form',
  headerRow: 9,
  first: 10,
  /** Boş formda Comments satırı (B sütunu); şablonda aranır, bulunamazsa bu kullanılır. */
  comments: 15,
  header: { partName: 'E6', dateCompleted: 'I6', partNo: 'E7', formRev: 'I7', partRev: 'E8', contacts: 'I8' },
  cols: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const,
};

export function kcFormFileName(p: Project): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 60);
  const part = safe(p.meta.partNumber || p.meta.fmeaNumber || p.meta.name || 'FMEA');
  const rev = safe(p.meta.kcFormRevision || p.meta.fmeaRevision || '');
  return `${KC_FORM_FILE_PREFIX}_${part}${rev ? '_' + rev : ''}.xlsx`;
}

export interface KcFormRow {
  id: string;
  B: string;
  C: string;
  D: string;
  E: string;
  F: string;
  G: number | string;
  H: string;
  I: string;
}

const t = (v: unknown) => (v == null ? '' : String(v).trim());
const lines = (xs: string[]) => xs.filter(Boolean).map((x) => `>${x}`).join('\n');

/** Formdaki satırlar: listedeki (numaralı) KC'ler, numara sırasıyla; elenenler dahil. CI'lar istenirse sona. */
export function kcFormRows(p: Project, opts: { includeCi?: boolean } = {}): KcFormRow[] {
  const ks = p.kcs.filter((k) => (k.lifecycle === 'Eliminated' || isListed(k)) && (opts.includeCi || !isCi(k)));
  const key = (k: KcRow) => `${isCi(k) ? 1 : 0}|${kcDisplayNo(k).padStart(40, ' ')}`;
  return [...ks].sort((a, b) => key(a).localeCompare(key(b))).map((k) => {
    const elim = k.lifecycle === 'Eliminated';
    const spec = t(k.specification);
    const notes: string[] = [];
    if (isCi(k)) notes.push('Critical Item (CI) – izlenebilirlik gereksinimi dışında bilgi amaçlı (7.2.17 Overview)');
    if (k.lifecycle === 'Preliminary') notes.push('Ön liste (preliminary)');
    if (k.lifecycle === 'Potential' || (!k.lifecycle && k.status !== 'Approved')) notes.push('Potansiyel KC – kesinleşmedi');
    if (t(k.rationale)) notes.push(t(k.rationale));
    if (elim) notes.push(`Eliminated${k.eliminatedBy ? ` (${k.eliminatedBy})` : ''}${k.eliminatedDate ? ` ${k.eliminatedDate}` : ''}${k.eliminatedRef ? ` – ${k.eliminatedRef}` : ''}: ${t(k.eliminationNote) || VY}`);
    return {
      id: k.id,
      B: kcDisplayNo(k),
      C: t(k.characteristic) || VY,
      D: spec && !/^VERİ YOK/.test(spec) ? spec : VY,
      E: elim ? NA : kcReference(p, k) || VY,
      F: elim ? NA : lines(k.impact ?? []) || VY,
      G: elim ? NA : typeof k.severity === 'number' && Number.isFinite(k.severity) ? k.severity : VY,
      H: lines(kcOrigins(p, k)) || VY,
      I: notes.join('\n'),
    };
  });
}

/** Comments bloğu (§1.2.9): KC listesi revizyon geçmişi, denetim izinden ve müşteri mutabakatından. */
export function kcFormComments(p: Project): string {
  const ids = new Map(p.kcs.map((k) => [k.id, kcDisplayNo(k)]));
  const out: string[] = [];
  for (const e of p.auditLog) {
    if (e.table !== 'kcs') continue;
    const no = ids.get(e.id) ?? e.id;
    if (e.kind === 'Added') out.push(`${e.at.slice(0, 10)} ${no} eklendi`);
    else if (e.field === 'lifecycle') out.push(`${e.at.slice(0, 10)} ${no}: ${t(e.from) || 'aday'} → ${t(e.to) || 'aday'}${e.reason ? ` (${e.reason})` : ''}`);
  }
  if (p.meta.kcListAgreedBy || p.meta.kcListAgreedDate)
    out.push(`${p.meta.kcListAgreedDate || VY} KC listesi müşteriyle mutabık: ${p.meta.kcListAgreedBy || VY}${p.meta.kcListAgreementRef ? ` (${p.meta.kcListAgreementRef})` : ''}`);
  return out.slice(-40).join('\n');
}

/** 7.2.16 şablonunu doldurur. Şablon değiştirilmez; doldurulmuş kopya döner. */
export async function buildKcForm(p: Project, tpl: Uint8Array, opts: { includeCi?: boolean } = {}): Promise<Buffer> {
  const b = await ScmhBook.open(tpl);
  const L = KC_FORM_LAYOUT;
  const sheet = b.hasSheet(L.sheet) ? L.sheet : b.sheetNames().find((n) => /KC Traceability Form/i.test(n) && !/example/i.test(n)) ?? b.sheetNames()[0];
  const m = p.meta;
  const vals: Record<keyof typeof L.header, string> = {
    partName: t(m.partName) || VY,
    dateCompleted: t(m.kcFormDate) || VY,
    partNo: t(m.partNumber) || VY,
    formRev: t(m.kcFormRevision) || VY,
    partRev: t(m.drawingRevision) || VY,
    contacts: t(m.kcContacts) || VY,
  };
  for (const [k, ref] of Object.entries(L.header) as [keyof typeof L.header, string][]) b.set(sheet, ref, vals[k]);
  const rows = kcFormRows(p, opts);
  let comments = b.findRow(sheet, 'B', (v) => typeof v === 'string' && /^\s*comments\s*$/i.test(v), L.first) ?? L.comments;
  const capacity = comments - L.first;
  if (rows.length > capacity) {
    b.insertRows(sheet, comments - 1, rows.length - capacity, comments - 1);
    comments += rows.length - capacity;
  }
  rows.forEach((r, i) => {
    const rr = L.first + i;
    const texts: Record<string, string> = {};
    for (const c of L.cols) {
      const v = r[c];
      b.set(sheet, `${c}${rr}`, v, { wrap: typeof v === 'string' });
      if (typeof v === 'string') texts[c] = v;
    }
    b.fitRow(sheet, rr, texts, 13, 40);
  });
  const cm = kcFormComments(p);
  if (cm) {
    b.set(sheet, `C${comments}`, cm, { wrap: true });
    b.fitRow(sheet, comments, { C: cm }, 13, 30);
  }
  return b.save();
}
