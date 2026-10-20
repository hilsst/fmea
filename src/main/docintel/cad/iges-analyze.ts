// IGES geometri analizi: varlık parametrelerinden nokta toplayıp (124 dönüşüm matrisleri uygulanarak)
// sınırlayıcı kutu, daire / yay çap grupları, silindirik yüzeyler (192, 120, 122), yüz türleri, katı sayısı.
// Bağımlı (alt) varlıklar ebeveynin dönüşümüyle birlikte, IGES anlamına uygun olarak işlenir.
import type { CadCircleGroup, CadHoleGroup, Vec3 } from '../../../shared/docmodel';
import { Box, cross, dot, len, mul, sub, unit as unitVec, addV, roundTo } from './geom';

export interface IgesEnt {
  de: number;
  type: number;
  form: number;
  level: number;
  /** 124 dönüşüm matrisi DE işaretçisi (0 = yok) */
  xform: number;
  blank: number;
  sub: number;
  use: number;
}

export interface IgesGeometry {
  box: Box;
  circles: CadCircleGroup[];
  cylinders: CadHoleGroup[];
  faces: Record<string, number>;
  solids: number;
  shells: number;
  transformed: number;
  warnings: string[];
}

type Mat = number[]; // [R11 R12 R13 T1 R21 R22 R23 T2 R31 R32 R33 T3]
const apply = (m: Mat, p: Vec3): Vec3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];
const applyDir = (m: Mat, p: Vec3): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]];
/** outer ∘ inner */
function compose(o: Mat, i: Mat): Mat {
  const r: Mat = new Array(12).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) r[row * 4 + col] = o[row * 4] * i[col] + o[row * 4 + 1] * i[4 + col] + o[row * 4 + 2] * i[8 + col];
    r[row * 4 + 3] = o[row * 4] * i[3] + o[row * 4 + 1] * i[7] + o[row * 4 + 2] * i[11] + o[row * 4 + 3];
  }
  return r;
}

const SURF_KEY: Record<number, string> = {
  108: 'PLANE', 190: 'PLANE', 192: 'CYLINDRICAL_SURFACE', 194: 'CONICAL_SURFACE', 196: 'SPHERICAL_SURFACE', 198: 'TOROIDAL_SURFACE',
  128: 'B_SPLINE_SURFACE', 120: 'SURFACE_OF_REVOLUTION', 122: 'TABULATED_CYLINDER', 118: 'RULED_SURFACE', 140: 'OFFSET_SURFACE',
  114: 'PARAMETRIC_SPLINE_SURFACE',
};

/** Geometri olmayan (açıklama, ölçü, yapı, özellik) türler kutuya katılmaz. */
const isGeomType = (t: number) => t >= 100 && t < 200 && t !== 124 && t !== 123 && t !== 134 ? true : t >= 502 && t <= 514;

