// CAD test dosyalarını deterministik olarak üretir: node tests/fixtures/gen-cad-fixtures.mjs
// Çıktılar tests/fixtures/docs/ altına yazılır ve depoya eklenir (testler bu betiği çalıştırmaz).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'docs');
const r = (x) => (Number.isInteger(x) ? `${x}.` : String(x));

class StepW {
  constructor() {
    this.lines = [];
    this.n = 0;
  }
  add(s) {
    const id = ++this.n;
    this.lines.push(`#${id}=${s};`);
    return `#${id}`;
  }
  pt(p) {
    return this.add(`CARTESIAN_POINT('',(${p.map(r).join(',')}))`);
  }
  dir(v) {
    return this.add(`DIRECTION('',(${v.map(r).join(',')}))`);
  }
  ax(loc, z = [0, 0, 1], x = [1, 0, 0]) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.pt(loc)},${this.dir(z)},${this.dir(x)})`);
  }
  vtx(p) {
    return this.add(`VERTEX_POINT('',${this.pt(p)})`);
  }
  lineEdge(v1, p1, v2, p2) {
    const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const l = Math.hypot(...d);
    const line = this.add(`LINE('',${this.pt(p1)},${this.add(`VECTOR('',${this.dir(d.map((c) => c / l))},${r(l)})`)})`);
    return this.add(`EDGE_CURVE('',${v1},${v2},${line},.T.)`);
  }
  circleEdge(v, center, rad) {
    const c = this.add(`CIRCLE('',${this.ax(center)},${r(rad)})`);
    return this.add(`EDGE_CURVE('',${v},${v},${c},.T.)`);
  }
  oe(e, o = true) {
    return this.add(`ORIENTED_EDGE('',*,*,${e},${o ? '.T.' : '.F.'})`);
  }
  loop(oes) {
    return this.add(`EDGE_LOOP('',(${oes.join(',')}))`);
  }
  file(schema, name, desc) {
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('${desc}'),'2;1');`,
      `FILE_NAME('${name}','2026-01-01T12:00:00',('Kemal'),('ACME Aero'),'FMEA Studio fixture generator','gen-cad-fixtures','');`,
      `FILE_SCHEMA(('${schema}'));`,
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

const AP214 = 'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }';
const AP242 = 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }';

/** Ortak bağlam + birimler. inch=true → CONVERSION_BASED_UNIT('INCH'). */
function contexts(w, { inch = false } = {}) {
  const ac = w.add(`APPLICATION_CONTEXT('automotive design')`);
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ac})`);
  const pc = w.add(`PRODUCT_CONTEXT('',${ac},'mechanical')`);
  const pdc = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ac},'design')`);
  const mm = w.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  let lu = mm;
  if (inch) {
    const conv = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${mm})`);
    const de = w.add(`DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)`);
    lu = w.add(`(CONVERSION_BASED_UNIT('INCH',${conv})LENGTH_UNIT()NAMED_UNIT(${de}))`);
  }
  const au = w.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const su = w.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${lu},'distance_accuracy_value','confusion accuracy')`);
  const ctx = w.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  );
  return { ac, pc, pdc, lu, ctx };
}

