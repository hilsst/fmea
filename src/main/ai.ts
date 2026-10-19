// Claude ile AI önerileri. Tüm öneriler "AI Proposed" durumunda döner; nihai kararı mühendis verir.
import Anthropic from '@anthropic-ai/sdk';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Sen deneyimli bir DFMEA/PFMEA, DFM/DFA ve kalite mühendisisin (havacılık, savunma, otomotiv, raylı sistemler; kompozit ve mekanik ürünler).
Kesin kurallar:
- Hiçbir teknik bilgiyi uydurma: değer, tolerans, malzeme özelliği, proses parametresi, standart, müşteri gereksinimi veya kabul kriteri (NDT dahil) yazma; dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz.
- Varsayım yapmak zorundaysan metne "AI VARSAYIMI – mühendislik doğrulaması gerekli" ekle; öneriler "AI RECOMMENDATION" olarak işaretlenir.
- Her satıra mümkünse kaynak ver (doküman ID/no, sayfa, bölüm, ölçü/balon no, gereksinim ID). Kaynak yoksa boş bırak.
- S/O/D değerlerini gerçek veri yokken kesin gibi sunma; bunlar öneridir. Güven (confidence) değerini dürüst ver: dokümandan doğrudan çıkmayanlar Medium/Low.
- Nedenleri 5 Neden / balık kılçığı mantığıyla kök nedene yaklaştır; insan faktörlerini ayrıca değerlendir.
- "Operatör dikkat etmeli" yerine hata önleme öner (poka-yoke, barkod/QR, interlock, parametre kilidi, fikstür, şablon, sensör, reçete yönetimi, otomatik muayene).
- Özel proseslerde (kür, bonding, boya, yüzey işlem, NDT) yalnızca son muayeneye güvenme: önleme + izleme + validasyon öner.
- Dokümanlardan çıkarılamayan ama kritik olabilecek konuları gereksinim gibi yazma; "issues" listesine açık mühendislik konusu olarak ekle.
- Metinleri Türkçe yaz; teknik terimler (failure mode, bondline, ply vb.) İngilizce kalabilir.`;

export interface AiConfig {
  apiKey: string;
}

function client(cfg: AiConfig) {
  if (!cfg.apiKey && !process.env.ANTHROPIC_API_KEY) throw new Error('Claude API anahtarı tanımlı değil. Ayarlar → AI bölümünden girin.');
  return new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {});
}

type Json = Record<string, unknown>;
const str = { type: 'string' };
const num = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
function obj(props: Record<string, unknown>): Json {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

const ISSUE = obj({ description: str, priority: { type: 'string', enum: ['Critical', 'Important', 'Optional'] }, source: str, risk: str, recommendedAction: str });
const FMEA_COMMON = {
  failureMode: str, effect: str, cause: str, prevention: str, detection: str, s: num, o: num, d: num,
  recommendedAction: str, source: str, confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
  dataStatus: { type: 'string', enum: ['Dokümandan (kaynaklı)', 'VERİ YOK – doğrulanmalı', 'AI VARSAYIMI – mühendislik doğrulaması gerekli', 'AI RECOMMENDATION'] },
};

async function ask(cfg: AiConfig, content: Anthropic.Beta.BetaContentBlockParam[], schema: Json): Promise<Json> {
  const res = await client(cfg).beta.messages.create({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  }, { timeout: 15 * 60 * 1000 });
  if (res.stop_reason === 'refusal') throw new Error('Claude bu isteği yanıtlamadı (refusal). İçeriği gözden geçirip tekrar deneyin.');
  if (res.stop_reason === 'max_tokens') throw new Error('Yanıt çok uzun olduğu için kesildi. Daha küçük bir doküman veya daha dar kapsamla deneyin.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return JSON.parse(text) as Json;
}

async function fileBlocks(filePath: string): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  if (ext === '.pdf') {
    const data = (await fs.readFile(filePath)).toString('base64');
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: name }];
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    const data = (await fs.readFile(filePath)).toString('base64');
    const media = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return [{ type: 'image', source: { type: 'base64', media_type: media, data } }, { type: 'text', text: `Görsel dosya: ${name}` }];
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const parts: string[] = [];
    wb.eachSheet((ws) => {
      parts.push(`### Sayfa: ${ws.name}`);
      ws.eachRow((row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' && 'text' in (v as Json) ? String((v as Json).text) : typeof v === 'object' && 'result' in (v as Json) ? String((v as Json).result) : String(v)));
        parts.push(vals.join(' | '));
      });
    });
    return [{ type: 'text', text: `Dosya: ${name}\n${parts.join('\n')}` }];
  }
  const text = await fs.readFile(filePath, 'utf8');
  return [{ type: 'text', text: `Dosya: ${name}\n${text}` }];
}

