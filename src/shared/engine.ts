// Değişiklik yayma motoru.
// Kullanıcının bir ekranda yaptığı değişiklik (Edit) önce projenin bir kopyasına uygulanır, ardından
// kurallar diğer ekranlardaki bağlı alanları günceller. Ortaya çıkan tüm etkiler (Effect) kullanıcıya
// onay için gösterilir; onaylanırsa kopya projenin yerine geçer, reddedilirse hiçbir şey değişmez.

import { REQ_AUTO_FIELDS, REQ_AUTO_INPUTS, reqAutoValues } from './reqAutofill';
import { blankRow, nextId, tableOfId } from './model';
import { isKcCandidate } from './scoring';
import { KC_LOCK_MSG, kcLocked, kcOnSet } from './kcScmh'; // v4-kc
import { crTouchesPpap, isUpdateTrigger, lessonReassessText, ppapApprovedDate } from './apqp'; // v4-apqp
import { capOnDelete, capOnSet } from './capEngine'; // v4-cap
import { cpRequired, joinedRequirement } from './risk'; // v4-risk
import { ensureLineNumbers, splitRequirement } from './riskModel'; // v4-risk
import type {
  ActionRow,
  AnyRow,
  ChangeRequestRow, // v4-apqp
  ControlPlanRow,
  DfmeaRow,
  KcRow,
  LessonRow, // v4-apqp
  PfdItemRow,
  PfmeaRow,
  ProcessParamRow,
  Project,
  RequirementRow,
  Settings,
  TableKey,
} from './types';

export type Edit =
  | { kind: 'set'; table: TableKey; id: string; field: string; value: unknown }
  | { kind: 'add'; table: TableKey; row: AnyRow }
  | { kind: 'delete'; table: TableKey; id: string }
  | { kind: 'settings'; field: keyof Settings; value: unknown };

export interface Effect {
  kind: 'Added' | 'Modified' | 'Deleted';
  table: TableKey | 'settings';
  id: string;
  field?: string;
  from?: unknown;
  to?: unknown;
  reason: string;
  primary: boolean;
}

export interface Plan {
  project: Project;
  effects: Effect[];
}

type Event =
  | { type: 'set'; table: TableKey | 'settings'; id: string; field: string; from: unknown; to: unknown; isNew?: boolean }
  | { type: 'add'; table: TableKey; id: string }
  | { type: 'delete'; table: TableKey; id: string; row: AnyRow };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const today = () => new Date().toISOString().slice(0, 10);
/** §29 gerçek reaksiyon planı sırası. Şirket prosedürüne göre mühendis düzenler. */
export const DEFAULT_REACTION =
  '1) Prosesi durdur 2) Şüpheli ürünü ayır (karantina) 3) Vardiya amirini (supervisor) ve Kaliteyi bilgilendir 4) Son kabul edilen parçayı belirle 5) Etkilenen lot/seri numaralarını belirle 6) Düzeltme yöntemi: VERİ YOK – doğrulanmalı 7) NCR aç 8) Karar (disposition) 9) Kök neden analizi 10) FMEA yeniden değerlendirme 11) Kontrol planı güncelleme (AI SUGGESTION – şirket prosedürüyle doğrulayın)';
// v4-risk: CP webinar p30 MUST öğeleri (ayır, düzeltme yöntemi, amire bildirim) eklendi; düzeltme yöntemi prosese özgüdür → VERİ YOK.
const NO_DATA = 'VERİ YOK – doğrulanmalı';

const ACTION_SYNC: [keyof DfmeaRow & keyof ActionRow | 'recommendedAction' | 'actionStatus', keyof ActionRow][] = [
  ['recommendedAction', 'description'],
  ['owner', 'owner'],
  ['dueDate', 'dueDate'],
  ['actionStatus', 'status'],
  ['actionTaken', 'actionTaken'],
  ['newS', 'newS'],
  ['newO', 'newO'],
  ['newD', 'newD'],
];

class Ctx {
  effects: Effect[] = [];
  queue: Event[] = [];
  primary = true;
  constructor(public p: Project) {}

  rows<T extends AnyRow>(t: TableKey): T[] {
    return this.p[t] as unknown as T[];
  }
  find<T extends AnyRow>(t: TableKey, id: string): T | undefined {
    return this.rows<T>(t).find((r) => r.id === id);
  }
  findAny(id: string): AnyRow | undefined {
    const t = tableOfId(id);
    return t ? this.find(t, id) : undefined;
  }

  set(table: TableKey, id: string, field: string, value: unknown, reason: string) {
    const row = this.find(table, id) as unknown as Record<string, unknown> | undefined;
    if (!row) return;
    const from = row[field];
    if (same(from, value)) return;
    row[field] = value;
    this.effects.push({ kind: 'Modified', table, id, field, from, to: value, reason, primary: this.primary });
    this.queue.push({ type: 'set', table, id, field, from, to: value });
  }

  add(table: TableKey, partial: Partial<AnyRow>, reason: string): string {
    const id = partial.id && !this.find(table, partial.id) ? partial.id : nextId(this.p, table);
    const row = { ...blankRow(table, id), ...partial, id } as AnyRow;
    (this.p[table] as AnyRow[]).push(row);
    this.effects.push({ kind: 'Added', table, id, reason, primary: this.primary });
    this.queue.push({ type: 'add', table, id });
    return id;
  }

  del(table: TableKey, id: string, reason: string) {
    const list = this.p[table] as AnyRow[];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    const [row] = list.splice(i, 1);
    this.effects.push({ kind: 'Deleted', table, id, reason, primary: this.primary });
    this.queue.push({ type: 'delete', table, id, row });
  }

  setting(field: keyof Settings, value: unknown, reason: string) {
    const from = this.p.settings[field];
    if (same(from, value)) return;
    (this.p.settings as unknown as Record<string, unknown>)[field] = value;
    this.effects.push({ kind: 'Modified', table: 'settings', id: 'Ayarlar', field, from, to: value, reason, primary: this.primary });
    this.queue.push({ type: 'set', table: 'settings', id: 'settings', field, from, to: value });
  }
}

// ---------------------------------------------------------------- yardımcılar

function requirementText(c: Ctx, reqIds: string[]) {
  return reqIds
    .map((rid) => c.find<AnyRow & { text: string }>('requirements', rid))
    .filter(Boolean)
    .map((r) => `${r!.id}: ${r!.text}`)
    .join('\n');
}

/** Gereksinimin kabul kriteri; boşsa kaynaktan gelen alt/üst limit (yalnızca girilmiş değerler). */
export function specOf(r: RequirementRow): string {
  if (r.acceptance) return r.acceptance;
  const u = r.unit ? ` ${r.unit}` : '';
  if (r.lsl != null && r.usl != null) return `${r.lsl}–${r.usl}${u}`;
  if (r.nominal != null && r.tolerance) return `${r.nominal} ${r.tolerance}${u}`;
  if (r.lsl != null) return `min ${r.lsl}${u}`;
  if (r.usl != null) return `max ${r.usl}${u}`;
  return '';
}

