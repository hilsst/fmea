// Document Intelligence ortak modeli (§5–14). Ayrıştırıcılar (main/docintel) bu yapıyı üretir;
// gereksinim adayı bulma, parçalama, arama ve kaynak doğrulama burada saf fonksiyonlarla yapılır.

export type ParserId =
  | 'pdf' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'txt' | 'eml' | 'msg' | 'image' | 'dxf' | 'step' | 'iges' | 'unsupported';
export type ExtractStatus = 'ok' | 'partial' | 'unsupported' | 'error';

export const UNSUPPORTED_MSG = 'Bu dosya formatı analiz için desteklenmiyor.';
export const CAD_PARTIAL_MSG = 'CAD geometry imported but this feature is not automatically interpreted.';
/** CAD geometrisi yorumlandığında: değerler nominal model geometrisidir, PMI dışında tolerans içermez. */
export const CAD_NOMINAL_MSG =
  'CAD geometrisi yorumlandı: değerler nominal model geometrisidir ve tolerans içermez (PMI hariç) – teknik resimden doğrulanmalı.';

export const EXT_PARSER: Record<string, ParserId> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', csv: 'csv', pptx: 'pptx', txt: 'txt', md: 'txt',
  eml: 'eml', msg: 'msg', png: 'image', jpg: 'image', jpeg: 'image', tif: 'image', tiff: 'image',
  dxf: 'dxf', step: 'step', stp: 'step', iges: 'iges', igs: 'iges',
};

export function parserFor(fileName: string): ParserId {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return EXT_PARSER[ext] ?? 'unsupported';
}

/** Bir bilginin dokümandaki yeri. Hangi alanların dolduğu doküman türüne bağlıdır. */
export interface DocLoc {
  page?: number;
  section?: string;
  sheet?: string;
  cell?: string;
  slide?: number;
  layer?: string;
  line?: number;
  balloon?: string;
  /** e-posta: 'header' | 'body' | 'quoted' | ek dosya adı; doküman: 'header' | 'footer' | 'table' | 'caption' */
  part?: string;
}

export interface DocBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'table-row' | 'cell' | 'caption' | 'header' | 'footer' | 'note' | 'dimension' | 'text' | 'email-header' | 'quoted' | 'attachment' | 'entity';
  text: string;
  loc: DocLoc;
  level?: number;
  /**
   * CAD ayrıştırıcısından gelen blok: 'geometry' = nominal model geometrisi (tolerans yok),
   * 'pmi' = modelde tanımlı ölçü/tolerans (AP242 PMI), 'heuristic' = sezgisel çıkarım. Gereksinim adayı güvenini belirler.
   */
  cadSource?: 'geometry' | 'pmi' | 'heuristic';
}

