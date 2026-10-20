// v4-cap: capability / MSA değişiklik yayma kuralları. engine.ts onSet/onDelete içinden çağrılır; tüm etkiler
// onay penceresinde (ConfirmDialog) listelenir. Eklenen satırlar AI SUGGESTION öneridir; hiçbir şey onaylanmaz.
import { BAND_LABEL, linkedPfmea, occurrenceFromCapability, rowCapability, type CapBand } from './capBand';
import { AS9145_ACCEPTANCE } from './capDefaults';
import { msaCovers, msaStudyFor, needsMsa, NO_DATA } from './msa';
import { blankRow, nextId } from './model';
import type { ActionRow, AnyRow, CapabilityRow, ControlPlanRow, IssueRow, MsaRow, PfmeaRow, Project, TableKey } from './types';

/** engine.ts Ctx ile yapısal uyumlu en küçük arayüz. */
export interface RuleCtx {
  p: Project;
  set(table: TableKey, id: string, field: string, value: unknown, reason: string): void;
  add(table: TableKey, partial: Partial<AnyRow>, reason: string): string;
  del(table: TableKey, id: string, reason: string): void;
}

export const CAP_INPUT_FIELDS = ['data', 'lsl', 'usl', 'target', 'subgroupSize', 'distribution', 'dataKind', 'attrKind', 'defects', 'units', 'opportunities', 'term', 'kcId'];
const today = () => new Date().toISOString().slice(0, 10);
const SUG = 'AI SUGGESTION – mühendis onayı gerekli';
const fx = (v: number) => v.toFixed(2);

function capRows(c: RuleCtx) {
  return c.p.capability as CapabilityRow[];
}
const findCp = (c: RuleCtx, id: string) => (c.p.controlPlan as ControlPlanRow[]).find((r) => r.id === id);

/** Containment satırı için şablon: aynı KC'nin ilk (containment olmayan) kontrol planı satırı. */
function baseCp(c: RuleCtx, cap: CapabilityRow): ControlPlanRow | undefined {
  return (c.p.controlPlan as ControlPlanRow[]).find((r) => r.kcId === cap.kcId && !r.capId);
}

/**
 * AS9145 Tablo 1 tepkileri (PPAP webinar p26) ve 7.2.3 p85 "≥1.33 sağlanana kadar %100 muayene":
 * CONDITIONAL/REJECT → %100 containment kontrol planı satırı + düzeltici faaliyet; REJECT → müşteri temsilcisi konusu.
 * ACCEPT → otomatik containment satırının kaldırılması önerilir.
 */
