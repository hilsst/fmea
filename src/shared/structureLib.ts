// 4.10.0: Yapı & Fonksiyon kütüphanesi (ENGINEERING KNOWLEDGE) – AI gerekmez.
// Ürün tipine göre tipik yapı ağacı (ürün → parça → özellik) ve her elemanın fonksiyonları önerilir.
// Sayısal değer içermez: performans gereksinimi boş gelir, bağlanan gereksinimin kabul kriterinden dolar.
// Tüm satırlar "AI Proposed" eklenir; mühendis ürününe uymayan elemanı seçmez / siler, adları düzenler.
import { Gen, type GenEdit } from './autogen';
import type { MaterialFamily } from './failureLib';
import { NO_DATA } from './reqAutofill';
import type { AnyRow, Project, StructureLevel, StructureRow } from './types';

export const STRUCTURE_SOURCE = 'Yapı kütüphanesi – ENGINEERING SUGGESTION – VERIFY';

export interface LibFunction {
  text: string;
  /** LISTS.functionType değerlerinden biri. */
  type: string;
  constraint?: string;
  iface?: string;
}

export interface LibElement {
  key: string;
  name: string;
  level: StructureLevel;
  /** Üst elemanın key'i; boşsa kök ürün. */
  parent?: string;
  fns: LibFunction[];
  /** Gereksinim metninde / karakteristiğinde aranır; eşleşen bağlanmamış gereksinim bu elemana bağlanır. */
  match?: RegExp;
  /** Her üründe bulunmayan eleman: seçim penceresinde işaretsiz gelir. */
  optional?: boolean;
}

export interface StructureTemplate {
  key: string;
  label: string;
  group: 'Kompozit' | 'Metal' | 'Montaj';
  family: MaterialFamily;
  hint: string;
  rootLevel: StructureLevel;
  /** Kök ürünün fonksiyonları (ürün seviyesi). */
  rootFns: LibFunction[];
  elements: LibElement[];
}

const F = (text: string, type: string, extra: Partial<LibFunction> = {}): LibFunction => ({ text, type, ...extra });

