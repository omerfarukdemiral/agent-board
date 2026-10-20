# WP0 · spike bulguları

Claude Code 2.1.304, `claude -p --model haiku`, 2 paralel subagent + 1 nested subagent. Ham örnekler `spike/raw.js` ile `~/.agent-board/raw.jsonl` dosyasına yazılır (yerel yol ve prompt içerdiği için repoda tutulmuyor).

## §3 hook payload'ları
| soru | sonuç |
|---|---|
| SessionStart'ta `&&` zinciri | **çalışıyor.** tek hook girdisi yeterli. |
| ortak alanlar | `session_id`, `transcript_path`, `cwd`, `hook_event_name`. çoğu olayda `prompt_id`, `permission_mode`, `effort` da var. **timestamp yok**, emit.js `ts` ekliyor. |
| SubagentStart | `agent_id`, `agent_type`. **parent alanı yok.** |
| SubagentStop | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message` |
| PostToolUse subagent içinden | **`agent_id` + `agent_type` geliyor.** yoksa olay ana oturumundur. |
| PostToolUse `tool_name: "Agent"` | `tool_response.agentId`, `resolvedModel`, `usage`, `totalToolUseCount`. çocuk agent'ı ebeveynin olayıyla eşler. |
| nested subagent | **mümkün.** nested agent'ın Agent çağrısı ebeveyn `agent_id`'siyle geliyor. |

## parent ilişkisi → iki seviyeli ağaç mümkün
`<transcript_dir>/<session_id>/subagents/agent-<id>.meta.json`:
```json
{"agentType":"general-purpose","description":"List spike-cwd directory","toolUseId":"toolu_…","parentAgentId":"a1fa641c9ef47052e","spawnDepth":2}
```
`parentAgentId` yoksa parent main'dir. yedek olarak ebeveynin `PostToolUse(Agent)` olayındaki `tool_response.agentId` de kullanılıyor.

## §5 maliyet
- subagent transcript: `<transcript_dir>/<session_id>/subagents/agent-<id>.jsonl`
- `message.model` ve `message.usage` alan adları plandaki gibi: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
- **tuzak 1:** aynı `message.id` streaming yüzünden 2-3 kez yazılıyor. son kayıt geçerli. düz toplama maliyeti 2-3 kat şişirir.
- **tuzak 2:** cache write iki fiyatlı. `usage.cache_creation.ephemeral_5m_input_tokens` 1.25x, `ephemeral_1h_input_tokens` 2x input fiyatı. ana oturum 1h, subagent'lar 5m yazıyor.
- `output_tokens` thinking token'larını içeriyor.
- ana transcript'in sonunda `{"type":"cost-state","totalCostUSD":…}` satırı var. claude code'un kendi hesabı, doğrulama referansı.

## fiyat doğrulaması
Spike oturumu `pricing.json` ile hesaplandı: **$0.019383**. `cost-state`: **$0.019382575**. eşleşiyor.

## affectUI
Bu oturumda affectUI MCP'si bağlı değil. kartlar shadcn tarzında elle yazıldı (§6'daki yedek yol).

## onay ve seçim (etkileşimli tty testi, python pty sürücüsüyle)
- `PermissionRequest` payload'ı: `tool_name`, `tool_input`, `permission_suggestions`. **`tool_use_id` yok.** `-p` modunda da tetikleniyor.
- `AskUserQuestion` da `PermissionRequest` olarak geliyor, `tool_input.questions` içinde tam sorular var.
- **terminal penceresi hook'la eş zamanlı açılıyor.** hook 12 saniye beklerken pencere 0.1 saniye sonra ekrandaydı.
- hook pencere açıkken `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` döndürürse pencere kapanıyor ve araç çalışıyor. terminalde "Allowed by PermissionRequest hook" görünüyor.
- soru cevabı: `decision.updatedInput = {...tool_input, answers: {"<soru metni>": "<etiket>"}}`. terminalde "User answered Claude's questions: … → Blue".
- terminalden önce cevap verilirse Claude hook'u **beklemiyor**, araç hemen çalışıyor. hook süreci ise hemen ölmüyor. bu yüzden kart `PostToolUse` eşleşmesiyle, hook bağlantısının kapanmasıyla ya da claude PID'sinin ölmesiyle kapatılıyor.
- hook'lar claude'un doğrudan alt süreci olarak çalışıyor, yani `$PPID` = claude PID.
- arka plan agent'ı bittiğinde `UserPromptSubmit` olayı `<task-notification>…</task-notification>` prompt'uyla geliyor.
- `TaskCreate` haiku 5.5'te varsayılan kapalı, `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ile açılıyor.

