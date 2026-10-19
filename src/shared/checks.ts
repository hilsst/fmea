// Spesifikasyon §35 FMEA kalite kontrolü ve §26 izlenebilirlik matrisleri.
import { actionPriority, isKcCandidate } from './scoring';
import type { ControlPlanRow, DfmeaRow, KcRow, PfmeaRow, Project } from './types';

export interface CheckResult {
  key: string;
  question: string;
  ok: boolean;
  weight: number;
  detail: string;
  ids: string[];
}

const nonEmpty = (s: string | undefined | null) => !!s && s.trim() !== '';
const isAi = (s: string) => /AI (VARSAYIMI|RECOMMENDATION)|VERİ YOK|DATA NOT AVAILABLE/i.test(s);

export function qualityChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (key: string, question: string, weight: number, bad: string[], okDetail: string, badDetail: (n: number) => string, applicable = true) => {
    out.push({ key, question, weight, ok: applicable && bad.length === 0, ids: bad, detail: !applicable ? 'Değerlendirilecek veri yok' : bad.length ? badDetail(bad.length) : okDetail });
  };
  const df = p.dfmea.filter((r) => nonEmpty(r.failureMode));
  const pf = p.pfmea.filter((r) => nonEmpty(r.failureMode));
  const hs = p.settings.highSeverityThreshold;

  add('req-df', 'Her gereksinim DFMEA’da temsil edilmiş mi?', 10,
    p.requirements.filter((r) => !p.dfmea.some((d) => d.reqIds.includes(r.id))).map((r) => r.id),
    'Tüm gereksinimler en az bir DFMEA satırına bağlı', (n) => `${n} gereksinim DFMEA’ya bağlı değil`, p.requirements.length > 0);

  add('df-pf', 'Her önemli DFMEA hata modu PFMEA’ya aktarılmış mı?', 10,
    df.filter((d) => (d.s ?? 0) >= hs || isKcCandidate(d, p.settings)).filter((d) => !p.pfmea.some((x) => x.dfIds.includes(d.id))).map((d) => d.id),
    'Yüksek severity DFMEA satırlarının hepsi PFMEA’ya bağlı', (n) => `${n} önemli DFMEA satırının PFMEA karşılığı yok`, df.length > 0);

  add('prev', 'Her yüksek severity hata modu için önleme kontrolü var mı?', 10,
    [...df, ...pf].filter((r) => (r.s ?? 0) >= hs && !nonEmpty(r.prevention)).map((r) => r.id),
    'Hepsinde önleme kontrolü var', (n) => `${n} yüksek severity satırda önleme kontrolü yok`, df.length + pf.length > 0);

  add('det-only', 'Sadece tespit (detection) kontrolüne güvenilmiş mi?', 8,
    [...df, ...pf].filter((r) => !nonEmpty(r.prevention) && nonEmpty(r.detection)).map((r) => r.id),
    'Sadece tespite dayanan satır yok', (n) => `${n} satır yalnızca tespit kontrolüne dayanıyor`, df.length + pf.length > 0);

  add('kc', 'KC’ler belirlenmiş mi?', 8,
    [...df, ...pf].filter((r) => isKcCandidate(r, p.settings) && !p.kcs.some((k) => k.sourceId === r.id)).map((r) => r.id),
    p.kcs.length ? `${p.kcs.length} KC tanımlı` : 'KC adayı yok', (n) => `${n} KC adayı satır için KC kaydı yok`, df.length + pf.length > 0);

  add('kc-review', 'KC’ler mühendis tarafından değerlendirilmiş mi?', 6,
    p.kcs.filter((k) => k.status === 'AI Proposed' || k.status === '').map((k) => k.id),
    'Tüm KC’ler değerlendirildi', (n) => `${n} KC hâlâ “AI Recommended KC” durumunda`, p.kcs.length > 0);

  add('kc-cp', 'Onaylı KC’lerin kontrol planı bağlantısı var mı?', 10,
    p.kcs.filter((k) => k.status === 'Approved' && !p.controlPlan.some((c) => c.kcId === k.id)).map((k) => k.id),
    'Onaylı KC’lerin hepsi kontrol planında', (n) => `${n} onaylı KC kontrol planında yok`, p.kcs.some((k) => k.status === 'Approved'));

  const special = p.processSteps.filter((s) => s.specialProcess);
  add('special', 'Özel prosesler önleme + izleme + validasyon ile değerlendirilmiş mi?', 8,
    special.filter((s) => {
      const rows = p.pfmea.filter((r) => r.stepId === s.id);
      return rows.length === 0 || rows.every((r) => !nonEmpty(r.prevention));
    }).map((s) => s.id),
    special.length ? 'Tüm özel proseslerde PFMEA önleme kontrolü var' : 'Özel proses işaretlenmemiş', (n) => `${n} özel proses adımında PFMEA önleme kontrolü yok`, special.length > 0);

  add('human', 'İnsan hataları değerlendirilmiş mi?', 5,
    pf.length && !pf.some((r) => /operat|insan|human|training|eğitim|talimat|instruction|label|etiket|wrong|yanlış/i.test(r.cause)) ? ['PFMEA'] : [],
    'PFMEA’da insan faktörü nedenleri var', () => 'PFMEA’da insan faktörüne dayalı neden bulunamadı', pf.length > 0);

  add('errproof', 'Aksiyonlar “operatör dikkat etmeli” yerine hata önleme içeriyor mu?', 5,
    [...df, ...pf].filter((r) => /dikkat etmeli|be careful|dikkatli ol/i.test(r.recommendedAction + ' ' + r.prevention)).map((r) => r.id),
    'Uygun', (n) => `${n} satırda yalnızca “dikkat” temelli kontrol var`, df.length + pf.length > 0);

  add('reassess', 'Revizyon/değişiklik etkileri değerlendirilmiş mi?', 6,
    [...p.requirements, ...p.dfmea, ...p.pfmea, ...p.processSteps, ...p.structure].filter((r) => nonEmpty(r.reassess)).map((r) => r.id),
    'Bekleyen “FMEA Reassessment Required” yok', (n) => `${n} satır yeniden değerlendirme bekliyor`);

  add('msa', 'Kritik karakteristikler için ölçüm sistemi analizi planlanmış mı?', 6,
    p.controlPlan.filter((c) => c.kcId && !p.msa.some((m) => m.cpId === c.id || m.kcId === c.kcId)).map((c) => c.id),
    'KC’li kontrol planı satırlarının MSA kaydı var', (n) => `${n} KC kontrol satırı için MSA yok`, p.controlPlan.some((c) => c.kcId));

  add('cap', 'Capability ihtiyacı belirlenmiş mi?', 4,
    p.kcs.filter((k) => k.status === 'Approved' && !p.capability.some((c) => c.kcId === k.id)).map((k) => k.id),
    'Onaylı KC’lerin capability kaydı var', (n) => `${n} onaylı KC için capability kaydı yok`, p.kcs.some((k) => k.status === 'Approved'));

  add('issues', 'Açık teknik konular kapatılmış mı?', 4,
    p.issues.filter((i) => i.status !== 'Closed' && i.status !== 'Resolved').map((i) => i.id),
    'Açık konu yok', (n) => `${n} açık mühendislik konusu var`);

  add('source', 'Doküman kaynağı mevcut mu?', 8,
    [...p.requirements, ...df, ...pf].filter((r) => !nonEmpty(r.source)).map((r) => r.id),
    'Tüm satırlarda kaynak var', (n) => `${n} satırda kaynak (Source) boş`, p.requirements.length + df.length + pf.length > 0);

  add('ai', 'AI varsayımları gerçek gereksinimlerden ayrılmış mı?', 6,
    [...p.requirements, ...df, ...pf].filter((r) => r.approval === 'AI Proposed' && !nonEmpty(r.dataStatus) && !isAi(r.notes ?? '')).map((r) => r.id),
    'AI önerileri etiketli', (n) => `${n} AI önerisi satırda veri durumu etiketi yok`, p.requirements.length + df.length + pf.length > 0);

  add('scores', 'S/O/D değerleri eksiksiz mi?', 6,
    [...df, ...pf].filter((r) => r.s == null || r.o == null || r.d == null).map((r) => r.id),
    'Tüm satırlar puanlanmış', (n) => `${n} satırda S/O/D eksik`, df.length + pf.length > 0);

  add('ap-high', 'AP=High satırlar için aksiyon tanımlanmış mı?', 8,
    [...df, ...pf].filter((r) => actionPriority(r.s, r.o, r.d) === 'H' && !nonEmpty(r.recommendedAction)).map((r) => r.id),
    'AP=High satırların hepsinde aksiyon var', (n) => `${n} AP=High satırda önerilen aksiyon yok`, df.length + pf.length > 0);

  return out;
}

