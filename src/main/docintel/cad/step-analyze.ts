// STEP (AP203 / AP214 / AP242) varlık grafiğinden mühendislik bilgisi: birimler, ürün / montaj yapısı,
// malzeme, B-rep topolojisinden sınırlayıcı kutu, silindirik özellikler (delik / çıkıntı), daireler,
// yüz türleri, sezgisel et kalınlığı ve AP242 semantik PMI (ölçü + tolerans + GD&T + datum).
import type {
  CadAssemblyLink, CadCircleGroup, CadHoleGroup, CadMaterial, CadPart, CadPmi, CadThickness, CadBBox, Vec3,
} from '../../../shared/docmodel';
import { Box, anyPerp, cross, dot, fmt, len, mul, roundTo, sub, unit as unitVec, addV } from './geom';
import { Enum, StepFile, Typed, enumV, list, num, refId, refsIn, str, type Val } from './step-graph';

export interface StepGeometry {
  units?: string;
  unitScaleToMm: number;
  unitKnown: boolean;
  bbox?: CadBBox;
  /** Kutunun güvenilir (B-rep / köşe / tessellation) olup olmadığı */
  geometryUnderstood: boolean;
  solids: number;
  shells: number;
  surfaceModels: number;
  faces: Record<string, number>;
  holes: CadHoleGroup[];
  circles: CadCircleGroup[];
  parts: CadPart[];
  assembly: CadAssemblyLink[];
  materials: CadMaterial[];
  pmi: CadPmi[];
  thickness: CadThickness[];
  warnings: string[];
  presentationPmi: number;
  bsplineInBox: boolean;
}

interface UnitInfo {
  kind: 'length' | 'angle' | 'other';
  /** uzunluk → mm, açı → derece */
  scale: number;
  label: string;
}

const SI_PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};
const PREFIX_LABEL: Record<string, string> = { MILLI: 'mm', CENTI: 'cm', MICRO: 'µm', KILO: 'km', DECI: 'dm', NANO: 'nm' };

const BODY_TYPES = ['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL'];
const SOLID_TYPES = new Set(['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP']);
const DESCEND = new Set([
  'MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL', 'CLOSED_SHELL', 'OPEN_SHELL',
  'ORIENTED_CLOSED_SHELL', 'ORIENTED_OPEN_SHELL', 'ORIENTED_FACE', 'ADVANCED_FACE', 'FACE_SURFACE', 'FACE_OUTER_BOUND',
  'FACE_BOUND', 'EDGE_LOOP', 'ORIENTED_EDGE', 'EDGE_CURVE', 'VERTEX_POINT', 'POLY_LOOP', 'VERTEX_LOOP', 'SUBEDGE',
]);
const FACE_TYPES = ['ADVANCED_FACE', 'FACE_SURFACE'];

export const GDT_LABEL: Record<string, string> = {
  FLATNESS_TOLERANCE: 'Düzlemsellik', STRAIGHTNESS_TOLERANCE: 'Doğrusallık', ROUNDNESS_TOLERANCE: 'Dairesellik',
  CYLINDRICITY_TOLERANCE: 'Silindiriklik', PERPENDICULARITY_TOLERANCE: 'Diklik', PARALLELISM_TOLERANCE: 'Paralellik',
  ANGULARITY_TOLERANCE: 'Açısallık', POSITION_TOLERANCE: 'Konum', CONCENTRICITY_TOLERANCE: 'Eş merkezlilik',
  COAXIALITY_TOLERANCE: 'Eş eksenlilik', SYMMETRY_TOLERANCE: 'Simetri', CIRCULAR_RUNOUT_TOLERANCE: 'Dairesel salgı',
  TOTAL_RUNOUT_TOLERANCE: 'Toplam salgı', LINE_PROFILE_TOLERANCE: 'Çizgi profili', SURFACE_PROFILE_TOLERANCE: 'Yüzey profili',
  GEOMETRIC_TOLERANCE: 'Geometrik tolerans',
};