export function analyzeIges(ents: Map<number, IgesEnt>, P: (de: number) => number[], scale: number): IgesGeometry {
  const warnings: string[] = [];
  const out: IgesGeometry = { box: new Box(), circles: [], cylinders: [], faces: {}, solids: 0, shells: 0, transformed: 0, warnings };
  const ent = (de: number) => ents.get(de);

  // Parametre uzayı (UV) eğrileri kutuya katılmaz
  const paramSpace = new Set<number>();
  for (const e of ents.values()) {
    if (e.use === 5) paramSpace.add(e.de);
    if (e.type === 142) {
      const p = P(e.de);
      if (p[3]) paramSpace.add(p[3]);
    }
    if (e.type === 141) {
      const p = P(e.de);
      const n = p[4] || 0;
      let k = 5;
      for (let i = 0; i < n && k < p.length; i++) {
        const kk = p[k + 2] || 0;
        for (let j = 0; j < kk; j++) paramSpace.add(p[k + 3 + j]);
        k += 3 + kk;
      }
    }
  }

  // Dönüşüm zinciri
  const xcache = new Map<number, Mat | null>();
  const chain = (de: number, depth = 0): Mat | null => {
    if (!de || depth > 16) return null;
    if (xcache.has(de)) return xcache.get(de)!;
    xcache.set(de, null);
    const e = ent(de);
    if (!e || e.type !== 124) return null;
    const p = P(de);
    let m: Mat = p.slice(1, 13);
    if (m.length < 12 || m.some((v) => !Number.isFinite(v))) return null;
    const parent = chain(e.xform, depth + 1);
    if (parent) m = compose(parent, m);
    xcache.set(de, m);
    return m;
  };

  const memo = new Map<number, Vec3[]>();
  const visited = new Set<number>();
  let nested = 0;

  const pointsOf = (de: number, depth = 0): Vec3[] => {
    if (!de || depth > 32 || paramSpace.has(de)) return [];
    const cached = memo.get(de);
    if (cached) return cached;
    const e = ent(de);
    if (!e) return [];
    memo.set(de, []); // döngü koruması
    visited.add(de);
    const p = P(de);
    const pts: Vec3[] = [];
    const kids = (ids: number[]) => {
      for (const c of ids) if (c > 0) for (const q of pointsOf(c, depth + 1)) pts.push(q);
    };
    const triple = (k: number): Vec3 => [p[k], p[k + 1], p[k + 2]];
    switch (e.type) {
      case 100: {
        const zt = p[1], c: [number, number] = [p[2], p[3]], s: [number, number] = [p[4], p[5]], en: [number, number] = [p[6], p[7]];
        const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
        if (!(r > 0)) break;
        const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
        let a1 = Math.atan2(en[1] - c[1], en[0] - c[0]);
        if (Math.hypot(en[0] - s[0], en[1] - s[1]) < 1e-9 * Math.max(1, r)) a1 = a0 + 2 * Math.PI;
        while (a1 <= a0) a1 += 2 * Math.PI;
        const n = 32;
        for (let i = 0; i <= n; i++) {
          const a = a0 + ((a1 - a0) * i) / n;
          pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), zt]);
        }
        break;
      }
      case 104:
        pts.push([p[8], p[9], p[7]], [p[10], p[11], p[7]]);
        break;
      case 106: {
        const ip = p[1], n = p[2] || 0;
        if (ip === 1) for (let i = 0; i < n; i++) pts.push([p[4 + 2 * i], p[5 + 2 * i], p[3]]);
        else if (ip === 2) for (let i = 0; i < n; i++) pts.push(triple(3 + 3 * i));
        else if (ip === 3) for (let i = 0; i < n; i++) pts.push(triple(3 + 6 * i));
        break;
      }
      case 110:
        pts.push(triple(1), triple(4));
        break;
      case 116:
        pts.push(triple(1));
        break;
      case 126: {
        const K = p[1], M = p[2];
        const start = 7 + (K + M + 2) + (K + 1);
        for (let i = 0; i <= K; i++) pts.push(triple(start + 3 * i));
        break;
      }
      case 128: {
        const K1 = p[1], K2 = p[2], M1 = p[3], M2 = p[4];
        const nc = (K1 + 1) * (K2 + 1);
        const start = 10 + (K1 + M1 + 2) + (K2 + M2 + 2) + nc;
        for (let i = 0; i < nc; i++) pts.push(triple(start + 3 * i));
        break;
      }
      case 502: {
        const n = p[1] || 0;
        for (let i = 0; i < n; i++) pts.push(triple(2 + 3 * i));
        break;
      }
      case 192:
      case 194:
      case 190:
        kids([p[1]]);
        break;
      case 196: {
        const c = pointsOf(p[1], depth + 1)[0];
        const r = p[2];
        if (c && r > 0) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) pts.push(addV(c, mul(d, r)));
        break;
      }
      case 102:
        kids(p.slice(2, 2 + (p[1] || 0)));
        break;
      case 108:
        if (p[5]) kids([p[5]]);
        else pts.push(triple(6));
        break;
      case 118:
        kids([p[1], p[2]]);
        break;
      case 120: {
        const axis = pointsOf(p[1], depth + 1);
        const gen = pointsOf(p[2], depth + 1);
        const sa = p[3], ta = p[4];
        if (axis.length >= 2 && Number.isFinite(sa) && Number.isFinite(ta)) {
          const o = axis[0];
          const k = unitVec(sub(axis[axis.length - 1], o));
          if (k) {
            const steps = 16;
            for (const q of gen)
              for (let i = 0; i <= steps; i++) pts.push(rotateAbout(q, o, k, sa + ((ta - sa) * i) / steps));
          }
        }
        if (!pts.length) for (const q of gen) pts.push(q);
        break;
      }
      case 122: {
        const dir = pointsOf(p[1], depth + 1);
        if (dir.length) {
          const off = sub([p[2], p[3], p[4]], dir[0]);
          for (const q of dir) pts.push(q, addV(q, off));
        }
        break;
      }
      case 141: {
        const n = p[4] || 0;
        let k = 5;
        const crv: number[] = [];
        for (let i = 0; i < n && k < p.length; i++) {
          crv.push(p[k]);
          k += 3 + (p[k + 2] || 0);
        }
        kids(crv.length ? crv : [p[3]]);
        break;
      }
      case 142:
        kids([p[4] || p[2]]);
        break;
      case 143: {
        const n = p[3] || 0;
        const b = p.slice(4, 4 + n);
        kids(b.length ? b : [p[2]]);
        break;
      }
      case 144: {
        const n2 = p[3] || 0;
        if (p[4]) kids([p[4], ...p.slice(5, 5 + n2)]);
        else kids([p[1]]);
        break;
      }
      case 186: {
        const nv = p[3] || 0;
        const ids = [p[1]];
        for (let i = 0; i < nv; i++) ids.push(p[4 + 2 * i]);
        kids(ids);
        break;
      }
      case 514: {
        const n = p[1] || 0;
        const ids: number[] = [];
        for (let i = 0; i < n; i++) ids.push(p[2 + 2 * i]);
        kids(ids);
        break;
      }
      case 510: {
        const n = p[2] || 0;
        kids(n ? p.slice(4, 4 + n) : [p[1]]);
        break;
      }
      case 508: {
        const n = p[1] || 0;
        let k = 2;
        const ids: number[] = [];
        for (let i = 0; i < n && k < p.length; i++) {
          ids.push(p[k + 1]);
          k += 5 + 2 * (p[k + 4] || 0);
        }
        kids(ids);
        break;
      }
      case 504: {
        const n = p[1] || 0;
        const ids: number[] = [];
        for (let i = 0; i < n; i++) ids.push(p[2 + 5 * i]);
        kids(ids);
        break;
      }
      default:
        break;
    }
    let res = pts.filter((q) => q.every(Number.isFinite));
    const m = chain(e.xform);
    if (m) {
      res = res.map((q) => apply(m, q));
      out.transformed++;
    }
    if (depth > 0) nested++;
    memo.set(de, res);
    return res;
  };

  // 1. geçiş: bağımsız geometri varlıkları (alt varlıklar ebeveyn üzerinden dönüşümle gelir)
  const geomEnts = [...ents.values()].filter((e) => isGeomType(e.type) && !paramSpace.has(e.de) && e.use !== 1 && e.use !== 2);
  for (const e of geomEnts) {
    if (e.sub === 1 || e.sub === 3) continue;
    for (const q of pointsOf(e.de)) out.box.addV(q);
  }
  // 2. geçiş: hiçbir ebeveynden ulaşılmamış bağımlı varlıklar (yazıcı bayrakları hatalıysa)
  let orphans = 0;
  for (const e of geomEnts) {
    if (visited.has(e.de)) continue;
    orphans++;
    for (const q of pointsOf(e.de)) out.box.addV(q);
  }
  if (orphans && orphans === geomEnts.length) orphans = 0;
  if (orphans) warnings.push(`${orphans} bağımlı geometri varlığına ebeveynden ulaşılamadı; yalnızca kendi dönüşümleriyle kutuya katıldı.`);
  if ([...ents.values()].some((e) => e.type === 408)) warnings.push('Alt şekil örnekleri (408) yerleştirilmedi; kutuya dahil değil (NOT SUPPORTED).');

  // Daireler / yaylar (yarıçap rijit dönüşümde değişmez)
  const cg = new Map<number, CadCircleGroup>();
  for (const e of ents.values()) {
    if (e.type !== 100 || paramSpace.has(e.de) || e.use === 1 || e.use === 2) continue;
    const p = P(e.de);
    const r = Math.hypot(p[4] - p[2], p[5] - p[3]);
    if (!(r > 0)) continue;
    const full = Math.hypot(p[6] - p[4], p[7] - p[5]) < 1e-9 * Math.max(1, r);
    const dia = Math.round(2 * r * matScale(chain(e.xform)) * 1e6) / 1e6;
    let gq = cg.get(dia);
    if (!gq) cg.set(dia, (gq = { diameter: dia, diameterMm: Math.round(dia * scale * 1e6) / 1e6, count: 0, full: 0, arcs: 0 }));
    gq.count++;
    if (full) gq.full++;
    else gq.arcs++;
  }
  out.circles = [...cg.values()].sort((a, b) => a.diameter - b.diameter);

  // Silindirik yüzeyler: 192, çizgi üretecli 120, tam daire yönergeli 122
  const cyl = new Map<number, { faces: number; axes: Set<string> }>();
  const addCyl = (r: number, key: string) => {
    const dia = Math.round(2 * r * 1e6) / 1e6;
    let c = cyl.get(dia);
    if (!c) cyl.set(dia, (c = { faces: 0, axes: new Set() }));
    c.faces++;
    c.axes.add(key);
  };
  for (const e of ents.values()) {
    const p = P(e.de);
    const m = chain(e.xform);
    if (e.type === 192 && p[3] > 0) {
      const loc = pointsOf(p[1])[0];
      const ax = ent(p[2]) ? P(p[2]) : [];
      let d: Vec3 | undefined = ax.length >= 4 ? unitVec([ax[1], ax[2], ax[3]]) : undefined;
      const r = p[3] * matScale(m);
      if (loc && d) {
        if (m) d = unitVec(applyDir(m, d)) ?? d;
        const l = m ? apply(m, loc) : loc;
        addCyl(r, axisKey(l, d));
      } else addCyl(r, `#${e.de}`);
    } else if (e.type === 120) {
      const L = ent(p[1]), C = ent(p[2]);
      if (L?.type === 110 && C?.type === 110 && Math.abs(Math.abs(p[4] - p[3]) - 2 * Math.PI) < 1e-3) {
        const a = pointsOf(p[1]), g = pointsOf(p[2]);
        const k = a.length >= 2 ? unitVec(sub(a[1], a[0])) : undefined;
        const gd = g.length >= 2 ? unitVec(sub(g[1], g[0])) : undefined;
        if (k && gd && len(cross(k, gd)) < 1e-6) {
          const v = sub(g[0], a[0]);
          const r = len(sub(v, mul(k, dot(v, k)))) * matScale(m);
          if (r > 0) addCyl(r, `#${e.de}`);
        }
      }
    } else if (e.type === 122) {
      const D = ent(p[1]);
      if (D?.type === 100) {
        const dp = P(p[1]);
        const r = Math.hypot(dp[4] - dp[2], dp[5] - dp[3]);
        const full = Math.hypot(dp[6] - dp[4], dp[7] - dp[5]) < 1e-9 * Math.max(1, r);
        const dpts = pointsOf(p[1]);
        const dm = chain(D.xform);
        const nrm = dm ? applyDir(dm, [0, 0, 1]) : ([0, 0, 1] as Vec3);
        const gen = dpts.length ? unitVec(sub([p[2], p[3], p[4]], dpts[0])) : undefined;
        if (full && r > 0 && gen && len(cross(unitVec(nrm) ?? [0, 0, 1], gen)) < 1e-6) addCyl(r * matScale(dm) * matScale(m), `#${e.de}`);
      }
    }
  }
  out.cylinders = [...cyl.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dia, c]) => ({ diameter: dia, diameterMm: Math.round(dia * scale * 1e6) / 1e6, count: c.axes.size, faces: c.faces, kind: 'cylindrical' as const }));

  // Yüz türleri: 510 yüzler; yoksa 144 kırpılmış yüzeyler
  const faces510 = [...ents.values()].filter((e) => e.type === 510);
  const faceSrc = faces510.length ? faces510 : [...ents.values()].filter((e) => e.type === 144);
  for (const e of faceSrc) {
    const s = ent(P(e.de)[1]);
    const k = s ? (SURF_KEY[s.type] ?? `IGES_${s.type}`) : 'UNKNOWN';
    out.faces[k] = (out.faces[k] ?? 0) + 1;
  }
  out.solids = [...ents.values()].filter((e) => e.type === 186).length;
  out.shells = [...ents.values()].filter((e) => e.type === 514).length;
  void nested;
  return out;
}

function matScale(m: Mat | null): number {
  if (!m) return 1;
  const s = len([m[0], m[4], m[8]]);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function axisKey(loc: Vec3, d: Vec3): string {
  const k = Math.abs(d[0]) > 1e-9 ? 0 : Math.abs(d[1]) > 1e-9 ? 1 : 2;
  const dd = d[k] < 0 ? mul(d, -1) : d;
  const p = sub(loc, mul(dd, dot(loc, dd)));
  return `${dd.map((v) => roundTo(v, 1e-4).toFixed(4)).join(',')}|${p.map((v) => roundTo(v, 1e-3).toFixed(3)).join(',')}`;
}

/** q noktasını (o, k) ekseni etrafında a radyan döndürür (Rodrigues). */
function rotateAbout(q: Vec3, o: Vec3, k: Vec3, a: number): Vec3 {
  const v = sub(q, o);
  const c = Math.cos(a), s = Math.sin(a);
  const r = addV(addV(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
  return addV(o, r);
}
