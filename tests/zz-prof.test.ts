import { it } from 'vitest';
import { StepFile } from '../src/main/docintel/cad/step-graph';
import { analyzeStep } from '../src/main/docintel/cad/step-analyze';
import { extractDocument } from '../src/main/docintel/index';
it('prof', async () => {
  const L: string[] = ['ISO-10303-21;', "HEADER;ENDSEC;", 'DATA;', '#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));'];
  let id = 10; const faces: number[] = [];
  for (let i = 0; i < 14300; i++) {
    const x = (i % 120) * 10, y = Math.floor(i / 120) * 10, r = 3; const c = id;
    L.push(`#${c}=CARTESIAN_POINT('',(${x}.,${y}.,0.));`, `#${c + 1}=DIRECTION('',(0.,0.,1.));`, `#${c + 2}=DIRECTION('',(1.,0.,0.));`, `#${c + 3}=AXIS2_PLACEMENT_3D('',#${c},#${c + 1},#${c + 2});`, `#${c + 4}=CYLINDRICAL_SURFACE('',#${c + 3},${r});`, `#${c + 5}=CARTESIAN_POINT('',(${x + r},${y}.,0.));`, `#${c + 6}=VERTEX_POINT('',#${c + 5});`, `#${c + 7}=CIRCLE('',#${c + 3},${r});`, `#${c + 8}=EDGE_CURVE('',#${c + 6},#${c + 6},#${c + 7},.T.);`, `#${c + 9}=ORIENTED_EDGE('',*,*,#${c + 8},.T.);`, `#${c + 10}=EDGE_LOOP('',(#${c + 9}));`, `#${c + 11}=FACE_BOUND('',#${c + 10},.T.);`, `#${c + 12}=ADVANCED_FACE('hole',(#${c + 11}),#${c + 4},.F.);`, `#${c + 13}=DIRECTION('',(0.,1.,0.));`);
    faces.push(c + 12); id += 14;
  }
  L.push(`#${id}=CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}));`, `#${id + 1}=MANIFOLD_SOLID_BREP('big',#${id});`, 'ENDSEC;');
  const txt = L.join('\n');
  for (let k = 0; k < 2; k++) {
    let t = performance.now(); const f = new StepFile(txt); const a = performance.now() - t;
    t = performance.now(); analyzeStep(f); const b = performance.now() - t;
    t = performance.now(); await extractDocument('p.step', Buffer.from('ISO-10303-21;\n' + txt)); const c = performance.now() - t;
    console.log('scan', a.toFixed(0), 'analyze', b.toFixed(0), 'full', c.toFixed(0));
  }
});