function acceptanceText(c: Ctx, reqIds: string[]) {
  return reqIds
    .map((rid) => c.find<RequirementRow>('requirements', rid))
    .filter((r) => r && specOf(r))
    .map((r) => `${r!.id}: ${specOf(r!)}`)
    .join('\n');
}

/** Ölçüm yöntemine göre MSA çalışma önerisi (§30). Belirsizse boş bırakılır; mühendis seçer. */
export function suggestMsaStudy(method: string): { study: string; dataType: '' | 'Variable' | 'Attribute' } {
  const m = method.toLowerCase();
  if (!m || /veri yok/.test(m)) return { study: '', dataType: '' };
  if (/görsel|visual|go.?no.?go|tapa|pim mastar|limit numune|attribute|tap test|pass\/fail/.test(m)) return { study: 'Attribute Agreement Analysis', dataType: 'Attribute' };
  if (/termokupl|thermocouple|sıcaklık|temperature|basınç|pressure|vakum|vacuum|transdüser|data ?logger/.test(m)) return { study: 'Calibration', dataType: 'Variable' };
  if (/cmm|mikrometre|micrometer|kumpas|caliper|komparatör|bore|ultrason|thickness|kalınlık|profilometre|terazi|tork|torque|gauge|ölçer/.test(m)) return { study: 'Gage R&R', dataType: 'Variable' };
  return { study: '', dataType: '' };
}

export function paramSpec(pp: ProcessParamRow): string {
  const u = pp.unit ? ` ${pp.unit}` : '';
  if (pp.lsl != null && pp.usl != null) return `${pp.lsl}–${pp.usl}${u}`;
  if (pp.nominal != null) return `${pp.nominal}${u}${pp.lsl != null ? ` (min ${pp.lsl})` : ''}${pp.usl != null ? ` (max ${pp.usl})` : ''}`;
  if (pp.lsl != null) return `min ${pp.lsl}${u}`;
  if (pp.usl != null) return `max ${pp.usl}${u}`;
  return '';
}

function maxLinkedSeverity(c: Ctx, dfIds: string[]): number | null {
  const ss = dfIds.map((id) => c.find<DfmeaRow>('dfmea', id)?.s).filter((s): s is number => typeof s === 'number');
  return ss.length ? Math.max(...ss) : null;
}

function kcCharacteristic(c: Ctx, src: DfmeaRow | PfmeaRow): string {
  if ('functionId' in src) return src.requirement || src.function || src.failureMode;
  return src.requirement || src.processFunction || src.failureMode || src.stepName;
}

function kcSpecification(c: Ctx, src: DfmeaRow | PfmeaRow): string {
  if ('functionId' in src) return acceptanceText(c, src.reqIds) || NO_DATA;
  const fromDf = src.dfIds.map((id) => c.find<DfmeaRow>('dfmea', id)).filter(Boolean) as DfmeaRow[];
  const acc = fromDf.map((d) => acceptanceText(c, d.reqIds)).filter(Boolean).join('\n');
  return acc || NO_DATA;
}

function kcClassFor(src: DfmeaRow | PfmeaRow, settings: Settings) {
  if (!('functionId' in src)) return 'KC-3 Process KC' as const;
  if ((src.s ?? 0) >= settings.kcSeverityThreshold || src.specialChar === 'Safety' || src.specialChar === 'Regulatory')
    return 'KC-1 Critical' as const;
  return 'KC-2 Significant' as const;
}

/** Yüksek severity veya özel karakteristik → AI Recommended KC adayı ekle / eşik altına düşeni kaldır. */
function syncKcCandidate(c: Ctx, table: 'dfmea' | 'pfmea', id: string) {
  const src = c.find<DfmeaRow | PfmeaRow>(table, id);
  if (!src) return;
  const kcs = c.rows<KcRow>('kcs').filter((k) => k.sourceId === id);
  const cand = isKcCandidate(src, c.p.settings);
  if (cand && kcs.length === 0 && c.p.settings.autoKcCandidates && (src.failureMode || ('function' in src && src.function) || ('stepName' in src && src.stepName))) {
    c.add(
      'kcs',
      {
        sourceId: id,
        characteristic: kcCharacteristic(c, src),
        kcClass: kcClassFor(src, c.p.settings),
        specification: kcSpecification(c, src),
        severity: src.s,
        rationale: src.specialChar
          ? `Özel karakteristik: ${src.specialChar}`
          : `Severity ${src.s} ≥ KC eşiği ${c.p.settings.kcSeverityThreshold} → KC değerlendirmesi önerilir. Severity tek başına KC kararı değildir; faktörleri inceleyin.`,
        origin: 'ai',
        status: 'AI Proposed',
        autoCreated: true,
      } as Partial<KcRow>,
      `${id} KC adayı oldu (AI Recommended KC – mühendis onayı gerekli)`,
    );
  }
  if (!cand) {
    for (const k of kcs)
      if (k.autoCreated && k.status === 'AI Proposed' && !kcLocked(k)) // v4-kc: numaralı KC silinmez
        c.del('kcs', k.id, `${id} artık KC eşiğinin altında; onaylanmamış otomatik KC adayı kaldırılır`);
  }
}

function syncAllKcCandidates(c: Ctx) {
  for (const r of c.rows<DfmeaRow>('dfmea')) syncKcCandidate(c, 'dfmea', r.id);
  for (const r of c.rows<PfmeaRow>('pfmea')) syncKcCandidate(c, 'pfmea', r.id);
}

function cpFromKc(c: Ctx, kc: KcRow): Partial<ControlPlanRow> {
  const base: Partial<ControlPlanRow> = {
    kcId: kc.id,
    kcClass: kc.kcClass,
    specification: kc.specification || NO_DATA,
    sampleSize: NO_DATA,
    frequency: NO_DATA,
    method: NO_DATA,
    reactionPlan: DEFAULT_REACTION,
    autoCreated: true,
    charType: 'Product Characteristic',
  };
  const src = c.findAny(kc.sourceId) as DfmeaRow | PfmeaRow | undefined;
  let pf: PfmeaRow | undefined;
  if (src && 'stepId' in src) {
    pf = src;
    base.processChar = kc.characteristic;
    base.charType = 'Process Characteristic';
  } else {
    base.productChar = kc.characteristic;
    pf = c.rows<PfmeaRow>('pfmea').find((p) => p.dfIds.includes(kc.sourceId));
  }
  if (pf) {
    base.pfId = pf.id;
    base.stepId = pf.stepId;
    base.opNo = pf.opNo;
    base.processName = pf.stepName;
    base.method = pf.measurement || pf.detection || NO_DATA;
    base.controlMethod = pf.prevention;
    base.reactionPlan = pf.reactionPlan || DEFAULT_REACTION;
    const step = c.find<AnyRow & { machine: string }>('processSteps', pf.stepId);
    if (step) base.machine = step.machine;
  }
  return base;
}

