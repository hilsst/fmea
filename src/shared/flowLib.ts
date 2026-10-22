// 4.4.0: Malzeme / imalat türüne göre proses akışı şablonları ve adım bazlı PFD girdi/çıktı + parametre kütüphanesi.
// Şablonlar ENGINEERING KNOWLEDGE önerisidir: adım adları ve parametre ADLARI verir, sayısal limit vermez
// (limitler proses spesifikasyonundan girilir; yoksa VERİ YOK). Mühendis gerçek akışa göre düzenler ve onaylar.
import { pfmeaAreaOf, type MaterialFamily } from './failureLib';
import type { Cause4M, PfdStepType, ProcessStepRow } from './types';

export const FLOW_SOURCE = 'Akış şablonu – ENGINEERING SUGGESTION – VERIFY';

export interface FlowStep {
  name: string;
  description: string;
  specialProcess?: boolean;
  stepType: PfdStepType[];
}

export interface FlowTemplate {
  key: string;
  label: string;
  hint: string;
  steps: FlowStep[];
}

const op = (name: string, description: string, specialProcess = false): FlowStep => ({ name, description, specialProcess, stepType: ['Operation'] });
const insp = (name: string, description: string, specialProcess = false): FlowStep => ({ name, description, specialProcess, stepType: ['Inspect/Test'] });

/** Her akışın başı ve sonu (birden çok şablon seçildiğinde bir kez eklenir). */
export const FLOW_HEAD: FlowStep[] = [
  insp('Malzeme kabul', 'Malzeme sertifikası, lot ve miktar kontrolü'),
  { name: 'Depolama', description: 'Malzemenin koşullarına uygun depolanması', stepType: ['Store'] },
];
export const FLOW_TAIL: FlowStep[] = [
  insp('Son kontrol', 'Son muayene, doküman ve izlenebilirlik kontrolü'),
  op('Ambalaj ve sevkiyat', 'Ambalajlama, etiketleme ve sevkiyat'),
];

/** Seçim sırası akış sırasıdır: önce parça imalatı, sonra ısıl / yüzey işlemler, en son montaj. */
export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'composite',
    label: 'Kompozit imalat akışı',
    hint: 'Prepreg serim, torbalama, kür, kalıptan çıkarma, kenar kesme, NDT',
    steps: [
      op('Malzeme hazırlama (çözdürme)', 'Prepreg çözdürme, out-time takibi'),
      op('Ply kesimi', 'Ply kesimi (CNC kesim / şablon)'),
      op('Ply kitleme', 'Ply kitleme ve etiketleme'),
      op('Serim (lay-up)', 'Kalıba serim, oryantasyon ve sıra'),
      op('Ara vakumlama (debulk)', 'Ara vakumlama'),
      op('Vakum torbalama', 'Torbalama ve sızdırmazlık testi'),
      op('Kür (otoklav / fırın)', 'Onaylı kür çevrimi', true),
      op('Kalıptan çıkarma', 'Parçanın kalıptan hasarsız çıkarılması'),
      op('Kenar kesme ve delme', 'Kenar trim ve delik delme'),
      insp('NDT muayenesi', 'Tahribatsız muayene (UT / tap test, spesifikasyona göre)', true),
    ],
  },
  {
    key: 'machining',
    label: 'Talaşlı imalat akışı',
    hint: 'Hammadde kesme, CNC tornalama / frezeleme, delik, çapak alma, boyutsal kontrol',
    steps: [
      op('Hammadde kesme (testere)', 'Çubuk / plaka hammaddenin boyuna kesilmesi'),
      op('CNC tornalama', 'Tornalama operasyonu'),
      op('CNC frezeleme', 'Frezeleme operasyonu'),
      op('Delik delme / raybalama', 'Delik delme, raybalama, diş açma'),
      op('Çapak alma', 'Çapak alma ve kenar kırma'),
      op('Temizleme', 'Kesme sıvısı ve talaş temizliği'),
      insp('Boyutsal kontrol', 'CMM / mastar ile ölçüm'),
    ],
  },
  {
    key: 'sheet',
    label: 'Sac metal şekillendirme akışı',
    hint: 'Sac kesme, büküm / şekillendirme, çapak alma, boyutsal kontrol',
    steps: [
      op('Sac kesme (lazer / punch)', 'Sac açınımın kesilmesi'),
      op('Büküm / şekillendirme', 'Abkant / pres ile büküm'),
      op('Çapak alma (sac)', 'Kesme kenarı çapak alma'),
      insp('Boyutsal kontrol (sac)', 'Açı / profil ve ölçü kontrolü'),
    ],
  },
  {
    key: 'welding',
    label: 'Kaynaklı imalat akışı',
    hint: 'Kaynak ağzı hazırlama, temizlik, puntalama, kaynak, kaynak muayenesi, doğrultma',
    steps: [
      op('Kaynak ağzı hazırlama', 'Kaynak ağzı açma ve alıştırma'),
      op('Kaynak öncesi temizlik', 'Yağ, oksit ve kirlerin temizlenmesi'),
      op('Fikstürde puntalama', 'Parçaların fikstürde konumlandırılması ve puntalanması'),
      op('Kaynak', 'Onaylı WPS’e göre kaynak', true),
      insp('Kaynak muayenesi (görsel / NDT)', 'Görsel muayene ve gerekiyorsa tahribatsız muayene', true),
      op('Doğrultma / çarpılma düzeltme', 'Kaynak sonrası çarpılmanın giderilmesi'),
    ],
  },
  {
    key: 'heat',
    label: 'Isıl işlem akışı',
    hint: 'Isıl işlem ve sertlik / özellik kontrolü',
    steps: [op('Isıl işlem', 'Onaylı fırın reçetesiyle ısıl işlem', true), insp('Sertlik kontrolü', 'Sertlik / test kuponu kontrolü')],
  },
  {
    key: 'surface',
    label: 'Yüzey işlem / boya akışı',
    hint: 'Yüzey hazırlığı, kimyasal yüzey işlem, astar ve boya, kaplama kontrolü',
    steps: [
      op('Yüzey hazırlığı', 'Zımparalama / kumlama / temizlik', true),
      op('Kimyasal yüzey işlem (anodize / pasivasyon)', 'Spesifikasyona göre kimyasal yüzey işlem', true),
      op('Astar ve boya', 'Astar ve son kat boya uygulaması', true),
      insp('Boya kontrolü', 'Kuru film kalınlığı ve yapışma kontrolü'),
    ],
  },
  {
    key: 'assembly',
    label: 'Montaj akışı',
    hint: 'Parça hazırlığı, montaj (bağlantı elemanı / tork), sızdırmazlık, montaj kontrolü',
    steps: [
      op('Montaj öncesi parça hazırlığı', 'Montaj parçalarının ve bağlantı elemanlarının hazırlanması'),
      op('Montaj (bağlantı elemanı / tork)', 'Bağlantı elemanlarıyla montaj ve torklama'),
      op('Sızdırmazlık (sealant) uygulama', 'Sealant uygulaması (gerekiyorsa)'),
      insp('Montaj kontrolü', 'Montaj, tork işareti ve eksik parça kontrolü'),
    ],
  },
];