## channels (board → Claude mesajı, etkileşimli tty testi)
- bağımlılıksız bir stdio MCP sunucusu yeterli: `capabilities.experimental['claude/channel'] = {}` + `tools: {}`, bildirim `notifications/claude/channel` `{content, meta: {chat_id}}`.
- `initialize` cevabında `protocolVersion: '2025-06-18'` (legacy) dönüldü. client `2025-11-25` istedi, kabul etti, kanal kaydoldu.
- başlatma: `--mcp-config '<json>' --dangerously-load-development-channels server:<ad>`. her açılışta "WARNING: Loading development channels" ekranı çıkıyor, varsayılan seçenek "I am using this for local development", Enter yeterli.
- Claude mesajı `<channel source="<ad>" chat_id="…">…</channel>` prompt'u olarak görüyor. bu prompt `UserPromptSubmit` hook'unu da tetikliyor.
- `reply` aracı (`mcp__<ad>__reply`) izin sorulmadan çağrıldı (auto mod).
- **`CLAUDE_PID` güvenilmez:** cmux sarmalayıcısı bir kez set ediyor, iç içe açılan claude süreçleri dıştakinin değerini miras alıyor. MCP stdio sunucusu claude'un doğrudan alt süreci, `process.ppid` kullanılıyor.
- board yeniden başlarsa kanal SSE akışı `end` yerine `close`/`error` ile kapanabiliyor. üçü de dinlenip tek bir yeniden bağlanma yapılıyor.
- Claude Code her turun sonunda `agent_type` boş, `SubagentStart`'ı ve transcript'i olmayan geçici agent'lar çalıştırıyor (`SubagentStop` geliyor). bunlar yok sayılıyor.

## gerçekçi kullanım testi (kitaplık projesi, 2 tur)
- **bekleyen istekler agent bazında kapatılmalı.** arka plan subagent'ı bitince gelen `<task-notification>` prompt'u (`UserPromptSubmit`) ya da ana turun `Stop`'u, başka bir subagent'ın hâlâ bekleyen izin isteğini kapatmamalı. kapatılırsa hook cevapsız kalır ve o subagent sessizce kilitlenir (1. turda yaşandı, 7+ dakika). artık sadece `SessionEnd`, kendi `SubagentStop`'u ya da (main için) `Stop` kapatıyor.
- "Bu oturumda hep izin ver" sonrası Claude aynı türdeki bekleyen istekleri kendisi onaylayıp hook'u öldürüyor. kart "başka yerden cevaplandı" oluyor (terminal olmak zorunda değil).
- 2. tur: 2 paralel subagent, 1 nested soru, 15+ onay, 2 board mesajı. kilitlenme yok, oturum değişimi yok, 29/29 test.