function onKcApproved(c: Ctx, kc: KcRow) {
  if (!c.p.settings.autoControlPlan) return;
  if (!c.rows<ControlPlanRow>('controlPlan').some((r) => r.kcId === kc.id)) {
    const cpId = c.add('controlPlan', cpFromKc(c, kc), `${kc.id} onaylandı → kontrol planı satırı önerildi (spesifikasyon §12)`);
    const cp = c.find<ControlPlanRow>('controlPlan', cpId)!;
    const sug = suggestMsaStudy(cp.method);
    c.add(
      'msa',
      {
        cpId, kcId: kc.id, characteristic: kc.characteristic, gauge: cp.method, study: sug.study, dataType: sug.dataType, status: 'Planned', autoCreated: true,
        notes: sug.study ? `Yöntem önerisi: ${sug.study} (AI SUGGESTION – ölçüm sistemine göre mühendis doğrular)` : 'Ölçüm yöntemi belirsiz; MSA çalışması mühendis tarafından seçilmeli.',
      },
      `${kc.id} için ölçüm sistemi analizi ihtiyacı (AI SUGGESTION)`,
    );
  }
  if (!c.rows<AnyRow & { kcId: string }>('capability').some((r) => r.kcId === kc.id))
    c.add('capability', { kcId: kc.id, characteristic: kc.characteristic }, `${kc.id} için capability çalışması gerekli`);
}

function onKcRejected(c: Ctx, kc: KcRow) {
  for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.kcId === kc.id && r.autoCreated))
    c.del('controlPlan', cp.id, `${kc.id} reddedildi; otomatik oluşturulan kontrol planı satırı kaldırılır`);
  for (const cap of c.rows<AnyRow & { kcId: string; data: string }>('capability').filter((r) => r.kcId === kc.id && !r.data))
    c.del('capability', cap.id, `${kc.id} reddedildi; veri girilmemiş capability satırı kaldırılır`);
}

function ensureAction(c: Ctx, table: 'dfmea' | 'pfmea', id: string) {
  const row = c.find<DfmeaRow | PfmeaRow>(table, id);
  if (!row || !row.recommendedAction || row.actionId) return;
  const actId = c.add(
    'actions',
    {
      sourceId: id,
      description: row.recommendedAction,
      owner: row.owner,
      dueDate: row.dueDate,
      status: row.actionStatus || 'Open',
      newS: row.newS,
      newO: row.newO,
      newD: row.newD,
    } as Partial<ActionRow>,
    `${id} için önerilen aksiyon Aksiyon Listesi'ne eklendi`,
  );
  c.set(table, id, 'actionId', actId, 'Aksiyon kaydı bağlandı');
  if (!row.actionStatus) c.set(table, id, 'actionStatus', 'Open', 'Aksiyon kaydı bağlandı');
}

function flagReassess(c: Ctx, why: string, match: (source: string) => boolean) {
  const tables: TableKey[] = ['requirements', 'structure', 'dfmea', 'processSteps', 'pfmea'];
  for (const t of tables)
    for (const r of c.rows<AnyRow & { source?: string }>(t))
      if (r.source && match(r.source)) c.set(t, r.id, 'reassess', `FMEA Reassessment Required – ${why}`, why);
}

/** Kabul kriteri, doğrulama yöntemi ve ölçü alanlarını gereksinimden doldurur (boş veya daha önce otomatik dolmuşsa). */
function autofillRequirement(c: Ctx, id: string) {
  const r = c.find<RequirementRow>('requirements', id);
  if (!r || !r.text?.trim()) return;
  const vals = reqAutoValues(r);
  const fields = Object.keys(vals);
  if (!fields.length) return;
  const auto = [...new Set([...(r.autoFields ?? []), ...fields])];
  if (!same(auto, r.autoFields ?? [])) c.set('requirements', id, 'autoFields', auto, 'Otomatik doldurulan alanlar');
  for (const f of fields) c.set('requirements', id, f, vals[f as keyof typeof vals], `${id} gereksinim metninden otomatik dolduruldu`);
}

/** Elle girilen değer otomatik değerden farklıysa alan otomatik güncellemeden çıkar. */
function keepOrReleaseAuto(c: Ctx, id: string, field: string, to: unknown) {
  const r = c.find<RequirementRow>('requirements', id);
  if (!r?.autoFields?.includes(field)) return;
  const expect = reqAutoValues(r)[field as keyof ReturnType<typeof reqAutoValues>];
  if (!same(expect, to) && !(to === '' || to == null)) c.set('requirements', id, 'autoFields', r.autoFields.filter((f) => f !== field), `${field} elle değiştirildi`);
}

// ---------------------------------------------------------------- kurallar

