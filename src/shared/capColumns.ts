// v4-cap: MSA, Capability ve kontrol planı SPC kolonları (ekran + Excel). columns.ts bu dizileri kullanır.
import { capResultText, guidelineColor, msaBlocker, occurrenceFromCapability, provenanceIssues, rowCapability, requiredReactions } from './capBand';
import type { Col } from './columns';
import { LISTS } from './model';
import { evaluateMsa, MSA_LISTS } from './msa';
import type { AnyRow, CapabilityRow, MsaRow, Project } from './types';

const t = (key: string, label: string, width = 140, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'text', ...extra });
const long = (key: string, label: string, width = 200, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'long', ...extra });
const sel = (key: string, label: string, options: string[], width = 130, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'select', options, ...extra });
const num = (key: string, label: string, width = 70, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'number', ...extra });
const bool = (key: string, label: string, width = 70, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'bool', ...extra });
const comp = (key: string, label: string, compute: Col['compute'], width = 80, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'computed', compute, readonly: true, ...extra });

const fmt = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? '' : Number(v.toFixed(d)));
const cap = (r: AnyRow, p: Project) => rowCapability(r as CapabilityRow, p.settings);
const ms = (r: AnyRow, p: Project) => evaluateMsa(r as MsaRow, p);
const ratio = (v: number | null) => (v == null ? 'VERİ YOK' : `${v.toFixed(1)}:1`);