export function analyzeStep(f: StepFile): StepGeometry {
  const warnings: string[] = [];
  const g: StepGeometry = {
    unitScaleToMm: 1, unitKnown: false, geometryUnderstood: false, solids: 0, shells: 0, surfaceModels: 0, faces: {},
    holes: [], circles: [], parts: [], assembly: [], materials: [], pmi: [], thickness: [], warnings, presentationPmi: 0, bsplineInBox: false,
  };

  // ───── Birimler ─────
  const unitCache = new Map<number, UnitInfo | undefined>();
  const unitInfo = (id: number | undefined, depth = 0): UnitInfo | undefined => {
    if (id == null || depth > 6) return undefined;
    if (unitCache.has(id)) return unitCache.get(id);
    unitCache.set(id, undefined);
    let u: UnitInfo | undefined;
    const si = f.partArgs(id, 'SI_UNIT');
    const cb = f.partArgs(id, 'CONVERSION_BASED_UNIT');
    if (si) {
      const a = si.slice(-2);
      const prefix = enumV(a[0]) ?? '';
      const name = enumV(a[1]) ?? '';
      const p = prefix ? (SI_PREFIX[prefix] ?? 1) : 1;
      if (name === 'METRE') u = { kind: 'length', scale: p * 1000, label: prefix ? (PREFIX_LABEL[prefix] ?? `${prefix.toLowerCase()}m`) : 'm' };
      else if (name === 'RADIAN') u = { kind: 'angle', scale: (p * 180) / Math.PI, label: 'rad' };
      else u = { kind: 'other', scale: p, label: name.toLowerCase() };
    } else if (cb) {
      const name = str(cb[0]);
      const m = measureOf(f, refId(cb[1]));
      const base = unitInfo(m?.unit, depth + 1);
      const isLen = base?.kind === 'length' || f.has(id, 'LENGTH_UNIT');
      const isAng = base?.kind === 'angle' || f.has(id, 'PLANE_ANGLE_UNIT');
      let scale = (m?.value ?? NaN) * (base?.scale ?? NaN);
      const lname = name.toLowerCase();
      if (!Number.isFinite(scale) || scale <= 0)
        scale = /^inch|^in$/.test(lname) ? 25.4 : /^f(oo|ee)t|^ft$/.test(lname) ? 304.8 : /^deg/.test(lname) ? 1 : NaN;
      const label = /^inch|^in$/.test(lname) ? 'in' : /^f(oo|ee)t|^ft$/.test(lname) ? 'ft' : /^deg/.test(lname) ? '°' : lname;
      u = { kind: isLen ? 'length' : isAng ? 'angle' : 'other', scale, label };
    }
    unitCache.set(id, u);
    return u;
  };

  const lengthUnits: UnitInfo[] = [];
  for (const id of f.allOf('GLOBAL_UNIT_ASSIGNED_CONTEXT')) {
    const a = f.partArgs(id, 'GLOBAL_UNIT_ASSIGNED_CONTEXT');
    for (const r of list(a?.[0])) {
      const u = unitInfo(refId(r));
      if (u?.kind === 'length' && Number.isFinite(u.scale)) lengthUnits.push(u);
    }
  }
  if (!lengthUnits.length)
    for (const id of f.allOf('LENGTH_UNIT')) {
      const u = unitInfo(id);
      if (u?.kind === 'length' && Number.isFinite(u.scale)) {
        lengthUnits.push(u);
        break;
      }
    }
  if (lengthUnits.length) {
    g.units = lengthUnits[0].label;
    g.unitScaleToMm = lengthUnits[0].scale;
    g.unitKnown = true;
    const distinct = new Set(lengthUnits.map((u) => u.label));
    if (distinct.size > 1)
      warnings.push(`Dosyada birden fazla uzunluk birimi var (${[...distinct].join(', ')}); tüm geometri ${g.units} kabul edildi.`);
  } else warnings.push('Uzunluk birimi bulunamadı; değerler mm kabul edildi (doğrulanmalı).');

  /** Bir ölçü varlığının değerini mm (uzunluk) veya derece (açı) cinsine çevirir. */
  const measureMm = (id: number | undefined): { value: number; unit: string; name: string } | undefined => {
    const m = measureOf(f, id);
    if (!m || m.value == null) return undefined;
    const u = unitInfo(m.unit);
    if (u?.kind === 'angle' || /PLANE_ANGLE/.test(m.kindName)) return { value: m.value * (u?.scale ?? 1), unit: '°', name: m.name };
    if (u?.kind === 'length') return { value: m.value * u.scale, unit: 'mm', name: m.name };
    if (u && u.kind === 'other') return { value: m.value, unit: u.label, name: m.name };
    return { value: m.value * g.unitScaleToMm, unit: 'mm', name: m.name };
  };

  // ───── Ürünler ve montaj ─────
  const products = new Map<number, { id: string; name: string; desc: string }>();
  for (const id of f.ofType('PRODUCT')) {
    const a = f.args(id) ?? [];
    products.set(id, { id: str(a[0]), name: str(a[1]), desc: str(a[2]) });
  }
  const pdfInfo = new Map<number, { product: number; revision: string }>();
  for (const t of ['PRODUCT_DEFINITION_FORMATION', 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE'])
    for (const id of f.ofType(t)) {
      const a = f.args(id) ?? [];
      const p = refId(a[2]);
      if (p != null) pdfInfo.set(id, { product: p, revision: str(a[0]) });
    }
  const pdProduct = new Map<number, number>();
  const pdRevision = new Map<number, string>();
  for (const t of ['PRODUCT_DEFINITION', 'PRODUCT_DEFINITION_WITH_ASSOCIATED_DOCUMENTS'])
    for (const id of f.ofType(t)) {
      const a = f.args(id) ?? [];
      const pf = pdfInfo.get(refId(a[2]) ?? -1);
      if (pf) {
        pdProduct.set(id, pf.product);
        pdRevision.set(id, pf.revision);
      }
    }
  const prodLabel = (pid: number | undefined) => {
    const p = pid != null ? products.get(pid) : undefined;
    if (!p) return '';
    return p.name && p.id && p.name !== p.id ? `${p.id} (${p.name})` : p.id || p.name || `#${pid}`;
  };
  const partByProduct = new Map<number, CadPart>();
  for (const [pd, pid] of pdProduct) {
    if (partByProduct.has(pid)) continue;
    const p = products.get(pid)!;
    const part: CadPart = { id: p.id || `#${pid}`, name: p.name || p.id };
    if (p.desc && p.desc !== p.name) part.description = p.desc;
    const rev = pdRevision.get(pd);
    if (rev && !/^(none|any|\$|-)$/i.test(rev)) part.revision = rev;
    partByProduct.set(pid, part);
  }
  // Ürün tanımı olmayan PRODUCT'lar da listelensin
  for (const [pid, p] of products) if (!partByProduct.has(pid)) partByProduct.set(pid, { id: p.id || `#${pid}`, name: p.name || p.id });

  const linkMap = new Map<string, CadAssemblyLink>();
  for (const t of ['NEXT_ASSEMBLY_USAGE_OCCURRENCE', 'QUANTIFIED_ASSEMBLY_COMPONENT_USAGE', 'ASSEMBLY_COMPONENT_USAGE'])
    for (const id of f.allOf(t)) {
      const a = f.partArgs(id, t) ?? [];
      const pa = pdProduct.get(refId(a[3]) ?? -1);
      const ch = pdProduct.get(refId(a[4]) ?? -1);
      if (pa == null || ch == null) continue;
      let q = 1;
      if (t === 'QUANTIFIED_ASSEMBLY_COMPONENT_USAGE') {
        const m = measureOf(f, refId(a[6]));
        if (m?.value && m.value > 0) q = m.value;
      }
      const key = `${pa}>${ch}`;
      const l = linkMap.get(key);
      if (l) l.quantity += q;
      else linkMap.set(key, { parent: prodLabel(pa), child: prodLabel(ch), quantity: q });
    }
  g.assembly = [...linkMap.values()];

  // ───── Temsil grupları (dönüşümsüz SHAPE_REPRESENTATION_RELATIONSHIP ile bağlı temsiller aynı koordinatta) ─────
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  let transforms = f.ofType('MAPPED_ITEM').length > 0;
  for (const t of ['SHAPE_REPRESENTATION_RELATIONSHIP', 'REPRESENTATION_RELATIONSHIP']) {
    for (const id of f.ofType(t)) {
      const a = f.args(id) ?? [];
      const r1 = refId(a[2]), r2 = refId(a[3]);
      if (r1 != null && r2 != null) union(r1, r2);
    }
  }
  for (const id of f.allOf('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION')) if (f.type(id) === 'COMPLEX_ENTITY') transforms = true;
  if (f.ofType('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION').length) transforms = true;
  const groupProduct = new Map<number, number>();
  for (const id of f.ofType('SHAPE_DEFINITION_REPRESENTATION')) {
    const a = f.args(id) ?? [];
    const pds = refId(a[0]);
    const rep = refId(a[1]);
    if (pds == null || rep == null) continue;
    const pdsA = f.partArgs(pds, 'PRODUCT_DEFINITION_SHAPE');
    const pid = pdProduct.get(refId(pdsA?.[2]) ?? -1);
    if (pid != null && !groupProduct.has(find(rep))) groupProduct.set(find(rep), pid);
  }

  // ───── Gövdeler (katı / yüzey modeli) ─────
  const bodies: { id: number; type: string; product?: number }[] = [];
  for (const t of BODY_TYPES) for (const id of f.ofType(t)) bodies.push({ id, type: t });
  const bodyOf = new Map<number, number>();
  bodies.forEach((b, i) => bodyOf.set(b.id, i));
  // Temsil öğelerinden gövde → ürün
  for (const [i, t] of f.types.entries()) {
    if (!t.endsWith('REPRESENTATION') || t === 'SHAPE_DEFINITION_REPRESENTATION' || t === 'PROPERTY_DEFINITION_REPRESENTATION') continue;
    const rid = f.ids[i];
    const a = f.args(rid);
    if (!a) continue;
    for (const r of list(a[1])) {
      const bi = bodyOf.get(refId(r) ?? -1);
      if (bi != null && bodies[bi].product == null) {
        const pid = groupProduct.get(find(rid));
        if (pid != null) bodies[bi].product = pid;
      }
    }
  }
  g.solids = bodies.filter((b) => SOLID_TYPES.has(b.type)).length;
  g.surfaceModels = bodies.length - g.solids;
  g.shells = f.ofType('CLOSED_SHELL').length + f.ofType('OPEN_SHELL').length;

  // ───── Geometri yardımcıları ─────
  const pointCache = new Map<number, Vec3 | undefined>();
  const point = (id: number | undefined): Vec3 | undefined => {
    if (id == null) return undefined;
    if (pointCache.has(id)) return pointCache.get(id);
    const a = f.partArgs(id, 'CARTESIAN_POINT');
    const c = list(a?.[1]);
    const p: Vec3 | undefined = c.length >= 2 ? [num(c[0]) ?? NaN, num(c[1]) ?? NaN, c.length > 2 ? (num(c[2]) ?? NaN) : 0] : undefined;
    const ok = p && p.every(Number.isFinite) ? p : undefined;
    pointCache.set(id, ok);
    return ok;
  };
  const direction = (id: number | undefined): Vec3 | undefined => {
    if (id == null) return undefined;
    const c = list(f.partArgs(id, 'DIRECTION')?.[1]);
    if (c.length < 2) return undefined;
    return unitVec([num(c[0]) ?? NaN, num(c[1]) ?? NaN, c.length > 2 ? (num(c[2]) ?? NaN) : 0]);
  };
  const placement = (id: number | undefined): { loc: Vec3; z: Vec3; x: Vec3 } | undefined => {
    if (id == null) return undefined;
    const a = f.partArgs(id, 'AXIS2_PLACEMENT_3D');
    if (!a) return undefined;
    const loc = point(refId(a[1]));
    if (!loc) return undefined;
    const z = direction(refId(a[2])) ?? [0, 0, 1];
    let x = direction(refId(a[3])) ?? anyPerp(z);
    x = unitVec(sub(x, mul(z, dot(x, z)))) ?? anyPerp(z);
    return { loc, z, x };
  };
  const baseCurve = (id: number | undefined, depth = 0): number | undefined => {
    if (id == null || depth > 4) return id;
    const t = f.type(id);
    if (t === 'SURFACE_CURVE' || t === 'SEAM_CURVE' || t === 'INTERSECTION_CURVE' || t === 'TRIMMED_CURVE') return baseCurve(refId(f.args(id)?.[1]), depth + 1);
    return id;
  };
  const circleOf = (id: number | undefined): { r: number; pl: { loc: Vec3; z: Vec3; x: Vec3 } } | undefined => {
    if (id == null || f.type(id) !== 'CIRCLE') return undefined;
    const a = f.args(id) ?? [];
    const r = num(a[2]);
    const pl = placement(refId(a[1]));
    return r && r > 0 && pl ? { r, pl } : undefined;
  };
  const bsplineCtrl = (id: number): number[] | undefined => {
    const t = f.type(id) ?? '';
    if (t.startsWith('B_SPLINE_CURVE')) return refsIn(f.args(id)?.[2]);
    if (t === 'COMPLEX_ENTITY') {
      const a = f.partArgs(id, 'B_SPLINE_CURVE');
      if (a) return refsIn(a[1]);
    }
    return undefined;
  };

  // ───── B-rep yürüyüşü: gövde başına köşe noktaları + tam daire kenarları + B-spline kontrol noktaları ─────
  const N = f.size;
  const mark = new Int32Array(N);
  const faceBody = new Map<number, number>();
  const flippedFaces = new Set<number>();
  const bodyBox: Box[] = [];
  bodies.forEach((b, bi) => {
    const box = new Box();
    const stamp = bi + 1;
    const stack = [b.id];
    while (stack.length) {
      const id = stack.pop()!;
      const idx = f.index.get(id);
      if (idx == null || mark[idx] === stamp) continue;
      mark[idx] = stamp;
      const t = f.types[idx];
      if (t === 'CARTESIAN_POINT') {
        const p = point(id);
        if (p) box.addV(p);
        continue;
      }
      if (!DESCEND.has(t)) continue;
      const a = f.args(id) ?? [];
      if (t === 'EDGE_CURVE') {
        const v1 = refId(a[1]), v2 = refId(a[2]);
        if (v1 != null) stack.push(v1);
        if (v2 != null) stack.push(v2);
        const cid = baseCurve(refId(a[3]));
        const c = circleOf(cid);
        if (c && v1 === v2) {
          const y = cross(c.pl.z, c.pl.x);
          for (let k = 0; k < 16; k++) {
            const th = (k * Math.PI) / 8;
            box.addV(addV(c.pl.loc, addV(mul(c.pl.x, c.r * Math.cos(th)), mul(y, c.r * Math.sin(th)))));
          }
        } else if (cid != null) {
          const ctrl = bsplineCtrl(cid);
          if (ctrl) {
            g.bsplineInBox = true;
            for (const p of ctrl) {
              const q = point(p);
              if (q) box.addV(q);
            }
          }
        }
        continue;
      }
      if (t === 'ADVANCED_FACE' || t === 'FACE_SURFACE') {
        if (!faceBody.has(id)) faceBody.set(id, bi);
        for (const r of refsIn(a[1])) stack.push(r);
        continue;
      }
      if (t === 'ORIENTED_FACE') {
        const fe = refId(a[2]);
        if (fe != null && enumV(a[3]) === 'F') flippedFaces.add(fe);
      }
      if (t === 'VERTEX_POINT') {
        const p = refId(a[1]);
        if (p != null) stack.push(p);
        continue;
      }
      for (const r of refsIn(a)) stack.push(r);
    }
    bodyBox.push(box);
  });

  // ───── Yüz türleri, silindirler, düzlemler ─────
  const surfType = (id: number | undefined): string => {
    if (id == null) return 'UNKNOWN';
    const t = f.type(id) ?? 'UNKNOWN';
    if (t.startsWith('B_SPLINE_SURFACE') || (t === 'COMPLEX_ENTITY' && f.has(id, 'B_SPLINE_SURFACE'))) return 'B_SPLINE_SURFACE';
    if (t === 'DEGENERATE_TOROIDAL_SURFACE') return 'TOROIDAL_SURFACE';
    if (t === 'RECTANGULAR_TRIMMED_SURFACE' || t === 'CURVE_BOUNDED_SURFACE') return surfType(refId(f.args(id)?.[1]));
    if (t === 'COMPLEX_ENTITY') return f.parts(id).find((p) => /SURFACE|PLANE/.test(p.name))?.name ?? 'COMPLEX_SURFACE';
    return t;
  };
  interface Cyl { body: number; r: number; loc: Vec3; z: Vec3; kind: CadHoleGroup['kind'] }
  interface Pl { body: number; face: number; loc: Vec3; n: Vec3 }
  const cyls: Cyl[] = [];
  const planes: Pl[] = [];
  for (const ft of FACE_TYPES)
    for (const id of f.ofType(ft)) {
      const a = f.args(id) ?? [];
      const sid = refId(a[2]);
      const st = surfType(sid);
      g.faces[st] = (g.faces[st] ?? 0) + 1;
      const body = faceBody.get(id) ?? -1;
      const sense = enumV(a[3]);
      const flip = flippedFaces.has(id);
      // Kapalı kabukta yüz normali dışarı bakar. same_sense=.T. → normal yüzey normaliyle aynı.
      const outward = sense === 'T' ? !flip : sense === 'F' ? flip : undefined;
      const solidBody = body >= 0 && SOLID_TYPES.has(bodies[body].type);
      if (st === 'CYLINDRICAL_SURFACE' && sid != null && f.type(sid) === 'CYLINDRICAL_SURFACE') {
        const sa = f.args(sid) ?? [];
        const r = num(sa[2]);
        const pl = placement(refId(sa[1]));
        if (r && r > 0 && pl) {
          const kind: CadHoleGroup['kind'] = !solidBody || outward == null ? 'cylindrical' : outward ? 'boss' : 'hole';
          cyls.push({ body, r, loc: pl.loc, z: pl.z, kind });
        }
      } else if (st === 'PLANE' && sid != null && f.type(sid) === 'PLANE' && solidBody && outward != null) {
        const pl = placement(refId((f.args(sid) ?? [])[1]));
        if (pl) planes.push({ body, face: id, loc: pl.loc, n: outward ? pl.z : mul(pl.z, -1) });
      }
    }

  // ───── Gövde → parça adı, kutular ─────
  const bodyPart = (bi: number) => (bi >= 0 && bodies[bi].product != null ? prodLabel(bodies[bi].product) : '');
  const productsWithBodies = new Set(bodies.map((b) => b.product ?? -1));
  const multiPart = [...productsWithBodies].filter((p) => p >= 0).length > 1;
  const scale = g.unitScaleToMm;

  const overall = new Box();
  for (const b of bodyBox) overall.merge(b);
  if (bodies.length && !overall.empty) {
    if (multiPart && transforms) {
      warnings.push(
        'Montaj yerleşim dönüşümleri (ITEM_DEFINED_TRANSFORMATION / MAPPED_ITEM) uygulanmıyor: genel montaj boyutu hesaplanmadı (NOT SUPPORTED); parça boyutları her parçanın kendi koordinat sisteminde verildi.',
      );
    } else g.bbox = overall.toBBox(scale, 'brep');
    g.geometryUnderstood = true;
  }
  // Parçalar
  const partBoxes = new Map<number, Box>();
  const partSolids = new Map<number, number>();
  bodies.forEach((b, bi) => {
    if (b.product == null) return;
    let bx = partBoxes.get(b.product);
    if (!bx) partBoxes.set(b.product, (bx = new Box()));
    bx.merge(bodyBox[bi]);
    if (SOLID_TYPES.has(b.type)) partSolids.set(b.product, (partSolids.get(b.product) ?? 0) + 1);
  });
  for (const [pid, part] of partByProduct) {
    const bx = partBoxes.get(pid);
    if (bx && !bx.empty) part.bbox = bx.toBBox(scale, 'brep');
    if (partSolids.get(pid)) part.solids = partSolids.get(pid);
  }
  g.parts = [...partByProduct.values()];

  // Gövde yoksa: köşe noktaları → tessellation → tüm noktalar
  if (!bodies.length || overall.empty) {
    const vb = new Box();
    for (const id of f.ofType('VERTEX_POINT')) {
      const p = point(refId((f.args(id) ?? [])[1]));
      if (p) vb.addV(p);
    }
    if (!vb.empty) {
      g.bbox = vb.toBBox(scale, 'vertices');
      g.geometryUnderstood = true;
    } else {
      const tb = new Box();
      for (const id of f.ofType('COORDINATES_LIST'))
        for (const c of list((f.args(id) ?? [])[2])) {
          const l = list(c);
          if (l.length >= 3) tb.add(num(l[0]) ?? NaN, num(l[1]) ?? NaN, num(l[2]) ?? NaN);
        }
      if (!tb.empty) {
        g.bbox = tb.toBBox(scale, 'tessellation');
        g.geometryUnderstood = true;
      } else {
        const ab = new Box();
        for (const id of f.ofType('CARTESIAN_POINT')) {
          const p = point(id);
          if (p) ab.addV(p);
        }
        if (!ab.empty) {
          g.bbox = ab.toBBox(scale, 'all-points');
          warnings.push('B-rep topolojisi bulunamadı; kutu tüm CARTESIAN_POINT varlıklarından hesaplandı (yerleşim / kontrol noktaları dahil, güvenilir değil).');
        }
      }
    }
  }

  // ───── Silindirik özellik grupları ─────
  const tol = 1e-3;
  const axisKey = (c: Cyl) => {
    let d = c.z;
    const k = Math.abs(d[0]) > 1e-9 ? 0 : Math.abs(d[1]) > 1e-9 ? 1 : 2;
    if (d[k] < 0) d = mul(d, -1);
    const p = sub(c.loc, mul(d, dot(c.loc, d)));
    return `${d.map((v) => roundTo(v, 1e-4).toFixed(4)).join(',')}|${p.map((v) => roundTo(v, tol).toFixed(3)).join(',')}`;
  };
  const hg = new Map<string, { g: CadHoleGroup; axes: Set<string> }>();
  for (const c of cyls) {
    const dia = Math.round(c.r * 2 * 1e6) / 1e6;
    const part = multiPart ? bodyPart(c.body) : '';
    const key = `${part}|${c.kind}|${dia}`;
    let e = hg.get(key);
    if (!e) {
      const grp: CadHoleGroup = { diameter: dia, diameterMm: Math.round(dia * scale * 1e6) / 1e6, count: 0, faces: 0, kind: c.kind };
      if (part) grp.part = part;
      hg.set(key, (e = { g: grp, axes: new Set() }));
    }
    e.g.faces++;
    e.axes.add(`${c.body}|${axisKey(c)}`);
  }
  g.holes = [...hg.values()]
    .map((e) => ({ ...e.g, count: e.axes.size }))
    .sort((a, b) => (a.part ?? '').localeCompare(b.part ?? '') || kindOrder(a.kind) - kindOrder(b.kind) || a.diameter - b.diameter);

  // ───── Daireler (CIRCLE geometrili kenarlar) ─────
  const cg = new Map<number, CadCircleGroup>();
  for (const id of f.ofType('EDGE_CURVE')) {
    const a = f.args(id) ?? [];
    const c = circleOf(baseCurve(refId(a[3])));
    if (!c) continue;
    const dia = Math.round(c.r * 2 * 1e6) / 1e6;
    let e = cg.get(dia);
    if (!e) cg.set(dia, (e = { diameter: dia, diameterMm: Math.round(dia * scale * 1e6) / 1e6, count: 0, full: 0, arcs: 0 }));
    e.count++;
    if (refId(a[1]) === refId(a[2])) e.full++;
    else e.arcs++;
  }
  g.circles = [...cg.values()].sort((a, b) => a.diameter - b.diameter);

  // ───── Sezgisel et kalınlığı: zıt yönlü, örtüşen iki büyük paralel düzlem ─────
  if (planes.length && planes.length <= 20000) g.thickness = thicknessCandidates(f, planes, point, multiPart ? bodyPart : () => '', scale);

  // ───── Malzeme ─────
  g.materials = materials(f, pdProduct, prodLabel);

  // ───── PMI ─────
  g.pmi = pmiItems(f, measureMm, g.unitScaleToMm);
  g.presentationPmi = Object.entries(f.counts)
    .filter(([k]) => /^(DRAUGHTING_CALLOUT|ANNOTATION_[A-Z_]+_OCCURRENCE|TESSELLATED_ANNOTATION_OCCURRENCE|ANNOTATION_OCCURRENCE)$/.test(k))
    .reduce((s, [, v]) => s + v, 0);
  return g;
}

const kindOrder = (k: CadHoleGroup['kind']) => (k === 'hole' ? 0 : k === 'boss' ? 1 : 2);

interface Measure {
  value?: number;
  unit?: number;
  name: string;
  kindName: string;
}

function measureOf(f: StepFile, id: number | undefined): Measure | undefined {
  if (id == null) return undefined;
  const t = f.type(id);
  if (!t) return undefined;
  let a: Val[] | undefined;
  let name = '';
  if (t === 'COMPLEX_ENTITY') {
    a = f.partArgs(id, 'MEASURE_WITH_UNIT');
    name = str(f.partArgs(id, 'REPRESENTATION_ITEM')?.[0]);
    if (!a) {
      const m = f.parts(id).find((p) => p.name.endsWith('MEASURE_WITH_UNIT') && p.args.length >= 2);
      a = m?.args;
    }
  } else if (t === 'MEASURE_REPRESENTATION_ITEM' || t.endsWith('_MEASURE_REPRESENTATION_ITEM')) {
    const all = f.args(id) ?? [];
    name = str(all[0]);
    a = all.slice(1);
  } else if (t.endsWith('MEASURE_WITH_UNIT')) a = f.args(id);
  if (!a) return undefined;
  const v = a[0];
  return { value: num(v), unit: refId(a[1]), name, kindName: v instanceof Typed ? v.name : '' };
}

function thicknessCandidates(
  f: StepFile,
  planes: { body: number; face: number; loc: Vec3; n: Vec3 }[],
  point: (id: number | undefined) => Vec3 | undefined,
  partOf: (bi: number) => string,
  scale: number,
): CadThickness[] {
  // Her düzlem yüzü için köşe noktaları (kendi sınırlarından)
  const facePts = (face: number): Vec3[] => {
    const out: Vec3[] = [];
    const seen = new Set<number>();
    const st = refsIn((f.args(face) ?? [])[1]);
    while (st.length && seen.size < 5000) {
      const id = st.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = f.type(id);
      if (t === 'CARTESIAN_POINT') {
        const p = point(id);
        if (p) out.push(p);
      } else if (t === 'VERTEX_POINT') {
        const r = refId((f.args(id) ?? [])[1]);
        if (r != null) st.push(r);
      } else if (t === 'EDGE_CURVE') {
        const a = f.args(id) ?? [];
        for (const k of [1, 2]) {
          const r = refId(a[k]);
          if (r != null) st.push(r);
        }
      } else if (t && /^(FACE_OUTER_BOUND|FACE_BOUND|EDGE_LOOP|ORIENTED_EDGE|POLY_LOOP|VERTEX_LOOP)$/.test(t)) st.push(...refsIn(f.args(id)));
    }
    return out;
  };
  const byBody = new Map<number, { p: (typeof planes)[number]; u: Vec3; v: Vec3; rect: [number, number, number, number] }[]>();
  for (const p of planes) {
    const pts = facePts(p.face);
    if (pts.length < 3) continue;
    const u = anyPerp(p.n);
    const v = cross(p.n, u);
    let r: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const q of pts) {
      const a = dot(q, u), b = dot(q, v);
      r = [Math.min(r[0], a), Math.min(r[1], b), Math.max(r[2], a), Math.max(r[3], b)];
    }
    let l = byBody.get(p.body);
    if (!l) byBody.set(p.body, (l = []));
    l.push({ p, u, v, rect: r });
  }
  const out: CadThickness[] = [];
  for (const [bi, l] of byBody) {
    const cands: { s: number; area: number }[] = [];
    // Büyük yüzlerden başla, çift sayısını sınırla
    l.sort((a, b) => (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]) - (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]));
    const L = l.slice(0, 200);
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const A = L[i], B = L[j];
        if (dot(A.p.n, B.p.n) > -0.9999) continue;
        const s = dot(sub(A.p.loc, B.p.loc), A.p.n);
        if (!(s > 1e-9)) continue; // malzeme iki düzlemin arasında olmalı
        // B'nin dikdörtgenini A'nın (u,v) eksenlerinde ifade et (B.u, A.u'ya paralel olmayabilir) → B'nin noktalarıyla yeniden hesapla
        const rb = reproject(B, A.u, A.v);
        const w = Math.min(A.rect[2], rb[2]) - Math.max(A.rect[0], rb[0]);
        const h = Math.min(A.rect[3], rb[3]) - Math.max(A.rect[1], rb[1]);
        if (w <= 0 || h <= 0) continue;
        if (Math.min(w, h) < 3 * s) continue;
        cands.push({ s, area: w * h });
      }
    cands.sort((a, b) => b.area - a.area);
    const picked: number[] = [];
    for (const c of cands) {
      if (c.area < 0.25 * cands[0].area || picked.length >= 3) break;
      if (picked.some((x) => Math.abs(x - c.s) < 1e-6 * Math.max(1, x))) continue;
      picked.push(c.s);
    }
    for (const s of picked) {
      const t: CadThickness = { value: Math.round(s * 1e6) / 1e6, valueMm: Math.round(s * scale * 1e6) / 1e6 };
      const part = partOf(bi);
      if (part) t.part = part;
      out.push(t);
    }
  }
  return out;

  function reproject(B: { rect: [number, number, number, number]; u: Vec3; v: Vec3; p: { loc: Vec3; n: Vec3 } }, u: Vec3, v: Vec3) {
    // B'nin dikdörtgen köşelerini 3B'ye geri taşıyıp A eksenlerine izdüşür
    const base = mul(B.p.n, dot(B.p.loc, B.p.n));
    const corners = [
      [B.rect[0], B.rect[1]], [B.rect[2], B.rect[1]], [B.rect[0], B.rect[3]], [B.rect[2], B.rect[3]],
    ].map(([a, b]) => addV(base, addV(mul(B.u, a), mul(B.v, b))));
    let r: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const q of corners) {
      const a = dot(q, u), b = dot(q, v);
      r = [Math.min(r[0], a), Math.min(r[1], b), Math.max(r[2], a), Math.max(r[3], b)];
    }
    return r;
  }
}