function onSet(c: Ctx, e: Extract<Event, { type: 'set' }>) {
  const { table, id, field } = e;
  const fresh = e.from === undefined;

  if (table === 'settings') {
    if (field === 'kcSeverityThreshold' || field === 'autoKcCandidates') syncAllKcCandidates(c);
    return;
  }
  capOnSet(c, table, id, field, e.from, e.to); // v4-cap: capability bandı, MSA yeniden çalışma ve kapsam kuralları

  switch (table) {
    case 'documents': {
      if ((field === 'revision' || field === 'date') && !fresh) {
        const doc = c.find<AnyRow & { docNumber: string; name: string }>('documents', id)!;
        const why = `${id}${doc.docNumber ? ' (' + doc.docNumber + ')' : ''} ${field === 'revision' ? 'revizyonu' : 'tarihi'} değişti: ${e.from || '—'} → ${e.to || '—'}`;
        flagReassess(c, why, (s) => s.includes(id) || (!!doc.docNumber && s.includes(doc.docNumber)));
      }
      break;
    }
    case 'requirements': {
      if (REQ_AUTO_INPUTS.includes(field)) autofillRequirement(c, id);
      if ((REQ_AUTO_FIELDS as readonly string[]).includes(field)) keepOrReleaseAuto(c, id, field, e.to);
      if (field === 'text' || field === 'acceptance' || field === 'lsl' || field === 'usl' || field === 'nominal' || field === 'unit' || field === 'tolerance') {
        for (const d of c.rows<DfmeaRow>('dfmea').filter((d) => d.reqIds.includes(id))) {
          c.set('dfmea', d.id, 'requirement', requirementText(c, d.reqIds), `${id} gereksinim metni değişti`);
          if (!fresh) c.set('dfmea', d.id, 'reassess', `FMEA Reassessment Required – ${id} değişti (${today()})`, `${id} değişti`);
          for (const k of c.rows<KcRow>('kcs').filter((k) => k.sourceId === d.id)) {
            if (field !== 'text') c.set('kcs', k.id, 'specification', acceptanceText(c, d.reqIds) || NO_DATA, `${id} kabul kriteri değişti`);
          }
        }
      }
      break;
    }
    case 'structure': {
      if (field === 'function')
        for (const d of c.rows<DfmeaRow>('dfmea').filter((d) => d.functionId === id))
          c.set('dfmea', d.id, 'function', e.to, `${id} fonksiyon tanımı değişti`);
      break;
    }
    case 'dfmea': {
      const d = c.find<DfmeaRow>('dfmea', id)!;
      if (field === 'functionId') {
        const fn = c.find<AnyRow & { function: string; reqIds: string[] }>('structure', d.functionId);
        if (fn) {
          c.set('dfmea', id, 'function', fn.function, `${fn.id} fonksiyonu bağlandı`);
          if (d.reqIds.length === 0 && fn.reqIds.length) c.set('dfmea', id, 'reqIds', [...fn.reqIds], `${fn.id} fonksiyonunun gereksinimleri`);
        }
      }
      if (field === 'reqIds') c.set('dfmea', id, 'requirement', requirementText(c, d.reqIds), 'Bağlı gereksinimler değişti');
      if (field === 's') {
        for (const p of c.rows<PfmeaRow>('pfmea').filter((p) => p.dfIds.includes(id)))
          c.set('pfmea', p.id, 's', maxLinkedSeverity(c, p.dfIds), `Bağlı DFMEA ${id} severity değişti (PFMEA ürün etkisi DFMEA ile tutarlı olmalı)`);
        for (const k of c.rows<KcRow>('kcs').filter((k) => k.sourceId === id))
          c.set('kcs', k.id, 'severity', d.s, `${id} severity değişti`);
      }
      if (field === 's' || field === 'specialChar' || field === 'failureMode') syncKcCandidate(c, 'dfmea', id);
      if (field === 'requirement' || field === 'function' || field === 'failureMode')
        for (const k of c.rows<KcRow>('kcs').filter((k) => k.sourceId === id && k.autoCreated && k.status === 'AI Proposed'))
          c.set('kcs', k.id, 'characteristic', kcCharacteristic(c, d), `${id} tanımı değişti`);
      syncActionFromFmea(c, 'dfmea', d, field);
      break;
    }
    case 'pfmea': {
      const p = c.find<PfmeaRow>('pfmea', id)!;
      if (field === 'stepId') {
        const st = c.find<AnyRow & { opNo: string; name: string }>('processSteps', p.stepId);
        c.set('pfmea', id, 'opNo', st?.opNo ?? '', 'Proses adımı bağlandı');
        c.set('pfmea', id, 'stepName', st?.name ?? '', 'Proses adımı bağlandı');
      }
      if (field === 'dfIds') {
        const s = maxLinkedSeverity(c, p.dfIds);
        if (s != null) c.set('pfmea', id, 's', s, 'Bağlı DFMEA severity değeri');
      }
      if (field === 's')
        for (const k of c.rows<KcRow>('kcs').filter((k) => k.sourceId === id)) c.set('kcs', k.id, 'severity', p.s, `${id} severity değişti`);
      if (field === 's' || field === 'specialChar' || field === 'failureMode') syncKcCandidate(c, 'pfmea', id);
      const cps = c.rows<ControlPlanRow>('controlPlan').filter((r) => r.pfId === id);
      for (const cp of cps) {
        if (field === 'prevention') c.set('controlPlan', cp.id, 'controlMethod', p.prevention, `${id} önleme kontrolü değişti`);
        if (field === 'measurement' || (field === 'detection' && !p.measurement))
          c.set('controlPlan', cp.id, 'method', p.measurement || p.detection, `${id} ölçüm/tespit yöntemi değişti`);
        if (field === 'reactionPlan') c.set('controlPlan', cp.id, 'reactionPlan', p.reactionPlan || DEFAULT_REACTION, `${id} reaksiyon planı değişti`);
        if (field === 'stepId' || field === 'opNo' || field === 'stepName') {
          c.set('controlPlan', cp.id, 'stepId', p.stepId, `${id} proses adımı değişti`);
        }
      }
      syncActionFromFmea(c, 'pfmea', p, field);
      break;
    }
    case 'processSteps': {
      const st = c.find<AnyRow & { opNo: string; name: string; machine: string; tool: string }>('processSteps', id)!;
      for (const p of c.rows<PfmeaRow>('pfmea').filter((p) => p.stepId === id)) {
        if (field === 'opNo') c.set('pfmea', p.id, 'opNo', st.opNo, `${id} operasyon numarası değişti`);
        if (field === 'name') c.set('pfmea', p.id, 'stepName', st.name, `${id} proses adı değişti`);
        if ((field === 'machine' || field === 'tool') && !fresh)
          c.set('pfmea', p.id, 'reassess', `FMEA Reassessment Required – ${id} ${field === 'machine' ? 'makine' : 'takım'} değişti (${e.from || '—'} → ${e.to || '—'})`, `${id} ${field} değişti`);
      }
      for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.stepId === id)) {
        if (field === 'opNo') c.set('controlPlan', cp.id, 'opNo', st.opNo, `${id} operasyon numarası değişti`);
        if (field === 'name') c.set('controlPlan', cp.id, 'processName', st.name, `${id} proses adı değişti`);
        if (field === 'machine') c.set('controlPlan', cp.id, 'machine', st.machine, `${id} makine değişti`);
        if (field === 'tool') c.set('controlPlan', cp.id, 'tool', st.tool, `${id} takım değişti`);
      }
      break;
    }
    case 'kcs': {
      const k = c.find<KcRow>('kcs', id)!;
      if (field === 'sourceId') {
        const src = c.findAny(k.sourceId) as DfmeaRow | PfmeaRow | undefined;
        if (src && 's' in src) c.set('kcs', id, 'severity', src.s, `Kaynak ${k.sourceId} severity değeri`);
      }
      for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.kcId === id)) {
        if (field === 'characteristic') c.set('controlPlan', cp.id, cp.processChar && !cp.productChar ? 'processChar' : 'productChar', k.characteristic, `${id} karakteristik tanımı değişti`);
        if (field === 'specification') c.set('controlPlan', cp.id, 'specification', k.specification, `${id} spesifikasyonu değişti`);
        if (field === 'kcClass') c.set('controlPlan', cp.id, 'kcClass', k.kcClass, `${id} KC sınıfı değişti`);
      }
      if (field === 'characteristic') {
        for (const m of c.rows<AnyRow & { kcId: string }>('msa').filter((m) => m.kcId === id)) c.set('msa', m.id, 'characteristic', k.characteristic, `${id} karakteristik tanımı değişti`);
        for (const m of c.rows<AnyRow & { kcId: string }>('capability').filter((m) => m.kcId === id)) c.set('capability', m.id, 'characteristic', k.characteristic, `${id} karakteristik tanımı değişti`);
      }
      // v4-kc: KC numarası, eleme tarihi, müşteri mutabakatının düşmesi (kcScmh.ts)
      if (k) for (const x of kcOnSet(c.p, k, field, fresh)) c.set(x.table, x.id, x.field, x.value, x.reason);
      if (field === 'status' && k.status === 'Approved') onKcApproved(c, k);
      if (field === 'status' && k.status === 'Rejected') onKcRejected(c, k);
      break;
    }
    case 'controlPlan': {
      const cp = c.find<ControlPlanRow>('controlPlan', id)!;
      if (field === 'stepId') {
        const st = c.find<AnyRow & { opNo: string; name: string; machine: string }>('processSteps', cp.stepId);
        c.set('controlPlan', id, 'opNo', st?.opNo ?? '', 'Proses adımı bağlandı');
        c.set('controlPlan', id, 'processName', st?.name ?? '', 'Proses adımı bağlandı');
        if (st?.machine) c.set('controlPlan', id, 'machine', st.machine, 'Proses adımı bağlandı');
      }
      if (field === 'pfId' && cp.pfId) {
        const p = c.find<PfmeaRow>('pfmea', cp.pfId);
        if (p) {
          c.set('controlPlan', id, 'stepId', p.stepId, `${p.id} PFMEA satırı bağlandı`);
          if (!cp.controlMethod) c.set('controlPlan', id, 'controlMethod', p.prevention, `${p.id} önleme kontrolü`);
          if (!cp.method || cp.method === NO_DATA) c.set('controlPlan', id, 'method', p.measurement || p.detection || NO_DATA, `${p.id} ölçüm yöntemi`);
        }
      }
      if (field === 'kcId' && cp.kcId) {
        const k = c.find<KcRow>('kcs', cp.kcId);
        if (k) {
          c.set('controlPlan', id, 'kcClass', k.kcClass, `${k.id} bağlandı`);
          if (!cp.specification) c.set('controlPlan', id, 'specification', k.specification, `${k.id} bağlandı`);
          if (!cp.productChar && !cp.processChar) c.set('controlPlan', id, 'productChar', k.characteristic, `${k.id} bağlandı`);
        }
      }
      if (field === 'method')
        for (const m of c.rows<AnyRow & { cpId: string }>('msa').filter((m) => m.cpId === id)) c.set('msa', m.id, 'gauge', cp.method, `${id} ölçüm yöntemi değişti`);
      break;
    }
    case 'processParams': {
      const pp = c.find<ProcessParamRow>('processParams', id)!;
      if (['nominal', 'lsl', 'usl', 'unit', 'parameter'].includes(field))
        for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.ppId === id)) {
          if (field === 'parameter') c.set('controlPlan', cp.id, 'processChar', pp.parameter, `${id} parametre adı değişti`);
          else c.set('controlPlan', cp.id, 'specification', paramSpec(pp) || NO_DATA, `${id} parametre limiti değişti`);
        }
      if ((field === 'nominal' || field === 'lsl' || field === 'usl') && !fresh)
        for (const pfId of pp.pfIds) c.set('pfmea', pfId, 'reassess', `FMEA Reassessment Required – ${id} parametre limiti değişti (${e.from ?? '—'} → ${e.to ?? '—'})`, `${id} değişti`);
      break;
    }
    case 'actions': {
      const a = c.find<ActionRow>('actions', id)!;
      if (field === 'sourceId' && a.sourceId) {
        const t = tableOfId(a.sourceId);
        if (t === 'dfmea' || t === 'pfmea') {
          const src = c.find<DfmeaRow | PfmeaRow>(t, a.sourceId);
          if (src && !src.actionId) c.set(t, src.id, 'actionId', id, `${id} aksiyonu bağlandı`);
        }
      }
      const t = tableOfId(a.sourceId);
      if (t === 'dfmea' || t === 'pfmea') {
        const src = c.find<DfmeaRow | PfmeaRow>(t, a.sourceId);
        if (src && src.actionId === id) {
          for (const [fmeaField, actField] of ACTION_SYNC)
            if (field === actField || field === 'sourceId')
              c.set(t, src.id, fmeaField, a[actField], `${id} aksiyon kaydı değişti`);
        }
      }
      if (field === 'status' && a.status === 'Completed' && !a.completionDate) c.set('actions', id, 'completionDate', today(), 'Aksiyon tamamlandı');
      break;
    }
    // v4-apqp: FMEA güncelleme tetikleyicileri (NCR, üretim koşusu, sürekli iyileştirme; SCMH 7.2.3 s.59, s.82, s.99–100)
    // ve PPAP onayı sonrası uygulanan değişiklik → yeniden sunum (PPAP webinar s.38). Etkiler onay penceresinde listelenir.
    case 'lessons': {
      const l = c.find<LessonRow>('lessons', id)!;
      if ((field === 'linkedFmeaIds' || field === 'sourceType') && isUpdateTrigger(l))
        for (const fid of l.linkedFmeaIds) {
          const t = tableOfId(fid);
          const row = t === 'dfmea' || t === 'pfmea' ? c.find<DfmeaRow | PfmeaRow>(t, fid) : undefined;
          if (row && !(row.reassess ?? '').includes(id)) c.set(t as TableKey, fid, 'reassess', lessonReassessText(l), `${id} (${l.sourceType}) FMEA satırına bağlandı`);
        }
      break;
    }
    case 'changeRequests': {
      const cr = c.find<ChangeRequestRow>('changeRequests', id)!;
      if (field === 'status' && cr.status === 'Implemented' && ppapApprovedDate(c.p) && crTouchesPpap(cr))
        c.set('changeRequests', id, 'ppapResubmission', true, `${id} PPAP onayından sonra uygulandı → PPAP yeniden sunumu gerekir`);
      break;
    }
    default:
      break;
  }
  riskOnSet(c, e); // v4-risk
}