export const MSA_COLUMNS: Col[] = [
  { key: 'cpId', label: 'Kontrol Planı', width: 100, type: 'ref', ref: 'controlPlan' },
  { key: 'kcId', label: 'KC', width: 90, type: 'ref', ref: 'kcs' },
  long('characteristic', 'Karakteristik', 200, { derived: 'Kritik Karakteristikler' }),
  t('gauge', 'Ölçüm Sistemi', 160, { derived: 'Kontrol Planı' }),
  sel('measType', 'Ölçüm Tipi', MSA_LISTS.measType, 150, { free: true, help: 'Tüm ölçüm tipleri (değişken ve nitel: görsel, go/no-go) MSA gerektirir (MSA webinar p26)' }),
  sel('dataType', 'Veri Tipi', LISTS.dataType, 90, { help: 'Değişken → GR&R; nitel (attribute) → Attribute Agreement' }),
  sel('trigger', 'Tetikleyici', MSA_LISTS.trigger, 130, { free: true, help: 'MSA p27: kaçak, yeni test, yeni ürün, tasarım değişikliği, açıklanamayan ölçüm sorunu, tüm KC’ler' }),
  sel('study', 'Çalışma', MSA_LISTS.msaStudy, 160),
  sel('status', 'Durum', MSA_LISTS.msaStatus, 150),
  num('tolerance', 'Tolerans Aralığı', 80, { help: 'Boşsa kontrol planı spesifikasyonundan okunur (yalnızca açık aralık/± varsa)' }),
  num('resolution', 'Çözünürlük', 80),
  comp('resRatio', 'Çözünürlük Oranı', (r, p) => ratio(ms(r, p).resolutionRatio), 90, { help: 'Tolerans / çözünürlük ≥ 10:1 (MSA p30)' }),
  num('gaugeUncertainty', 'Belirsizlik (±U)', 80),
  comp('tur', 'TUR', (r, p) => ratio(ms(r, p).tur), 70, { help: '(Tolerans/2) / U ≥ 4:1 (MSA p17–19, p31); müşteri oranı belirleyebilir' }),
  num('stabilityDrift', 'Kararlılık Sapması', 80, { secondary: true, help: 'Kalibrasyon geçmişinden; doğruluğun en az 10 katı iyi olmalı (MSA p31)' }),
  sel('linearity', 'Doğrusallık', MSA_LISTS.linearity, 80, { secondary: true }),
  t('calibrationRef', 'Kalibrasyon Kaydı', 120, { secondary: true }),
  { key: 'calibrationDue', label: 'Kalibrasyon Termini', width: 120, type: 'date', secondary: true },
  bool('calibrationVerified', 'Kalibrasyon Doğrulandı', 80, { help: 'GR&R öncesi (MSA p33)' }),
  bool('softwareDependent', 'Yazılıma Bağlı', 70, { secondary: true }),
  bool('multiGauge', 'Çoklu Cihaz', 70, { secondary: true }),
  { key: 'refMsaId', label: 'Referans MSA', width: 90, type: 'ref', ref: 'msa', secondary: true, help: 'Aynı/benzer kararlı sistem (MSA adım 5–6)' },
  num('grrParts', 'Parça', 60, { help: 'Önerilen 10, en az 5 (MSA p33)' }),
  num('grrOperators', 'Operatör', 66, { help: 'Tüm operatörler, en az 2 (MSA p33)' }),
  num('grrTrials', 'Tekrar', 60, { help: 'Önerilen 2-10-2 (MSA p34)' }),
  num('pctStudyVar', '%GRR (SV)', 70),
  num('pctTolerance', '%GRR (Tol)', 70),
  num('ndc', 'ndc', 56),
  num('kappa', 'Kappa', 60, { secondary: true }),
  num('effectiveness', 'Etkinlik %', 70, { secondary: true }),
  num('custMaxGrr', 'Müşteri GR&R ≤ %', 80, { help: 'Müşteri kriteri. Boşsa Ayarlar’daki kriter; o da boşsa VERİ YOK (MSA p36)' }),
  sel('custBasis', 'Kriter Bazı', MSA_LISTS.custBasis, 100, { secondary: true }),
  num('custMinNdc', 'Müşteri ndc ≥', 70, { secondary: true }),
  num('custMinKappa', 'Müşteri kappa ≥', 70, { secondary: true }),
  t('custSource', 'Kriter Kaynağı', 140, { help: 'Müşteri dokümanı / şartname maddesi' }),
  comp('criterion', 'Kabul Kriteri', (r, p) => ms(r, p).criterionText, 200),
  comp('msaVerdict', 'Kriter Değerlendirmesi', (r, p) => ms(r, p).verdict, 170, { help: 'Öneridir; Durum alanını mühendis seçer' }),
  comp('msaWarn', 'Uyarılar', (r, p) => [...ms(r, p).warnings, ...ms(r, p).flow].join(' '), 260),
  t('result', 'Sonuç (serbest)', 140, { secondary: true }),
  t('actionId', 'Aksiyon ID', 80, { readonly: true, derived: 'Aksiyonlar' }),
  t('reassess', 'Yeniden Çalışma', 200, { help: 'Ölçüm yöntemi/cihazı değişince dolar; değerlendirince temizleyin' }),
  long('notes', 'Notlar', 200),
];