function product(w, c, id, name, desc) {
  const p = w.add(`PRODUCT('${id}','${name}','${desc}',(${c.pc}))`);
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${p}))`);
  const pdf = w.add(`PRODUCT_DEFINITION_FORMATION('A','',${p})`);
  const pd = w.add(`PRODUCT_DEFINITION('design','',${pdf},${c.pdc})`);
  const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  return { p, pd, pds };
}

/** Delikli dikdörtgen blok B-rep'i. holes: [{cx, cy, r}] Z ekseninde boydan boya. */
function plateSolid(w, name, [x0, y0, z0], [x1, y1, z1], holes = []) {
  const P = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const V = Array.from({ length: 8 }, (_, i) => w.vtx(P(i)));
  const E = {};
  const edge = (a, b) => {
    const k = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (!E[k]) E[k] = { e: w.lineEdge(V[Math.min(a, b)], P(Math.min(a, b)), V[Math.max(a, b)], P(Math.max(a, b))), a: Math.min(a, b) };
    return w.oe(E[k].e, E[k].a === a);
  };
  const quad = (q) => w.loop([edge(q[0], q[1]), edge(q[1], q[2]), edge(q[2], q[3]), edge(q[3], q[0])]);
  const faces = [];
  const planeFace = (q, loc, n, inner = []) => {
    const bounds = [w.add(`FACE_OUTER_BOUND('',${quad(q)},.T.)`), ...inner.map((e) => w.add(`FACE_BOUND('',${w.loop([w.oe(e)])},.T.)`))];
    const pl = w.add(`PLANE('',${w.ax(loc, n, Math.abs(n[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0])})`);
    faces.push(w.add(`ADVANCED_FACE('',(${bounds.join(',')}),${pl},.T.)`));
  };
  const topC = [], botC = [];
  for (const h of holes) {
    const vt = w.vtx([h.cx + h.r, h.cy, z1]);
    const vb = w.vtx([h.cx + h.r, h.cy, z0]);
    const ct = w.circleEdge(vt, [h.cx, h.cy, z1], h.r);
    const cb = w.circleEdge(vb, [h.cx, h.cy, z0], h.r);
    const seam = w.lineEdge(vb, [h.cx + h.r, h.cy, z0], vt, [h.cx + h.r, h.cy, z1]);
    topC.push(ct);
    botC.push(cb);
    const cyl = w.add(`CYLINDRICAL_SURFACE('',${w.ax([h.cx, h.cy, z0])},${r(h.r)})`);
    const lp = w.loop([w.oe(ct, false), w.oe(seam, false), w.oe(cb), w.oe(seam)]);
    // same_sense .F.: yüz normali eksene doğru → malzeme dışarıda → delik
    faces.push(w.add(`ADVANCED_FACE('',(${w.add(`FACE_BOUND('',${lp},.T.)`)}),${cyl},.F.)`));
  }
  planeFace([0, 2, 3, 1], [x0, y0, z0], [0, 0, -1], botC);
  planeFace([4, 5, 7, 6], [x0, y0, z1], [0, 0, 1], topC);
  planeFace([0, 1, 5, 4], [x0, y0, z0], [0, -1, 0]);
  planeFace([2, 6, 7, 3], [x0, y1, z0], [0, 1, 0]);
  planeFace([0, 4, 6, 2], [x0, y0, z0], [-1, 0, 0]);
  planeFace([1, 3, 7, 5], [x1, y0, z0], [1, 0, 0]);
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

/** Dolu silindir (pim): yan yüz same_sense .T. → dış silindir (çıkıntı). */
function pinSolid(w, name, rad, h) {
  const vt = w.vtx([rad, 0, h]);
  const vb = w.vtx([rad, 0, 0]);
  const ct = w.circleEdge(vt, [0, 0, h], rad);
  const cb = w.circleEdge(vb, [0, 0, 0], rad);
  const seam = w.lineEdge(vb, [rad, 0, 0], vt, [rad, 0, h]);
  const cyl = w.add(`CYLINDRICAL_SURFACE('',${w.ax([0, 0, 0])},${r(rad)})`);
  const side = w.add(`ADVANCED_FACE('',(${w.add(`FACE_BOUND('',${w.loop([w.oe(cb), w.oe(seam), w.oe(ct, false), w.oe(seam, false)])},.T.)`)}),${cyl},.T.)`);
  const top = w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${w.loop([w.oe(ct)])},.T.)`)}),${w.add(`PLANE('',${w.ax([0, 0, h])})`)},.T.)`);
  const bot = w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${w.loop([w.oe(cb, false)])},.T.)`)}),${w.add(`PLANE('',${w.ax([0, 0, 0], [0, 0, -1])})`)},.T.)`);
  const shell = w.add(`CLOSED_SHELL('',(${side},${top},${bot}))`);
  return w.add(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
}

function shapeRep(w, c, prod, solid) {
  const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solid},${w.ax([0, 0, 0])}),${c.ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${prod.pds},${rep})`);
  return rep;
}

const HOLES4 = [
  { cx: 10, cy: 10, r: 3 },
  { cx: 110, cy: 10, r: 3 },
  { cx: 10, cy: 70, r: 3 },
  { cx: 110, cy: 70, r: 3 },
];

// 1) AP214 plaka 120×80×10 mm, 4× Ø6 delik
{
  const w = new StepW();
  const c = contexts(w);
  const pr = product(w, c, 'PLATE-01', 'Base plate', 'Plate 120x80x10 with 4 holes');
  shapeRep(w, c, pr, plateSolid(w, 'Plate', [0, 0, 0], [120, 80, 10], HOLES4));
  writeFileSync(join(OUT, 'plate.step'), w.file(AP214, 'plate.step', 'FMEA test plate'));
}