export function applyCapReactions(c: RuleCtx, capId: string) {
  const cap = capRows(c).find((r) => r.id === capId);
  if (!cap) return;
  const rc = rowCapability(cap, c.p.settings);
  const band: CapBand = rc.band;
  const acc = c.p.settings.capAcceptance ?? AS9145_ACCEPTANCE;
  const idxText = rc.index != null ? `${rc.indexName} ${fx(rc.index)}` : '';
  const ch = cap.characteristic || cap.kcId || cap.id;
  if (band === 'CONDITIONAL' || band === 'REJECT') {
    const why = `${cap.id} ${BAND_LABEL[band].split(' – ')[0]} (${idxText}; ${acc.source})`;
    if (!cap.containmentCpId || !findCp(c, cap.containmentCpId)) {
      const b = baseCp(c, cap);
      const cpId = c.add('controlPlan', {
        capId: cap.id,
        kcId: cap.kcId,
        stepId: b?.stepId ?? '', opNo: b?.opNo ?? '', processName: b?.processName ?? '', machine: b?.machine ?? '', pfId: b?.pfId ?? '',
        productChar: b ? b.productChar : ch, processChar: b?.processChar ?? '', charType: b?.charType || 'Product Characteristic',
        specification: b?.specification || NO_DATA, tolerance: b?.tolerance ?? '', method: b?.method || NO_DATA, gauge: b?.gauge ?? '',
        sampleSize: '%100',
        frequency: `Her parça – ${acc.accept} sağlanana kadar`,
        controlMethod: `%100 muayene (sınırlama / containment) – ${idxText} < ${acc.accept}`,
        reactionPlan: b?.reactionPlan || 'Uygunsuz parçayı ayır, NCR aç, Kaliteyi bilgilendir (şirket prosedürüyle doğrulayın)',
        responsible: b?.responsible ?? '',
        autoCreated: true,
        origin: 'ai',
        notes: `${SUG}. ${why}. AS9145 Tablo 1: kontrol metodu uygulanmalı; 7.2.3 p85: ≥1.33 sağlanana kadar %100 muayene beklenir.`,
      } as Partial<ControlPlanRow>, `${why} → %100 containment kontrol planı satırı önerildi`);
      c.set('capability', cap.id, 'containmentCpId', cpId, 'Containment satırı bağlandı');
    }
    if (!cap.actionId || !(c.p.actions as ActionRow[]).some((a) => a.id === cap.actionId)) {
      const actId = c.add('actions', {
        sourceId: cap.id,
        description: `Düzeltici faaliyet – capability: ${ch} ${idxText} < ${acc.accept}. Varyasyon kaynaklarını belirle ve azalt, ardından capability çalışmasını tekrarla.`,
        actionType: 'Process change',
        status: 'Open',
        origin: 'ai',
        notes: `${SUG}. ${why}.`,
      } as Partial<ActionRow>, `${why} → düzeltici faaliyet önerildi`);
      c.set('capability', cap.id, 'actionId', actId, 'Aksiyon kaydı bağlandı');
    }
    if (band === 'REJECT' && (!cap.customerIssueId || !(c.p.issues as IssueRow[]).some((i) => i.id === cap.customerIssueId))) {
      const isId = c.add('issues', {
        description: `Yetkili müşteri temsilcisiyle iletişim – ${cap.id} ${ch}: ${idxText} < ${acc.conditional} (AS9145 Tablo 1)`,
        priority: 'Critical',
        source: cap.id,
        risk: 'Capability kabul kriterini karşılamıyor',
        relatedFmea: linkedPfmea(c.p, cap).map((x) => x.id).join(', '),
        recommendedAction: 'Müşteri temsilcisini bilgilendir; containment ve düzeltici faaliyet planını paylaş.',
        status: 'Open',
        origin: 'ai',
      } as Partial<IssueRow>, `${why} → müşteri temsilcisi iletişim konusu önerildi`);
      c.set('capability', cap.id, 'customerIssueId', isId, 'Müşteri konusu bağlandı');
    }
  }
  if (band === 'ACCEPT' && cap.containmentCpId) {
    const cp = findCp(c, cap.containmentCpId);
    if (cp?.autoCreated && cp.capId === cap.id) {
      c.del('controlPlan', cp.id, `${cap.id} ACCEPT (${idxText} ≥ ${acc.accept}) → otomatik %100 containment satırı kaldırılabilir`);
      c.set('capability', cap.id, 'containmentCpId', '', 'Containment satırı kaldırıldı');
    }
  }
  if (rc.verdict === 'VALID') {
    occurrenceLink(c, cap);
    if (rc.kind === 'Variable') proposeSpc(c, cap);
  }
}

/** G9: geçerli capability → bağlı PFMEA satırlarında O kanıtı ve yeniden değerlendirme (O mühendis tarafından değiştirilir). */
function occurrenceLink(c: RuleCtx, cap: CapabilityRow) {
  const sug = occurrenceFromCapability(c.p, cap);
  if (!sug.evidence) return;
  for (const pf of linkedPfmea(c.p, cap) as PfmeaRow[]) {
    if (!pf.oEvidence || pf.oEvidence.startsWith(`${cap.id}:`)) c.set('pfmea', pf.id, 'oEvidence', sug.evidence, `${cap.id} capability sonucu O kanıtı olarak önerildi (CAP p50)`);
    const o = sug.rank != null ? `O önerisi ${sug.rank} (aktif O tablosu)` : sug.note;
    if (sug.rank == null || pf.o !== sug.rank)
      c.set('pfmea', pf.id, 'reassess', `FMEA Reassessment Required – ${cap.id} capability değişti: ${sug.evidence}; ${o}`, `${cap.id} capability verisi değişti`);
  }
}

