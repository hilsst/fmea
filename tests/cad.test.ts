import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractDocument } from '../src/main/docintel/index';
import { CAD_NOMINAL_MSG, CAD_PARTIAL_MSG, findRequirementCandidates } from '../src/shared/docmodel';
import { DERIVED, Enum, Ref, StepFile, Typed } from '../src/main/docintel/cad/step-graph';

const FIX = join(__dirname, 'fixtures', 'docs');
const fx = (n: string) => readFileSync(join(FIX, n));

describe('STEP varlık grafiği', () => {
  it('çok satırlı varlık, kaçışlı dize, yorum, karmaşık varlık, $, *, enum, tipli parametre', () => {
    const src = [
      'ISO-10303-21;',
      "HEADER; FILE_NAME('x.stp','',(''),(''),'','',''); ENDSEC;",
      'DATA;',
      "#1=PRODUCT('P-1','It''s; a (test)', /* yorum ; ( */ 'açıklama',",
      '   (#2));',
      '#2=PRODUCT_CONTEXT($,*,.MECHANICAL.);',
      '#3=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));',
      '#4=MEASURE_REPRESENTATION_ITEM(\'v\',LENGTH_MEASURE(1.5E+01),#3);',
      '#5 = CARTESIAN_POINT ( \'\' , ( -1.E-03 , 2. , .5 ) ) ;',
      'çöp satır;',
      '#6=DIRECTION(\'\\X2\\00D6\\X0\\\',(0.,0.,1.));',
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');
    const f = new StepFile(src);
    expect(f.size).toBe(6);
    const p = f.args(1)!;
    expect(p[0]).toBe('P-1');
    expect(p[1]).toBe("It's; a (test)");
    expect(p[2]).toBe('açıklama');
    expect((p[3] as Ref[])[0]).toBeInstanceOf(Ref);
    const c = f.args(2)!;
    expect(c[0]).toBeNull();
    expect(c[1]).toBe(DERIVED);
    expect((c[2] as Enum).v).toBe('MECHANICAL');
    expect(f.type(3)).toBe('COMPLEX_ENTITY');
    expect(f.parts(3).map((x) => x.name)).toEqual(['LENGTH_UNIT', 'NAMED_UNIT', 'SI_UNIT']);
    expect((f.partArgs(3, 'SI_UNIT')![0] as Enum).v).toBe('MILLI');
    const m = f.args(4)!;
    expect(m[1]).toBeInstanceOf(Typed);
    expect((m[1] as Typed).args[0]).toBe(15);
    expect(f.args(5)![1]).toEqual([-0.001, 2, 0.5]);
    expect(f.args(6)![0]).toBe('Ö');
    expect(f.warnings.join(' ')).toContain('çözümlenemeyen');
  });
});

describe('STEP geometri', () => {
  it('plaka 120×80×10 mm: kutu, sizeMm, 4× Ø6 delik, yüz türleri, kalınlık adayı', async () => {
    const d = await extractDocument('plate.step', fx('plate.step'));
    expect(d.status).toBe('ok');
    expect(d.messages[0].text).toBe(CAD_NOMINAL_MSG);
    const cad = d.cad!;
    expect(cad.units).toBe('mm');
    expect(cad.unitScaleToMm).toBe(1);
    expect(cad.bbox).toMatchObject({ min: [0, 0, 0], max: [120, 80, 10], size: [120, 80, 10], sizeMm: [120, 80, 10], source: 'brep' });
    expect(cad.solids).toBe(1);
    expect(cad.shells).toBe(1);
    expect(cad.faces).toEqual({ PLANE: 6, CYLINDRICAL_SURFACE: 4 });
    expect(cad.holes).toEqual([{ diameter: 6, diameterMm: 6, count: 4, faces: 4, kind: 'hole' }]);
    expect(cad.circles).toEqual([{ diameter: 6, diameterMm: 6, count: 8, full: 8, arcs: 0 }]);
    expect(cad.thickness).toEqual([{ value: 10, valueMm: 10 }]);
    expect(cad.parts).toMatchObject([{ id: 'PLATE-01', name: 'Base plate', revision: 'A', solids: 1 }]);
    const txt = d.blocks.map((b) => b.text);
    expect(txt).toContain('Genel boyutlar: 120.00 × 80.00 × 10.00 mm (X × Y × Z sınırlayıcı kutu, B-rep köşe noktalarından; nominal geometri, tolerans içermez)');
    expect(txt.some((t) => t.startsWith('Delik (iç silindirik yüzey): Ø6.00 mm × 4 adet'))).toBe(true);
    expect(d.blocks.filter((b) => b.loc.section === 'Geometri').length).toBeGreaterThan(5);

    // Geometri kaynaklı adaylar: en çok Medium, "tolerans modelde yok" notu ile
    const rc = findRequirementCandidates(d);
    expect(rc.length).toBe(5);
    for (const c of rc) {
      expect(['Medium', 'Low']).toContain(c.confidence);
      expect(c.text).toContain('tolerans modelde yok – resimden doğrulanmalı');
      expect(c.lsl).toBeNull();
      expect(c.usl).toBeNull();
    }
    const hole = rc.find((c) => c.text.startsWith('Delik'))!;
    expect(hole).toMatchObject({ nominal: 6, unit: 'mm', confidence: 'Medium', trigger: 'CAD nominal geometry', reqType: 'Dimensional' });
    expect(rc.find((c) => c.text.startsWith('Kalınlık'))!.confidence).toBe('Low');
    expect(rc.map((c) => c.nominal)).toEqual([120, 80, 10, 6, 10]);
  });

  it('silindir açısal kapsamı: tam / ikiye bölünmüş delik → delik, çeyrek yay → kısmi silindir (fillet)', async () => {
    const src = `ISO-10303-21;
HEADER;ENDSEC;
DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#10=CARTESIAN_POINT('',(0.,0.,0.));#11=DIRECTION('',(0.,0.,1.));#12=DIRECTION('',(1.,0.,0.));
#13=AXIS2_PLACEMENT_3D('',#10,#11,#12);#14=CYLINDRICAL_SURFACE('',#13,3.);#15=CARTESIAN_POINT('',(3.,0.,0.));
#16=VERTEX_POINT('',#15);#17=CIRCLE('',#13,3.);#18=EDGE_CURVE('',#16,#16,#17,.T.);#19=ORIENTED_EDGE('',*,*,#18,.T.);
#20=EDGE_LOOP('',(#19));#21=FACE_BOUND('',#20,.T.);#22=ADVANCED_FACE('',(#21),#14,.F.);
#30=CARTESIAN_POINT('',(20.,0.,0.));#31=AXIS2_PLACEMENT_3D('',#30,#11,#12);#32=CYLINDRICAL_SURFACE('',#31,2.);
#33=CIRCLE('',#31,2.);#34=CARTESIAN_POINT('',(22.,0.,0.));#35=VERTEX_POINT('',#34);#36=CARTESIAN_POINT('',(18.,0.,0.));
#37=VERTEX_POINT('',#36);#38=EDGE_CURVE('',#35,#37,#33,.T.);#39=EDGE_CURVE('',#37,#35,#33,.T.);
#40=ORIENTED_EDGE('',*,*,#38,.T.);#41=EDGE_LOOP('',(#40));#42=FACE_BOUND('',#41,.T.);#43=ADVANCED_FACE('',(#42),#32,.F.);
#44=ORIENTED_EDGE('',*,*,#39,.T.);#45=EDGE_LOOP('',(#44));#46=FACE_BOUND('',#45,.T.);#47=ADVANCED_FACE('',(#46),#32,.F.);
#50=CARTESIAN_POINT('',(40.,0.,0.));#51=AXIS2_PLACEMENT_3D('',#50,#11,#12);#52=CYLINDRICAL_SURFACE('',#51,1.);
#53=CIRCLE('',#51,1.);#54=CARTESIAN_POINT('',(41.,0.,0.));#55=VERTEX_POINT('',#54);#56=CARTESIAN_POINT('',(40.,1.,0.));
#57=VERTEX_POINT('',#56);#58=EDGE_CURVE('',#55,#57,#53,.T.);#59=ORIENTED_EDGE('',*,*,#58,.T.);#60=EDGE_LOOP('',(#59));
#61=FACE_BOUND('',#60,.T.);#62=ADVANCED_FACE('',(#61),#52,.T.);
#70=CLOSED_SHELL('',(#22,#43,#47,#62));#71=MANIFOLD_SOLID_BREP('',#70);
ENDSEC;
END-ISO-10303-21;`;
    const d = await extractDocument('cyl.step', Buffer.from(src));
    expect(d.status).toBe('ok');
    expect(d.cad!.holes).toEqual([
      { diameter: 4, diameterMm: 4, count: 1, faces: 2, kind: 'hole' },
      { diameter: 6, diameterMm: 6, count: 1, faces: 1, kind: 'hole' },
    ]);
    expect(d.cad!.fillets).toEqual([{ radius: 1, radiusMm: 1, faces: 1, kind: 'convex' }]);
    expect(d.blocks.map((b) => b.text)).toContain('Kısmi silindirik yüzeyler (radyus / fillet olabilir): R1.00 mm dış × 1 yüz');
  });

  it('inç birimi → mm dönüşümü (CONVERSION_BASED_UNIT)', async () => {
    const d = await extractDocument('inch.step', fx('inch.step'));
    expect(d.status).toBe('ok');
    expect(d.cad!.units).toBe('in');
    expect(d.cad!.unitScaleToMm).toBeCloseTo(25.4, 9);
    expect(d.cad!.bbox!.size).toEqual([4, 2, 1]);
    expect(d.cad!.bbox!.sizeMm).toEqual([101.6, 50.8, 25.4]);
    expect(d.cad!.holes).toEqual([{ diameter: 0.25, diameterMm: 6.35, count: 1, faces: 1, kind: 'hole' }]);
    expect(d.blocks.map((b) => b.text)).toContain(
      'Genel boyut X: 101.60 mm (4.000 in) – sınırlayıcı kutu, nominal model geometrisi; tolerans modelde yok – resimden doğrulanmalı',
    );
    const rc = findRequirementCandidates(d);
    expect(rc.find((c) => c.text.startsWith('Delik'))).toMatchObject({ nominal: 6.35, unit: 'mm' });
  });

  it('montaj ağacı: NEXT_ASSEMBLY_USAGE_OCCURRENCE ebeveyn / çocuk / adet', async () => {
    const d = await extractDocument('assembly.step', fx('assembly.step'));
    expect(d.status).toBe('ok');
    const cad = d.cad!;
    expect(cad.assembly).toEqual([
      { parent: 'ASM-001 (Bracket assembly)', child: 'PLATE-02 (Bracket plate)', quantity: 1 },
      { parent: 'ASM-001 (Bracket assembly)', child: 'PIN-01 (Dowel pin)', quantity: 2 },
    ]);
    expect(cad.solids).toBe(2);
    // Yerleşim dönüşümleri uygulanmadığından genel montaj kutusu verilmez; parça kutuları verilir
    expect(cad.bbox).toBeUndefined();
    expect(cad.warnings!.join(' ')).toContain('NOT SUPPORTED');
    const parts = Object.fromEntries(cad.parts!.map((p) => [p.id, p]));
    expect(parts['PLATE-02'].bbox!.sizeMm).toEqual([100, 60, 8]);
    expect(parts['PIN-01'].bbox!.sizeMm).toEqual([5, 5, 20]);
    expect(parts['ASM-001'].bbox).toBeUndefined();
    expect(cad.holes).toEqual([
      { diameter: 5, diameterMm: 5, count: 1, faces: 1, kind: 'boss', part: 'PIN-01 (Dowel pin)' },
      { diameter: 5, diameterMm: 5, count: 2, faces: 2, kind: 'hole', part: 'PLATE-02 (Bracket plate)' },
    ]);
    const montaj = d.blocks.filter((b) => b.loc.section === 'Montaj').map((b) => b.text);
    expect(montaj).toEqual([
      'Montaj yapısı: ASM-001 (Bracket assembly) kök; 2 ebeveyn–çocuk ilişkisi',
      'Montaj: ASM-001 (Bracket assembly) → PLATE-02 (Bracket plate) × 1 adet',
      'Montaj: ASM-001 (Bracket assembly) → PIN-01 (Dowel pin) × 2 adet',
    ]);
    // Montaj satırları gereksinim adayı değildir
    expect(findRequirementCandidates(d).some((c) => c.text.startsWith('Montaj'))).toBe(false);
  });

  it('AP242 PMI: DIMENSIONAL_SIZE + PLUS_MINUS_TOLERANCE → yüksek güvenli gereksinim adayı; GD&T + datum; malzeme', async () => {
    const d = await extractDocument('pmi.step', fx('pmi.step'));
    expect(d.status).toBe('ok');
    const pmi = d.cad!.pmi!;
    expect(pmi[0]).toEqual({
      kind: 'DIMENSIONAL_SIZE', name: 'diameter', value: 6, unit: 'mm', upper: 0.1, lower: 0, tolerance: '+0.10/-0.00',
      text: 'PMI: Ø6.00 +0.10/-0.00 mm (DIMENSIONAL_SIZE: diameter)',
    });
    expect(pmi.find((p) => p.kind === 'POSITION_TOLERANCE')).toMatchObject({ value: 0.2, datum: 'A' });
    expect(pmi.find((p) => p.kind === 'FLATNESS_TOLERANCE')).toMatchObject({ value: 0.05 });
    expect(pmi.find((p) => p.kind === 'DATUM')).toMatchObject({ datum: 'A' });
    expect(d.cad!.materials).toEqual([{ name: 'AL 7075-T6', source: 'MATERIAL_DESIGNATION', part: 'PLATE-PMI (PMI plate)' }]);
    expect(d.meta.material).toBe('AL 7075-T6');

    const rc = findRequirementCandidates(d);
    const dia = rc.find((c) => c.text.includes('DIMENSIONAL_SIZE'))!;
    expect(dia).toMatchObject({ nominal: 6, lsl: 6, usl: 6.1, unit: 'mm', confidence: 'High', trigger: 'CAD PMI', characteristic: 'diameter' });
    expect(dia.loc.section).toBe('PMI');
    const pos = rc.find((c) => c.text.includes('POSITION_TOLERANCE'))!;
    expect(pos).toMatchObject({ usl: 0.2, confidence: 'High' });
    expect(pos.text).toContain('datum: A');
    // Datum notu aday değildir
    expect(rc.some((c) => c.text.includes('Datum A tanımlı'))).toBe(false);
  });

  it('eski part.step: geometri yok → partial, PMI (flatness 0.05) okunur', async () => {
    const d = await extractDocument('part.step', fx('part.step'));
    expect(d.status).toBe('partial');
    expect(d.messages[0].text).toBe(CAD_PARTIAL_MSG);
    expect(d.cad!.bbox!.source).toBe('all-points');
    expect(d.cad!.pmi).toMatchObject([{ kind: 'GEOMETRIC_TOLERANCE', name: 'flatness', value: 0.05 }]);
    // güvenilmez kutudan ölçü adayı üretilmez
    expect(findRequirementCandidates(d).filter((c) => c.text.startsWith('Genel boyut'))).toEqual([]);
  });
});

describe('IGES geometri', () => {
  it('global bölüm, 110 dikdörtgen, 4× tam daire, 124 dönüşüm uygulanır, 192 silindir', async () => {
    const d = await extractDocument('plate.igs', fx('plate.igs'));
    expect(d.status).toBe('ok');
    expect(d.messages[0].text).toBe(CAD_NOMINAL_MSG);
    const cad = d.cad!;
    expect(cad.units).toBe('mm');
    expect(cad.unitScaleToMm).toBe(1);
    expect(cad.header).toMatchObject({ fileName: 'plate.igs', author: 'Kemal', organization: 'ACME Aero', modelSpaceScale: '1.', minResolution: '1.E-06', maxCoordinate: '120.' });
    // Dönüşümsüz: orijindeki daire min'i -3'e çeker, döndürülmüş çizgi Z=0'da kalırdı
    expect(cad.bbox).toMatchObject({ min: [0, 0, 0], max: [120, 80, 25], sizeMm: [120, 80, 25] });
    expect(cad.circles).toEqual([{ diameter: 6, diameterMm: 6, count: 4, full: 4, arcs: 0 }]);
    expect(cad.holes).toEqual([{ diameter: 6, diameterMm: 6, count: 1, faces: 1, kind: 'cylindrical' }]);
    expect(d.messages.some((m) => m.text.includes('124 dönüşüm'))).toBe(true);
    const rc = findRequirementCandidates(d);
    expect(rc.find((c) => c.text.startsWith('Silindirik özellik'))).toMatchObject({ nominal: 6, confidence: 'Medium' });
  });

  it('inç IGES: birim bayrağı 1 → 25.4 mm ölçek', async () => {
    const igs = fx('plate.igs').toString('latin1').replace(',1.,2,2HMM,', ',1.,1,2HIN,');
    const d = await extractDocument('plate_in.igs', Buffer.from(igs, 'latin1'));
    expect(d.cad!.units).toBe('in');
    expect(d.cad!.unitScaleToMm).toBe(25.4);
    expect(d.cad!.bbox!.sizeMm).toEqual([3048, 2032, 635]);
  });
});

describe('Bozuk girdi – asla fırlatmaz', () => {
  it('kesik STEP → uyarı, fırlatmaz', async () => {
    const full = fx('plate.step').toString('latin1');
    const cut = full.slice(0, Math.floor(full.length * 0.6));
    const d = await extractDocument('cut.step', Buffer.from(cut, 'latin1'));
    expect(['ok', 'partial']).toContain(d.status);
    expect(d.messages.some((m) => m.text.includes('kesik'))).toBe(true);
  });

  it('yalnızca başlık / DATA yok / anlamsız gövde → partial', async () => {
    for (const body of ['', 'DATA;\nENDSEC;', 'DATA;\n#1=FOO(((((((;\n', 'DATA;\n#1=' + '('.repeat(5000) + ')'.repeat(5000) + ';\nENDSEC;', 'DATA;\n#x=1;\n#2==;\nENDSEC;']) {
      const d = await extractDocument('h.step', Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('h.step','',(''),(''),'','','');\nENDSEC;\n${body}`));
      expect(d.status, body.slice(0, 20)).toBe('partial');
      expect(d.messages[0].text).toBe(CAD_PARTIAL_MSG);
    }
  });

  it('bozuk referanslı STEP (eksik #id, yanlış tipler) → fırlatmaz', async () => {
    const src = `ISO-10303-21;\nHEADER;ENDSEC;\nDATA;\n#1=MANIFOLD_SOLID_BREP('x',#99);\n#2=ADVANCED_FACE('',(#1,#1),#2,.T.);\n#3=CYLINDRICAL_SURFACE('',#4,'r');\n#4=AXIS2_PLACEMENT_3D('',#5,$,$);\n#5=CARTESIAN_POINT('',('a',2.));\n#6=EDGE_CURVE('',#6,#6,#6,.T.);\n#7=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#1,#2,$);\n#8=PLUS_MINUS_TOLERANCE(#8,#8);\n#9=DIMENSIONAL_SIZE(#9,'diameter');\nENDSEC;\nEND-ISO-10303-21;`;
    const d = await extractDocument('bad.step', Buffer.from(src));
    expect(['ok', 'partial']).toContain(d.status);
  });

  it('bozuk IGES parametre verisi → fırlatmaz', async () => {
    const igs = fx('plate.igs')
      .toString('latin1')
      .split('\n')
      .map((l) => (l[72] === 'P' ? 'xx,yy;'.padEnd(64) + l.slice(64) : l))
      .join('\n');
    const d = await extractDocument('bad.igs', Buffer.from(igs, 'latin1'));
    expect(['ok', 'partial']).toContain(d.status);
    expect(d.cad!.format).toBe('IGES');
  });
});

describe('Performans', () => {
  it('~200k varlıklı sentetik STEP < 3 sn', async () => {
    const L: string[] = [
      'ISO-10303-21;',
      "HEADER;FILE_DESCRIPTION(('perf'),'2;1');FILE_NAME('perf.step','',(''),(''),'','','');FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));ENDSEC;",
      'DATA;',
      '#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));',
      "#2=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#1))REPRESENTATION_CONTEXT('',''));",
    ];
    let id = 10;
    const faces: number[] = [];
    const G = 14300;
    const radii = [1.5, 3, 4.25];
    for (let i = 0; i < G; i++) {
      const x = (i % 120) * 10, y = Math.floor(i / 120) * 10, r = radii[i % 3];
      const c = id;
      L.push(
        `#${c}=CARTESIAN_POINT('',(${x}.,${y}.,0.));`,
        `#${c + 1}=DIRECTION('',(0.,0.,1.));`,
        `#${c + 2}=DIRECTION('',(1.,0.,0.));`,
        `#${c + 3}=AXIS2_PLACEMENT_3D('',#${c},#${c + 1},#${c + 2});`,
        `#${c + 4}=CYLINDRICAL_SURFACE('',#${c + 3},${r});`,
        `#${c + 5}=CARTESIAN_POINT('',(${x + r},${y}.,0.));`,
        `#${c + 6}=VERTEX_POINT('',#${c + 5});`,
        `#${c + 7}=CIRCLE('',#${c + 3},${r});`,
        `#${c + 8}=EDGE_CURVE('',#${c + 6},#${c + 6},#${c + 7},.T.);`,
        `#${c + 9}=ORIENTED_EDGE('',*,*,#${c + 8},.T.);`,
        `#${c + 10}=EDGE_LOOP('',(#${c + 9}));`,
        `#${c + 11}=FACE_BOUND('',#${c + 10},.T.);`,
        `#${c + 12}=ADVANCED_FACE('hole ${i}; ''q''',(#${c + 11}),#${c + 4},.F.);`,
        `/* grup ${i} */ #${c + 13}=DIRECTION('',\n  (0.,1.,0.));`,
      );
      faces.push(c + 12);
      id += 14;
    }
    L.push(`#${id}=CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}));`, `#${id + 1}=MANIFOLD_SOLID_BREP('big',#${id});`, 'ENDSEC;', 'END-ISO-10303-21;');
    const buf = Buffer.from(L.join('\n'));
    const t0 = performance.now();
    const d = await extractDocument('perf.step', buf);
    const ms = performance.now() - t0;
    const total = Object.values(d.cad!.entityCounts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(200_000);
    expect(d.status).toBe('ok');
    expect(d.cad!.holes!.map((h) => [h.diameter, h.count])).toEqual([
      [3, Math.ceil(G / 3)],
      [6, Math.ceil((G - 1) / 3)],
      [8.5, Math.floor(G / 3)],
    ]);
    expect(ms).toBeLessThan(3000);
  }, 20_000);
});