// ---------------------------------------------------------------- v4-risk kuralları
// DFMEA ↔ PFMEA iki yönlü güncelleme (SCMH 7.2.3 p32 "Updates to either may impact the other"), çok seviyeli DFMEA
// (DRA webinar slide 42), PFD girdi/çıktı (PF webinar p20/p22), hata önleme KP satırı (CP webinar p29), karakteristik
// ID (CP Q&A Q31), ürün↔proses eşleşmesi (CP webinar p24) ve talimat güncellemesi (CP Q&A Q20). Hepsi onay penceresinde
// gösterilir; öneriler AI SUGGESTION olarak işaretlenir ve değer uydurulmaz.
const EP_NONE = (s: string) => !s || /^None/i.test(s.trim());

function balloonFor(c: Ctx, cp: ControlPlanRow): string {
  const dfIds: string[] = [];
  const k = cp.kcId ? c.find<KcRow>('kcs', cp.kcId) : undefined;
  if (k?.sourceId.startsWith('DF-')) dfIds.push(k.sourceId);
  const pf = cp.pfId ? c.find<PfmeaRow>('pfmea', cp.pfId) : undefined;
  if (pf) dfIds.push(...pf.dfIds);
  if (k?.sourceId.startsWith('PF-')) dfIds.push(...(c.find<PfmeaRow>('pfmea', k.sourceId)?.dfIds ?? []));
  for (const id of dfIds)
    for (const rid of c.find<DfmeaRow>('dfmea', id)?.reqIds ?? []) {
      const r = c.find<RequirementRow>('requirements', rid);
      if (r && (r.balloon || r.sourceCell)) return (r.balloon || r.sourceCell).trim();
    }
  return '';
}

