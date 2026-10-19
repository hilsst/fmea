import { useState } from 'react';
import { completenessScore, qualityChecks, traceability } from '../../shared/checks';
import { rowLabel } from '../../shared/columns';
import { actionPriority, riskLevel } from '../../shared/scoring';
import type { TabKey } from '../../shared/tabs';
import type { ScoringEntry } from '../../shared/types';
import { api, isDesktop } from '../api';
import { projectContext } from '../components/AiDialogs';
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
                      <div className={`node df ${riskLevel(d, project.settings).toLowerCase()}`}>{d.id}<small>{d.failureMode.slice(0, 50)} · AP {actionPriority(d.s, d.o, d.d) || '–'}</small></div>
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

function md(text: string) {
  // Minimal markdown → HTML (başlık, madde, kalın)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc(text).split('\n');
  let html = '';
  let inList = false;
  for (const l of lines) {
    const b = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*[-*] /.test(l)) {
      if (!inList) html += '<ul>';
      inList = true;
      html += `<li>${b.replace(/^\s*[-*] /, '')}</li>`;
      continue;
    }
    if (inList) {
      html += '</ul>';
      inList = false;
    }
    if (/^### /.test(l)) html += `<h5>${b.slice(4)}</h5>`;
    else if (/^## /.test(l)) html += `<h4>${b.slice(3)}</h4>`;
    else if (/^# /.test(l)) html += `<h3>${b.slice(2)}</h3>`;
    else if (l.trim()) html += `<p>${b}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

export function QualityTab({ go }: { go: (t: TabKey) => void }) {
  const { project, toast } = useStore();
  const checks = qualityChecks(project);
  const score = completenessScore(checks);
  const [review, setReview] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const top = [...project.dfmea, ...project.pfmea]
    .filter((r) => r.failureMode)
    .map((r) => ({ r, risk: riskLevel(r, project.settings), ap: actionPriority(r.s, r.o, r.d) }))
    .filter((x) => x.risk)
    .sort((a, b) => {
      const ord = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, '': 4 };
      return ord[a.risk] - ord[b.risk] || (b.r.s ?? 0) - (a.r.s ?? 0) || ((b.r.s ?? 0) * (b.r.o ?? 0)) - ((a.r.s ?? 0) * (a.r.o ?? 0));
    })
    .slice(0, 10);

  const runReview = async () => {
    if (!isDesktop) return toast('AI özeti masaüstü uygulamasında çalışır.', 'warn');
    const s = await api.aiStatus();
    if (!s.configured) {
      window.dispatchEvent(new CustomEvent('open-settings'));
      return toast('Önce Claude API anahtarını girin.', 'warn');
    }
    setBusy(true);
    const r = await api.aiReview({ context: projectContext(project) + '\n\nKALİTE KONTROL:\n' + checks.map((c) => `${c.ok ? 'UYGUN' : 'EKSİK'} – ${c.question}: ${c.detail} ${c.ids.slice(0, 20).join(',')}`).join('\n') });
    setBusy(false);
    if (!r.ok) return toast(`AI hatası: ${r.error}`, 'err');
    setReview(String((r.data as { markdown: string }).markdown));
  };

  return (
    <div className="page">
      <div className="two-col">
        <section className="card">
          <div className="score-head">
            <div className={`gauge ${score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red'}`} style={{ ['--p' as string]: score }}>
              <span>%{score}</span>
            </div>
            <div>
              <h3>FMEA Completeness Score</h3>
              <p className="muted">Ağırlıklı kontrol listesi (spesifikasyon §35). Bu skor bir kalite sertifikası değildir; mühendislik değerlendirmesinin yerini tutmaz.</p>
            </div>
          </div>
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                <span className="mark">{c.ok ? '✓' : '!'}</span>
                <div>
                  <b>{c.question}</b>
                  <div className="muted">{c.detail}</div>
                  {!c.ok && c.ids.length > 0 && <div className="ids">{c.ids.slice(0, 30).join(', ')}{c.ids.length > 30 ? ' …' : ''}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h3>Kritik riskler (ilk 10)</h3>
          <p className="muted">Sıralama: emniyet/regülasyon ve yüksek severity önce, sonra AP ve S×O. RPN tek başına kullanılmaz.</p>
          {top.length === 0 && <p className="muted">Puanlanmış satır yok.</p>}
          <table className="effects">
            <tbody>
              {top.map(({ r, risk, ap }) => (
                <tr key={r.id} onClick={() => go(r.id.startsWith('DF') ? 'dfmea' : 'pfmea')} className="click">
                  <td><span className={`badge ${risk === 'CRITICAL' || risk === 'HIGH' ? 'b-red' : risk === 'MEDIUM' ? 'b-amber' : 'b-green'}`}>{risk}</span></td>
                  <td className="rid">{r.id}</td>
                  <td>{r.failureMode}<div className="why">S{r.s ?? '–'} O{r.o ?? '–'} D{r.d ?? '–'} · AP {ap || '–'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt">Mühendislik özeti</h3>
          <p className="muted">Claude, mevcut proje verisinden spesifikasyon §36 formatında özet ve Critical / Important / Optional soruları hazırlar.</p>
          <button className="btn ai" disabled={busy} onClick={runReview}>{busy ? 'Hazırlanıyor…' : '✦ AI: Mühendislik özeti oluştur'}</button>
          {review && <div className="md" dangerouslySetInnerHTML={{ __html: md(review) }} />}
        </section>
      </div>
    </div>
  );
}

const S_BANDS = ['9–10', '7–8', '4–6', '2–3', '1'];
const O_BANDS = ['8–10', '6–7', '4–5', '2–3', '1'];
const D_COLS: [string, number][] = [['D 7–10', 8], ['D 5–6', 5], ['D 2–4', 3], ['D 1', 1]];
const S_REP = [10, 8, 5, 2, 1];
const O_REP = [9, 6, 4, 2, 1];

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
    <div className="page">
      <div className="two-col">
        <section className="card">
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
        <section className="card">
          <h3>Action Priority (AP) tablosu</h3>
          <p className="muted">AIAG & VDA FMEA Handbook (2019). AP her satırda S, O, D girildiğinde otomatik hesaplanır.</p>
          <table className="ap-table">
            <thead>
              <tr><th>S</th><th>O</th>{D_COLS.map(([l]) => <th key={l}>{l}</th>)}</tr>
            </thead>
            <tbody>
              {S_BANDS.flatMap((sb, si) =>
                O_BANDS.map((ob, oi) => (
                  <tr key={`${si}-${oi}`}>
                    {oi === 0 && <td rowSpan={5} className="band">{sb}</td>}
                    <td className="band">{ob}</td>
                    {D_COLS.map(([l, d]) => {
                      const ap = actionPriority(S_REP[si], O_REP[oi], d);
                      return <td key={l} className={`ap ap-${ap}`}>{ap}</td>;
                    })}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
