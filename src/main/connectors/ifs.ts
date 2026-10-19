// Opsiyonel IFS connector (§2). Çekirdek uygulama bu modüle bağımlı değildir; kapalıyken hiçbir işlev etkilenmez.
// Bu sürümde yalnızca arayüz ve MOCK veri vardır; gerçek IFS bağlantısı NOT SUPPORTED.

export interface IfsSettings {
  enabled: boolean;
  mode: 'mock' | 'live';
  baseUrl: string;
  auth: 'oauth2' | 'basic';
  clientId: string;
  username: string;
}

export const DEFAULT_IFS: IfsSettings = { enabled: false, mode: 'mock', baseUrl: '', auth: 'oauth2', clientId: '', username: '' };

export interface IfsPart { partNo: string; description: string; revision: string }
export interface IfsNcr { ncrNo: string; partNo: string; date: string; description: string; rootCause: string; action: string }
export interface IfsOperation { partNo: string; opNo: string; name: string; workCenter: string }

export interface IfsConnector {
  test(): Promise<{ ok: boolean; message: string }>;
  parts(query: string): Promise<IfsPart[]>;
  ncrs(partNo: string): Promise<IfsNcr[]>;
  routing(partNo: string): Promise<IfsOperation[]>;
}

const MOCK_NOTE = 'MOCK – örnek veri, gerçek IFS kaydı değildir';

class MockIfs implements IfsConnector {
  async test() {
    return { ok: true, message: `Mock bağlantı hazır (${MOCK_NOTE}).` };
  }
  async parts(query: string) {
    const all = [
      { partNo: 'MOCK-1001', description: `Örnek kompozit panel (${MOCK_NOTE})`, revision: 'A' },
      { partNo: 'MOCK-1002', description: `Örnek bonded braket (${MOCK_NOTE})`, revision: 'B' },
    ];
    return all.filter((p) => !query || p.partNo.includes(query) || p.description.toLowerCase().includes(query.toLowerCase()));
  }
  async ncrs(partNo: string) {
    return [{ ncrNo: 'MOCK-NCR-001', partNo, date: '2026-01-15', description: `Örnek uygunsuzluk (${MOCK_NOTE})`, rootCause: '', action: '' }];
  }
  async routing(partNo: string) {
    return [
      { partNo, opNo: '10', name: 'Lay-up', workCenter: 'MOCK-WC1' },
      { partNo, opNo: '20', name: 'Cure', workCenter: 'MOCK-AUTOCLAVE' },
    ];
  }
}

class LiveIfs implements IfsConnector {
  private ns = () => Promise.reject(new Error('NOT SUPPORTED – canlı IFS bağlantısı bu sürümde uygulanmadı. Mock modu kullanılabilir.'));
  async test() {
    return { ok: false, message: 'NOT SUPPORTED – canlı IFS bağlantısı bu sürümde uygulanmadı.' };
  }
  parts = this.ns as IfsConnector['parts'];
  ncrs = this.ns as IfsConnector['ncrs'];
  routing = this.ns as IfsConnector['routing'];
}

export function ifsConnector(s: IfsSettings): IfsConnector | null {
  if (!s.enabled) return null;
  return s.mode === 'mock' ? new MockIfs() : new LiveIfs();
}
