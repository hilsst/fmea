// ISO 10303-21 (STEP) varlık grafiği. Tek geçişli karakter tarayıcı: her varlığın türünü ve parametre
// aralığını kaydeder; parametreler yalnızca gerektiğinde (tembel) ayrıştırılır. Regex geri izleme yoktur,
// 50+ MB dosyalar doğrusal sürede taranır. Kesik / bozuk girdi uyarı üretir, hata fırlatmaz.

export class Ref {
  constructor(readonly id: number) {}
}
export class Enum {
  constructor(readonly v: string) {}
}
/** Tipli parametre (LENGTH_MEASURE(6.)) veya karmaşık varlığın bir parçası (SI_UNIT(.MILLI.,.METRE.)). */
export class Typed {
  constructor(
    readonly name: string,
    readonly args: Val[],
  ) {}
}
class Derived {}
/** '*' (türetilmiş) parametre */
export const DERIVED = new Derived();
export type Val = number | string | null | Ref | Enum | Typed | Derived | Val[];

/** STEP dize kaçışları: '' , \X2\..\X0\, \X4\..\X0\, \X\hh, \S\c, \\ */
export function stepString(s: string): string {
  if (s.indexOf('\\') < 0 && s.indexOf("''") < 0) return s;
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h: string) => (h.match(/.{4}/g) ?? []).map((x) => String.fromCharCode(parseInt(x, 16))).join(''))
    .replace(/\\X4\\([0-9A-F]+)\\X0\\/gi, (_, h: string) => (h.match(/.{8}/g) ?? []).map((x) => String.fromCodePoint(parseInt(x, 16))).join(''))
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\\\/g, '\\');
}

/** Standart dışı olarak doğrudan UTF-8 yazılmış dizeleri (latin1 okunmuş) düzeltir. */
function fixUtf8(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[\u0080-ÿ]/.test(s)) return s;
  const u = Buffer.from(s, 'latin1').toString('utf8');
  return u.includes('�') ? s : u;
}

const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isIdent = (c: number) => isLetter(c) || (c >= 48 && c <= 57);
const isDigit = (c: number) => c >= 48 && c <= 57;

export interface StepScan {
  header: string;
  warnings: string[];
}

export class StepFile {
  readonly ids: number[] = [];
  readonly types: string[] = [];
  private starts: number[] = [];
  private ends: number[] = [];
  readonly index = new Map<number, number>();
  readonly counts: Record<string, number> = {};
  readonly warnings: string[] = [];
  headerText = '';
  private cache = new Map<number, Val[]>();
  private byTypeIdx?: Map<string, number[]>;
  private complexParts?: Map<string, number[]>;

  constructor(readonly text: string) {
    this.scan();
  }

  get size() {
    return this.ids.length;
  }

  type(id: number): string | undefined {
    const i = this.index.get(id);
    return i == null ? undefined : this.types[i];
  }

  /** Basit varlık: parametre listesi. Karmaşık varlık: Typed parçalar listesi. Ayrıştırılamazsa undefined. */
  args(id: number): Val[] | undefined {
    const i = this.index.get(id);
    if (i == null) return undefined;
    let a = this.cache.get(id);
    if (a) return a;
    try {
      a = parseList(this.text, this.starts[i], this.ends[i], 0)[0];
    } catch {
      a = [];
    }
    this.cache.set(id, a);
    return a;
  }

  /** Varlığın parçaları: basit varlık için tek parça. */
  parts(id: number): Typed[] {
    const t = this.type(id);
    if (!t) return [];
    const a = this.args(id) ?? [];
    if (t !== 'COMPLEX_ENTITY') return [new Typed(t, a)];
    return a.filter((x): x is Typed => x instanceof Typed);
  }

  /** Varlık bu türde mi (karmaşık varlıkta parça adı olarak da arar). */
  has(id: number, name: string): boolean {
    const t = this.type(id);
    if (t === name) return true;
    if (t !== 'COMPLEX_ENTITY') return false;
    return this.parts(id).some((p) => p.name === name);
  }

