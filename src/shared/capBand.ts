// v4-cap: AS9145 Tablo 1 capability bantları, CAP p66 renk kılavuzu, capability → Occurrence önerisi ve veri kaynağı.
// Bant ve öneriler mühendis kararının yerine geçmez; motor yalnızca öneri satırı açar.
import { attributeCapability, capabilityAnalysis, type AttributeAnalysis, type CapabilityAnalysis } from './capability';
import { AS9145_ACCEPTANCE } from './capDefaults';
import { parseData } from './scoring';
import type { CapabilityRow, ControlPlanRow, KcRow, MsaRow, PfmeaRow, Project, Settings } from './types';

export type CapBand = 'ACCEPT' | 'CONDITIONAL' | 'REJECT' | '';

export const BAND_LABEL: Record<Exclude<CapBand, ''>, string> = {
  ACCEPT: 'ACCEPT – kabul kriterini karşılıyor',
  CONDITIONAL: 'CONDITIONAL – kabul edilebilir olabilir: kontrol metodu + düzeltici faaliyet',
  REJECT: 'REJECT – kabul kriterini karşılamıyor: kontrol metodu + düzeltici faaliyet + müşteri temsilcisi',
};

/** AS9145 Tablo 1 gereken tepkiler (PPAP webinar p26). */
export function requiredReactions(band: CapBand): string[] {
  if (band === 'CONDITIONAL') return ['Ürün uygunluğunu güvenceye alan kontrol metodu (ör. %100 muayene / artırılmış örnekleme)', 'Düzeltici faaliyet başlat', 'Kabul kararı: kuruluş, iç veya müşteri gereksinimine göre'];
  if (band === 'REJECT') return ['Ürün uygunluğunu güvenceye alan kontrol metodu (ör. %100 muayene)', 'Düzeltici faaliyet başlat', 'Yetkili müşteri temsilcisiyle iletişime geç'];
  return [];
}

export interface RowCapability {
  kind: 'Variable' | 'Attribute';
  variable: CapabilityAnalysis | null;
  attribute: AttributeAnalysis | null;
  verdict: CapabilityAnalysis['verdict'];
  /** Banda esas indeks (Cpk; uzun dönem veya yalnızca performans indeksi varsa Ppk). */
  index: number | null;
  indexName: 'Cpk' | 'Ppk' | '';
  band: CapBand;
}

const cache = new WeakMap<object, { s: Settings; r: RowCapability }>();

export function rowCapability(row: CapabilityRow, settings: Settings): RowCapability {
  const hit = cache.get(row);
  if (hit && hit.s === settings) return hit.r;
  let r: RowCapability;
  if (row.dataKind === 'Attribute') {
    const at = attributeCapability({ kind: row.attrKind, data: row.data, defects: row.defects, units: row.units, opportunities: row.opportunities }, settings);
    r = { kind: 'Attribute', variable: null, attribute: at, verdict: at.verdict, index: null, indexName: '', band: '' };
  } else {
    const a = capabilityAnalysis(parseData(row.data), row.lsl, row.usl, row.target, settings, row.subgroupSize, row.distribution);
    const useP = row.term === 'Long-term' || a.cpk == null;
    const index = a.verdict === 'VALID' ? (useP ? a.ppk ?? a.cpk : a.cpk) : null;
    const indexName = index == null ? '' : useP && a.ppk != null ? 'Ppk' : 'Cpk';
    r = { kind: 'Variable', variable: a, attribute: null, verdict: a.verdict, index, indexName, band: bandOf(index, settings) };
  }
  cache.set(row, { s: settings, r });
  return r;
}

export function bandOf(index: number | null, settings: Pick<Settings, 'capAcceptance'>): CapBand {
  if (index == null) return '';
  const acc = settings.capAcceptance ?? AS9145_ACCEPTANCE;
  if (index >= acc.accept) return 'ACCEPT';
  if (index >= acc.conditional) return 'CONDITIONAL';
  return 'REJECT';
}

/** "VALID · CONDITIONAL (Cpk 1.12)" */
export function capResultText(row: CapabilityRow, settings: Settings): string {
  const r = rowCapability(row, settings);
  if (r.kind === 'Attribute') {
    const at = r.attribute!;
    const v = at.ppm != null ? `PPM ${Math.round(at.ppm)}` : at.dpmo != null ? `DPMO ${Math.round(at.dpmo)}` : '';
    return `${at.verdict} · NİTEL${v ? ` (${v})` : ''} · Tablo 1 bandı uygulanmaz – müşteri kriteri`;
  }
  if (!r.band) return r.verdict;
  return `${r.verdict} · ${r.band} (${r.indexName} ${r.index!.toFixed(2)})`;
}

/** CAP p66 renk kılavuzu – yalnızca ikincil ipucu; kabul kararı AS9145 Tablo 1 bandıdır. */
export function guidelineColor(kind: 'Cp' | 'Pp', v: number | null): '' | 'red' | 'yellow' | 'green' {
  if (v == null) return '';
  if (kind === 'Cp') return v < 1.33 ? 'red' : v < 1.67 ? 'yellow' : 'green';
  return v < 1.0 ? 'red' : v <= 1.33 ? 'yellow' : 'green';
}

// ───────────────────────── bağlantılar ─────────────────────────