export const MATERIALS = [
  'Metal – alüminyum',
  'Metal – çelik / paslanmaz',
  'Metal – titanyum',
  'Kompozit – prepreg (karbon / cam)',
  'Kompozit – ıslak serim / infüzyon',
  'Sandviç (kompozit + core)',
  'Karma (metal + kompozit)',
  'Diğer',
] as const;

/** Malzeme ve ürün tipinden önerilen şablonlar (yalnızca ön seçim; kullanıcı değiştirir). */
export function suggestFlowTemplates(material: string, productType: string): string[] {
  const m = `${material} ${productType}`.toLocaleLowerCase('tr');
  const out = new Set<string>();
  if (/kompozit|composite|sandviç|sandwich|radom|radome|bonded/.test(m)) out.add('composite');
  if (/metal|alüminyum|çelik|titanyum|metallic/.test(m)) out.add('machining');
  if (/karma/.test(m)) out.add('assembly');
  if (/assembly|montaj/.test(m)) out.add('assembly');
  return FLOW_TEMPLATES.map((t) => t.key).filter((k) => out.has(k));
}

export interface PlannedStep extends FlowStep {
  opNo: string;
  template: string;
}

const key = (s: string) => s.toLocaleLowerCase('tr').trim();

/**
 * Seçilen şablonlardan sıralı akış. Mevcut adımlarla aynı adlı adımlar atlanır (mevcut akış silinmez);
 * operasyon numaraları mevcut en büyük numaradan 10'ar artar.
 */
