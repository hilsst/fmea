// CAD analizinde kullanılan küçük vektör / kutu yardımcıları ve sayı biçimlendirme.
import type { CadBBox, Vec3 } from '../../../shared/docmodel';

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3) => Math.sqrt(dot(a, a));
export function unit(a: Vec3): Vec3 | undefined {
  const l = len(a);
  return l > 1e-12 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : undefined;
}

/** a'ya dik herhangi bir birim vektör. */
export function anyPerp(a: Vec3): Vec3 {
  const t: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(a, t)) ?? [1, 0, 0];
}

export class Box {
  min: Vec3 = [Infinity, Infinity, Infinity];
  max: Vec3 = [-Infinity, -Infinity, -Infinity];
  n = 0;
  add(x: number, y: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
    this.n++;
  }
  addV(v: Vec3) {
    this.add(v[0], v[1], v[2]);
  }
  merge(b: Box) {
    if (!b.n) return;
    this.addV(b.min);
    this.addV(b.max);
    this.n += b.n - 2;
  }
  get empty() {
    return this.n === 0;
  }
  toBBox(scaleToMm: number, source: CadBBox['source']): CadBBox | undefined {
    if (!this.n) return undefined;
    const r = (v: number) => Math.round(v * 1e9) / 1e9;
    const size = sub(this.max, this.min).map(r) as Vec3;
    return {
      min: this.min.map(r) as Vec3,
      max: this.max.map(r) as Vec3,
      size,
      sizeMm: size.map((v) => r(v * scaleToMm)) as Vec3,
      source,
    };
  }
}

/** Ölçü biçimlendirme: mm için 2 hane (1'den küçükse en çok 3: 0.10, 0.05, 0.025), inç için 3 hane (0.1'den küçükse 4). -0 → 0. */
export function fmt(v: number, unitLabel = 'mm'): string {
  const a = Math.abs(v);
  const inch = unitLabel === 'in';
  const d = inch ? (a < 0.1 && a > 0 ? 4 : 3) : a < 1 && a > 0 ? 3 : 2;
  let s = v.toFixed(d);
  const minD = inch ? 3 : 2;
  while (s.endsWith('0') && (s.split('.')[1]?.length ?? 0) > minD) s = s.slice(0, -1);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export const roundTo = (v: number, step: number) => Math.round(v / step) * step;