/** G19: geçerli capability → bağlı kontrol planı satırlarında boş SPC alanları baseline limitlerle önerilir (CAP p42). */
function proposeSpc(c: RuleCtx, cap: CapabilityRow) {
  const a = rowCapability(cap, c.p.settings).variable;
  if (!a?.limits || !cap.kcId) return;
  for (const cp of (c.p.controlPlan as ControlPlanRow[]).filter((r) => r.kcId === cap.kcId && !r.capId)) {
    if (cp.spcUcl != null || cp.spcLcl != null) continue;
    const why = `${cap.id} VALID → SPC limitleri baseline olarak önerildi (CAP p42: kontrol altındayken belirlenir ve sabitlenir)`;
    const r4 = (v: number) => Number(v.toPrecision(6));
    c.set('controlPlan', cp.id, 'spcChart', a.method, why);
    c.set('controlPlan', cp.id, 'spcSubgroup', cap.subgroupSize && cap.subgroupSize > 1 ? cap.subgroupSize : 1, why);
    c.set('controlPlan', cp.id, 'spcCenter', r4(a.limits.center), why);
    c.set('controlPlan', cp.id, 'spcUcl', r4(a.limits.ucl), why);
    c.set('controlPlan', cp.id, 'spcLcl', r4(a.limits.lcl), why);
    c.set('controlPlan', cp.id, 'spcBaselineCapId', cap.id, why);
    c.set('controlPlan', cp.id, 'spcLimitsFixedOn', today(), why);
  }
}

/** engine.ts onSet kancası. */
export function capOnSet(c: RuleCtx, table: TableKey, id: string, field: string, from: unknown, to: unknown) {
  const fresh = from === undefined;
  if (table === 'capability' && CAP_INPUT_FIELDS.includes(field)) applyCapReactions(c, id);
  if (table === 'controlPlan' && (field === 'method' || field === 'gauge')) {
    const cp = findCp(c, id);
    if (!cp) return;
    // G16: ölçüm yöntemi / cihazı değişti → bağlı MSA yeniden çalışma
    if (!fresh && from) {
      for (const m of (c.p.msa as MsaRow[]).filter((m) => m.cpId === id)) {
        c.set('msa', m.id, 'status', 'Planned (re-study)', `${id} ölçüm ${field === 'gauge' ? 'cihazı' : 'yöntemi'} değişti → MSA yeniden çalışılmalı (MSA p36)`);
        c.set('msa', m.id, 'trigger', field === 'gauge' ? 'Gauge change' : 'Method change', `${id} değişti`);
        c.set('msa', m.id, 'reassess', `MSA Re-study Required – ${id} ${field === 'gauge' ? 'cihaz' : 'yöntem'}: ${String(from)} → ${String(to ?? '—')}`, `${id} değişti`);
      }
    }
    // G29: kontrol planına yeni ölçüm eklendi → MSA planı güncellenmeli (7.2.3 p73, MSA p26)
    if (needsMsa(cp) && !msaCovers(c.p, cp)) {
      const sug = msaStudyFor(cp.gauge || cp.method);
      c.add('msa', {
        cpId: cp.id, kcId: cp.kcId, characteristic: cp.productChar || cp.processChar, gauge: cp.gauge || cp.method,
        study: sug.study, dataType: sug.dataType, status: 'Planned', autoCreated: true, origin: 'ai', trigger: cp.kcId ? 'KC' : 'Control plan addition',
        notes: `${sug.study ? `Yöntem önerisi: ${sug.study}` : 'Çalışma tipi mühendis tarafından seçilmeli'} (AI SUGGESTION). Her ölçüm tipi MSA gerektirir (MSA p26).`,
      } as Partial<MsaRow>, `${id} ölçümü eklendi → MSA planı güncellenmeli (AI SUGGESTION)`);
    }
  }
  if (table === 'msa' && field === 'status' && to === 'Not acceptable' && from !== 'Not acceptable') {
    const m = (c.p.msa as MsaRow[]).find((x) => x.id === id);
    if (!m) return;
    if (!m.actionId || !(c.p.actions as ActionRow[]).some((a) => a.id === m.actionId)) {
      const actId = c.add('actions', {
        sourceId: m.id,
        description: `MSA iyileştirme – ${m.id} ${m.gauge || m.characteristic}: eğitim, daha iyi yöntem, beceri ve ergonomi; ardından GR&R tekrarı (MSA p36).`,
        actionType: 'Detection control',
        status: 'Open',
        origin: 'ai',
        notes: SUG,
      } as Partial<ActionRow>, `${m.id} kabul edilemez → MSA iyileştirme aksiyonu önerildi`);
      c.set('msa', m.id, 'actionId', actId, 'Aksiyon kaydı bağlandı');
    }
    // D puanı ölçüm sisteminin güvenilirliğine dayanır (çıkarım) → bağlı PFMEA satırları yeniden değerlendirilir
    const cp = m.cpId ? findCp(c, m.cpId) : undefined;
    const g = (m.gauge || '').trim().toLowerCase();
    for (const pf of c.p.pfmea as PfmeaRow[]) {
      const viaCp = cp?.pfId === pf.id;
      const viaGauge = g.length > 2 && `${pf.measurement} ${pf.detection}`.toLowerCase().includes(g);
      if (viaCp || viaGauge) c.set('pfmea', pf.id, 'reassess', `FMEA Reassessment Required – ${m.id} ölçüm sistemi kabul edilemez: D (tespit) puanının dayanağı doğrulanmadı`, `${m.id} Not acceptable`);
    }
  }
}