export function planFlow(keys: string[], existing: Pick<ProcessStepRow, 'name' | 'opNo'>[]): PlannedStep[] {
  const chosen = FLOW_TEMPLATES.filter((t) => keys.includes(t.key));
  if (!chosen.length) return [];
  const have = new Set(existing.map((s) => key(s.name)));
  let n = Math.max(0, ...existing.map((s) => Number.parseInt(s.opNo, 10)).filter((x) => Number.isFinite(x)));
  const out: PlannedStep[] = [];
  const push = (st: FlowStep, template: string) => {
    if (have.has(key(st.name))) return;
    have.add(key(st.name));
    n = Math.floor(n / 10) * 10 + 10;
    out.push({ ...st, opNo: String(n), template });
  };
  for (const st of FLOW_HEAD) push(st, 'Ortak');
  for (const t of chosen) for (const st of t.steps) push(st, t.label);
  for (const st of FLOW_TAIL) push(st, 'Ortak');
  return out;
}

// ───────────────────────── Adım → PFD girdi / çıktı + proses parametresi adları ─────────────────────────

export interface StepIo {
  outputs: string[];
  inputs: [string, Cause4M][];
  params: string[];
}

const ENV: [string, Cause4M] = ['Ortam koşulları (sıcaklık / nem / temizlik)', 'Environment'];
const WI: [string, Cause4M] = ['İş talimatı / onaylı prosedür', 'Method'];
const OPR: [string, Cause4M] = ['Yetkin / sertifikalı operatör', 'Man'];

