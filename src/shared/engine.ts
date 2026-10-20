// Değişiklik yayma motoru.
// Kullanıcının bir ekranda yaptığı değişiklik (Edit) önce projenin bir kopyasına uygulanır, ardından
// kurallar diğer ekranlardaki bağlı alanları günceller. Ortaya çıkan tüm etkiler (Effect) kullanıcıya
// onay için gösterilir; onaylanırsa kopya projenin yerine geçer, reddedilirse hiçbir şey değişmez.

import { blankRow, nextId, tableOfId } from './model';
import { isKcCandidate } from './scoring';
import { crTouchesPpap, isUpdateTrigger, lessonReassessText, ppapApprovedDate } from './apqp'; // v4-apqp
import type {
  ActionRow,
  AnyRow,
  ChangeRequestRow, // v4-apqp
  ControlPlanRow,
  DfmeaRow,
  KcRow,
  LessonRow, // v4-apqp
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
  '1) Prosesi durdur 2) Şüpheli ürünü ayır (karantina) 3) Son kabul edilen parçayı belirle 4) Etkilenen lot/seri numaralarını belirle 5) Kaliteyi bilgilendir 6) NCR aç 7) Karar (disposition) 8) Kök neden analizi 9) FMEA yeniden değerlendirme 10) Kontrol planı güncelleme (AI SUGGESTION – şirket prosedürüyle doğrulayın)';
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
      if (k.autoCreated && k.status === 'AI Proposed')
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

// ---------------------------------------------------------------- kurallar

function onSet(c: Ctx, e: Extract<Event, { type: 'set' }>) {
  const { table, id, field } = e;
  const fresh = e.from === undefined;

  if (table === 'settings') {
    if (field === 'kcSeverityThreshold' || field === 'autoKcCandidates') syncAllKcCandidates(c);
    return;
  }

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
      if (table === 'dfmea')
        for (const p of c.rows<PfmeaRow>('pfmea').filter((p) => p.dfIds.includes(id))) c.set('pfmea', p.id, 'dfIds', p.dfIds.filter((x) => x !== id), why);
      if (table === 'pfmea') {
        for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.pfId === id)) c.set('controlPlan', cp.id, 'pfId', '', why);
        for (const pp of c.rows<ProcessParamRow>('processParams').filter((r) => r.pfIds.includes(id)))
          c.set('processParams', pp.id, 'pfIds', pp.pfIds.filter((x) => x !== id), why);
      }
      for (const k of c.rows<KcRow>('kcs').filter((k) => k.sourceId === id)) c.del('kcs', k.id, `Kaynağı ${why}`);
      for (const a of c.rows<ActionRow>('actions').filter((a) => a.sourceId === id)) c.del('actions', a.id, `Kaynağı ${why}`);
      for (const l of c.rows<AnyRow & { linkedFmeaIds: string[] }>('lessons').filter((l) => l.linkedFmeaIds.includes(id)))
        c.set('lessons', l.id, 'linkedFmeaIds', l.linkedFmeaIds.filter((x) => x !== id), why);
      break;
    case 'processSteps':
      for (const p of c.rows<PfmeaRow>('pfmea').filter((p) => p.stepId === id)) c.set('pfmea', p.id, 'stepId', '', why);
      for (const cp of c.rows<ControlPlanRow>('controlPlan').filter((r) => r.stepId === id)) c.set('controlPlan', cp.id, 'stepId', '', why);
      for (const pp of c.rows<ProcessParamRow>('processParams').filter((r) => r.stepId === id)) c.set('processParams', pp.id, 'stepId', '', why);
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