function materials(f: StepFile, pdProduct: Map<number, number>, prodLabel: (pid: number | undefined) => string): CadMaterial[] {
  const out: CadMaterial[] = [];
  const seen = new Set<string>();
  const push = (m: CadMaterial) => {
    const k = `${m.name}|${m.part ?? ''}`;
    if (!m.name || seen.has(k)) return;
    seen.add(k);
    out.push(m);
  };
  const partOfDef = (id: number | undefined, depth = 0): string => {
    if (id == null || depth > 3) return '';
    const t = f.type(id);
    if (t === 'PRODUCT_DEFINITION' || t === 'PRODUCT_DEFINITION_WITH_ASSOCIATED_DOCUMENTS') return prodLabel(pdProduct.get(id));
    if (t === 'PRODUCT_DEFINITION_SHAPE' || t === 'PROPERTY_DEFINITION') return partOfDef(refId((f.args(id) ?? [])[2]), depth + 1);
    if (t === 'PRODUCT') return prodLabel(id);
    return '';
  };
  for (const id of f.ofType('MATERIAL_DESIGNATION')) {
    const a = f.args(id) ?? [];
    const defs = refsIn(a[1]);
    const part = defs.map((d) => partOfDef(d)).find(Boolean);
    push({ name: str(a[0]).trim(), source: 'MATERIAL_DESIGNATION', ...(part ? { part } : {}) });
  }
  // PROPERTY_DEFINITION('material property' / 'material name') → PROPERTY_DEFINITION_REPRESENTATION → REPRESENTATION öğeleri
  const matProps = new Map<number, string>();
  for (const id of f.ofType('PROPERTY_DEFINITION')) {
    const a = f.args(id) ?? [];
    if (/material|malzeme|werkstoff/i.test(`${str(a[0])} ${str(a[1])}`)) matProps.set(id, partOfDef(refId(a[2])));
  }
  const repMat = new Map<number, string>();
  for (const id of f.ofType('PROPERTY_DEFINITION_REPRESENTATION')) {
    const a = f.args(id) ?? [];
    const pd = refId(a[0]);
    const rep = refId(a[1]);
    if (pd != null && rep != null && matProps.has(pd)) repMat.set(rep, matProps.get(pd)!);
  }
  const densities = new Map<string, string>();
  for (const [rep, part] of repMat) {
    const items = refsIn((f.args(rep) ?? [])[1]);
    for (const it of items) {
      const t = f.type(it);
      const a = f.args(it) ?? [];
      if (t === 'DESCRIPTIVE_REPRESENTATION_ITEM') {
        const nm = str(a[0]), ds = str(a[1]);
        if (/density|yoğunluk/i.test(nm)) continue;
        push({ name: (ds || nm).trim(), source: 'DESCRIPTIVE_REPRESENTATION_ITEM', ...(part ? { part } : {}) });
      } else if (t === 'MEASURE_REPRESENTATION_ITEM' || f.has(it, 'MEASURE_REPRESENTATION_ITEM')) {
        const m = measureOf(f, it);
        if (m && /density|yoğunluk/i.test(m.name) && m.value != null) densities.set(part, `${m.value}`);
      }
    }
  }
  // Bağımsız DRI: adı 'material' içeren
  for (const id of f.ofType('DESCRIPTIVE_REPRESENTATION_ITEM')) {
    const a = f.args(id) ?? [];
    const nm = str(a[0]), ds = str(a[1]);
    if (/^(material|malzeme|werkstoff)/i.test(nm) && ds) push({ name: ds.trim(), source: 'DESCRIPTIVE_REPRESENTATION_ITEM' });
  }
  for (const m of out) {
    const d = densities.get(m.part ?? '');
    if (d) m.density = d;
  }
  return out;
}