function riskOnSet(c: Ctx, e: Extract<Event, { type: 'set' }>) {
  const { table, id, field } = e;
  const fresh = e.from === undefined;
  if (table === 'settings') return;
  if ((table === 'dfmea' || table === 'pfmea') && field === 'riskDecision' && e.to) {
    const r = c.find<DfmeaRow | PfmeaRow>(table, id);
    if (r && !r.riskDecisionBy && c.p.settings.userName) c.set(table, id, 'riskDecisionBy', c.p.settings.userName, 'Kararı veren kullanıcı');
  }
  if (table === 'dfmea') {
    const d = c.find<DfmeaRow>('dfmea', id);
    if (!d) return;
    if (field === 'causeFromIds' && !d.cause.trim()) {
      const txt = d.causeFromIds.map((x) => c.find<DfmeaRow>('dfmea', x)).filter((x) => x && x.failureMode).map((x) => `${x!.id}: ${x!.failureMode}`).join('\n');
      if (txt) c.set('dfmea', id, 'cause', txt, 'Alt seviye DFMEA hata modu bu satırın nedeni olarak önerildi (DRA webinar slide 42)');
    }
    if (field === 'failureMode' && !fresh)
      for (const parent of c.rows<DfmeaRow>('dfmea').filter((x) => x.causeFromIds?.includes(id)))
        c.set('dfmea', parent.id, 'reassess', `FMEA Reassessment Required – alt seviye ${id} hata modu değişti (${today()})`, `${id} (alt seviye) hata modu değişti`);
    return;
  }
  if (table === 'pfmea') {
    const p = c.find<PfmeaRow>('pfmea', id);
    if (!p) return;
    // PFMEA → DFMEA geri bildirimi (DFMEA'dan gelen S senkronu hariç)
    const syncS = field === 's' && p.s === maxLinkedSeverity(c, p.dfIds);
    if ((field === 'failureMode' || field === 'cause' || field === 's') && !fresh && !syncS)
      for (const dfId of p.dfIds)
        c.set('dfmea', dfId, 'reassess', `FMEA Reassessment Required – PFMEA ${id} değişti; DRA/DFMEA etkisi değerlendirilmeli (${today()})`, `PFMEA ${id} ${field} değişti`);
    if (field === 'designActionRequest' && e.to === true) {
      const open = c.rows<AnyRow & { source: string; status: string }>('issues').some((x) => x.source === id && x.status !== 'Closed' && x.status !== 'Resolved');
      if (!open)
        c.add('issues', {
          description: `PFMEA ${id}: neden tasarımla giderilebilir mi? ${p.cause || p.failureMode}`.trim(),
          priority: 'Important', source: id, relatedFmea: p.dfIds.join(', '), status: 'Open',
          recommendedAction: p.dfIds.length ? 'Bağlı DFMEA/DRA satırında tasarım değişikliği değerlendirilmeli' : 'DFMEA bağlantısı yok: ilgili DFMEA/DRA satırı belirlenmeli',
        } as Partial<AnyRow>, `${id} tasarım talebi → açık konu (SCMH 7.2.3 p40 adım 4)`);
      for (const dfId of p.dfIds) c.set('dfmea', dfId, 'reassess', `FMEA Reassessment Required – PFMEA ${id} tasarım değişikliği talep etti`, `${id} tasarım talebi`);
    }
    if (field === 'dfIds' && p.dfIds.length) {
      const dfs = p.dfIds.map((x) => c.find<DfmeaRow>('dfmea', x)).filter(Boolean) as DfmeaRow[];
      if (!p.productRequirement.trim()) {
        const req = dfs.map((d) => d.requirement).filter(Boolean).join('\n');
        if (req) c.set('pfmea', id, 'productRequirement', req, 'Bağlı DFMEA gereksinimi ürün gereksinimi olarak önerildi');
      }
      if (!p.effect.trim()) {
        const eff = dfs.filter((d) => d.failureMode).map((d) => `${d.failureMode} (${d.id})`).join('; ');
        if (eff) {
          c.set('pfmea', id, 'effect', eff, 'DFMEA hata modu → PFMEA etkisi (PF webinar p31) – AI SUGGESTION');
          if (!p.dataStatus) c.set('pfmea', id, 'dataStatus', 'AI SUGGESTION', 'Etki önerisi');
        }
      }
    }
    if (field === 'productRequirement' || field === 'processRequirement')
      c.set('pfmea', id, 'requirement', joinedRequirement(p.productRequirement, p.processRequirement), 'Ürün / proses gereksinimi');
    if (field === 'requirement' && !p.productRequirement.trim() && !p.processRequirement.trim() && p.requirement.trim()) {
      const sp = splitRequirement(c.p, p);
      if (sp.product) c.set('pfmea', id, 'productRequirement', sp.product, 'Gereksinim ayrımı (SCMH 7.2.11 Rev A)');
      if (sp.process) c.set('pfmea', id, 'processRequirement', sp.process, 'Gereksinim ayrımı (SCMH 7.2.11 Rev A)');
    }
    if (field === 'causeInputIds' && !p.cause4M) {
      const inp = p.causeInputIds.map((x) => c.find<PfdItemRow>('pfdItems', x)).find((x) => x?.cat4M);
      if (inp) c.set('pfmea', id, 'cause4M', inp.cat4M, `${inp.id} girdisinin 4M kategorisi`);
    }
    if ((field === 'errorProofing' || field === 'significantRisk' || field === 's') && !EP_NONE(p.errorProofing) && cpRequired(c.p, p)
      && !c.rows<ControlPlanRow>('controlPlan').some((r) => r.pfId === id && r.controlKind === 'Error proofing')) {
      const st = c.find<AnyRow & { machine: string; opNo: string; name: string }>('processSteps', p.stepId);
      c.add('controlPlan', {
        pfId: id, stepId: p.stepId, opNo: st?.opNo ?? p.opNo, processName: st?.name ?? p.stepName, machine: st?.machine ?? '',
        controlKind: 'Error proofing', epDevice: p.errorProofing, charType: 'Process Characteristic',
        processChar: `Hata önleme cihazı çalışıyor: ${p.errorProofing}`, method: 'Cihaz doğrulaması (referans/deneme parçası) – AI SUGGESTION',
        sampleSize: NO_DATA, frequency: NO_DATA, epVerification: NO_DATA, reactionPlan: DEFAULT_REACTION, autoCreated: true,
      } as Partial<ControlPlanRow>, `${id} hata önleme cihazı kontrol planında izlenmeli (CP webinar p29) – AI SUGGESTION`);
    }
    return;
  }
  if (table === 'pfdItems') {
    const it = c.find<PfdItemRow>('pfdItems', id);
    if (!it) return;
    if (field === 'text' && !fresh && e.from)
      for (const p of c.rows<PfmeaRow>('pfmea').filter((x) => x.outputId === id || x.causeInputIds?.includes(id)))
        c.set('pfmea', p.id, 'reassess', `FMEA Reassessment Required – PFD ${it.kind === 'Output' ? 'çıktısı' : 'girdisi'} ${id} değişti`, `${id} değişti`);
    if ((field === 'text' || field === 'kind' || field === 'stepId') && it.kind === 'Output' && it.text.trim() && it.stepId
      && !c.rows<PfmeaRow>('pfmea').some((x) => x.outputId === id)) {
      const st = c.find<AnyRow & { opNo: string; name: string }>('processSteps', it.stepId);
      for (const m of ['yok (no output)', 'kısmi / yetersiz (partial / under)', 'fazla (over)', 'aralıklı (intermittent)'])
        c.add('pfmea', {
          stepId: it.stepId, opNo: st?.opNo ?? '', stepName: st?.name ?? '', outputId: id, productRequirement: it.text,
          failureMode: `${it.text} – ${m}`, approval: 'AI Proposed', dataStatus: 'AI SUGGESTION', origin: 'ai', source: id,
        } as Partial<PfmeaRow>, `${id} PFD çıktısı → hata modu taslağı (PF webinar p20) – AI SUGGESTION`);
    }
    return;
  }
  if (table === 'controlPlan') {
    const cp = c.find<ControlPlanRow>('controlPlan', id);
    if (!cp) return;
    if ((field === 'kcId' || field === 'pfId') && !cp.charId.trim()) {
      const b = balloonFor(c, cp);
      if (b) c.set('controlPlan', id, 'charId', b, 'Bağlı gereksinimin resim balonu / konumu (CP Q&A Q31)');
    }
    if (['method', 'frequency', 'sampleSize', 'controlMethod', 'reactionPlan'].includes(field) && !fresh && cp.wiDocId)
      c.set('documents', cp.wiDocId, 'reassess', `Talimat güncellemesi gerekli – ${id} ${field} değişti (${today()})`, `${id} kontrol yöntemi değişti (CP Q&A Q20)`);
    if ((field === 'specification' || field === 'processChar') && !fresh)
      for (const t of cp.controlsCpIds ?? [])
        c.set('controlPlan', t, 'reassess', `FMEA Reassessment Required – bağlı proses karakteristiği ${id} değişti`, `${id} değişti`);
    return;
  }
}