/** engine.ts onDelete kancası: bağlantıları temizler. */
export function capOnDelete(c: RuleCtx, table: TableKey, id: string) {
  const why = `${id} silindi`;
  if (table === 'controlPlan') for (const r of capRows(c).filter((r) => r.containmentCpId === id)) c.set('capability', r.id, 'containmentCpId', '', why);
  if (table === 'actions') {
    for (const r of capRows(c).filter((r) => r.actionId === id)) c.set('capability', r.id, 'actionId', '', why);
    for (const r of (c.p.msa as MsaRow[]).filter((r) => r.actionId === id)) c.set('msa', r.id, 'actionId', '', why);
  }
  if (table === 'issues') for (const r of capRows(c).filter((r) => r.customerIssueId === id)) c.set('capability', r.id, 'customerIssueId', '', why);
  if (table === 'capability')
    for (const cp of (c.p.controlPlan as ControlPlanRow[]).filter((r) => r.capId === id)) {
      if (cp.autoCreated) c.del('controlPlan', cp.id, `Bağlı capability ${why}; otomatik containment satırı kaldırılır`);
      else c.set('controlPlan', cp.id, 'capId', '', why);
    }
}

export interface RecordedEdit {
  kind: 'add' | 'set';
  table: TableKey;
  id: string;
  row?: AnyRow;
  field?: string;
  value?: unknown;
}

/**
 * Ekrandan "tepkileri öner" düğmesi için: kuralları projenin kopyasında çalıştırır ve kullanıcı düzenlemesi
 * (engine Edit) olarak döndürür; böylece öneriler planEdits + onay penceresinden geçer.
 */
export function capReactionEdits(p: Project, capId: string): RecordedEdit[] {
  const d = structuredClone(p);
  const out: RecordedEdit[] = [];
  const ctx: RuleCtx = {
    p: d,
    set(table, id, field, value) {
      const row = (d[table] as AnyRow[]).find((r) => r.id === id) as unknown as Record<string, unknown> | undefined;
      if (!row || JSON.stringify(row[field] ?? null) === JSON.stringify(value ?? null)) return;
      row[field] = value;
      const added = out.find((e) => e.kind === 'add' && e.id === id);
      if (added) (added.row as unknown as Record<string, unknown>)[field] = value;
      else out.push({ kind: 'set', table, id, field, value });
    },
    add(table, partial) {
      const id = nextId(d, table);
      const row = { ...blankRow(table, id), ...partial, id } as AnyRow;
      (d[table] as AnyRow[]).push(row);
      out.push({ kind: 'add', table, id, row: structuredClone(row) });
      return id;
    },
    del() {
      /* düğme yalnızca öneri ekler */
    },
  };
  applyCapReactions(ctx, capId);
  return out;
}
