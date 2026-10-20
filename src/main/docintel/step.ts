// STEP (ISO 10303-21, AP203 / AP214 / AP242): HEADER, varlık sayıları, PRODUCT adları ve geometri analizi
// (birim, sınırlayıcı kutu, delik / silindir grupları, daireler, yüz türleri, montaj, malzeme, AP242 PMI).
// Geometri değerleri nominal model geometrisidir; tolerans yalnızca PMI'dan gelir.
import { CAD_NOMINAL_MSG, CAD_PARTIAL_MSG, type CadInfo, type ExtractMessage } from '../../shared/docmodel';
import { BlockList, errMsg, result, type Parser } from './util';
import { StepFile, stepString } from './cad/step-graph';
import { analyzeStep, type StepGeometry } from './cad/step-analyze';
import { cadBlocks } from './cad/report';

export { stepString };

type Arg = string | Arg[];

/** pos konumundaki '(' ile başlayan parametre listesini ayrıştırır. Dizeler çözülmüş, diğer atomlar ham döner. (HEADER için) */
export function parseArgsAt(text: string, pos: number): [Arg[], number] {
  const stack: Arg[][] = [];
  let cur: Arg[] = [];
  let atom = '';
  const pushAtom = () => {
    if (atom.trim()) cur.push(atom.trim());
    atom = '';
  };
  for (let i = pos; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1, s = '';
      for (; j < text.length; j++) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") { s += "''"; j++; continue; }
          break;
        }
        s += text[j];
      }
      cur.push(stepString(s));
      i = j;
    } else if (ch === '(') {
      pushAtom();
      stack.push(cur);
      cur = [];
    } else if (ch === ')') {
      pushAtom();
      const done = cur;
      cur = stack.pop() ?? [];
      cur.push(done);
      if (!stack.length) return [done, i + 1];
    } else if (ch === ',') pushAtom();
    else atom += ch;
  }
  return [cur, text.length];
}

const flatStr = (a: Arg | undefined): string =>
  a == null ? '' : Array.isArray(a) ? a.map(flatStr).filter((s) => s && s !== '$').join('; ') : a === '$' ? '' : a;

function headerCall(header: string, name: string): Arg[] | undefined {
  const m = new RegExp(`\\b${name}\\s*\\(`).exec(header);
  if (!m) return undefined;
  return parseArgsAt(header, m.index + m[0].length - 1)[0];
}