/** Alan bazlı kütüphane. Çıktı = adımın ürettiği ürün/proses karakteristiği (→ PFMEA hata modu); girdi = değişkenlik kaynağı (→ neden). */
export const STEP_IO: Record<string, StepIo> = {
  Material: { outputs: ['Kabul edilmiş, tanımlı ve uygun koşulda depolanan malzeme'], inputs: [['Malzeme sertifikası / lot bilgisi', 'Material'], ['Depolama ekipmanı (dondurucu / raf)', 'Machine'], WI, ENV], params: [] },
  'Lay-up': { outputs: ['Doğru ply sayısı, sırası ve oryantasyonunda laminat'], inputs: [['Ply kiti / prepreg', 'Material'], ['Kalıp ve serim şablonu / lazer projeksiyon', 'Machine'], WI, OPR, ENV], params: ['Ortam sıcaklığı', 'Ortam nemi'] },
  'Vacuum Bagging': { outputs: ['Sızdırmaz vakum torbası'], inputs: [['Torbalama sarf malzemeleri', 'Material'], ['Vakum pompası / vakum ölçer', 'Machine'], WI, OPR], params: ['Vakum seviyesi', 'Sızdırmazlık testi düşüşü'] },
  Cure: { outputs: ['Tam kürlenmiş parça (kür derecesi, porozite, mekanik özellik)'], inputs: [['Otoklav / fırın ve kontrol sistemi', 'Machine'], ['Termokupllar', 'Measurement'], ['Kür reçetesi', 'Method'], ['Torbalanmış parça', 'Material']], params: ['Kür sıcaklığı', 'Isıtma hızı', 'Bekleme süresi', 'Soğutma hızı', 'Otoklav basıncı', 'Torba vakumu'] },
  Bonding: { outputs: ['Tanımlı bondline kalınlığında yapışmış birleşim'], inputs: [['Yapıştırıcı (lot / pot life)', 'Material'], ['Karışım / dozaj ekipmanı, fikstür', 'Machine'], WI, OPR, ENV], params: ['Karışım oranı', 'Pot life', 'Kür sıcaklığı', 'Kür süresi', 'Basınç'] },
  Demolding: { outputs: ['Hasarsız kalıptan çıkmış parça'], inputs: [['Çıkarma takımları', 'Machine'], WI, OPR], params: [] },
  Machining: { outputs: ['Çizime uygun kenar ve delikler (delaminasyonsuz)'], inputs: [['CNC tezgâh / matkap ünitesi', 'Machine'], ['Kesici takım', 'Machine'], ['Fikstür / backing plate', 'Machine'], ['CNC programı', 'Method'], OPR], params: ['Devir', 'İlerleme', 'Takım ömrü'] },
  'Metal Machining': { outputs: ['Çizim ölçü, tolerans ve yüzey pürüzlülüğüne uygun parça'], inputs: [['Hammadde (malzeme / temper)', 'Material'], ['CNC tezgâh', 'Machine'], ['Kesici takım', 'Machine'], ['Fikstür / bağlama', 'Machine'], ['CNC programı / kesme parametreleri', 'Method'], ['Ölçüm aleti', 'Measurement'], OPR], params: ['Devir', 'İlerleme', 'Kesme derinliği', 'Takım ömrü'] },
  Welding: { outputs: ['WPS’e uygun, hatasız kaynak dikişi (nüfuziyet, ölçü)'], inputs: [['Ana malzeme ve kaynak teli / elektrot', 'Material'], ['Koruyucu gaz', 'Material'], ['Kaynak makinesi', 'Machine'], ['Kaynak fikstürü', 'Machine'], ['WPS / kaynak sırası', 'Method'], ['Sertifikalı kaynakçı', 'Man'], ENV], params: ['Kaynak akımı', 'Kaynak gerilimi', 'Kaynak hızı', 'Gaz debisi', 'Ön ısıtma sıcaklığı', 'Pasolar arası sıcaklık'] },
  Forming: { outputs: ['Çizime uygun büküm açısı ve profil'], inputs: [['Sac malzeme (kalınlık / temper)', 'Material'], ['Abkant / pres ve kalıp', 'Machine'], ['Büküm programı', 'Method'], OPR], params: ['Büküm açısı', 'Büküm yarıçapı', 'Pres kuvveti'] },
  'Heat Treatment': { outputs: ['Spesifikasyona uygun sertlik / mekanik özellik'], inputs: [['Fırın ve kontrol sistemi', 'Machine'], ['Termokupllar', 'Measurement'], ['Fırın reçetesi', 'Method'], ['Yükleme fikstürü', 'Machine']], params: ['Fırın sıcaklığı', 'Bekleme süresi', 'Soğutma hızı / ortamı', 'Atmosfer'] },
  Painting: { outputs: ['Spesifikasyon kalınlığında ve yapışmasında kaplama'], inputs: [['Boya / astar (lot, karışım)', 'Material'], ['Boya tabancası / kabin', 'Machine'], WI, OPR, ENV], params: ['Ortam sıcaklığı', 'Ortam nemi', 'Kat kalınlığı', 'Kür süresi'] },
  'Surface Treatment': { outputs: ['Sonraki işleme hazır, temiz ve aktif yüzey'], inputs: [['Zımpara / kumlama / kimyasal banyo', 'Material'], ['Yüzey işlem ekipmanı', 'Machine'], WI, OPR, ENV], params: ['Hazırlık – sonraki işlem arası süre'] },
  NDT: { outputs: ['Kabul kriterine göre değerlendirilmiş parça (iç hata tespiti)'], inputs: [['NDT ekipmanı ve referans standart', 'Measurement'], ['Seviye 2/3 NDT personeli', 'Man'], ['NDT tekniği / tarama planı', 'Method']], params: [] },
  Inspection: { outputs: ['Doğrulanmış ürün karakteristikleri; uygunsuz ürün ayrılmış'], inputs: [['Ölçüm sistemi (CMM / mastar)', 'Measurement'], ['Muayene planı / çizim', 'Method'], OPR], params: [] },
  Assembly: { outputs: ['Doğru parça ve torkla tamamlanmış montaj'], inputs: [['Montaj parçaları ve bağlantı elemanları', 'Material'], ['Tork aleti / montaj fikstürü', 'Machine'], WI, OPR], params: ['Tork değeri'] },
  Packaging: { outputs: ['Hasarsız, etiketli ve izlenebilir ambalaj'], inputs: [['Ambalaj malzemesi', 'Material'], WI, OPR], params: [] },
  // 4.5.0
  Deburring: { outputs: ['Çapaksız, kabul kriterine uygun kenar'], inputs: [['Çapak alma aleti / tezgâhı', 'Machine'], ['Kenar kabul kriteri / referans numune', 'Method'], OPR], params: [] },
  Cutting: { outputs: ['Çizim konturuna uygun, çapaksız kenarlı açınım'], inputs: [['Levha (alaşım / temper / kalınlık)', 'Material'], ['Lazer / plazma / su jeti tezgâhı', 'Machine'], ['Kesim programı (nesting)', 'Method'], OPR], params: ['Güç', 'Kesme hızı', 'Gaz basıncı'] },
  'Metal Finishing': { outputs: ['Spesifikasyon kalınlığında, yapışan ve lekesiz kaplama'], inputs: [['Kaplama banyosu (konsantrasyon / sıcaklık)', 'Material'], ['Doğrultucu / askı', 'Machine'], ['Onaylı proses kartı', 'Method'], ['Kaplama kalınlık ölçer', 'Measurement'], OPR], params: ['Banyo süresi', 'Akım yoğunluğu', 'Banyo sıcaklığı'] },
};

/** Proses adımı için kütüphane girdi/çıktı + parametre adları; tanınmayan adım için undefined. */
export function stepIo(step: Pick<ProcessStepRow, 'name' | 'description'>, family: MaterialFamily = ''): { area: string; io: StepIo } | undefined {
  const area = pfmeaAreaOf(`${step.name} ${step.description ?? ''}`, family);
  const io = STEP_IO[area];
  return io ? { area, io } : undefined;
}