export function completenessScore(checks: CheckResult[]): number {
  const total = checks.reduce((a, c) => a + c.weight, 0);
  const ok = checks.reduce((a, c) => a + (c.ok ? c.weight : 0), 0);
  return total ? Math.round((ok / total) * 100) : 0;
}

export interface TraceLink {
  from: string;
  to: string;
}

export interface TraceMatrix {
  key: string;
  title: string;
  links: TraceLink[];
  orphans: string[];
  orphanLabel: string;
}

export function traceability(p: Project): TraceMatrix[] {
  const m: TraceMatrix[] = [];
  const kcById = new Map(p.kcs.map((k) => [k.id, k] as [string, KcRow]));
  m.push({
    key: 'req-df',
    title: 'Gereksinim → DFMEA',
    links: p.dfmea.flatMap((d) => d.reqIds.map((r) => ({ from: r, to: d.id }))),
    orphans: p.requirements.filter((r) => !p.dfmea.some((d) => d.reqIds.includes(r.id))).map((r) => r.id),
    orphanLabel: 'DFMEA’ya bağlı olmayan gereksinimler',
  });
  m.push({
    key: 'req-doc',
    title: 'Gereksinim → Doküman / Resim',
    links: p.requirements.flatMap((r) => p.documents.filter((d) => r.source.includes(d.id) || (d.docNumber && r.source.includes(d.docNumber))).map((d) => ({ from: r.id, to: d.id }))),
    orphans: p.requirements.filter((r) => !p.documents.some((d) => r.source.includes(d.id) || (d.docNumber && r.source.includes(d.docNumber)))).map((r) => r.id),
    orphanLabel: 'Kaynak dokümanı kayıtlı olmayan gereksinimler',
  });
  m.push({
    key: 'df-pf',
    title: 'DFMEA → PFMEA',
    links: p.pfmea.flatMap((x) => x.dfIds.map((d) => ({ from: d, to: x.id }))),
    orphans: p.dfmea.filter((d) => !p.pfmea.some((x) => x.dfIds.includes(d.id))).map((d) => d.id),
    orphanLabel: 'PFMEA karşılığı olmayan DFMEA satırları (DFMEA–PFMEA Gap)',
  });
  m.push({
    key: 'df-kc',
    title: 'DFMEA → KC',
    links: p.kcs.filter((k) => k.sourceId.startsWith('DF-')).map((k) => ({ from: k.sourceId, to: k.id })),
    orphans: [],
    orphanLabel: '',
  });
  m.push({
    key: 'pf-kc',
    title: 'PFMEA → KC',
    links: p.kcs.filter((k) => k.sourceId.startsWith('PF-')).map((k) => ({ from: k.sourceId, to: k.id })),
    orphans: [],
    orphanLabel: '',
  });
  m.push({
    key: 'kc-cp',
    title: 'KC → Kontrol Planı',
    links: p.controlPlan.filter((c) => c.kcId).map((c) => ({ from: c.kcId, to: c.id })),
    orphans: p.kcs.filter((k) => k.status !== 'Rejected' && !p.controlPlan.some((c) => c.kcId === k.id)).map((k) => k.id),
    orphanLabel: 'Kontrol planında karşılığı olmayan KC’ler (Control Plan Gap)',
  });
  m.push({
    key: 'kc-insp',
    title: 'KC → Muayene / Ölçüm',
    links: p.controlPlan.filter((c: ControlPlanRow) => c.kcId && c.method).map((c) => ({ from: c.kcId, to: `${c.id}: ${c.method}` })),
    orphans: [],
    orphanLabel: '',
  });
  m.push({
    key: 'kc-msa',
    title: 'KC → MSA / Capability',
    links: [
      ...p.msa.filter((x) => x.kcId).map((x) => ({ from: x.kcId, to: x.id })),
      ...p.capability.filter((x) => x.kcId).map((x) => ({ from: x.kcId, to: x.id })),
    ],
    orphans: [],
    orphanLabel: '',
  });
  m.push({
    key: 'kc-val',
    title: 'KC → Test / Validasyon',
    links: p.kcs.flatMap((k) => {
      const src = [...p.dfmea, ...p.pfmea].find((r) => r.id === k.sourceId) as DfmeaRow | PfmeaRow | undefined;
      const v = src && 'verification' in src ? src.verification : src?.detection;
      return v ? [{ from: k.id, to: v }] : [];
    }),
    orphans: p.kcs.filter((k) => kcById.has(k.id)).filter((k) => {
      const src = [...p.dfmea, ...p.pfmea].find((r) => r.id === k.sourceId) as DfmeaRow | PfmeaRow | undefined;
      return !src || !('verification' in src ? src.verification || src.detection : src.detection);
    }).map((k) => k.id),
    orphanLabel: 'Doğrulama/test yöntemi tanımlı olmayan KC’ler',
  });
  m.push({
    key: 'fm-ll',
    title: 'Hata Modu → NCR / CAPA (Dersler)',
    links: p.lessons.flatMap((l) => l.linkedFmeaIds.map((id) => ({ from: id, to: `${l.id} ${l.sourceType} ${l.reference}`.trim() }))),
    orphans: [],
    orphanLabel: '',
  });
  return m;
}

/** Geçmiş problemi olan hata modları (Historical Occurrence Evidence). */
export function historicalIds(p: Project): Set<string> {
  return new Set(p.lessons.flatMap((l) => l.linkedFmeaIds));
}
