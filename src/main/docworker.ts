// Doküman ayrıştırma ayrı iş parçacığında çalışır; büyük dosyalar arayüzü kilitlemez (§63).
import { parentPort } from 'node:worker_threads';
import { extractDocumentFile } from './docintel';

parentPort?.on('message', async (msg: { id: number; path: string }) => {
  try {
    const doc = await extractDocumentFile(msg.path);
    parentPort!.postMessage({ id: msg.id, doc });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