export const parseStep: Parser = async (_name, data) => {
  const raw = data.toString('latin1');
  if (!/ISO-10303-21\s*;/.test(raw.slice(0, 2000))) throw new Error('Geçerli bir STEP (ISO-10303-21) dosyası değil.');
  const f = new StepFile(raw);
  const headerTxt = f.headerText;
  const header: Record<string, string> = {};
  const fd = headerCall(headerTxt, 'FILE_DESCRIPTION');
  if (fd) {
    header.FILE_DESCRIPTION = flatStr(fd[0]);
    header.implementationLevel = flatStr(fd[1]);
  }
  const fn = headerCall(headerTxt, 'FILE_NAME');
  if (fn) {
    const keys = ['FILE_NAME', 'timeStamp', 'author', 'organization', 'preprocessorVersion', 'originatingSystem', 'authorization'];
    keys.forEach((k, i) => (header[k] = flatStr(fn[i])));
  }
  const fs = headerCall(headerTxt, 'FILE_SCHEMA');
  if (fs) header.FILE_SCHEMA = flatStr(fs);
  for (const k of Object.keys(header)) if (!header[k]) delete header[k];

  const counts = f.counts;
  const bl = new BlockList();
  const label: [string, string][] = [
    ['FILE_NAME', 'Dosya adı'], ['FILE_DESCRIPTION', 'Açıklama'], ['FILE_SCHEMA', 'Şema'], ['author', 'Yazar'],
    ['organization', 'Kuruluş'], ['originatingSystem', 'Kaynak sistem'], ['timeStamp', 'Tarih'],
  ];
  for (const [k, l] of label) if (header[k]) bl.add('note', `${l}: ${header[k]}`, { part: 'header' });
  for (const id of f.ofType('PRODUCT')) {
    const args = f.args(id) ?? [];
    const s = (i: number) => (typeof args[i] === 'string' ? (args[i] as string) : '');
    const [pid, name, desc] = [s(0), s(1), s(2)];
    const parts = [pid, name && name !== pid ? name : '', desc && desc !== name ? desc : ''].filter(Boolean);
    if (parts.length) bl.add('entity', `PRODUCT: ${parts.join(' – ')}`, { part: `#${id}` });
  }

  let geo: StepGeometry | undefined;
  const warnings = [...f.warnings];
  try {
    geo = analyzeStep(f);
    warnings.push(...geo.warnings);
  } catch (e) {
    warnings.push(`Geometri analizi tamamlanamadı: ${errMsg(e)}`);
  }

  const cad: CadInfo = { format: 'STEP', units: geo?.units, entityCounts: counts, header };
  if (geo) {
    cad.unitScaleToMm = geo.unitScaleToMm;
    if (geo.bbox) cad.bbox = geo.bbox;
    cad.solids = geo.solids;
    cad.shells = geo.shells;
    if (Object.keys(geo.faces).length) cad.faces = geo.faces;
    if (geo.holes.length) cad.holes = geo.holes;
    if (geo.fillets.length) cad.fillets = geo.fillets;
    if (geo.circles.length) cad.circles = geo.circles;
    if (geo.parts.length) cad.parts = geo.parts;
    if (geo.assembly.length) cad.assembly = geo.assembly;
    if (geo.materials.length) cad.materials = geo.materials;
    if (geo.pmi.length) cad.pmi = geo.pmi;
    if (geo.thickness.length) cad.thickness = geo.thickness;
    if (geo.bsplineInBox) warnings.push('Kutuya B-spline kenar kontrol noktaları dahil edildi; serbest form bölgelerde kutu bir miktar büyük olabilir.');
    if (geo.surfaceModels) warnings.push(`${geo.surfaceModels} yüzey modeli (SHELL_BASED_SURFACE_MODEL) var; bunlardaki silindirlerde delik / çıkıntı yönü belirlenmedi.`);
  }
  if (warnings.length) cad.warnings = warnings;
  if (!cad.units) delete cad.units;

  const understood = !!geo?.geometryUnderstood;
  if (geo) cadBlocks(bl, cad, { reliable: understood });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}: ${v}`).join(', ');
  const messages: ExtractMessage[] = [
    understood ? { level: 'warning', text: CAD_NOMINAL_MSG } : { level: 'warning', text: CAD_PARTIAL_MSG },
    { level: 'info', text: `STEP varlık sayısı: ${total}${top ? ` (${top})` : ''}.` },
  ];
  const sem = (geo?.pmi ?? []).filter((p) => p.kind !== 'DATUM').length;
  if (sem) messages.push({ level: 'info', text: `PMI: ${sem} ölçü / tolerans modelden okundu (toleranslı olanlar gereksinim adayı olarak yüksek güvenle önerilir).` });
  if (geo?.presentationPmi)
    messages.push({ level: 'warning', text: `${geo.presentationPmi} sunum (grafik) PMI / GD&T varlığı mevcut ancak otomatik yorumlanmadı (MANUAL VERIFICATION REQUIRED).` });
  if (!total) messages.push({ level: 'warning', text: 'DATA bölümünde varlık bulunamadı.' });
  for (const w of warnings) messages.push({ level: 'warning', text: w });
  messages.push({
    level: 'info',
    text: 'Desteklenmeyen: hacim / kütle, delik geçiş-kör ayrımı, montaj yerleşim dönüşümleri, sunum (grafik) PMI, PMI değiştiricileri (MMC/LMC vb.).',
  });

  const meta: Record<string, string> = {};
  if (header.FILE_NAME) meta.title = header.FILE_NAME;
  if (header.author) meta.author = header.author;
  if (geo?.materials.length === 1) meta.material = geo.materials[0].name;
  return result(bl.blocks, { status: understood ? 'ok' : 'partial', cad, meta, messages });
};
