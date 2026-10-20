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