  /** Belirtilen türün / parçanın parametreleri. */
  partArgs(id: number, name: string): Val[] | undefined {
    const t = this.type(id);
    if (t === name) return this.args(id);
    if (t !== 'COMPLEX_ENTITY') return undefined;
    return this.parts(id).find((p) => p.name === name)?.args;
  }

  /** Bu türdeki basit varlıkların kimlikleri (dosya sırasıyla). */
  ofType(name: string): number[] {
    if (!this.byTypeIdx) {
      const m = new Map<string, number[]>();
      for (let i = 0; i < this.types.length; i++) {
        const t = this.types[i];
        let l = m.get(t);
        if (!l) m.set(t, (l = []));
        l.push(this.ids[i]);
      }
      this.byTypeIdx = m;
    }
    return this.byTypeIdx.get(name) ?? [];
  }

  /** Basit varlıklar + bu adı parça olarak içeren karmaşık varlıklar. */
  allOf(name: string): number[] {
    if (!this.complexParts) {
      const m = new Map<string, number[]>();
      for (const id of this.ofType('COMPLEX_ENTITY'))
        for (const p of this.parts(id)) {
          let l = m.get(p.name);
          if (!l) m.set(p.name, (l = []));
          l.push(id);
        }
      this.complexParts = m;
    }
    const simple = this.ofType(name);
    const cx = this.complexParts.get(name);
    return cx ? [...simple, ...cx] : simple;
  }

  /** Karmaşık varlıklarda geçen tüm parça adları. */
  complexPartNames(): string[] {
    this.allOf('');
    return [...(this.complexParts?.keys() ?? [])];
  }