function syncActionFromFmea(c: Ctx, table: 'dfmea' | 'pfmea', row: DfmeaRow | PfmeaRow, field: string) {
  if (field === 'recommendedAction') ensureAction(c, table, row.id);
  if (!row.actionId) return;
  for (const [fmeaField, actField] of ACTION_SYNC)
    if (field === fmeaField) c.set('actions', row.actionId, actField, (row as unknown as Record<string, unknown>)[fmeaField], `${row.id} aksiyon alanları değişti`);
}

function onAdd(c: Ctx, e: Extract<Event, { type: 'add' }>) {
  const row = c.find(e.table, e.id) as unknown as Record<string, unknown> | undefined;
  if (!row) return;
  // Yeni satırın dolu alanları "değişmiş" gibi işlenir; böylece türetilmiş alanlar ve KC/aksiyon kuralları çalışır.
  for (const [field, value] of Object.entries(row)) {
    if (field === 'id' || value === '' || value == null || (Array.isArray(value) && value.length === 0) || value === false) continue;
    onSet(c, { type: 'set', table: e.table, id: e.id, field, from: undefined, to: value, isNew: true });
  }
}

function onDelete(c: Ctx, e: Extract<Event, { type: 'delete' }>) {
  const { table, id } = e;
  const why = `${id} silindi`;
  capOnDelete(c, table, id); // v4-cap
  switch (table) {
    case 'requirements':
      for (const d of c.rows<DfmeaRow>('dfmea').filter((d) => d.reqIds.includes(id)))
        c.set('dfmea', d.id, 'reqIds', d.reqIds.filter((x) => x !== id), why);
      for (const s of c.rows<AnyRow & { reqIds: string[] }>('structure').filter((s) => s.reqIds.includes(id)))
        c.set('structure', s.id, 'reqIds', s.reqIds.filter((x) => x !== id), why);
      break;
    case 'structure':
      for (const d of c.rows<DfmeaRow>('dfmea').filter((d) => d.functionId === id)) c.set('dfmea', d.id, 'functionId', '', why);
      for (const s of c.rows<AnyRow & { parentId: string }>('structure').filter((s) => s.parentId === id)) c.set('structure', s.id, 'parentId', '', why);
      break;
    case 'dfmea':
    case 'pfmea':
      if (table === 'dfmea') {
        for (const p of c.rows<PfmeaRow>('pfmea').filter((p) => p.dfIds.includes(id))) c.set('pfmea', p.id, 'dfIds', p.dfIds.filter((x) => x !== id), why);
        for (const d of c.rows<DfmeaRow>('dfmea').filter((d) => d.causeFromIds?.includes(id))) c.set('dfmea', d.id, 'causeFromIds', d.causeFromIds.filter((x) => x !== id), why); // v4-risk
      }
      if (table === 'pfmea') {
        for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.pfId === id)) c.set('controlPlan', cp.id, 'pfId', '', why);
        for (const pp of c.rows<ProcessParamRow>('processParams').filter((r) => r.pfIds.includes(id)))
          c.set('processParams', pp.id, 'pfIds', pp.pfIds.filter((x) => x !== id), why);
      }
      for (const k of c.rows<KcRow>('kcs').filter((k) => k.sourceId === id)) {
        // v4-kc: numaralı KC kayıtta kalır (7.2.17 §1.2.1); yalnızca yeniden değerlendirme işaretlenir
        if (kcLocked(k)) c.set('kcs', k.id, 'reassess', `FMEA Reassessment Required – kaynak ${why}; KC durumunu değerlendirin (Eliminated + gerekçe)`, `Kaynağı ${why}`);
        else c.del('kcs', k.id, `Kaynağı ${why}`);
      }
      for (const a of c.rows<ActionRow>('actions').filter((a) => a.sourceId === id)) c.del('actions', a.id, `Kaynağı ${why}`);
      for (const l of c.rows<AnyRow & { linkedFmeaIds: string[] }>('lessons').filter((l) => l.linkedFmeaIds.includes(id)))
        c.set('lessons', l.id, 'linkedFmeaIds', l.linkedFmeaIds.filter((x) => x !== id), why);
      break;
    case 'processSteps':
      for (const p of c.rows<PfmeaRow>('pfmea').filter((p) => p.stepId === id)) c.set('pfmea', p.id, 'stepId', '', why);
      for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.stepId === id)) c.set('controlPlan', cp.id, 'stepId', '', why);
      for (const pp of c.rows<ProcessParamRow>('processParams').filter((r) => r.stepId === id)) c.set('processParams', pp.id, 'stepId', '', why);
      for (const x of c.rows<PfdItemRow>('pfdItems').filter((r) => r.stepId === id)) c.set('pfdItems', x.id, 'stepId', '', why); // v4-risk
      for (const st of c.rows<AnyRow & { alternateOf: string; returnTo: string }>('processSteps')) { // v4-risk
        if (st.alternateOf === id) c.set('processSteps', st.id, 'alternateOf', '', why);
        if (st.returnTo === id) c.set('processSteps', st.id, 'returnTo', '', why);
      }
      break;
    case 'kcs':
      for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.kcId === id)) {
        if (cp.autoCreated) c.del('controlPlan', cp.id, `Bağlı KC ${why}`);
        else c.set('controlPlan', cp.id, 'kcId', '', why);
      }
      for (const m of c.rows<AnyRow & { kcId: string; data?: string }>('capability').filter((r) => r.kcId === id)) {
        if (!m.data) c.del('capability', m.id, `Bağlı KC ${why}`);
        else c.set('capability', m.id, 'kcId', '', why);
      }
      for (const m of c.rows<AnyRow & { kcId: string }>('msa').filter((r) => r.kcId === id)) c.set('msa', m.id, 'kcId', '', why);
      break;
    case 'controlPlan':
      for (const x of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.controlsCpIds?.includes(id))) // v4-risk
        c.set('controlPlan', x.id, 'controlsCpIds', x.controlsCpIds.filter((v) => v !== id), why);
      for (const m of c.rows<AnyRow & { cpId: string; autoCreated: boolean }>('msa').filter((r) => r.cpId === id)) {
        if (m.autoCreated) c.del('msa', m.id, `Bağlı kontrol planı satırı ${why}`);
        else c.set('msa', m.id, 'cpId', '', why);
      }
      break;
    case 'actions': {
      const t = tableOfId((e.row as ActionRow).sourceId);
      if (t === 'dfmea' || t === 'pfmea') {
        const src = c.find<DfmeaRow | PfmeaRow>(t, (e.row as ActionRow).sourceId);
        if (src?.actionId === id) c.set(t, src.id, 'actionId', '', why);
      }
      break;
    }
    case 'processParams':
      for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.ppId === id)) c.set('controlPlan', cp.id, 'ppId', '', why);
      break;
    case 'pfdItems': // v4-risk
      for (const p of c.rows<PfmeaRow>('pfmea')) {
        if (p.outputId === id) c.set('pfmea', p.id, 'outputId', '', why);
        if (p.causeInputIds?.includes(id)) c.set('pfmea', p.id, 'causeInputIds', p.causeInputIds.filter((x) => x !== id), why);
      }
      break;
    case 'evidence':
      for (const t of ['requirements', 'dfmea', 'pfmea', 'kcs', 'controlPlan', 'processParams'] as TableKey[])
        for (const r of c.rows<AnyRow>(t).filter((r) => r.evidenceIds?.includes(id)))
          c.set(t, r.id, 'evidenceIds', r.evidenceIds!.filter((x) => x !== id), why);
      break;
    default:
      break;
  }
}