function pmiItems(
  f: StepFile,
  measureMm: (id: number | undefined) => { value: number; unit: string; name: string } | undefined,
  scale: number,
): CadPmi[] {
  const out: CadPmi[] = [];
  // Ölçü → değer (DIMENSIONAL_CHARACTERISTIC_REPRESENTATION → SHAPE_DIMENSION_REPRESENTATION öğeleri)
  const dimValues = new Map<number, { nominal?: { value: number; unit: string }; upper?: number; lower?: number }>();
  for (const id of f.ofType('DIMENSIONAL_CHARACTERISTIC_REPRESENTATION')) {
    const a = f.args(id) ?? [];
    const dim = refId(a[0]);
    const rep = refId(a[1]);
    if (dim == null || rep == null) continue;
    const e: { nominal?: { value: number; unit: string }; upper?: number; lower?: number } = {};
    for (const it of refsIn((f.args(rep) ?? [])[1])) {
      const m = measureMm(it);
      if (!m) continue;
      if (/upper/i.test(m.name)) e.upper = m.value;
      else if (/lower/i.test(m.name)) e.lower = m.value;
      else if (!e.nominal) e.nominal = { value: m.value, unit: m.unit };
    }
    dimValues.set(dim, e);
  }
  // Ölçü → ± tolerans
  const dimTol = new Map<number, { upper?: number; lower?: number; fit?: string }>();
  for (const id of f.allOf('PLUS_MINUS_TOLERANCE')) {
    const a = f.partArgs(id, 'PLUS_MINUS_TOLERANCE') ?? [];
    const range = refId(a[0]);
    const dim = refId(a[1]);
    if (range == null || dim == null) continue;
    const rt = f.type(range);
    if (rt === 'TOLERANCE_VALUE') {
      const r = f.args(range) ?? [];
      dimTol.set(dim, { lower: measureMm(refId(r[0]))?.value, upper: measureMm(refId(r[1]))?.value });
    } else if (rt === 'LIMITS_AND_FITS') {
      const r = f.args(range) ?? [];
      dimTol.set(dim, { fit: [str(r[0]), str(r[1]), str(r[2])].filter(Boolean).join(' ').trim() || str(r[3]) });
    }
  }
  const DIM_TYPES = ['DIMENSIONAL_SIZE', 'DIMENSIONAL_SIZE_WITH_PATH', 'ANGULAR_SIZE', 'DIMENSIONAL_LOCATION', 'DIMENSIONAL_LOCATION_WITH_PATH', 'ANGULAR_LOCATION', 'DIRECTED_DIMENSIONAL_LOCATION'];
  for (const t of DIM_TYPES)
    for (const id of f.allOf(t)) {
      const a = f.partArgs(id, t) ?? [];
      const isSize = t.includes('SIZE');
      const name = isSize ? str(a[1]) : str(a[0]) || str(a[1]);
      const v = dimValues.get(id);
      const tl = dimTol.get(id);
      const angular = t.startsWith('ANGULAR') || v?.nominal?.unit === '°';
      const unitL = angular ? '°' : (v?.nominal?.unit ?? 'mm');
      const nominal = v?.nominal?.value;
      let upper = tl?.upper, lower = tl?.lower;
      // Sınır ölçüsü (upper/lower limit değerleri) → sapma
      if (nominal != null && upper == null && v?.upper != null) upper = v.upper - nominal;
      if (nominal != null && lower == null && v?.lower != null) lower = v.lower - nominal;
      const item: CadPmi = { kind: t, text: '' };
      if (name) item.name = name;
      if (nominal != null) item.value = r6(nominal);
      item.unit = unitL;
      if (upper != null) item.upper = r6(upper);
      if (lower != null) item.lower = r6(lower);
      const dia = /diam|çap/i.test(name) ? 'Ø' : /radius|yarıçap/i.test(name) ? 'R' : '';
      const nomS = nominal != null ? `${dia}${fmt(nominal)}` : `${dia}(nominal değer modelde yok)`;
      let tolS = '';
      if (upper != null && lower != null) {
        if (Math.abs(upper + lower) < 1e-9 && upper > 0) tolS = `±${fmt(upper)}`;
        else if (upper >= 0 && lower <= 0) tolS = `+${fmt(upper)}/-${fmt(Math.abs(lower))}`;
        else if (nominal != null) tolS = `(sınırlar ${fmt(nominal + lower)} – ${fmt(nominal + upper)} ${unitL})`;
      } else if (upper != null) tolS = `+${fmt(upper)}/-0`;
      else if (lower != null) tolS = `+0/-${fmt(Math.abs(lower))}`;
      if (tolS) item.tolerance = tolS.replace(/^\(sınırlar (.*)\)$/, '$1');
      if (tl?.fit) item.tolerance = tl.fit;
      const label = `${t}${name ? `: ${name}` : ''}`;
      if (tl?.fit) item.text = `PMI: ${nomS} ${unitL} ${tl.fit} (${label}, geçme toleransı – sınır değerleri ISO 286 tablosundan doğrulanmalı)`;
      else if (tolS.startsWith('(')) item.text = `PMI: ${nomS} ${unitL} ${tolS} (${label})`;
      else if (tolS) item.text = `PMI: ${nomS} ${tolS} ${unitL} (${label})`;
      else item.text = `PMI: ${nomS} ${unitL} (${label}) – PMI'da tolerans tanımlı değil`;
      out.push(item);
    }

  // Geometrik toleranslar (GD&T)
  const datumLetters = (start: Val | undefined): string[] => {
    const letters: string[] = [];
    const seen = new Set<number>();
    const st = refsIn(start).map((id) => ({ id, d: 0 }));
    while (st.length) {
      const { id, d } = st.shift()!;
      if (seen.has(id) || d > 5) continue;
      seen.add(id);
      const t = f.type(id);
      if (!t) continue;
      if (t === 'DATUM' || f.has(id, 'DATUM')) {
        const a = f.partArgs(id, 'DATUM') ?? [];
        const l = str(a[4]) || str(a[0]);
        if (l && !letters.includes(l)) letters.push(l);
        continue;
      }
      if (/^(DATUM_SYSTEM|DATUM_REFERENCE|DATUM_REFERENCE_COMPARTMENT|DATUM_REFERENCE_ELEMENT|COMMON_DATUM|COMPLEX_ENTITY)$/.test(t))
        for (const r of refsIn(f.args(id))) st.push({ id: r, d: d + 1 });
    }
    return letters;
  };
  const gtIds = new Set<number>();
  for (const [t] of Object.entries(f.counts)) if (/_TOLERANCE$/.test(t) && t !== 'PLUS_MINUS_TOLERANCE') for (const id of f.ofType(t)) gtIds.add(id);
  for (const name of f.complexPartNames()) if (/_TOLERANCE$|^GEOMETRIC_TOLERANCE/.test(name) && name !== 'PLUS_MINUS_TOLERANCE') for (const id of f.allOf(name)) gtIds.add(id);
  for (const id of [...gtIds].sort((a, b) => a - b)) {
    const parts = f.parts(id);
    const specific =
      parts.find((p) => /_TOLERANCE$/.test(p.name) && p.name !== 'GEOMETRIC_TOLERANCE' && !/WITH_|PLUS_MINUS/.test(p.name))?.name ??
      parts.find((p) => p.name === 'GEOMETRIC_TOLERANCE')?.name ??
      parts[0]?.name ??
      'GEOMETRIC_TOLERANCE';
    // Ana parametreler: (name, description, magnitude, toleranced_shape_aspect [, datum_system])
    const main = parts.find((p) => p.name === 'GEOMETRIC_TOLERANCE')?.args ?? (parts.length === 1 ? parts[0].args : undefined);
    if (!main) continue;
    const gname = str(main[0]);
    let mag: { value: number; unit: string } | undefined;
    for (const v of main.slice(2)) {
      if (typeof v === 'number') {
        mag = { value: v * scale, unit: 'mm' };
        break;
      }
      if (v instanceof Typed && /MEASURE/.test(v.name) && num(v) != null) {
        mag = { value: num(v)! * scale, unit: 'mm' };
        break;
      }
      const m = measureMm(refId(v));
      if (m) {
        mag = m;
        break;
      }
    }
    const dsys = parts.find((p) => p.name === 'GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE')?.args[0] ?? (parts.length === 1 ? main[4] : undefined);
    const datums = dsys ? datumLetters(dsys) : [];
    const modifiers = parts.find((p) => p.name === 'GEOMETRIC_TOLERANCE_WITH_MODIFIERS')?.args[0];
    const mods = list(modifiers).map((m) => (m instanceof Enum ? m.v : '')).filter(Boolean);
    const label = GDT_LABEL[specific] ?? specific;
    const item: CadPmi = { kind: specific, text: '' };
    if (gname) item.name = gname;
    if (mag) {
      item.value = r6(mag.value);
      item.unit = mag.unit;
      item.tolerance = `${fmt(mag.value)}`;
    }
    if (datums.length) item.datum = datums.join('|');
    const head = specific === 'GEOMETRIC_TOLERANCE' && gname ? `Geometrik tolerans '${gname}'` : `${label} toleransı`;
    item.text =
      `PMI: ${head} (${specific})` +
      (mag ? ` max ${fmt(mag.value)} ${mag.unit} (tolerans bölgesi)` : ' – tolerans değeri okunamadı') +
      (datums.length ? `; datum: ${datums.join(', ')}` : '') +
      (mods.length ? `; değiştiriciler: ${mods.join(', ')} (yorumlanmadı)` : '');
    out.push(item);
  }
  // Datumlar
  for (const id of f.allOf('DATUM')) {
    const a = f.partArgs(id, 'DATUM') ?? [];
    const l = str(a[4]) || str(a[0]);
    if (l) out.push({ kind: 'DATUM', datum: l, text: `PMI: Datum ${l} tanımlı` });
  }
  return out;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