export const CAP_COLUMNS: Col[] = [
  { key: 'kcId', label: 'KC', width: 90, type: 'ref', ref: 'kcs' },
  long('characteristic', 'Karakteristik', 200, { derived: 'Kritik Karakteristikler' }),
  sel('dataKind', 'Veri Türü', ['Variable', 'Attribute'], 90, { help: 'Boş = Variable. Attribute: PPM / DPMO, p/np/c/u kartı (CAP p15–16, p46)' }),
  { key: 'lsl', label: 'LSL', width: 70, type: 'number' },
  { key: 'usl', label: 'USL', width: 70, type: 'number' },
  { key: 'target', label: 'Hedef', width: 70, type: 'number' },
  long('data', 'Ölçüm Verisi', 220, { help: 'Değişken: değerleri üretim sırasıyla boşluk, satır veya ; ile ayırın. Nitel: alt grupları "kusur/adet" olarak girin (örn. 1/50 0/50)' }),
  { key: 'subgroupSize', label: 'Alt Grup', width: 66, type: 'number', help: '1 veya boş = I-MR; 2–10 = Xbar-R; >10 = Xbar-s (CAP p46)' },
  sel('distribution', 'Dağılım', LISTS.distribution, 100),
  sel('term', 'Dönem', ['Short-term', 'Long-term'], 100, { help: 'Long-term → bant Ppk ile değerlendirilir (CAP p20)' }),
  sel('attrKind', 'Nitel Tip', ['Defectives', 'Defects'], 100, { secondary: true }),
  num('defects', 'Kusur / Uygunsuz', 80, { secondary: true }),
  num('units', 'Adet', 70, { secondary: true }),
  num('opportunities', 'Fırsat / Birim', 70, { secondary: true }),
  comp('n', 'N', (r, p) => cap(r, p).variable?.n ?? cap(r, p).attribute?.units ?? '', 56),
  comp('subgroups', 'Alt Grup Sayısı', (r, p) => { const a = cap(r, p); return a.variable ? `${a.variable.subgroups}/${a.variable.minSubgroups}` : a.attribute ? `${a.attribute.subgroups}/${a.attribute.minSubgroups}` : ''; }, 80, { help: 'Kontrol limitleri için en az 20–25 alt grup (CAP p38)' }),
  comp('chart', 'Kart', (r, p) => cap(r, p).variable?.method || cap(r, p).attribute?.chart || '', 70),
  ...(['mean', 'cp', 'cpk', 'pp', 'ppk'] as const).map((k) =>
    comp(k, k === 'mean' ? 'Ort.' : { cp: 'Cp', cpk: 'Cpk', pp: 'Pp', ppk: 'Ppk' }[k], (r, p) => fmt(cap(r, p).variable?.[k]), 64),
  ),
  comp('normality', 'Normallik', (r, p) => {
    const a = cap(r, p).variable;
    return a?.adP == null ? '' : `${a.normal ? 'Normal' : 'Normal değil'} (AD p=${a.adP.toFixed(3)})`;
  }, 140),
  comp('stability', 'Kararlılık', (r, p) => {
    const x = cap(r, p);
    const st = x.variable?.stable ?? x.attribute?.stable;
    if (st == null) return '';
    return st ? `Kararlı (${x.variable?.method ?? x.attribute?.chart})` : `Kararsız: ${(x.variable?.ruleHits ?? []).map((h) => h.rule).join('; ') || `${x.attribute?.outOfControl.length} alt grup`}`;
  }, 150),
  comp('result', 'Geçerlilik / Sonuç', (r, p) => capResultText(r as CapabilityRow, p.settings), 230, { help: 'AS9145 Tablo 1: ≥1.33 ACCEPT; 1.00–1.33 CONDITIONAL; <1.00 REJECT (eşikler Ayarlar’da)' }),
  comp('reaction', 'Gerekli Tepki', (r, p) => requiredReactions(cap(r, p).band).join('; '), 220),
  comp('ppmExp', 'Beklenen PPM (overall)', (r, p) => { const a = cap(r, p); const v = a.variable?.ppmOverall ?? a.attribute?.ppm; return v == null ? '' : v < 1 ? Number(v.toFixed(3)) : Math.round(v); }, 90),
  comp('ppmWithin', 'Beklenen PPM (within)', (r, p) => { const v = cap(r, p).variable?.ppmWithin; return v == null ? '' : v < 1 ? Number(v.toFixed(3)) : Math.round(v); }, 90, { secondary: true }),
  comp('ppmObs', 'Gözlenen PPM', (r, p) => { const v = cap(r, p).variable?.ppmObserved; return v == null ? '' : Math.round(v); }, 80, { secondary: true }),
  comp('dpmo', 'DPMO', (r, p) => { const v = cap(r, p).attribute?.dpmo; return v == null ? '' : Math.round(v); }, 70, { secondary: true }),
  comp('zbench', 'Z.bench', (r, p) => fmt(cap(r, p).variable?.zBench ?? cap(r, p).attribute?.zEquivalent, 2), 66),
  comp('sigma', 'Sigma (~3×Cpk)', (r, p) => fmt(cap(r, p).variable?.sigmaLevel, 2), 70, { help: 'CAP p18: “Sigma Score ~ 3 x Cpk” – yaklaşık' }),
  comp('guide', 'Renk Kılavuzu (CAP p66)', (r, p) => {
    const a = cap(r, p).variable;
    if (!a) return '';
    const c = guidelineColor('Cp', a.cp), q = guidelineColor('Pp', a.pp);
    return c || q ? `Cp ${c || '—'} / Pp ${q || '—'} (kılavuz, kabul kriteri değil)` : '';
  }, 160, { secondary: true }),
  comp('oSug', 'O Önerisi', (r, p) => { const s = occurrenceFromCapability(p, r as CapabilityRow); return s.rank != null ? `${s.rank} – ${s.evidence}` : s.note; }, 160, { help: 'CAP p50: kararlı proseste capability Occurrence puanında kullanılabilir. Öneri; O mühendis tarafından değiştirilir' }),
  comp('msaState', 'Ölçüm Sistemi', (r, p) => msaBlocker(p, r as CapabilityRow), 160),
  sel('dataSource', 'Veri Kaynağı', ['Production run', 'Pre-launch', 'Prototype'], 120, { help: 'PPAP başlangıç capability: üretim koşusu parçaları (PPAP p26)' }),
  t('runRef', 'Koşu / Lot', 100, { secondary: true }),
  { key: 'dateFrom', label: 'Veri Başlangıç', width: 110, type: 'date', secondary: true },
  { key: 'dateTo', label: 'Veri Bitiş', width: 110, type: 'date', secondary: true },
  t('operators', 'Operatör(ler)', 100, { secondary: true, help: 'Temsil edici veri: tek operatör değil (CAP p19)' }),
  t('samplePlan', 'Örnekleme Planı', 140, { help: 'Örn. 5 parça / 2 saat, 25 alt grup' }),
  comp('prov', 'Kaynak Eksikleri', (r) => provenanceIssues(r as CapabilityRow).join('; '), 200, { secondary: true }),
  long('disposition', 'Karar (Disposition)', 180, { help: 'Koşullu bantta kabul kararı kuruluşa/müşteriye aittir; mühendis girer' }),
  t('containmentCpId', 'Containment KP', 90, { readonly: true, derived: 'Kontrol Planı' }),
  t('actionId', 'Aksiyon ID', 80, { readonly: true, derived: 'Aksiyonlar' }),
  t('customerIssueId', 'Müşteri Konusu', 90, { readonly: true, derived: 'Açık Konular' }),
  t('customerContactRef', 'Müşteri İletişim Ref.', 130, { secondary: true }),
  bool('customerAccepted', 'Müşteri Kabulü', 70, { secondary: true }),
  comp('reasons', 'Açıklama', (r, p) => { const a = cap(r, p); return (a.variable?.reasons ?? a.attribute?.reasons ?? []).join(' '); }, 260),
  long('notes', 'Notlar', 160),
];

export const CP_SPC_COLUMNS: Col[] = [
  sel('spcChart', 'SPC Kartı', ['I-MR', 'Xbar-R', 'Xbar-s', 'p', 'np', 'u', 'c', 'Target I-MR', 'Pre-control'], 100, { secondary: true, free: true, help: 'CAP p46 karar ağacı' }),
  num('spcSubgroup', 'SPC Alt Grup', 70, { secondary: true }),
  num('spcCenter', 'Merkez Çizgi', 80, { secondary: true }),
  num('spcUcl', 'UCL', 70, { secondary: true }),
  num('spcLcl', 'LCL', 70, { secondary: true }),
  { key: 'spcBaselineCapId', label: 'Baseline Capability', width: 100, type: 'ref', ref: 'capability', secondary: true },
  { key: 'spcLimitsFixedOn', label: 'Limit Sabitleme', width: 110, type: 'date', secondary: true, help: 'CAP p42: limitler baseline’da sabitlenir, yalnızca kalıcı iyileşmede güncellenir' },
  t('capId', 'Containment (CAP)', 90, { secondary: true, readonly: true, derived: 'Capability' }),
];
