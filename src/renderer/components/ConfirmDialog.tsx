import { useEffect } from 'react';
import { fieldLabel, rowLabel } from '../../shared/columns';
import type { Effect } from '../../shared/engine';
import { TABLE_LABEL } from '../../shared/model';
import { TABS } from '../../shared/tabs';
import { useStore } from '../store';

const SETTINGS_LABEL: Record<string, string> = {
  kcSeverityThreshold: 'KC Severity eşiği',
  highSeverityThreshold: 'High Severity eşiği',
  rpnThreshold: 'RPN eşiği',
  autoKcCandidates: 'Otomatik KC adayı',
  autoControlPlan: 'Otomatik kontrol planı',
};

function fmt(v: unknown): string {
  if (v == null || v === '') return '(boş)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(boş)';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  const s = String(v);
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

function screenName(table: string) {
  const i = TABS.findIndex((t) => t.key === table);
  return i >= 0 ? `${i + 1}. ${TABS[i].label}` : TABLE_LABEL[table as keyof typeof TABLE_LABEL] ?? 'Ayarlar';
}

export function ConfirmDialog() {
  const { pending, decide, project } = useStore();
  useEffect(() => {
    if (!pending) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decide('cancel');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pending, decide]);
  if (!pending) return null;

  const primary = pending.plan.effects.filter((e) => e.primary);
  const groups = new Map<string, Effect[]>();
  for (const e of pending.effects) {
    const k = String(e.table);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const order = [...groups.keys()].sort((a, b) => TABS.findIndex((t) => t.key === a) - TABS.findIndex((t) => t.key === b));
  const counts = {
    mod: pending.effects.filter((e) => e.kind === 'Modified').length,
    add: pending.effects.filter((e) => e.kind === 'Added').length,
    del: pending.effects.filter((e) => e.kind === 'Deleted').length,
  };

  return (
    <div className="modal-back">
      <div className="modal confirm" role="dialog" aria-modal="true">
        <div className="modal-head warn">
          <div className="icon">⚠</div>
          <div>
            <h2>Bu değişiklik diğer ekranları da etkiliyor</h2>
            <p>Onaylamadan önce nelerin değişeceğini kontrol edin. Hiçbir şey siz onaylamadan kaydedilmez.</p>
          </div>
        </div>

        <div className="modal-body">
          <section className="you-changed">
            <h3>Sizin yaptığınız değişiklik</h3>
            <ul>
              {primary.map((e, i) => (
                <li key={i}>
                  <b>{screenName(String(e.table))}</b> · {e.id}
                  {e.kind === 'Modified' && (
                    <>
                      {' '}· {e.table === 'settings' ? SETTINGS_LABEL[e.field!] ?? e.field : fieldLabel(String(e.table), e.field!)}: <span className="from">{fmt(e.from)}</span> → <span className="to">{fmt(e.to)}</span>
                    </>
                  )}
                  {e.kind === 'Added' && <> · yeni kayıt</>}
                  {e.kind === 'Deleted' && <> · silinecek</>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>
              Onaylarsanız otomatik olarak yapılacaklar
              <span className="pill">{counts.mod} güncelleme</span>
              {counts.add > 0 && <span className="pill green">{counts.add} yeni kayıt</span>}
              {counts.del > 0 && <span className="pill red">{counts.del} silme</span>}
            </h3>
            {order.map((t) => (
              <div key={t} className="effect-group">
                <h4>{screenName(t)} ekranı</h4>
                <table className="effects">
                  <tbody>
                    {groups.get(t)!.map((e, i) => (
                      <tr key={i} className={`k-${e.kind}`}>
                        <td className="kind">{e.kind === 'Added' ? 'Eklenecek' : e.kind === 'Deleted' ? 'Silinecek' : 'Değişecek'}</td>
                        <td className="rid" title={rowLabel(project, e.id)}>{e.id}</td>
                        <td>
                          {e.kind === 'Modified' ? (
                            <>
                              <b>{fieldLabel(t, e.field!)}</b>: <span className="from">{fmt(e.from)}</span> → <span className="to">{fmt(e.to)}</span>
                            </>
                          ) : (
                            <span>{rowLabel(pending.plan.project, e.id) || rowLabel(project, e.id)}</span>
                          )}
                          <div className="why">Neden: {e.reason}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={() => decide('cancel')}>
            Vazgeç
          </button>
          <button className="btn" onClick={() => decide('only')} title="Bağlı ekranlar güncellenmez; oluşan tutarsızlıklar Kalite Kontrol ekranında görünür.">
            Sadece bu ekranda değiştir
          </button>
          <button className="btn primary" autoFocus onClick={() => decide('apply')}>
            Onayla ve tümünü güncelle
          </button>
        </div>
      </div>
    </div>
  );
}