export interface ExtractMessage {
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface EmailInfo {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  attachments: { name: string; size: number; mime: string }[];
}

export type Vec3 = [number, number, number];

/** Sınırlayıcı kutu. min/max/size dosya biriminde, sizeMm milimetre. */
export interface CadBBox {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  sizeMm: Vec3;
  /** Kutunun hangi noktalardan hesaplandığı: B-rep köşeleri (güvenilir) … tüm noktalar (güvenilmez). */
  source: 'brep' | 'vertices' | 'tessellation' | 'all-points' | 'iges-geometry';
}

/** Aynı çaptaki silindirik özellik grubu. count = ayrı eksen (özellik) sayısı, faces = yüz sayısı. */
export interface CadHoleGroup {
  diameter: number;
  diameterMm: number;
  count: number;
  faces: number;
  /** hole = iç (içbükey) silindir, boss = dış (dışbükey) silindir; yön belirlenemezse cylindrical. Geçiş / kör ayrımı yapılmaz. */
  kind: 'hole' | 'boss' | 'cylindrical';
  part?: string;
}

/** Kısmi silindirik yüzeyler (açısal kapsam < ~350°): çoğunlukla radyus / fillet. concave = iç köşe, convex = dış köşe yuvarlatma. */
export interface CadFilletGroup {
  radius: number;
  radiusMm: number;
  faces: number;
  kind: 'concave' | 'convex' | 'unknown';
  part?: string;
}

export interface CadCircleGroup {
  diameter: number;
  diameterMm: number;
  count: number;
  full: number;
  arcs: number;
}

export interface CadPart {
  id: string;
  name: string;
  description?: string;
  revision?: string;
  solids?: number;
  bbox?: CadBBox;
}

export interface CadAssemblyLink {
  parent: string;
  child: string;
  quantity: number;
}

export interface CadMaterial {
  name: string;
  part?: string;
  /** Kaynak varlık (MATERIAL_DESIGNATION, DESCRIPTIVE_REPRESENTATION_ITEM, ...) */
  source: string;
  density?: string;
}

/** Modelde tanımlı ölçü / tolerans (AP242 semantik PMI). Değerler mm (açılar °). */
export interface CadPmi {
  kind: string;
  name?: string;
  value?: number;
  unit?: string;
  tolerance?: string;
  upper?: number;
  lower?: number;
  datum?: string;
  text: string;
}

/** Sezgisel et kalınlığı adayı: zıt yönlü iki büyük paralel düzlem arası mesafe. */
export interface CadThickness {
  value: number;
  valueMm: number;
  part?: string;
}

export interface CadInfo {
  format: 'DXF' | 'STEP' | 'IGES';
  units?: string;
  layers?: string[];
  entityCounts: Record<string, number>;
  /** STEP header: FILE_NAME, FILE_SCHEMA vb. */
  header?: Record<string, string>;
  /** 1 dosya birimi kaç mm */
  unitScaleToMm?: number;
  bbox?: CadBBox;
  solids?: number;
  shells?: number;
  /** Yüz sayısı yüzey türüne göre (PLANE, CYLINDRICAL_SURFACE, B_SPLINE_SURFACE, ...) */
  faces?: Record<string, number>;
  holes?: CadHoleGroup[];
  fillets?: CadFilletGroup[];
  circles?: CadCircleGroup[];
  parts?: CadPart[];
  assembly?: CadAssemblyLink[];
  materials?: CadMaterial[];
  pmi?: CadPmi[];
  thickness?: CadThickness[];
  warnings?: string[];
}

export interface ExtractedDoc {
  fileName: string;
  ext: string;
  hash: string;
  size: number;
  parser: ParserId;
  status: ExtractStatus;
  messages: ExtractMessage[];
  meta: Record<string, string>;
  blocks: DocBlock[];
  email?: EmailInfo;
  cad?: CadInfo;
  extractedAt: string;
}

export function locText(loc: DocLoc | undefined): string {
  if (!loc) return '';
  const p: string[] = [];
  if (loc.page != null) p.push(`s.${loc.page}`);
  if (loc.slide != null) p.push(`slayt ${loc.slide}`);
  if (loc.sheet) p.push(`sayfa "${loc.sheet}"`);
  if (loc.cell) p.push(`hücre ${loc.cell}`);
  if (loc.section) p.push(`bölüm ${loc.section}`);
  if (loc.layer) p.push(`katman ${loc.layer}`);
  if (loc.line != null) p.push(`satır ${loc.line}`);
  if (loc.balloon) p.push(`balon ${loc.balloon}`);
  if (loc.part) p.push(loc.part);
  return p.join(', ');
}

// ───────────────────────── Değer / tolerans çözümleme ─────────────────────────

export interface ValueSpec {
  nominal: number | null;
  lsl: number | null;
  usl: number | null;
  unit: string;
  tolerance: string;
}

const NUM = String.raw`[-+]?\d+(?:[.,]\d+)?`;
const UNIT = String.raw`(?:(N·m|Nm|kN|MPa|GPa|kPa|mbar|inHg|psi|bar|Pa|mm|µm|um|μm|cm|inch|in|°C|°F|deg|°|kg|min|g|%|h|saat|dk|s|Ra|N|m)(?![A-Za-zçğıöşüÇĞİÖŞÜ]))`;
const num = (s: string) => Number(s.replace(',', '.'));

/** Metindeki ilk ölçü/tolerans ifadesini çözer. Bulamazsa null; tahmin yapmaz. */
export function parseValueSpec(text: string): ValueSpec | null {
  const t = text.replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  // pah: 0.5 × 45° ±0.2 mm
  if ((m = new RegExp(`(${NUM})\\s*[×xX]\\s*${NUM}\\s*°\\s*(?:±|\\+/-)\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(t))) {
    const n = num(m[1]), d = num(m[2]);
    return { nominal: n, lsl: round(n - d), usl: round(n + d), unit: m[3] ?? '', tolerance: `±${m[2]}` };
  }
  // 2.00 ± 0.10 mm  /  Ø6.00 ±0.05
  if ((m = new RegExp(`(?:Ø|⌀)?\\s*(${NUM})\\s*(?:±|\\+/-|\\+-)\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(t))) {
    const n = num(m[1]), d = num(m[2]);
    return { nominal: n, lsl: round(n - d), usl: round(n + d), unit: m[3] ?? '', tolerance: `±${m[2]}` };
  }
  // 6.00 +0.10/-0.00, 6.00 +0.10 -0.05 veya 10.00 +0.10 / 0.00 (işaretsiz alt sapma)
  if ((m = new RegExp(`(${NUM})\\s*\\+\\s*(${NUM})\\s*(?:/\\s*-?|-)\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(t))) {
    const n = num(m[1]);
    return { nominal: n, lsl: round(n - num(m[3])), usl: round(n + num(m[2])), unit: m[4] ?? '', tolerance: `+${m[2]}/-${m[3]}` };
  }
  // 6.00 – 6.10 mm  / 120-130 °C (aralık)
  if ((m = new RegExp(`(${NUM})\\s*(?:–|-|to|ile|\\.\\.)\\s*(${NUM})\\s*${UNIT}`, 'i').exec(t))) {
    const a = num(m[1]), b = num(m[2]);
    if (a < b) return { nominal: null, lsl: a, usl: b, unit: m[3], tolerance: `${m[1]}–${m[2]}` };
  }
  // min. 25 MPa / en az 25 MPa / ≥ 25
  if ((m = new RegExp(`(?:min(?:imum)?\\.?|en az|≥|>=|at least)\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(t)))
    return { nominal: null, lsl: num(m[1]), usl: null, unit: m[2] ?? '', tolerance: `min ${m[1]}` };
  // ≤ %2 / en az %60 (yüzde işareti önde)
  if ((m = new RegExp(`(≤|<=|max(?:imum)?\\.?|en fazla|maksimum|≥|>=|min(?:imum)?\\.?|en az)\\s*%\\s*(${NUM})`, 'i').exec(t))) {
    const lo = /≥|>=|min|en az/i.test(m[1]);
    return { nominal: null, lsl: lo ? num(m[2]) : null, usl: lo ? null : num(m[2]), unit: '%', tolerance: `${lo ? 'min' : 'max'} ${m[2]}` };
  }
  if ((m = new RegExp(`(?:max(?:imum)?\\.?|en fazla|≤|<=|not exceed|maksimum)\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(t)))
    return { nominal: null, lsl: null, usl: num(m[1]), unit: m[2] ?? '', tolerance: `max ${m[1]}` };
  // tek değer + birim (tolerans yok)
  if ((m = new RegExp(`(?:Ø|⌀)?\\s*(${NUM})\\s*${UNIT}\\b`, 'i').exec(t)))
    return { nominal: num(m[1]), lsl: null, usl: null, unit: m[2], tolerance: '' };
  // yalnızca tolerans (±2°): nominal başka yerde
  if ((m = new RegExp(`(?:±|\\+/-)\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(t)))
    return { nominal: null, lsl: null, usl: null, unit: m[2] ?? '', tolerance: `±${m[1]}` };
  return null;
}

function round(v: number) {
  return Math.round(v * 1e6) / 1e6;
}

// ───────────────────────── Gereksinim adayları (§7, §12) ─────────────────────────

export interface RequirementCandidate {
  text: string;
  characteristic: string;
  nominal: number | null;
  lsl: number | null;
  usl: number | null;
  unit: string;
  tolerance: string;
  reqType: string;
  evidence: string;
  loc: DocLoc;
  blockId: string;
  confidence: 'High' | 'Medium' | 'Low';
  trigger: string;
}

const TRIGGERS = /\b(shall|must|required|requires|is to be|are to be|will be|should)\b|(olmalıdır|olmalı|edilmelidir|yapılmalıdır|gereklidir|zorunludur|uygulanmalıdır|sağlamalıdır|aşmamalıdır|tutulmalıdır|[a-zçğıöşü]+(?:malı|meli)dır|[a-zçğıöşü]+(?:ecek|acak)tır|kabul edilmez|bulunmamalı|bulunmayacak)/i;

const TYPE_RULES: [RegExp, string][] = [
  [/\b(safety|emniyet|güvenlik|hazard|flammab)/i, 'Safety'],
  [/\b(regulat|yasal|reach|rohs|faa|easa|far\s?25|cs-25|mevzuat)/i, 'Regulatory'],
  [/\b(cure|autoclave|bond|lay-?up|vacuum|kür|otoklav|vakum|surface prep|paint|coat|anodiz|primer|heat treat)/i, 'Process'],
  [/\b(temperature|humidity|salt|uv|altitude|vibration|nem|sıcaklık|titreşim|rain|erosion|lightning)/i, 'Environmental'],
  [/\b(material|prepreg|resin|fiber|fibre|adhesive|core|honeycomb|malzeme|reçine|elyaf|yapıştırıcı|alloy|aluminium|aluminum|titanium)/i, 'Material'],
  [/\b(inspect|ndt|ultrason|x-ray|muayene|tap test|cmm)/i, 'Inspection'],
  [/\b(interface|mating|arayüz|montaj|fastener|connector)/i, 'Interface'],
  [/\b(mtbf|life|ömür|reliab|güvenilir|fatigue|yorulma|cycles)/i, 'Reliability'],
  [/\b(transmission|loss|db|ghz|strength|load|yük|dayanım|mukavemet|performans|performance|stiffness)/i, 'Performance'],
  [/(Ø|⌀|±|\bmm\b|thickness|kalınlık|diameter|çap|flatness|düzlemsellik|position|tolerance|tolerans|length|width)/i, 'Dimensional'],
];

export function classifyRequirement(text: string): string {
  for (const [re, t] of TYPE_RULES) if (re.test(text)) return t;
  return 'Functional';
}

/** Değerin hangi karakteristiğe ait olduğu – yalnızca metinde geçen kelimeden; yoksa boş. */
const CHAR_WORDS = /(thickness|kalınlık|diameter|çap|\\bhole\\b|delik|flatness|düzlemsellik|position|pozisyon|length|uzunluk|width|genişlik|roughness|pürüzlülük|temperature|sıcaklık|pressure|basınç|vacuum|vakum|torque|tork|weight|ağırlık|coating|kaplama|bondline|transmission loss|strength|dayanım|porosity|gözeneklilik|porozite|void|cure time|dwell|ramp rate|radyüs|radius|dikliğ|diklik|perpendicular|pah|chamfer|fiber açı|açı toleransı|out-time|ısıtma hızı|kür süresi|ply sayısı|tg\b)/i;

// ───────── Metin birimleri: Markdown tablo satırı, madde listesi, başlık / giriş bağlamı ─────────

interface ReqUnit {
  text: string;
  block: DocBlock;
  loc: DocLoc;
  /** Tablo satırı: tetik kelimesi olmasa da gereksinimdir. */
  forced?: boolean;
  characteristic?: string;
  spec?: ValueSpec | null;
  /** Karakteristik aramasında kullanılan başlık / giriş metni. */
  context?: string;
}

/** Markdown vurgu işaretlerini ve satır sonu boşluklarını temizler. */
export function cleanMd(t: string): string {
  return t.replace(/\*\*|__|`/g, '').replace(/[ \t]+$/gm, '').trim();
}

const BULLET = /^\s*(?:[-*•·]|\d{1,2}[.)])\s+/;
const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const startsLower = (t: string) => /^[a-zçğıöşü]/.test(t);
/** Başlık: numarasız (büyük harf korunur; Türkçe küçültme İngilizce kelimeleri bozar). */
const headingTitle = (t: string) => cleanMd(t).replace(/^(?:\d{1,2}\.)*\d{1,2}\.?\s+/, '').trim();
const withLine = (loc: DocLoc, add: number): DocLoc => (loc.line != null ? { ...loc, line: loc.line + add } : loc);

/** Tablo satırı: Nominal + Tolerans kolonları varsa tek değer olarak birleştirilir. */
function tableUnits(b: DocBlock, lines: string[], heading: string): ReqUnit[] {
  const rows = lines.map((l, i) => ({ c: cells(l), i })).filter((r) => !r.c.every((x) => /^:?-{2,}:?$/.test(x) || x === ''));
  if (rows.length < 2) return [];
  const head = rows[0].c.map((h) => h.toLocaleLowerCase('tr'));
  const nomI = head.findIndex((h) => /nominal/.test(h));
  const tolI = head.findIndex((h) => /tolerans|tolerance/.test(h));
  return rows.slice(1).map(({ c, i }) => {
    const name = c[0] ?? '';
    let text: string;
    let spec: ValueSpec | null;
    if (nomI > 0 && tolI > 0) {
      const nom = c[nomI] ?? '';
      const tol = c[tolI] ?? '';
      text = `${name}: ${nom} ${tol}`.trim();
      const n = new RegExp(`(?:Ø|⌀|R)?\\s*(${NUM})\\s*${UNIT}?`, 'i').exec(nom);
      const unit = n?.[2] ?? new RegExp(`${UNIT}`, 'i').exec(tol)?.[1] ?? '';
      const tolNum = tol.replace(new RegExp(`\\s*${UNIT}`, 'gi'), '');
      spec = /^[±+]/.test(tolNum.trim()) && n ? parseValueSpec(`${n[1]} ${tolNum} ${unit}`) : parseValueSpec(tol) ?? parseValueSpec(nom);
      if (spec && !spec.unit) spec = { ...spec, unit };
    } else {
      text = `${heading ? `${heading} – ` : ''}${c.map((x, k) => (k && rows[0].c[k] ? `${rows[0].c[k]}: ${x}` : x)).join('; ')}`;
      spec = parseValueSpec(text);
    }
    return { text, block: b, loc: withLine(b.loc, i), forced: true, characteristic: name, spec, context: heading };
  });
}

function reqUnits(doc: ExtractedDoc): ReqUnit[] {
  const out: ReqUnit[] = [];
  const titles: string[] = []; // başlık seviyelerine göre
  let lead = ''; // ":" ile biten son giriş cümlesi
  const blocks = doc.blocks;
  const ctx = () => {
    const t = titles.filter(Boolean);
    return t.slice(-2).join(' / ');
  };
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.cadSource) {
      out.push({ text: b.text, block: b, loc: b.loc });
      continue;
    }
    if (b.kind === 'heading') {
      const lvl = b.level ?? 1;
      titles.length = Math.max(0, lvl - 1);
      titles[lvl - 1] = headingTitle(b.text);
      lead = '';
      continue;
    }
    const text = cleanMd(b.text);
    if (!text) continue;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const heading = ctx();
    const label = [heading, lead].filter(Boolean).join(' – ');
    // Markdown tablosu
    if (lines.length >= 2 && lines.filter(isTableLine).length >= 2) {
      out.push(...tableUnits(b, lines.filter(isTableLine), heading));
      continue;
    }
    // Madde listesi
    if (lines.length >= 1 && lines.every((l) => BULLET.test(l))) {
      const items = lines.map((l) => l.replace(BULLET, '').replace(/[,;]\s*$/, '').trim());
      const next = blocks[k + 1];
      const closing = next && next.kind !== 'heading' && startsLower(cleanMd(next.text)) && cleanMd(next.text).length < 160 ? cleanMd(next.text) : '';
      if (closing) {
        // "… şunlar: a, b, c bulunmamalıdır." → tek gereksinim (şartnamedeki gibi)
        out.push({ text: `${lead || heading}${lead || heading ? ': ' : ''}${items.join(', ')} ${closing}`, block: b, loc: b.loc, context: heading });
        k++;
      } else
        items.forEach((it, i) => out.push({ text: label ? `${label}: ${it}` : it, block: b, loc: withLine(b.loc, i), context: heading }));
      lead = '';
      continue;
    }
    // Giriş cümlesi ("Kabul:", "Tipik olarak:") – sonraki birime bağlam olur
    if (/:$/.test(text) && text.length <= 120 && lines.length === 1) {
      lead = text.slice(0, -1).trim();
      continue;
    }
    // Yalnızca değer içeren satır ("R10.00 ±0.50 mm") – başlık ve giriş bağlamıyla
    const letters = text.replace(/[^A-Za-zçğıöşüÇĞİÖŞÜ]/g, '').length;
    if (text.length <= 60 && lines.length === 1 && parseValueSpec(text) && letters <= 12) {
      let full = `${label}${label ? ': ' : ''}${text}`;
      const next = blocks[k + 1];
      if (next && next.kind !== 'heading' && startsLower(cleanMd(next.text))) {
        full += ` ${cleanMd(next.text).split('\n')[0]}`;
        k++;
      }
      // Değer ayrı satıra yazılmışsa şartname onu gereksinim olarak vurgulamıştır
      out.push({ text: full, block: b, loc: b.loc, spec: parseValueSpec(text), context: heading, forced: !!label });
      lead = '';
      continue;
    }
    // Küçük harfle başlayan devam satırı ("olabilir.", "ve … doğrulanmalıdır.") önceki birime eklenir
    const last = out[out.length - 1];
    if (startsLower(text)) {
      if (last && last.block === blocks[k - 1]) last.text += ` ${lines.join(' ')}`;
      continue;
    }
    out.push({ text: lead ? `${label}: ${text}` : text, block: b, loc: b.loc, context: heading });
    lead = '';
  }
  return out;
}

export function findRequirementCandidates(doc: ExtractedDoc): RequirementCandidate[] {
  const out: RequirementCandidate[] = [];
  const seen = new Set<string>();
  for (const u of reqUnits(doc)) {
    const b = u.block;
    if (b.kind === 'email-header' || b.kind === 'attachment' || b.kind === 'entity') continue;
    // Uzun paragrafları cümlelere böl
    const sentences = u.text.length > 300 && !u.forced ? u.text.split(/(?<=[.;])\s+(?=[A-ZÇĞİÖŞÜ0-9])/) : [u.text];
    for (const s of sentences) {
      const text = s.trim();
      if (text.length < 8) continue;
      const trig = TRIGGERS.exec(text);
      const spec = u.spec !== undefined && sentences.length === 1 ? u.spec : parseValueSpec(text);
      const isDim = b.kind === 'dimension';
      if (!u.forced && !trig && !isDim && !(spec && (spec.lsl != null || spec.usl != null) && b.kind !== 'quoted')) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const ch = u.characteristic ? null : CHAR_WORDS.exec(text) ?? (u.context ? CHAR_WORDS.exec(u.context) : null);
      // Güven: tetik + değer + konum net ise High; yalnızca tetik ise Medium; alıntı / belirsiz ise Low
      let confidence: RequirementCandidate['confidence'] = (trig || u.forced) && spec ? 'High' : trig || isDim || u.forced ? 'Medium' : 'Low';
      if (b.kind === 'quoted') confidence = 'Low';
      let trigger = trig ? trig[0] : u.forced ? 'table row' : isDim ? 'drawing dimension' : 'numeric limit';
      // CAD: yalnızca ölçü blokları aday olur. PMI toleranslı → High; nominal geometri → Medium; sezgisel → Low.
      if (b.cadSource) {
        if (!isDim) continue;
        const limited = !!spec && (spec.lsl != null || spec.usl != null);
        confidence = b.cadSource === 'pmi' ? (limited ? 'High' : 'Medium') : b.cadSource === 'geometry' ? 'Medium' : 'Low';
        trigger = b.cadSource === 'pmi' ? 'CAD PMI' : b.cadSource === 'geometry' ? 'CAD nominal geometry' : 'CAD heuristic';
      }
      out.push({
        text,
        characteristic: u.characteristic || (ch ? ch[1] : ''),
        nominal: spec?.nominal ?? null,
        lsl: spec?.lsl ?? null,
        usl: spec?.usl ?? null,
        unit: spec?.unit ?? '',
        tolerance: spec?.tolerance ?? '',
        reqType: classifyRequirement(u.context ? `${text} ${u.context}` : text),
        evidence: text.length > 400 ? text.slice(0, 400) + '…' : text,
        loc: u.loc,
        blockId: b.id,
        confidence,
        trigger,
      });
    }
  }
  return out;
}

// ───────────────────────── Parçalama ve arama (§55 token optimizasyonu) ─────────────────────────

export interface Chunk {
  id: string;
  docName: string;
  text: string;
  locs: DocLoc[];
  tokens: number;
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);

/** Blokları konum etiketiyle yaklaşık maxTokens büyüklüğünde parçalara ayırır. */
export function chunkDoc(doc: ExtractedDoc, maxTokens = 1500): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let locs: DocLoc[] = [];
  let tok = 0;
  const flush = () => {
    if (!cur.length) return;
    chunks.push({ id: `${doc.hash.slice(0, 8)}-${chunks.length + 1}`, docName: doc.fileName, text: cur.join('\n'), locs, tokens: tok });
    cur = [];
    locs = [];
    tok = 0;
  };
  for (const b of doc.blocks) {
    const line = `[${locText(b.loc) || b.id}] ${b.text}`;
    const t = estimateTokens(line);
    if (tok + t > maxTokens && cur.length) flush();
    cur.push(line);
    locs.push(b.loc);
    tok += t;
  }
  flush();
  return chunks;
}

const tokenize = (s: string) =>
  s.toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9ø±.]+/).filter((w) => w.length > 1);

/** BM25 benzeri basit sıralama: sorguya en ilgili parçaları döndürür. */
export function retrieve(chunks: Chunk[], query: string, k = 8): Chunk[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return chunks.slice(0, k);
  const docs = chunks.map((c) => tokenize(c.text));
  const avg = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    return { i, s };
  });
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => chunks[x.i]);
}

// ───────────────────────── Kaynak doğrulama (§64) ─────────────────────────

export interface SourceCheck {
  verdict: 'VERIFIED' | 'VERIFIED – farklı konum' | 'SOURCE NOT VERIFIED' | 'MANUAL VERIFICATION REQUIRED';
  foundAt?: DocLoc;
  note: string;
}

const normalizeForMatch = (s: string) =>
  s.toLocaleLowerCase('tr').replace(/[“”"'’‘]/g, '').replace(/\s+/g, ' ').replace(/,(\d)/g, '.$1').trim();

/**
 * AI'nin gösterdiği alıntı gerçekten dokümanda var mı? Önce beyan edilen konumda, sonra tüm dokümanda arar.
 * Görsel / taranmış doküman (blok yok) için doğrulama yapılamaz → MANUAL VERIFICATION REQUIRED.
 */
export function verifySource(doc: ExtractedDoc | undefined, quote: string, claimed?: DocLoc): SourceCheck {
  if (!doc) return { verdict: 'SOURCE NOT VERIFIED', note: 'Kaynak doküman projede bulunamadı.' };
  if (!quote.trim()) return { verdict: 'SOURCE NOT VERIFIED', note: 'Kanıt metni boş.' };
  if (!doc.blocks.length) return { verdict: 'MANUAL VERIFICATION REQUIRED', note: 'Dokümandan metin çıkarılamadı (görsel / taranmış); kaynak elle doğrulanmalı.' };
  const q = normalizeForMatch(quote);
  const probe = q.length > 120 ? q.slice(0, 120) : q;
  const matches = (b: DocBlock) => normalizeForMatch(b.text).includes(probe);
  const sameLoc = (b: DocBlock) =>
    !claimed ||
    ((claimed.page == null || b.loc.page === claimed.page) &&
      (!claimed.sheet || b.loc.sheet === claimed.sheet) &&
      (!claimed.cell || b.loc.cell === claimed.cell) &&
      (claimed.slide == null || b.loc.slide === claimed.slide));
  const at = doc.blocks.find((b) => sameLoc(b) && matches(b));
  if (at) return { verdict: 'VERIFIED', foundAt: at.loc, note: 'Alıntı belirtilen konumda bulundu.' };
  const any = doc.blocks.find(matches);
  if (any) return { verdict: 'VERIFIED – farklı konum', foundAt: any.loc, note: `Alıntı farklı konumda bulundu: ${locText(any.loc)}` };
  // Sayısal değerleri ayrıca kontrol et: alıntıdaki tüm sayılar aynı blokta geçiyor mu?
  const nums = quote.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (nums.length) {
    const nb = doc.blocks.find((b) => nums.every((n) => normalizeForMatch(b.text).includes(n.replace(',', '.'))));
    if (nb) return { verdict: 'MANUAL VERIFICATION REQUIRED', foundAt: nb.loc, note: `Değerler ${locText(nb.loc)} içinde geçiyor ama metin birebir eşleşmiyor.` };
  }
  return { verdict: 'SOURCE NOT VERIFIED', note: 'Alıntı dokümanda bulunamadı.' };
}