/** Capability satırına KC ve kontrol planı üzerinden bağlı PFMEA satırları. */
export function linkedPfmea(p: Project, cap: CapabilityRow): PfmeaRow[] {
  if (!cap.kcId) return [];
  const kc = p.kcs.find((k: KcRow) => k.id === cap.kcId);
  const ids = new Set<string>();
  if (kc?.sourceId.startsWith('PF-')) ids.add(kc.sourceId);
  if (kc?.sourceId.startsWith('DF-')) for (const pf of p.pfmea) if (pf.dfIds.includes(kc.sourceId)) ids.add(pf.id);
  for (const cp of p.controlPlan) if (cp.kcId === cap.kcId && cp.pfId) ids.add(cp.pfId);
  return p.pfmea.filter((x) => ids.has(x.id));
}

/** Aynı karakteristiği ölçen MSA satırları (KC veya kontrol planı üzerinden). */
export function linkedMsa(p: Project, cap: CapabilityRow): MsaRow[] {
  if (!cap.kcId) return [];
  const cpIds = new Set(p.controlPlan.filter((c: ControlPlanRow) => c.kcId === cap.kcId).map((c) => c.id));
  return p.msa.filter((m) => m.kcId === cap.kcId || cpIds.has(m.cpId));
}

/** G16: ölçüm sistemi kabul edilmemişse capability yorumu uyarı taşır. */
export function msaBlocker(p: Project, cap: CapabilityRow): string {
  const ms = linkedMsa(p, cap);
  if (!ms.length) return cap.kcId ? 'MSA kaydı yok – ölçüm sistemi doğrulanmadı' : '';
  const bad = ms.filter((m) => m.status !== 'Acceptable');
  return bad.length ? `Ölçüm sistemi henüz kabul edilebilir değil: ${bad.map((m) => `${m.id} (${m.status || '—'})`).join(', ')}` : '';
}

// ───────────────────────── Occurrence önerisi (CAP p50) ─────────────────────────

export interface OccurrenceSuggestion {
  rank: number | null;
  ppm: number | null;
  evidence: string;
  note: string;
}

/**
 * "With stable processes, the capability analysis can be used for the Occurrence scoring" (CAP p50).
 * O yalnızca aktif O tablosunda "% of production" eşlemesi varsa önerilir (SCMH P-OCC); yoksa VERİ YOK.
 * Oran, oranı karşılayan en küçük yüzdelik satırına eşlenir (temkinli: daha yüksek O).
 */
export function occurrenceFromCapability(p: Project, cap: CapabilityRow): OccurrenceSuggestion {
  const r = rowCapability(cap, p.settings);
  const ppm = r.kind === 'Attribute' ? r.attribute!.ppm : r.verdict === 'VALID' ? r.variable!.ppmOverall : null;
  const idx = r.index != null ? `${r.indexName} ${r.index.toFixed(2)}` : '';
  const evidence = ppm != null ? `${cap.id}: ${idx ? idx + ' ' : ''}(PPM ${ppm < 1 ? ppm.toFixed(2) : Math.round(ppm)})` : '';
  if (r.verdict !== 'VALID' || ppm == null) return { rank: null, ppm, evidence, note: 'Capability geçerli değil (kararlı + yeterli veri gerekir) – O önerisi yok.' };
  const rows = p.scoring.occurrence
    .map((e) => ({ rank: e.rank, m: /(\d+(?:\.\d+)?)\s*%\s*of production/i.exec(e.pf), less: /less than|<\s*\d/i.test(e.pf) }))
    .filter((x) => x.m && !x.less)
    .map((x) => ({ rank: x.rank, pct: Number(x.m![1]) }))
    .sort((a, b) => a.pct - b.pct);
  if (!rows.length) return { rank: null, ppm, evidence, note: 'O önerisi VERİ YOK – aktif O tablosunda üretim oranı (% of production) eşlemesi yok.' };
  const pct = ppm / 1e4;
  const hit = rows.find((x) => x.pct >= pct);
  if (!hit) return { rank: rows[rows.length - 1].rank, ppm, evidence, note: 'Oran tablonun en yüksek satırını aşıyor.' };
  const note = hit === rows[0] && pct < rows[0].pct ? 'Daha düşük O yalnızca önleyici kontrol kanıtıyla verilebilir (O tablosu).' : '';
  return { rank: hit.rank, ppm, evidence, note };
}

// ───────────────────────── veri kaynağı (G17) ─────────────────────────

/** PPAP element 7 (Initial Process Capability) için kullanılabilir mi: üretim koşusu verisi + VALID. */
export function isPpapCapabilityEvidence(row: CapabilityRow, settings: Settings): boolean {
  return row.dataSource === 'Production run' && rowCapability(row, settings).verdict === 'VALID';
}

export function provenanceIssues(row: CapabilityRow): string[] {
  const out: string[] = [];
  const hasData = !!row.data.trim() || row.units != null;
  if (!hasData) return out;
  if (!row.dataSource) out.push('Veri kaynağı (üretim koşusu / pre-launch / prototip) VERİ YOK');
  else if (row.dataSource !== 'Production run') out.push(`Veri kaynağı ${row.dataSource}: PPAP başlangıç capability için üretim koşusu parçaları gerekir (PPAP p26)`);
  if (!row.dateFrom && !row.dateTo) out.push('Veri tarih aralığı VERİ YOK');
  if (!row.samplePlan) out.push('Örnekleme planı VERİ YOK');
  if (/^\s*1\s*$/.test(row.operators)) out.push('Tek operatör: veri temsil edici olmayabilir (CAP p19)');
  return out;
}