// 2) Montaj: ASM-001 = PLATE-02 × 1 + PIN-01 × 2 (yerleşim dönüşümleriyle)
{
  const w = new StepW();
  const c = contexts(w);
  const asm = product(w, c, 'ASM-001', 'Bracket assembly', 'Two-part assembly');
  const plate = product(w, c, 'PLATE-02', 'Bracket plate', '');
  const pin = product(w, c, 'PIN-01', 'Dowel pin', 'Ø5 x 20');
  const asmRep = w.add(`SHAPE_REPRESENTATION('',(${w.ax([0, 0, 0])}),${c.ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${asm.pds},${asmRep})`);
  const plateRep = shapeRep(w, c, plate, plateSolid(w, 'Plate', [0, 0, 0], [100, 60, 8], [{ cx: 20, cy: 30, r: 2.5 }, { cx: 80, cy: 30, r: 2.5 }]));
  const pinRep = shapeRep(w, c, pin, pinSolid(w, 'Pin', 2.5, 20));
  const place = (childRep, prodChild, idx, loc) => {
    const nauo = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${idx}','${idx}','',${asm.pd},${prodChild.pd},$)`);
    const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${nauo})`);
    const idt = w.add(`ITEM_DEFINED_TRANSFORMATION('','',${w.ax([0, 0, 0])},${w.ax(loc)})`);
    const rr = w.add(`(REPRESENTATION_RELATIONSHIP('','',${childRep},${asmRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
    w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rr},${pds})`);
  };
  place(plateRep, plate, 'NAUO1', [0, 0, 0]);
  place(pinRep, pin, 'NAUO2', [20, 30, -6]);
  place(pinRep, pin, 'NAUO3', [80, 30, -6]);
  writeFileSync(join(OUT, 'assembly.step'), w.file(AP214, 'assembly.step', 'FMEA test assembly'));
}

// 3) İnç: 4 × 2 × 1 in blok, Ø0.25 in delik
{
  const w = new StepW();
  const c = contexts(w, { inch: true });
  const pr = product(w, c, 'BLOCK-IN', 'Inch block', '');
  shapeRep(w, c, pr, plateSolid(w, 'Block', [0, 0, 0], [4, 2, 1], [{ cx: 1, cy: 1, r: 0.125 }]));
  writeFileSync(join(OUT, 'inch.step'), w.file(AP214, 'inch.step', 'FMEA test inch block'));
}

// 4) AP242 PMI: Ø6 +0.10/0 (DIMENSIONAL_SIZE + PLUS_MINUS_TOLERANCE), konum toleransı datum A'ya göre, düzlemsellik, malzeme
{
  const w = new StepW();
  const c = contexts(w);
  const pr = product(w, c, 'PLATE-PMI', 'PMI plate', 'AP242 semantic PMI');
  shapeRep(w, c, pr, plateSolid(w, 'Plate', [0, 0, 0], [120, 80, 10], HOLES4));
  w.add(`MATERIAL_DESIGNATION('AL 7075-T6',(${pr.pd}))`);
  const lenMri = (v, nm) =>
    w.add(`(LENGTH_MEASURE_WITH_UNIT()MEASURE_REPRESENTATION_ITEM()MEASURE_WITH_UNIT(LENGTH_MEASURE(${r(v)}),${c.lu})REPRESENTATION_ITEM('${nm}'))`);
  const hole = w.add(`SHAPE_ASPECT('4x hole','',${pr.pds},.F.)`);
  const ds = w.add(`DIMENSIONAL_SIZE(${hole},'diameter')`);
  const sdr = w.add(`SHAPE_DIMENSION_REPRESENTATION('',(${lenMri(6, 'nominal value')}),${c.ctx})`);
  w.add(`DIMENSIONAL_CHARACTERISTIC_REPRESENTATION(${ds},${sdr})`);
  const tv = w.add(`TOLERANCE_VALUE(${lenMri(0, 'lower limit')},${lenMri(0.1, 'upper limit')})`);
  w.add(`PLUS_MINUS_TOLERANCE(${tv},${ds})`);
  const bottom = w.add(`SHAPE_ASPECT('bottom face','',${pr.pds},.T.)`);
  const datum = w.add(`DATUM('','',${pr.pds},.F.,'A')`);
  w.add(`DATUM_FEATURE('','',${pr.pds},.T.)`);
  const drc = w.add(`DATUM_REFERENCE_COMPARTMENT('','',${pr.pds},.F.,${datum},$)`);
  const dsys = w.add(`DATUM_SYSTEM('','',${pr.pds},.F.,(${drc}))`);
  const pmag = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.2),${c.lu})`);
  w.add(`(GEOMETRIC_TOLERANCE('position','',${pmag},${hole})GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE((${dsys}))POSITION_TOLERANCE())`);
  const fmag = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.05),${c.lu})`);
  w.add(`FLATNESS_TOLERANCE('flatness','',${fmag},${bottom})`);
  writeFileSync(join(OUT, 'pmi.step'), w.file(AP242, 'pmi.step', 'FMEA test AP242 PMI'));
}

// 5) IGES (mm): dikdörtgen 120×80 (4× 110), 4× tam daire r=3 (biri 124 öteleme ile), 124 döndürme+öteleme uygulanmış çizgi, 192 silindir
{
  const ents = [];
  const add = (type, params, { xform = 0, status = '00000000', form = 0 } = {}) => {
    ents.push({ type, params, xform, status, form });
    return ents.length * 2 - 1; // DE numarası
  };
  const L = (a, b) => add(110, [...a, ...b]);
  L([0, 0, 0], [120, 0, 0]);
  L([120, 0, 0], [120, 80, 0]);
  L([120, 80, 0], [0, 80, 0]);
  L([0, 80, 0], [0, 0, 0]);
  const C = (cx, cy, rad, opt) => add(100, [0, cx, cy, cx + rad, cy, cx + rad, cy], opt);
  C(10, 10, 3);
  C(110, 10, 3);
  C(10, 70, 3);
  const t1 = add(124, [1, 0, 0, 110, 0, 1, 0, 70, 0, 0, 1, 0]);
  C(0, 0, 3, { xform: t1 }); // tanım uzayında orijinde → (110,70)
  const t2 = add(124, [0, 0, -1, 60, 0, 1, 0, 40, 1, 0, 0, 0]);
  add(110, [0, 0, 0, 25, 0, 0], { xform: t2 }); // → (60,40,0)–(60,40,25)
  const p = add(116, [10, 10, 0], { status: '00010000' });
  const d = add(123, [0, 0, 1], { status: '00010200' });
  add(192, [p, d, 3]);

  const S = ['FMEA Studio IGES geometry fixture', 'Plate outline 120x80 with 4x R3 circles'];
  const G = [
    '1H,', '1H;', '6HSENDER', '9Hplate.igs', '9HGenerator', '4H1.00', '32', '38', '6', '308', '15', '7HRECEIVE', '1.', '2', '2HMM', '1', '0.08',
    '15H20260101.120000', '1.E-06', '120.', '5HKemal', '9HACME Aero', '11', '0', '15H20260101.120000',
  ].join(',') + ';';
  const lines = [];
  S.forEach((s, i) => lines.push(s.padEnd(72) + 'S' + String(i + 1).padStart(7)));
  for (let i = 0, k = 1; i < G.length; i += 72, k++) lines.push(G.slice(i, i + 72).padEnd(72) + 'G' + String(k).padStart(7));
  // P bölümü
  const pl = [];
  const dl = [];
  ents.forEach((e, i) => {
    const de = 2 * i + 1;
    // 192'nin ilk iki parametresi DE işaretçisidir (tamsayı); diğerleri gerçel sayı
    const toks = [String(e.type), ...e.params.map((v, j) => (e.type === 192 && j < 2 ? String(v) : r(v)))];
    const start = pl.length + 1;
    let cur = '';
    toks.forEach((t, j) => {
      const piece = t + (j === toks.length - 1 ? ';' : ',');
      if ((cur + piece).length > 64) {
        pl.push({ text: cur, de });
        cur = '';
      }
      cur += piece;
    });
    if (cur) pl.push({ text: cur, de });
    const f8 = (v) => String(v).padStart(8);
    dl.push([e.type, start, 0, 0, 0, 0, e.xform, 0].map(f8).join('') + e.status + 'D' + String(de).padStart(7));
    dl.push([e.type, 0, 0, pl.length - start + 1, e.form, '', '', '', 0].map(f8).join('') + 'D' + String(de + 1).padStart(7));
  });
  lines.push(...dl);
  pl.forEach((l, i) => lines.push(l.text.padEnd(64) + String(l.de).padStart(8) + 'P' + String(i + 1).padStart(7)));
  const cnt = (c) => lines.filter((l) => l[72] === c).length;
  lines.push(`S${String(cnt('S')).padStart(7)}G${String(cnt('G')).padStart(7)}D${String(cnt('D')).padStart(7)}P${String(cnt('P')).padStart(7)}`.padEnd(72) + 'T' + '1'.padStart(7));
  writeFileSync(join(OUT, 'plate.igs'), lines.join('\n') + '\n');
}
console.log('CAD fixtures written to', OUT);