  private scan() {
    const t = this.text;
    const n = t.length;
    const head = /\bHEADER\s*;/.exec(t.length > 2_000_000 ? t.slice(0, 2_000_000) : t);
    let pos = 0;
    if (head) {
      const e = t.indexOf('ENDSEC', head.index);
      this.headerText = (e < 0 ? t.slice(head.index + head[0].length, head.index + 200_000) : t.slice(head.index + head[0].length, e)).replace(/\/\*[\s\S]*?\*\//g, '');
      pos = e < 0 ? head.index : e + 6;
    }
    let garbage = 0;
    let truncated = false;
    let dup = 0;
    const dataRe = /\bDATA\b\s*[;(]/g;
    for (;;) {
      dataRe.lastIndex = pos;
      const d = dataRe.exec(t);
      if (!d) break;
      let i = d.index + d[0].length;
      if (t[i - 1] === '(') {
        // DATA('ad',('şema')); – parametreleri atla
        i = skipBalanced(t, i - 1);
        const semi = t.indexOf(';', i);
        i = semi < 0 ? n : semi + 1;
      }
      // DATA bölümü gövdesi
      while (i < n) {
        const c = t.charCodeAt(i);
        if (c <= 32) {
          i++;
          continue;
        }
        if (c === 47 && t.charCodeAt(i + 1) === 42) {
          const e = t.indexOf('*/', i + 2);
          i = e < 0 ? n : e + 2;
          continue;
        }
        if (c === 35) {
          let j = i + 1;
          let id = 0;
          const s0 = j;
          while (j < n && isDigit(t.charCodeAt(j))) id = id * 10 + (t.charCodeAt(j++) - 48);
          j = skipWs(t, j);
          if (j === s0 || t.charCodeAt(j) !== 61) {
            garbage++;
            i = nextSemi(t, j);
            continue;
          }
          j = skipWs(t, j + 1);
          let name: string;
          const c2 = t.charCodeAt(j);
          if (isLetter(c2)) {
            const ns = j;
            while (j < n && isIdent(t.charCodeAt(j))) j++;
            name = t.slice(ns, j).toUpperCase();
            j = skipWs(t, j);
            if (t.charCodeAt(j) !== 40) {
              garbage++;
              i = nextSemi(t, j);
              continue;
            }
          } else if (c2 === 40) name = 'COMPLEX_ENTITY';
          else {
            garbage++;
            i = nextSemi(t, j);
            continue;
          }
          const ps = j;
          const end = findEntityEnd(t, j);
          if (end < 0) {
            truncated = true;
            i = n;
            break;
          }
          if (this.index.has(id)) dup++;
          else {
            this.index.set(id, this.ids.length);
            this.ids.push(id);
            this.types.push(name);
            this.starts.push(ps);
            this.ends.push(end);
            this.counts[name] = (this.counts[name] ?? 0) + 1;
          }
          i = end + 1;
          continue;
        }
        if (isLetter(c)) {
          let j = i;
          while (j < n && isIdent(t.charCodeAt(j))) j++;
          const w = t.slice(i, j).toUpperCase();
          if (w === 'ENDSEC') {
            i = j;
            break;
          }
        }
        garbage++;
        i = nextSemi(t, i);
      }
      pos = i;
      if (i >= n) break;
    }
    if (truncated) this.warnings.push('STEP dosyası kesik görünüyor: son varlık tamamlanmamış (dosya eksik kopyalanmış olabilir).');
    if (garbage) this.warnings.push(`DATA bölümünde ${garbage} çözümlenemeyen kayıt atlandı.`);
    if (dup) this.warnings.push(`${dup} yinelenen varlık numarası (#id) yok sayıldı.`);
  }
}

function skipWs(t: string, j: number): number {
  const n = t.length;
  for (;;) {
    while (j < n && t.charCodeAt(j) <= 32) j++;
    if (t.charCodeAt(j) === 47 && t.charCodeAt(j + 1) === 42) {
      const e = t.indexOf('*/', j + 2);
      j = e < 0 ? n : e + 2;
      continue;
    }
    return j;
  }
}

function nextSemi(t: string, j: number): number {
  // Dize içindeki ';' atlanarak bir sonraki kayıt sonu
  const n = t.length;
  while (j < n) {
    const c = t.charCodeAt(j);
    if (c === 39) j = endOfString(t, j);
    else if (c === 59) return j + 1;
    else j++;
  }
  return n;
}

/** ' ile başlayan dizenin bittiği konumdan bir sonraki indeks. */
function endOfString(t: string, j: number): number {
  let k = j + 1;
  for (;;) {
    const q = t.indexOf("'", k);
    if (q < 0) return t.length;
    if (t.charCodeAt(q + 1) === 39) {
      k = q + 2;
      continue;
    }
    return q + 1;
  }
}

function skipBalanced(t: string, j: number): number {
  let depth = 0;
  const n = t.length;
  while (j < n) {
    const c = t.charCodeAt(j);
    if (c === 39) {
      j = endOfString(t, j);
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41 && --depth === 0) return j + 1;
    j++;
  }
  return n;
}

/** '(' konumundan başlayarak varlığı bitiren ';' konumu; bulunamazsa -1. */
function findEntityEnd(t: string, j: number): number {
  const n = t.length;
  let depth = 0;
  while (j < n) {
    const c = t.charCodeAt(j);
    if (c === 39) {
      j = endOfString(t, j);
      if (j >= n) return -1;
      continue;
    }
    if (c === 34) {
      const q = t.indexOf('"', j + 1);
      if (q < 0) return -1;
      j = q + 1;
      continue;
    }
    if (c === 47 && t.charCodeAt(j + 1) === 42) {
      const e = t.indexOf('*/', j + 2);
      if (e < 0) return -1;
      j = e + 2;
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41) depth--;
    else if (c === 59 && depth <= 0) return j;
    j++;
  }
  return -1;
}

/** text[pos] === '(' olan listeyi ayrıştırır, [değerler, ')' sonrası konum] döner. */
export function parseList(t: string, pos: number, end: number, depth: number): [Val[], number] {
  if (depth > 64) throw new Error('STEP parametre iç içeliği çok derin');
  const out: Val[] = [];
  let i = pos + 1;
  while (i < end) {
    const c = t.charCodeAt(i);
    if (c <= 32 || c === 44) {
      i++;
      continue;
    }
    if (c === 41) return [out, i + 1];
    if (c === 47 && t.charCodeAt(i + 1) === 42) {
      const e = t.indexOf('*/', i + 2);
      i = e < 0 ? end : e + 2;
      continue;
    }
    if (c === 39) {
      const e = endOfString(t, i);
      out.push(stepString(fixUtf8(t.slice(i + 1, e - 1))));
      i = e;
      continue;
    }
    if (c === 34) {
      const q = t.indexOf('"', i + 1);
      const e = q < 0 ? end : q;
      out.push(t.slice(i + 1, e));
      i = e + 1;
      continue;
    }
    if (c === 35) {
      let j = i + 1;
      let id = 0;
      while (j < end && isDigit(t.charCodeAt(j))) id = id * 10 + (t.charCodeAt(j++) - 48);
      out.push(new Ref(id));
      i = j;
      continue;
    }
    if (c === 36) {
      out.push(null);
      i++;
      continue;
    }
    if (c === 42) {
      out.push(DERIVED);
      i++;
      continue;
    }
    if (c === 46 && isLetter(t.charCodeAt(i + 1))) {
      const e = t.indexOf('.', i + 1);
      const stop = e < 0 || e > end ? end : e;
      out.push(new Enum(t.slice(i + 1, stop).toUpperCase()));
      i = stop + 1;
      continue;
    }
    if (isDigit(c) || c === 45 || c === 43 || c === 46) {
      let j = i + 1;
      while (j < end) {
        const d = t.charCodeAt(j);
        if (isDigit(d) || d === 46 || d === 69 || d === 101 || ((d === 45 || d === 43) && (t.charCodeAt(j - 1) | 32) === 101)) j++;
        else break;
      }
      const v = Number(t.slice(i, j));
      out.push(Number.isFinite(v) ? v : null);
      i = j;
      continue;
    }
    if (c === 40) {
      const [l, j] = parseList(t, i, end, depth + 1);
      out.push(l);
      i = j;
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (j < end && isIdent(t.charCodeAt(j))) j++;
      const name = t.slice(i, j).toUpperCase();
      while (j < end && t.charCodeAt(j) <= 32) j++;
      if (t.charCodeAt(j) === 40) {
        const [l, k] = parseList(t, j, end, depth + 1);
        out.push(new Typed(name, l));
        i = k;
      } else {
        out.push(new Enum(name));
        i = j;
      }
      continue;
    }
    i++; // tanınmayan karakter
  }
  return [out, end];
}

// ───────── Değer erişim yardımcıları ─────────

export const isRef = (v: Val | undefined): v is Ref => v instanceof Ref;
export const refId = (v: Val | undefined): number | undefined => (v instanceof Ref ? v.id : undefined);
export const str = (v: Val | undefined): string => (typeof v === 'string' ? v : '');
export const list = (v: Val | undefined): Val[] => (Array.isArray(v) ? v : []);
export const enumV = (v: Val | undefined): string | undefined => (v instanceof Enum ? v.v : undefined);
export function num(v: Val | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (v instanceof Typed && v.args.length) return num(v.args[0]);
  return undefined;
}
/** Bir değerin içindeki tüm referanslar (derin). */
export function refsIn(v: Val | undefined, out: number[] = []): number[] {
  if (v instanceof Ref) out.push(v.id);
  else if (Array.isArray(v)) for (const x of v) refsIn(x, out);
  else if (v instanceof Typed) for (const x of v.args) refsIn(x, out);
  return out;
}