export async function extractRequirements(cfg: AiConfig, input: { filePath?: string; text?: string; docId: string; docLabel: string; existing: string[] }) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.filePath) content.push(...(await fileBlocks(input.filePath)));
  if (input.text) content.push({ type: 'text', text: input.text });
  content.push({
    type: 'text',
    text: `Bu doküman ${input.docId} (${input.docLabel}) olarak kayıtlı. Spesifikasyon §4–5'e göre dokümanı analiz et ve Requirements Matrix çıkar.
Her gereksinimin kaynağını "${input.docId} / Sayfa x / Bölüm y / Ölçü z" biçiminde ver. Tip listesi: Functional, Performance, Dimensional, Material, Structural, Environmental, Safety, Reliability, Interface, Manufacturing, Inspection, Regulatory, Customer-specific.
Kabul kriteri dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz. Çelişkileri ve eksikleri issues listesine ekle.
Projede zaten bulunan gereksinimler (tekrar etme):\n${input.existing.slice(0, 200).join('\n') || '(yok)'}`,
  });
  const schema = obj({
    requirements: { type: 'array', items: obj({ text: str, reqType: str, acceptance: str, verification: str, source: str, confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] } }) },
    issues: { type: 'array', items: ISSUE },
  });
  return ask(cfg, content, schema);
}

export async function suggestDfmea(cfg: AiConfig, ctx: { context: string; target: string }) {
  const schema = obj({
    rows: { type: 'array', items: obj({ functionId: str, reqIds: { type: 'array', items: str }, localEffect: str, higherEffect: str, verification: str, ...FMEA_COMMON }) },
    issues: { type: 'array', items: ISSUE },
  });
  return ask(cfg, [{ type: 'text', text: `${ctx.context}\n\nGÖREV: Aşağıdaki fonksiyon(lar) için DFMEA satırları öner (Function → Requirement → Failure Mode → Effect → Cause → Prevention → Detection; S/O/D öneri; AP otomatik hesaplanacak). Her satırda functionId ve reqIds'i yukarıdaki ID'lerden seç. Projede zaten olan hata modlarını tekrarlama.\n${ctx.target}` }], schema);
}

export async function suggestPfmea(cfg: AiConfig, ctx: { context: string; target: string; composite: string }) {
  const schema = obj({
    rows: { type: 'array', items: obj({ stepId: str, processFunction: str, requirement: str, dfIds: { type: 'array', items: str }, errorProofing: str, measurement: str, reactionPlan: str, ...FMEA_COMMON }) },
    issues: { type: 'array', items: ISSUE },
  });
  return ask(cfg, [{ type: 'text', text: `${ctx.context}\n\nGÖREV: Aşağıdaki proses adım(lar)ı için PFMEA satırları öner. PFMEA DFMEA'dan bağımsız değildir: ilgili DFMEA ID'lerini dfIds'e yaz (Product Requirement → DFMEA → Manufacturing Requirement → Process Step → Failure Mode → Cause → Effect → Control). Kompozit üretimse şu kontrol listesini değerlendir:\n${ctx.composite}\nProjede zaten olan hata modlarını tekrarlama.\n${ctx.target}` }], schema);
}

export async function engineeringReview(cfg: AiConfig, ctx: { context: string }) {
  const schema = obj({ markdown: str });
  return ask(cfg, [{ type: 'text', text: `${ctx.context}\n\nGÖREV: Spesifikasyon §36 formatında kısa bir mühendislik özeti yaz (Markdown): ## Critical Risks (en önemli 10), ## Key Characteristics, ## Missing Requirements, ## Open Engineering Issues, ## DFMEA–PFMEA Gaps, ## Control Plan Gaps, ## Recommended Actions, ## Engineer Review Required. Ayrıca sonucu değiştirecek soruları Critical / Important / Optional olarak listele. Yalnızca verilen proje verisine dayan; ID'lere atıf yap.` }], schema);
}