/**
 * Düzenlemeleri projenin kopyasına uygular ve bağlı ekranlara yayar.
 * propagate=false ise yalnızca birincil değişiklik uygulanır (kullanıcı "sadece bu ekranda" seçerse).
 */
export function planEdits(project: Project, edits: Edit[], propagate = true): Plan {
  const c = new Ctx(structuredClone(project));
  for (const ed of edits) {
    if (ed.kind === 'set') {
      const row = c.find(ed.table, ed.id);
      if (!row) continue;
      c.set(ed.table, ed.id, ed.field, ed.value, 'Kullanıcı değişikliği');
    } else if (ed.kind === 'add') {
      c.add(ed.table, ed.row, 'Kullanıcı ekledi');
    } else if (ed.kind === 'delete') {
      // v4-kc: numaralı KC/CI silinemez; silme isteği yeniden değerlendirme notuna dönüşür
      if (ed.table === 'kcs' && kcLocked(c.find<KcRow>('kcs', ed.id))) {
        c.set('kcs', ed.id, 'reassess', KC_LOCK_MSG, 'Silme reddedildi');
        continue;
      }
      c.del(ed.table, ed.id, 'Kullanıcı sildi');
    } else {
      c.setting(ed.field, ed.value, 'Kullanıcı değişikliği');
    }
  }
  c.primary = false;
  if (propagate) {
    let guard = 0;
    while (c.queue.length && guard++ < 20000) {
      const ev = c.queue.shift()!;
      if (ev.type === 'set') onSet(c, ev);
      else if (ev.type === 'add') onAdd(c, ev);
      else onDelete(c, ev);
    }
  }
  c.queue = [];
  ensureLineNumbers(c.p); // v4-risk: yeni satırlara sabit satır numarası
  const at = new Date().toISOString();
  for (const ef of c.effects)
    if (ef.table !== 'settings')
      c.p.changeLog.push({ at, kind: ef.kind, table: ef.table, id: ef.id, field: ef.field, from: ef.from, to: ef.to });
  return { project: c.p, effects: c.effects };
}

/** Kullanıcıya onay için gösterilecek etkiler: birincil değişiklik ve aynı satırdaki türetilmiş alanlar hariç. */
export function crossScreenEffects(plan: Plan, edits: Edit[]): Effect[] {
  const own = new Set<string>();
  for (const e of edits) if (e.kind === 'set' || e.kind === 'delete') own.add(`${e.table}|${e.id}`);
  const added = new Set(plan.effects.filter((e) => e.primary && e.kind === 'Added').map((e) => `${e.table}|${e.id}`));
  return plan.effects.filter((e) => !e.primary && !own.has(`${e.table}|${e.id}`) && !added.has(`${e.table}|${e.id}`));
}

/** Son revizyondan bu yana yapılan değişiklikleri Added/Modified/Deleted olarak özetler. */
export function summarizeChanges(project: Project) {
  const byKind = { Added: new Set<string>(), Modified: new Set<string>(), Deleted: new Set<string>() };
  for (const e of project.changeLog) byKind[e.kind].add(e.id);
  for (const id of byKind.Added) byKind.Modified.delete(id);
  for (const id of byKind.Deleted) {
    byKind.Modified.delete(id);
    if (byKind.Added.has(id)) {
      byKind.Added.delete(id);
      byKind.Deleted.delete(id);
    }
  }
  const fmt = (s: Set<string>) => [...s].sort().join(', ');
  return { added: fmt(byKind.Added), modified: fmt(byKind.Modified), deleted: fmt(byKind.Deleted), count: byKind.Added.size + byKind.Modified.size + byKind.Deleted.size };
}