## akış ve inbox (2 eşzamanlı oturum, haiku)
- görev ↔ agent eşleşmesi: kanal talimatıyla Claude subagent açıklamalarını `#1 …`, `#2 …` diye başlattı, eşleşme kesin oldu. eski kayıtlarda (talimatsız) kelime örtüşmesi 9/9 görevi doğru bağladı; yol kelimeleri parçalanmadan biri kaçıyordu (`test/store.test.js` ↔ `store.test.js`).
- `inbox` aracı (kanal MCP aracı) talimatla doğru kullanıldı: karar, review ve bilgi ayrımı istendiği gibi; dokümantasyon oturumu kendiliğinden gerçek bir hata bildirdi (silinen en büyük id'nin yeniden kullanılması).
- inbox'tan "Cevapla" → kanal mesajı → Claude değişikliği uyguladı (CSV ayracı `;`), 59/59 test.
- görev araçları yeni modellerde varsayılan kapalı; `claude-board` `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ile açıyor.

## yük testi: turnuva platformu (3 eşzamanlı oturum, haiku)
- 3 oturum (core / api / qa), 14 agent (11 subagent, 1 nested), tepe noktada 8 agent aynı anda çalışıyor. 3 oturumda 501 hook olayı, 9/9 görev bitti, inbox'ta 7 kayıt. ortaya çıkan ürün: 52/52 test, API ve doğrulama elle denendi.
- board sunucusu belleği 16–31 MB; tarayıcıda hiç long task yok.
- Claude bir görevi birden fazla subagent'a bölebiliyor (`#1 Bracket testleri`, `#1 Standings testleri`). görev artık birden fazla agent taşıyor (ana + yardımcılar).
- genel kelimeler ("test", "testleri", "npm") kelime eşleşmesini yanıltıyordu: "Tüm testleri npm test ile çalıştır" bir test subagent'ına bağlanmıştı. bu kelimeler artık sayılmıyor; açıkça başka göreve bağlı agent kelime eşleşmesine girmiyor; dosya yollarının son parçası ayrı kelime. kayıtlı 7 oturumda 13/13 subagent bağlantısı doğru.
- arka plan subagent'larında Agent aracı hemen dönüyor; açıklama bu yoldan gelince eşleşme bir sonraki olaya kadar gecikiyordu (aynı iş birkaç saniye iki kart). artık o anda eşleşiyor.
- inbox, oturumlar arası entegrasyon sorunlarını yakaladı (lig fikstürü core'da yok → API'de 404).
- bilinen sınır: sunucu kapalıyken gelen hook olayları kaybolur (hook'lar sessizce vazgeçer).

## transcript'ten izleme (hook'suz oturumlar)
- her asistan satırı tek içerik bloğu; aynı mesajın satırları aynı `message.id`'yi paylaşır, tur sonu `stop_reason: end_turn`. kullanıcı satırları: gerçek prompt (string/text), `tool_result` + yapılandırılmış `toolUseResult` (hook'taki `tool_response` ile aynı şekil), ya da `isMeta` (skill içerikleri vb., atlanır).
- transcript'ler yüzlerce MB olabiliyor (bu geliştirme oturumu 26 MB, `api-request-blob` satırları megabaytlarca). tümünü okumak sunucuyu 1,28 GB'a çıkardı; 4 MB'lık parçalar + JSON.parse'tan önce satır başına bakarak eleme + araç girdilerini kırpma ile tepe 329 MB, oturunca 80 MB. maliyet hesabı değişmedi (cost-state ile birebir).
- canlılık: cmux her `claude`'u `--session-id <uuid>` ile başlatıyor; `ps` çıktısından oturum ↔ pid eşleşiyor. eşleşmeyen oturumlar 15 dk sessizlikten sonra kapandı sayılır.
- gecikme: kendi araç çağrım board'da ≤5 sn içinde göründü (tarama 2,5 sn).

## Workflow agent'ları (2026-10-20)

- Workflow aracının agent'ları `subagents/` altına değil `<session>/subagents/workflows/<runId>/agent-<id>.jsonl` altına yazar; `meta.json`'da `agentType: "workflow-subagent"`, `description` (etiket) ve `workflowPhase` var.
- Aynı klasördeki `journal.jsonl`: `launched`, her agent için `started` (`agentId`, `label`, `phase`) ve bitince `result` (`agentId`, `result`).
- `<session>/workflows/scripts/<name>-<runId>.js` script'in kendisi (`meta.name`, `meta.phases`); `<session>/workflows/<runId>.json` yalnızca çalışma bitince oluşur (`status`, `workflowName`, `startTime` epoch ms, `durationMs`).
- Board bunları her oturum için (hook'lu olanlar dahil) okur; hook ve transcript'ten gelen aynı araç çağrısı `tool_use_id` ile tekilleşir.
