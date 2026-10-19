import { useState } from 'react';
import { traceability } from '../../shared/checks';
import { rowLabel } from '../../shared/columns';
import { apOf, riskLevel } from '../../shared/scoring';
import type { ScoringEntry } from '../../shared/types';
import { TextCell } from '../components/Cells';
import { useStore } from '../store';

export function TraceabilityTab() {
  const { project } = useStore();
  const mats = traceability(project);
  const [key, setKey] = useState(mats[0].key);
  const m = mats.find((x) => x.key === key)!;

  // Zincir görünümü: gereksinim → DFMEA → PFMEA → KC → kontrol planı
  const chains = project.requirements.map((r) => {
    const dfs = project.dfmea.filter((d) => d.reqIds.includes(r.id));
    return { r, dfs };
  });

  return (
    <div className="page">
      <div className="matrix-tabs">
        {mats.map((x) => (
          <button key={x.key} className={`chip-btn ${x.key === key ? 'on' : ''}`} onClick={() => setKey(x.key)}>
            {x.title}
            <span className="n">{x.links.length}</span>
            {x.orphans.length > 0 && <span className="n warn">{x.orphans.length}</span>}
          </button>
        ))}
      </div>
      <div className="two-col">
        <section className="card">
          <h3>{m.title}</h3>
          {m.links.length === 0 ? (
            <p className="muted">Bağlantı yok.</p>
          ) : (
            <table className="effects">
              <thead>
                <tr><th>Kimden</th><th>Kime</th></tr>
              </thead>
              <tbody>
                {m.links.map((l, i) => (
                  <tr key={i}>
                    <td title={rowLabel(project, l.from)}>{rowLabel(project, l.from)}</td>
                    <td title={rowLabel(project, l.to)}>{rowLabel(project, l.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h3>Boşluklar</h3>
          {m.orphanLabel ? (
            m.orphans.length ? (
              <>
                <p className="warn-text">{m.orphanLabel}</p>
                <ul className="plain">{m.orphans.map((o) => <li key={o}>{rowLabel(project, o)}</li>)}</ul>
              </>
            ) : (
              <p className="ok-text">✓ Boşluk yok</p>
            )
          ) : (
            <p className="muted">Bu matris için boşluk kontrolü yok.</p>
          )}
        </section>
      </div>
      <section className="card">
        <h3>Uçtan uca zincir (Gereksinim → DFMEA → PFMEA → KC → Kontrol Planı)</h3>
        {chains.length === 0 && <p className="muted">Gereksinim girildiğinde zincir burada görünür.</p>}
        <div className="chains">
          {chains.map(({ r, dfs }) => (
            <div key={r.id} className="chain">
              <div className="node req">{r.id}<small>{r.text.slice(0, 60)}</small></div>
              <div className="branch">
                {dfs.length === 0 && <div className="node gap">DFMEA yok</div>}
                {dfs.map((d) => {
                  const pfs = project.pfmea.filter((p) => p.dfIds.includes(d.id));
                  const kcs = project.kcs.filter((k) => k.sourceId === d.id || pfs.some((p) => p.id === k.sourceId));
                  const cps = project.controlPlan.filter((c) => kcs.some((k) => k.id === c.kcId) || pfs.some((p) => p.id === c.pfId));
                  return (
                    <div key={d.id} className="row">
                      <div className={`node df ${riskLevel(d, project.settings, project.scoring.apTable).toLowerCase()}`}>{d.id}<small>{d.failureMode.slice(0, 50)} · AP {apOf(project, d.s, d.o, d.d) || '–'}</small></div>
                      <span className="arr">→</span>
                      <div className="node pf">{pfs.length ? pfs.map((p) => p.id).join(', ') : <span className="gap-t">PFMEA yok</span>}</div>
                      <span className="arr">→</span>
                      <div className="node kc">{kcs.length ? kcs.map((k) => `${k.id}${k.status === 'Approved' ? ' ✓' : ''}`).join(', ') : '—'}</div>
                      <span className="arr">→</span>
                      <div className="node cp">{cps.length ? cps.map((c) => c.id).join(', ') : kcs.length ? <span className="gap-t">Kontrol planı yok</span> : '—'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}


export function ScoringTab() {
  const { project, mutate } = useStore();
  const [kind, setKind] = useState<'severity' | 'occurrence' | 'detection'>('severity');
  const list = project.scoring[kind];
  const setEntry = (rank: number, field: keyof ScoringEntry) => (v: unknown) => {
    mutate((d) => {
      const e = d.scoring[kind].find((x) => x.rank === rank);
      if (e) (e as unknown as Record<string, unknown>)[field] = String(v);
    });
    return Promise.resolve(true);
  };
  return (
    <div>
      <div>
        <section className="card">
          <h3>Puanlama kriterleri</h3>
          <div className="matrix-tabs">
            {(['severity', 'occurrence', 'detection'] as const).map((k) => (
              <button key={k} className={`chip-btn ${k === kind ? 'on' : ''}`} onClick={() => setKind(k)}>
                {k === 'severity' ? 'Severity (S)' : k === 'occurrence' ? 'Occurrence (O)' : 'Detection (D)'}
              </button>
            ))}
          </div>
          <p className="muted">Kurum veya müşteri tablonuz varsa metinleri buraya yazın; hücrelerdeki açılır listeler bu metinleri gösterir.</p>
          <table className="effects scoring">
            <thead>
              <tr><th>Puan</th><th>DFMEA kriteri</th><th>PFMEA kriteri</th></tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.rank}>
                  <td className="center"><b>{e.rank}</b></td>
                  <td><TextCell value={e.df} multiline onCommit={setEntry(e.rank, 'df')} /></td>
                  <td><TextCell value={e.pf} multiline onCommit={setEntry(e.rank, 'pf')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
