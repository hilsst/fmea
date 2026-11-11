import { useEffect, useState } from 'react';
import { fieldLabel, rowLabel } from '../../shared/columns';
import type { Effect } from '../../shared/engine';
import { SCREENS, screenLabel, screenOfTable } from '../../shared/nav';
import { useStore } from '../store';
import { Modal } from './Modal';

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

const screenName = screenLabel;
/** Tek tıkla seçilen hazır nedenler (yazmak zorunlu değil). */
const QUICK_REASONS = ['Onaylandı', 'Mühendis incelemesi', 'Tasarım incelemesi kararı', 'Müşteri talebi', 'Doküman revizyonu', 'Hatalı giriş düzeltmesi'];

const order = (t: string) => SCREENS.findIndex((s) => s.key === screenOfTable(t)?.screen);

export function ConfirmDialog() {
  const { pending, decide, project } = useStore();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  useEffect(() => {
    setReason('');
    setComment('');
  }, [pending]);
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
  const sorted = [...groups.keys()].sort((a, b) => order(a) - order(b));
  const cross = pending.effects.length > 0;
  const blocked = pending.needReason && !reason.trim();
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
            <h2>{cross ? 'Bu değişiklik diğer ekranları da etkiliyor' : 'Değişiklik nedeni gerekli'}</h2>
            <p>{cross ? 'Onaylamadan önce nelerin değişeceğini kontrol edin. Hiçbir şey siz onaylamadan kaydedilmez.' : 'Bu alan denetim izinde nedeniyle kaydedilir (Ayarlar › Neden sorulan alanlar).'}</p>
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

          {cross && <section>
            <h3>
              Onaylarsanız otomatik olarak yapılacaklar
              <span className="pill">{counts.mod} güncelleme</span>
              {counts.add > 0 && <span className="pill green">{counts.add} yeni kayıt</span>}
              {counts.del > 0 && <span className="pill red">{counts.del} silme</span>}
            </h3>
            {sorted.map((t) => (
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
          </section>}
          <section className="reason">
            <div className="form">
              <label className="wide">
                <span>Değişiklik nedeni{pending.needReason ? ' (zorunlu)' : ' (isteğe bağlı)'}</span>
                <div className="quick-reasons">
                  {QUICK_REASONS.map((q) => (
                    <button key={q} type="button" className={`chip-btn ${reason === q ? 'on' : ''}`} onClick={() => setReason(q)}>
                      {q}
                    </button>
                  ))}
                </div>
                <input className="cell-input" autoFocus={pending.needReason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. müşteri resmi Rev C, NCR-0042 sonucu, tasarım incelemesi kararı…" />
              </label>
              <label className="wide">
                <span>Yorum</span>
                <input className="cell-input" value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
            </div>
            <p className="muted small">Kullanıcı: {project.settings.userName || '(Ayarlar’da kullanıcı adı girilmemiş)'} · Revizyon: {project.meta.fmeaRevision}</p>
          </section>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={() => decide('cancel')}>
            Vazgeç
          </button>
          {cross && (
            <button className="btn" disabled={blocked} onClick={() => decide('only', reason, comment)} title="Bağlı ekranlar güncellenmez; oluşan tutarsızlıklar Kalite Kontrol ekranında görünür.">
              Sadece bu ekranda değiştir
            </button>
          )}
          <button className="btn primary" autoFocus={!pending.needReason} disabled={blocked} onClick={() => decide('apply', reason, comment)}>
            {cross ? 'Onayla ve tümünü güncelle' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** store.ask / store.confirm penceresi. */
export function AskDialog() {
  const { asking, answer } = useStore();
  const [text, setText] = useState('');
  useEffect(() => setText(asking?.input ?? ''), [asking]);
  if (!asking) return null;
  const hasInput = asking.input !== undefined;
  const ok = () => (!hasInput || text.trim()) && answer(hasInput ? text.trim() : '');
  return (
    <Modal
      title={asking.title}
      icon={asking.danger ? '⚠' : '?'}
      onClose={() => answer(null)}
      foot={
        <>
          <button className="btn" onClick={() => answer(null)}>Vazgeç</button>
          <button className={`btn ${asking.danger ? 'danger' : 'primary'}`} autoFocus={!hasInput} disabled={hasInput && !text.trim()} onClick={ok}>
            {asking.okLabel ?? 'Tamam'}
          </button>
        </>
      }
    >
      {asking.message && <p className="ask-msg">{asking.message}</p>}
      {hasInput && <input className="cell-input ask-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />}
    </Modal>
  );
}