// Sık kullanılan ortak elemanlar
const HOLES = (parent: string, optional = false): LibElement => ({
  key: 'holes', name: 'Bağlantı delikleri', level: 'Feature', parent, optional,
  fns: [
    F('Bağlantı elemanlarını tanımlı konumda ve geçmede konumlar', 'Geometrik uyum', { iface: 'Karşı parça delik düzeni, bağlantı elemanı' }),
    F('Bağlantı yükünü (yataklama / kesme) gövdeye aktarır', 'Yük aktarma'),
  ],
  match: /delik|havşa|hole|kenar mesafesi|hatve/i,
});
const COATING = (parent: string, name = 'Yüzey koruma (astar / boya)'): LibElement => ({
  key: 'coating', name, level: 'Feature', parent,
  fns: [F('Alt malzemeyi servis ortamına (nem, UV, akışkan, korozyon) karşı korur', 'Yüzey koruması'), F('Görünüm ve renk gereksinimini sağlar', 'Diğer')],
  match: /boya|astar|kaplama|anodi[zs]|alodin|kromat|pasivasyon|korozyon|renk|görünüm|primer/i,
});
const MARKING = (parent: string): LibElement => ({
  key: 'marking', name: 'İşaretleme / tanımlama', level: 'Feature', parent, optional: true,
  fns: [F('Parça numarası, revizyon ve seri / lot bilgisini servis ömrü boyunca okunur şekilde taşır', 'Diğer')],
  match: /işaretle|markala|etiket|seri no|izlenebilir|tanımlama/i,
});
const SEALING = (parent: string, optional = false): LibElement => ({
  key: 'seal', name: 'Sızdırmazlık elemanı (conta / sealant)', level: 'Component', parent, optional,
  fns: [F('Arayüzden akışkan / nem / basınç geçişini engeller', 'Sızdırmazlık', { iface: 'Sızdırmazlık yüzeyleri' })],
  match: /sızdır|conta|o-?ring|sealant|kaçak|basınç testi|su geçir/i,
});
const LIGHTNING = (parent: string): LibElement => ({
  key: 'lightning', name: 'Yıldırım koruma / iletken katman', level: 'Feature', parent, optional: true,
  fns: [F('Yıldırım akımını yapıya zarar vermeden topraklama yoluna iletir', 'Diğer', { iface: 'Topraklama / bonding noktaları' })],
  match: /yıldırım|lightning|iletken|bonding|topraklama|statik/i,
});

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
  // ───────────── Kompozit ─────────────
  {
    key: 'laminate', label: 'Monolitik kompozit laminat parça', group: 'Kompozit', family: 'composite', rootLevel: 'Product',
    hint: 'Kabuk, panel, kaporta, kapak: tek laminat, kenar kesimi, bağlantı delikleri ve yüzey koruma.',
    rootFns: [F('Tanımlı yükleri taşır ve bağlantı noktalarına aktarır', 'Yük aktarma'), F('Dış geometriyi / arayüz konturunu sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'lam', name: 'Kompozit laminat', level: 'Part', fns: [F('Düzlem içi ve eğilme yüklerini taşır', 'Yük aktarma'), F('Tanımlı kalınlık ve kontur geometrisini sağlar', 'Geometrik uyum'), F('Servis sıcaklığı ve nem altında mekanik özelliklerini korur', 'Termal dayanım')], match: /laminat|ply|katman|dizilim|oryantasyon|kalınlık|elyaf|reçine|prepreg|porozite|delaminasyon|tg\b|cam geçiş/i },
      { key: 'drop', name: 'Takviye bölgesi (ply drop-off)', level: 'Feature', parent: 'lam', optional: true, fns: [F('Yerel yükleri taşımak için kalınlığı kademeli artırır', 'Yük aktarma')], match: /takviye|doubler|drop-?off|kalınlık geçiş/i },
      { key: 'edge', name: 'Kenar / trim konturu', level: 'Feature', parent: 'lam', fns: [F('Komşu parçalarla arayüz boşluğunu ve konturu sağlar', 'Geometrik uyum', { iface: 'Komşu parça / panel' }), F('Kesilmiş kenardan nem girişini engeller', 'Çevresel dayanım')], match: /kenar|trim|kontur|çevre|boşluk|basamak/i },
      HOLES('lam'),
      COATING('lam'),
      LIGHTNING('lam'),
      MARKING('lam'),
    ],
  },
  {
    key: 'sandwich', label: 'Sandviç panel', group: 'Kompozit', family: 'composite', rootLevel: 'Product',
    hint: 'Yüzey laminatları, çekirdek (bal peteği / köpük), yüzey–çekirdek yapıştırma, kenar kapama, insert.',
    rootFns: [F('Eğilme yüklerini düşük ağırlıkla taşır', 'Yük aktarma'), F('Tanımlı düzlemsellik ve kalınlığı sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'skin', name: 'Yüzey laminatı (üst / alt)', level: 'Part', fns: [F('Eğilmeden doğan çekme / basma yüklerini taşır', 'Yük aktarma'), F('Dış yüzey kalitesini ve konturu sağlar', 'Geometrik uyum')], match: /laminat|yüzey levha|skin|ply|katman|dizilim|elyaf|prepreg/i },
      { key: 'core', name: 'Çekirdek (bal peteği / köpük)', level: 'Part', fns: [F('Yüzey laminatlarını ayrık tutar ve kayma yükünü taşır', 'Yük aktarma'), F('Yerel basma yüklerine karşı yüzeyi destekler', 'Yük aktarma')], match: /çekirdek|bal peteği|honeycomb|köpük|core|hücre/i },
      { key: 'bond', name: 'Yüzey–çekirdek yapıştırma hattı', level: 'Feature', parent: 'core', fns: [F('Yüzey laminatı ile çekirdek arasında yük aktarır', 'Bağlantı', { iface: 'Yüzey laminatı ↔ çekirdek' })], match: /yapıştır|film|adhesive|bond|ayrılma|soyulma/i },
      { key: 'close', name: 'Kenar kapama (close-out / dolgu)', level: 'Feature', parent: 'core', fns: [F('Çekirdeği nem ve sıvı girişine karşı kapatır', 'Sızdırmazlık'), F('Panel kenarında yük aktarımı ve kontur sağlar', 'Geometrik uyum')], match: /kenar|kapama|close-?out|nem girişi|trim|kontur/i },
      { key: 'insert', name: 'Insert / gömme bağlantı', level: 'Component', parent: 'core', fns: [F('Bağlantı yükünü panele yayarak aktarır', 'Bağlantı', { iface: 'Bağlanan ekipman / komşu yapı' }), F('Bağlantı elemanını tanımlı konumda konumlar', 'Geometrik uyum')], match: /insert|gömme|potting|bağlantı noktası|çekme dayanımı|pull-?out/i },
      COATING('skin'),
      LIGHTNING('skin'),
      MARKING('skin'),
    ],
  },
  {
    key: 'radome', label: 'Radom', group: 'Kompozit', family: 'composite', rootLevel: 'Product',
    hint: 'EM pencere duvarı, taban flanşı, bağlantı delikleri, erozyon / boya sistemi, yıldırım yönlendirici, sızdırmazlık.',
    rootFns: [
      F('Anteni çevresel etkilerden (yağmur, erozyon, kuş / dolu, sıcaklık) korur', 'Çevresel dayanım'),
      F('Elektromanyetik sinyali tanımlı kayıp ve bozulma sınırları içinde geçirir', 'Elektromanyetik performans', { iface: 'Anten / radar' }),
      F('Aerodinamik dış konturu sağlar', 'Aerodinamik / akış performansı'),
    ],
    elements: [
      { key: 'wall', name: 'Radom duvarı (EM pencere)', level: 'Part', fns: [F('Çalışma frekans bandında elektromanyetik geçirgenliği sağlar', 'Elektromanyetik performans'), F('Aerodinamik ve atalet yüklerini taban flanşına aktarır', 'Yük aktarma'), F('Tanımlı duvar kalınlığını ve dış konturu sağlar', 'Geometrik uyum')], match: /iletim|geçirgen|transmission|dielektrik|frekans|kayıp|boresight|yansıma|duvar|kalınlık|laminat|ply|katman|elyaf|prepreg/i },
      { key: 'core', name: 'Çekirdek (bal peteği / köpük)', level: 'Part', optional: true, fns: [F('Duvar katmanlarını EM tasarım aralığında ayrık tutar ve kayma yükünü taşır', 'Yük aktarma')], match: /çekirdek|bal peteği|honeycomb|köpük|core/i },
      { key: 'flange', name: 'Taban bağlantı flanşı', level: 'Feature', parent: 'wall', fns: [F('Radomu gövdeye bağlar ve yükleri gövdeye aktarır', 'Bağlantı', { iface: 'Gövde / taşıyıcı yapı arayüzü' }), F('Arayüz düzlemselliğini ve konumunu sağlar', 'Geometrik uyum')], match: /flanş|taban|arayüz|montaj yüzeyi|düzlemsel/i },
      HOLES('wall'),
      { key: 'coating', name: 'Dış kaplama (erozyon koruma / boya)', level: 'Feature', parent: 'wall', fns: [F('Dış yüzeyi yağmur erozyonu, UV ve neme karşı korur', 'Yüzey koruması'), F('Statik yükü boşaltır (antistatik kaplama)', 'Diğer', { constraint: 'EM geçirgenliği bozmamalı' })], match: /boya|kaplama|erozyon|uv|antistatik|statik|renk|primer/i },
      { key: 'lightning', name: 'Yıldırım yönlendirici şerit (diverter)', level: 'Component', parent: 'wall', optional: true, fns: [F('Yıldırım akımını duvarı delmeden gövdeye yönlendirir', 'Diğer', { iface: 'Gövde topraklama yolu', constraint: 'EM performansa etkisi sınırlı olmalı' })], match: /yıldırım|lightning|diverter/i },
      SEALING('wall'),
      MARKING('wall'),
    ],
  },
  {
    key: 'bonded', label: 'Yapıştırmalı montaj', group: 'Kompozit', family: 'composite', rootLevel: 'Assembly',
    hint: 'Yapışan parçalar, yapıştırma yüzeyi, yapıştırma hattı, fillet / sızdırmazlık, konumlama.',
    rootFns: [F('Parçaları yapıştırma ile birleştirerek yükü aktarır', 'Yük aktarma'), F('Montajın arayüz geometrisini sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'adh', name: 'Yapışan parçalar (alt montaj elemanları)', level: 'Part', fns: [F('Yükü yapıştırma hattına taşır', 'Yük aktarma'), F('Yapıştırma için tanımlı yüzey ve geometriyi sağlar', 'Geometrik uyum')], match: /parça|laminat|profil|takviye|stringer|kiriş/i },
      { key: 'bond', name: 'Yapıştırma hattı', level: 'Feature', parent: 'adh', fns: [F('Parçalar arasında kayma ve soyulma yükünü aktarır', 'Bağlantı', { iface: 'Yapışan parça ↔ yapışan parça' }), F('Tanımlı bondline kalınlığını sağlar', 'Geometrik uyum'), F('Servis ortamında yapışma dayanımını korur', 'Çevresel dayanım')], match: /yapıştır|bondline|adhesive|film|macun|soyulma|kayma dayanımı|bindirme/i },
      { key: 'fillet', name: 'Fillet ve kenar sızdırmazlığı (sealant)', level: 'Feature', parent: 'bond', optional: true, fns: [F('Yapıştırma hattı kenarını nem girişine karşı kapatır', 'Sızdırmazlık')], match: /fillet|sızdır|sealant|nem/i },
      { key: 'loc', name: 'Konumlama özellikleri (pim / referans)', level: 'Feature', parent: 'adh', optional: true, fns: [F('Parçaları yapıştırma sırasında tanımlı konumda tutar', 'Geometrik uyum')], match: /konum|pim|referans|datum|hizala/i },
      MARKING('adh'),
    ],
  },
  {
    key: 'wound', label: 'Filament sargılı tüp / basınçlı gövde', group: 'Kompozit', family: 'composite', rootLevel: 'Product',
    hint: 'Sargı laminatı, liner, uç bağlantı (boss), dış koruma.',
    rootFns: [F('İç basıncı / eksenel yükü taşır', 'Yük aktarma'), F('Akışkanı sızdırmadan tutar', 'Sızdırmazlık')],
    elements: [
      { key: 'wind', name: 'Sargı laminatı', level: 'Part', fns: [F('Çevresel ve eksenel yükü tanımlı sarım açılarıyla taşır', 'Yük aktarma'), F('Tanımlı çap ve et kalınlığını sağlar', 'Geometrik uyum')], match: /sarım|sargı|elyaf|açı|patlatma|basınç|et kalınlığı|çap/i },
      { key: 'liner', name: 'Liner (iç astar)', level: 'Part', optional: true, fns: [F('Akışkan geçirgenliğini engeller', 'Sızdırmazlık')], match: /liner|geçirgen|sızdır|kaçak/i },
      { key: 'boss', name: 'Uç bağlantı (boss)', level: 'Component', fns: [F('Dış bağlantıya arayüz sağlar ve yükü sargıya aktarır', 'Bağlantı', { iface: 'Vana / boru / flanş' })], match: /boss|uç bağlantı|fitting|diş|bağlantı ağzı/i },
      COATING('wind', 'Dış yüzey koruma (boya / jelkot)'),
      MARKING('wind'),
    ],
  },
  // ───────────── Metal ─────────────
  {
    key: 'machined', label: 'Talaşlı imalat parça (braket / fitting)', group: 'Metal', family: 'metal', rootLevel: 'Product',
    hint: 'Gövde, bağlantı delikleri, oturma yüzeyi, radyüs geçişleri, diş, yüzey koruma.',
    rootFns: [F('Bağlanan elemanı taşır ve yükünü ana yapıya aktarır', 'Yük aktarma'), F('Bağlanan elemanı tanımlı konumda tutar', 'Geometrik uyum')],
    elements: [
      { key: 'body', name: 'Gövde', level: 'Part', fns: [F('Statik ve yorulma yüklerini taşır', 'Yük aktarma'), F('Gerekli rijitliği sağlar (sehim / doğal frekans)', 'Titreşim dayanımı'), F('Genel ölçü ve geometriyi sağlar', 'Geometrik uyum')], match: /malzeme|alaşım|temper|sertlik|dayanım|akma|çekme|ağırlık|kütle|rijit|titreşim|genel tolerans|boy|genişlik|kalınlık|yükseklik/i },
      HOLES('body'),
      { key: 'seat', name: 'Montaj / oturma yüzeyi', level: 'Feature', parent: 'body', fns: [F('Karşı parçaya düzgün oturur ve yükü yüzeyden aktarır', 'Bağlantı', { iface: 'Ana yapı / karşı parça' }), F('Tanımlı düzlemsellik ve yüzey pürüzlülüğünü sağlar', 'Geometrik uyum')], match: /yüzey|düzlemsel|pürüzlülük|\bra\b|oturma|paralel|diklik/i },
      { key: 'rad', name: 'Radyüs / geçiş bölgeleri', level: 'Feature', parent: 'body', fns: [F('Kesit geçişlerinde gerilme yığılmasını sınırlar', 'Yük aktarma')], match: /radyüs|radius|köşe|pah|keskin kenar|çapak/i },
      { key: 'thr', name: 'Dişli delik (diş / helicoil)', level: 'Feature', parent: 'body', optional: true, fns: [F('Bağlantı elemanına ön yükü taşıyan diş kavraması sağlar', 'Bağlantı')], match: /diş|helicoil|vida|metrik|unf|unc/i },
      COATING('body', 'Yüzey koruma (anodize / kaplama / boya)'),
      MARKING('body'),
    ],
  },
  {
    key: 'sheet', label: 'Sac metal parça', group: 'Metal', family: 'metal', rootLevel: 'Product',
    hint: 'Sac gövde, büküm bölgeleri, delik ve kesim konturu, flanş, yüzey koruma.',
    rootFns: [F('Bağlanan elemanı taşır / kapatır ve yükünü aktarır', 'Yük aktarma'), F('Tanımlı açınım ve büküm geometrisini sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'body', name: 'Sac gövde', level: 'Part', fns: [F('Yükleri ve titreşimi kalıcı deformasyon olmadan taşır', 'Yük aktarma'), F('Tanımlı kalınlık ve kontur ölçülerini sağlar', 'Geometrik uyum')], match: /sac|levha|malzeme|alaşım|temper|kalınlık|kontur|açınım|ağırlık/i },
      { key: 'bend', name: 'Büküm bölgeleri', level: 'Feature', parent: 'body', fns: [F('Tanımlı büküm açısı ve iç yarıçapı ile profili oluşturur', 'Geometrik uyum'), F('Büküm hattında çatlak olmadan yük taşır', 'Yük aktarma')], match: /büküm|bükme|açı|iç yarıçap|hadde yönü/i },
      HOLES('body'),
      { key: 'flange', name: 'Flanş / montaj yüzeyi', level: 'Feature', parent: 'body', fns: [F('Karşı parçaya oturur ve bağlantı yükünü aktarır', 'Bağlantı', { iface: 'Karşı parça' })], match: /flanş|oturma|montaj yüzeyi|düzlemsel/i },
      { key: 'nut', name: 'Perçin somunu / sıkma bağlantı elemanı', level: 'Component', parent: 'body', optional: true, fns: [F('İnce sacda dişli bağlantı noktası sağlar', 'Bağlantı')], match: /perçin somun|sıkma somun|pem|clinch/i },
      COATING('body', 'Yüzey koruma (kaplama / boya)'),
      MARKING('body'),
    ],
  },
  {
    key: 'weldment', label: 'Kaynaklı konstrüksiyon', group: 'Metal', family: 'metal', rootLevel: 'Assembly',
    hint: 'Ana gövde elemanları, kaynak dikişleri, bağlantı plakası, yüzey koruma.',
    rootFns: [F('Yükleri taşır ve mesnet / bağlantı noktalarına aktarır', 'Yük aktarma'), F('Bağlantı noktalarının karşılıklı konumunu sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'body', name: 'Ana gövde elemanları (profil / plaka)', level: 'Part', fns: [F('Statik ve yorulma yüklerini taşır', 'Yük aktarma'), F('Gerekli rijitliği sağlar', 'Titreşim dayanımı')], match: /profil|plaka|malzeme|çelik|alaşım|sehim|rijit|dayanım|ağırlık/i },
      { key: 'weld', name: 'Kaynak dikişleri', level: 'Feature', parent: 'body', fns: [F('Elemanlar arasında yükü sürekli dikişle aktarır', 'Bağlantı'), F('Yorulma yükü altında çatlak başlatmadan çalışır', 'Yük aktarma')], match: /kaynak|dikiş|wps|nüfuziyet|weld|ndt|penetrant|radyograf/i },
      { key: 'plate', name: 'Bağlantı plakası / arayüz yüzeyi', level: 'Feature', parent: 'body', fns: [F('Komşu yapıya bağlantı arayüzü sağlar', 'Bağlantı', { iface: 'Komşu yapı' }), F('Kaynak sonrası tanımlı düzlemsellik ve delik konumunu sağlar', 'Geometrik uyum')], match: /flanş|arayüz|bağlantı plaka|düzlemsel|delik|konum/i },
      COATING('body', 'Yüzey koruma (boya / kaplama)'),
      MARKING('body'),
    ],
  },
  {
    key: 'shaft', label: 'Mil / döner parça', group: 'Metal', family: 'metal', rootLevel: 'Product',
    hint: 'Mil gövdesi, yatak oturma yüzeyleri, kama yuvası / spline, diş, sertleştirilmiş yüzey.',
    rootFns: [F('Torku ve eğilme yükünü aktarır', 'Yük aktarma'), F('Dönen elemanları eş eksenli konumlar', 'Geometrik uyum')],
    elements: [
      { key: 'body', name: 'Mil gövdesi', level: 'Part', fns: [F('Burulma ve eğilme yüklerini yorulma ömrü boyunca taşır', 'Yük aktarma'), F('Kritik devirden uzak çalışır (rijitlik / denge)', 'Titreşim dayanımı')], match: /mil|şaft|malzeme|tork|burulma|balans|denge|devir|doğrusallık/i },
      { key: 'seat', name: 'Yatak oturma yüzeyi', level: 'Feature', parent: 'body', fns: [F('Yatağı tanımlı geçme ve salgı ile konumlar', 'Geometrik uyum', { iface: 'Rulman / yatak' })], match: /yatak|rulman|geçme|salgı|eş eksen|silindirik|pürüzlülük|\bra\b/i },
      { key: 'key', name: 'Kama yuvası / spline', level: 'Feature', parent: 'body', fns: [F('Torku göbeğe / kapline aktarır', 'Bağlantı', { iface: 'Göbek / kaplin' })], match: /kama|spline|kaplin/i },
      { key: 'thr', name: 'Mil ucu dişi', level: 'Feature', parent: 'body', optional: true, fns: [F('Eksenel sabitleme için somun kavraması sağlar', 'Bağlantı')], match: /diş|somun|metrik/i },
      { key: 'hard', name: 'Sertleştirilmiş yüzey (ısıl işlem bölgesi)', level: 'Feature', parent: 'body', optional: true, fns: [F('Temas ve aşınma yüküne karşı yüzey sertliği sağlar', 'Yüzey koruması')], match: /sertlik|sertleştir|ısıl işlem|nitrür|sementasyon|hrc|aşınma/i },
      MARKING('body'),
    ],
  },
  {
    key: 'housing', label: 'Gövde / muhafaza', group: 'Metal', family: 'metal', rootLevel: 'Product',
    hint: 'Gövde, sızdırmazlık yüzeyi, kapak arayüzü, bağlantı delikleri ve dişleri, yüzey koruma.',
    rootFns: [F('İç elemanları taşır, konumlar ve dış etkilerden korur', 'Taşıma'), F('İç hacmi dış ortama karşı kapatır', 'Sızdırmazlık')],
    elements: [
      { key: 'body', name: 'Gövde', level: 'Part', fns: [F('İç basınç / montaj yüklerini taşır', 'Yük aktarma'), F('İç elemanların konum referanslarını sağlar', 'Geometrik uyum'), F('Isıyı dış ortama iletir', 'Termal dayanım')], match: /gövde|malzeme|alaşım|et kalınlığı|basınç|ağırlık|ısı|sıcaklık|genel tolerans/i },
      { key: 'sealface', name: 'Sızdırmazlık yüzeyi / conta kanalı', level: 'Feature', parent: 'body', fns: [F('Contayı tanımlı sıkıştırma ile tutar ve sızdırmazlık yüzeyi sağlar', 'Sızdırmazlık', { iface: 'Kapak / conta' })], match: /sızdır|conta|o-?ring|kanal|kaçak|ip\d|pürüzlülük/i },
      { key: 'cover', name: 'Kapak arayüzü', level: 'Feature', parent: 'body', fns: [F('Kapağı tanımlı konumda ve düzlemsellikte oturtur', 'Geometrik uyum', { iface: 'Kapak' })], match: /kapak|arayüz|düzlemsel|oturma/i },
      HOLES('body'),
      { key: 'thr', name: 'Dişli delik (diş / helicoil)', level: 'Feature', parent: 'body', optional: true, fns: [F('Bağlantı elemanına ön yükü taşıyan diş kavraması sağlar', 'Bağlantı')], match: /diş|helicoil|vida|metrik/i },
      COATING('body', 'Yüzey koruma (anodize / kaplama / boya)'),
      { key: 'gnd', name: 'Topraklama / bonding noktası', level: 'Feature', parent: 'body', optional: true, fns: [F('Gövdenin elektriksel sürekliliğini sağlar', 'Diğer')], match: /topraklama|bonding|elektriksel süreklilik|emi|emc/i },
      MARKING('body'),
    ],
  },
  {
    key: 'riveted', label: 'Perçinli metal montaj (sac + takviye)', group: 'Metal', family: 'metal', rootLevel: 'Assembly',
    hint: 'Dış sac, takviye / profil, perçinler, bindirme arayüzü, ara yüzey sızdırmazlığı (sealant), yüzey koruma.',
    rootFns: [F('Sac ve takviye elemanlarını perçinle birleştirerek yükü taşır ve aktarır', 'Yük aktarma'), F('Montajın dış konturunu ve arayüz konumlarını sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'skin', name: 'Dış sac (panel)', level: 'Part', fns: [F('Kayma ve basınç yüklerini burkulmadan taşır', 'Yük aktarma'), F('Dış konturu ve yüzey düzgünlüğünü sağlar', 'Geometrik uyum')], match: /sac|kaplama sacı|levha|kontur|kalınlık|alaşım|temper|malzeme/i },
      { key: 'stiff', name: 'Takviye profili (kiriş / stringer)', level: 'Part', fns: [F('Dış sacı burkulmaya karşı destekler ve eksenel yükü taşır', 'Yük aktarma'), F('Gerekli rijitliği sağlar', 'Titreşim dayanımı')], match: /takviye|profil|kiriş|stringer|rijit|sehim|titreşim/i },
      { key: 'rivet', name: 'Perçinler', level: 'Component', fns: [F('Sac ve takviye arasında kesme yükünü aktarır', 'Bağlantı'), F('Servis boyunca gevşemeden sıkılığını korur', 'Titreşim dayanımı')], match: /perçin|rivet|baş yüksekliği|baş taşması|flush/i },
      { key: 'holes', name: 'Perçin delikleri', level: 'Feature', parent: 'skin', fns: [F('Perçinleri tanımlı hatve ve kenar mesafesinde konumlar', 'Geometrik uyum'), F('Yataklama yükünü saca aktarır', 'Yük aktarma')], match: /delik|havşa|hatve|kenar mesafesi/i },
      { key: 'lap', name: 'Bindirme arayüzü / temas yüzeyi', level: 'Feature', parent: 'skin', fns: [F('Parçaların boşluksuz oturmasını sağlar', 'Geometrik uyum', { iface: 'Sac ↔ takviye' })], match: /bindirme|arayüz|temas|boşluk|şim|shim|oturma/i },
      { key: 'seal', name: 'Ara yüzey sızdırmazlığı (sealant)', level: 'Component', parent: 'lap', optional: true, fns: [F('Ara yüzeye nem girişini ve aralık korozyonunu engeller', 'Sızdırmazlık')], match: /sızdır|sealant|ıslak montaj|nem/i },
      COATING('skin', 'Yüzey koruma (astar / boya)'),
      { key: 'gnd', name: 'Topraklama / bonding noktası', level: 'Feature', parent: 'skin', optional: true, fns: [F('Montajın elektriksel sürekliliğini sağlar', 'Diğer')], match: /topraklama|bonding|elektriksel süreklilik/i },
      MARKING('skin'),
    ],
  },
  // ───────────── Montaj ─────────────
  {
    key: 'bolted', label: 'Cıvatalı / perçinli montaj', group: 'Montaj', family: '', rootLevel: 'Assembly',
    hint: 'Montaj parçaları, bağlantı elemanları, arayüz yüzeyleri, kilitleme, sızdırmazlık, topraklama.',
    rootFns: [F('Parçaları sökülebilir / kalıcı bağlantı ile birleştirerek yükü aktarır', 'Yük aktarma'), F('Parçaların karşılıklı konumunu sağlar', 'Geometrik uyum')],
    elements: [
      { key: 'parts', name: 'Montaj parçaları (alt parçalar)', level: 'Part', fns: [F('Yükü bağlantı noktalarına taşır', 'Yük aktarma')], match: /parça|alt montaj|bileşen/i },
      { key: 'fast', name: 'Bağlantı elemanları (cıvata / perçin)', level: 'Component', fns: [F('Parçalar arasında kesme ve çekme yükünü aktarır', 'Bağlantı'), F('Tanımlı ön yükü (tork) servis boyunca korur', 'Titreşim dayanımı')], match: /cıvata|civata|perçin|somun|vida|tork|ön yük|bağlantı eleman/i },
      { key: 'face', name: 'Arayüz / temas yüzeyleri', level: 'Feature', parent: 'parts', fns: [F('Parçaların boşluksuz oturmasını ve delik hizasını sağlar', 'Geometrik uyum', { iface: 'Parça ↔ parça' })], match: /arayüz|temas|boşluk|şim|shim|hiza|oturma|düzlemsel/i },
      HOLES('parts'),
      { key: 'lock', name: 'Kilitleme / emniyet elemanı', level: 'Component', parent: 'fast', fns: [F('Bağlantı elemanının titreşimde gevşemesini önler', 'Titreşim dayanımı')], match: /kilit|emniyet teli|kopilya|gevşe|locking/i },
      SEALING('parts', true),
      { key: 'gnd', name: 'Topraklama / bonding şeridi', level: 'Component', parent: 'parts', optional: true, fns: [F('Parçalar arasında elektriksel sürekliliği sağlar', 'Diğer')], match: /topraklama|bonding|elektriksel süreklilik/i },
    ],
  },
];

export const STRUCTURE_TEMPLATE_BY_KEY = Object.fromEntries(STRUCTURE_TEMPLATES.map((t) => [t.key, t])) as Record<string, StructureTemplate>;

/** Ürün tipi, malzeme ve parça adından önerilen şablon (yalnız ön seçim). */
export function suggestStructureTemplate(p: { meta?: { material?: string; partName?: string; name?: string }; settings?: { productType?: string } }): string {
  const t = `${p.settings?.productType ?? ''} ${p.meta?.material ?? ''} ${p.meta?.partName ?? ''} ${p.meta?.name ?? ''}`.toLocaleLowerCase('tr');
  if (/radom|radome/.test(t)) return 'radome';
  if (/sandwich|sandviç|bal peteği|honeycomb/.test(t)) return 'sandwich';
  if (/bonded|yapıştırma/.test(t)) return 'bonded';
  if (/sargı|filament|basınçlı (kap|tüp)/.test(t)) return 'wound';
  if (/kaynak|weld/.test(t)) return 'weldment';
  if (/perçin|rivet/.test(t)) return 'riveted';
  if (/(^|\s)sac(\s|$)|sheet/.test(t)) return 'sheet';
  if (/(^|\s)mil(\s|$)|şaft|shaft/.test(t)) return 'shaft';
  if (/muhafaza|housing|kutu/.test(t)) return 'housing';
  if (/composite assembly|montaj|assembly/.test(t)) return /composite|kompozit/.test(t) ? 'bonded' : 'bolted';
  if (/composite|kompozit|prepreg|laminat/.test(t)) return 'laminate';
  if (/metal|alüminyum|çelik|titanyum|braket|fitting/.test(t)) return 'machined';
  return '';
}

const norm = (s: string) => (s ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

/** Şablonda varsayılan olarak seçili gelen elemanlar. */
export const defaultElements = (t: StructureTemplate) => t.elements.filter((e) => !e.optional).map((e) => e.key);

export interface StructurePlan {
  edits: GenEdit[];
  /** Eklenen yapı satırı sayısı. */
  rows: number;
  /** Elemanlara bağlanan gereksinim sayısı. */
  linked: number;
  /** Hiçbir elemana uymayan (bağlanmamış kalan) gereksinim ID'leri. */
  unmatched: string[];
}

const PROCESS_TYPES = new Set(['Manufacturing', 'Process', 'Inspection']);

/**
 * Seçilen şablon elemanlarını yapı ağacına ekler. Kök ürün varsa kullanılır (yoksa proje bilgisinden eklenir);
 * aynı adlı mevcut elemanlar tekrar eklenmez. Yapıya bağlı olmayan (proses dışı, reddedilmemiş) gereksinimler
 * anahtar kelimeyle ilgili elemanın, tipine uyan fonksiyon satırına bağlanır.
 */
export function planStructure(p: Project, templateKey: string, elementKeys?: string[]): StructurePlan {
  const t = STRUCTURE_TEMPLATE_BY_KEY[templateKey];
  const g = new Gen(p);
  if (!t) return { edits: [], rows: 0, linked: 0, unmatched: [] };
  const keys = new Set(elementKeys ?? defaultElements(t));
  const common = { approval: 'AI Proposed', origin: 'template', source: `${STRUCTURE_SOURCE} – ${t.label}`, notes: 'Kütüphane önerisi – ürüne uygunluğunu doğrulayın (AI VARSAYIMI)' };
  const fnRow = (f: LibFunction) => ({ function: f.text, functionType: f.type, constraint: f.constraint ?? '', interface: f.iface ?? '' });
  const m = p.meta;

  // Kök ürün
  let root = g.p.structure.find((s) => !s.parentId && ['Product', 'System', 'Assembly'].includes(s.level)) as StructureRow | undefined;
  const rootName = root?.element || m.partName || m.name || 'Ürün';
  const added: string[] = [];
  if (!root) {
    t.rootFns.forEach((f) => added.push(g.add('structure', { level: t.rootLevel, parentId: '', element: rootName, ...fnRow(f), ...common } as Partial<AnyRow>)));
    root = g.p.structure.find((s) => s.id === added[0]);
  } else if (!root.function?.trim() && t.rootFns[0]) {
    const f = fnRow(t.rootFns[0]);
    g.set('structure', root.id, 'function', f.function);
    if (!root.functionType) g.set('structure', root.id, 'functionType', f.functionType);
  }
  const rootId = root!.id;

  // Elemanlar: her fonksiyon bir satır; ilk satır elemanın kendisi (alt elemanlar ona bağlanır).
  const idOf = new Map<string, string>();
  const rowsOf = new Map<string, string[]>();
  for (const e of t.elements) {
    if (!keys.has(e.key)) continue;
    const parentId = (e.parent && idOf.get(e.parent)) || rootId;
    const existing = g.p.structure.filter((s) => norm(s.element) === norm(e.name));
    if (existing.length) {
      idOf.set(e.key, existing[0].id);
      rowsOf.set(e.key, existing.map((s) => s.id));
      continue;
    }
    const ids = e.fns.map((f) => g.add('structure', { level: e.level, parentId, element: e.name, ...fnRow(f), ...common } as Partial<AnyRow>));
    added.push(...ids);
    idOf.set(e.key, ids[0]);
    rowsOf.set(e.key, ids);
  }

  // Gereksinim bağlama
  const linkedIds = new Set(g.p.structure.flatMap((s) => s.reqIds));
  const reqs = g.p.requirements.filter((r) => r.text?.trim() && !linkedIds.has(r.id) && r.approval !== 'Rejected' && !PROCESS_TYPES.has(r.reqType));
  const unmatched: string[] = [];
  let linked = 0;
  // Alt (daha özel) elemanlar önce denenir.
  const order = t.elements.filter((e) => rowsOf.has(e.key) && e.match).sort((a, b) => Number(!!b.parent) - Number(!!a.parent));
  for (const r of reqs) {
    const text = `${r.text} ${r.characteristic ?? ''}`;
    const e = order.find((x) => x.match!.test(text));
    if (!e) { unmatched.push(r.id); continue; }
    const rows = rowsOf.get(e.key)!.map((id) => g.p.structure.find((s) => s.id === id)!);
    const row = rows.find((s) => s.functionType && s.functionType === REQ_FUNCTION_TYPE[r.reqType]) ?? rows[0];
    g.set('structure', row.id, 'reqIds', [...row.reqIds, r.id]);
    if (!row.performanceReq && r.acceptance && !r.acceptance.includes(NO_DATA)) g.set('structure', row.id, 'performanceReq', r.acceptance);
    linked++;
  }
  return { edits: collapse(g.edits), rows: added.length, linked, unmatched };
}

/** Gereksinim tipi → hangi fonksiyon tipindeki satıra bağlanacağı. */
const REQ_FUNCTION_TYPE: Record<string, string> = {
  Dimensional: 'Geometrik uyum', Interface: 'Bağlantı', Structural: 'Yük aktarma', Environmental: 'Çevresel dayanım', Reliability: 'Titreşim dayanımı', Performance: 'Elektromanyetik performans',
};

/** Bu çalıştırmada eklenen satırlara yapılan 'set' düzenlemelerini eklenen satırın içine katlar (tek onay listesi). */
function collapse(edits: GenEdit[]): GenEdit[] {
  const adds = new Map<string, AnyRow>();
  const out: GenEdit[] = [];
  for (const e of edits) {
    if (e.kind === 'add') {
      const row = { ...e.row } as AnyRow;
      adds.set(`${e.table}:${row.id}`, row);
      out.push({ ...e, row });
    } else {
      const row = adds.get(`${e.table}:${e.id}`);
      if (row) (row as unknown as Record<string, unknown>)[e.field] = e.value;
      else out.push(e);
    }
  }
  return out;
}
