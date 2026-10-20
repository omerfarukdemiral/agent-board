# agent-board

Kurulum sayfası: https://agent-board.ofd.works

Claude Code terminalde (cmux, iTerm, ne kullanıyorsan) her zamanki gibi çalışır. agent-board hook'larla dinler, tarayıcıda canlı bir pano gösterir. Onay ya da seçim gereken anlarda cevabı oradan verebilirsin, çalışan oturuma oradan mesaj da yazabilirsin.

Genelden özele: **Proje → Oturum → Agent → Görev.**

- **proje ağacı:** solda projeler ve oturumları; her oturumda durum (çalışıyor / seni bekliyor / boşta / bitti) ve kaç orkestratör, kaç subagent olduğu.
- **akış panosu:** projedeki görevler Yapılacak / Çalışılıyor / Review / Bitti sütunlarında akar, her kartta işi yapan agent görünür. İki gruplama: **Görev → Agent** ya da **Agent → Görev** (her agent bir şerit). Göreve bağlanmamış subagent'lar da "agent işi" kartı olarak akar. Review = seni bekleyen işler: yürüten agent onay bekliyorsa ya da Claude review istediyse.
- **inbox (proje bazında):** izin istekleri ve sorular, Claude'un senin yerine verip itiraz edebileceğin **kararlar**, review bekleyen işler ve okuman gereken **bilgi notları**. "Okudum" ile kapatır, "Cevapla" ile çalışan oturuma yazarsın.
- **orkestrasyon:** bir oturumun agent ağacı (nested dahil), canlı etkinlik akışı ve mesaj kutusu. Akıştaki bir karta tıklayınca o agent'a inilir.
- **sayaçlar ve maliyet:** canlı oturum, orkestratör, subagent ve görev sayıları; agent başına api eşdeğeri maliyet.

Görev ile agent eşleşmesi: Claude subagent açıklamasını görev numarasıyla başlatırsa (`#3 …`) kesin; yoksa görev başlığı ile subagent açıklaması arasındaki kelime örtüşmesinden tahmin edilir. Görev listesi için `claude-board` görev araçlarını açar (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`), inbox ve görev numarası kurallarını da kanal üzerinden Claude'a anlatır.

## kurulum

Node 18+ ve Claude Code yeterli. Bir kez:

```sh
git clone https://github.com/omerfarukdemiral/agent-board ~/tools/agent-board
cd ~/tools/agent-board
npm run setup
```

`setup` arayüzü derler ve `claude-board` komutunu `~/.local/bin`'e bağlar. `git pull` sonrası tekrar çalıştır.

## açık oturumları kurulumsuz görmek

Board, makinedeki Claude Code oturumlarını transcript'lerinden de okur: `claude`, cmux ya da başka bir yoldan açılmış, hook'suz oturumlar da son 2 saat içinde yazdılarsa kendiliğinden belirir. Bu oturumlar **salt izlemedir** (sol ağaçta göz ikonu): ağaç, akış, görevler, maliyet ve sohbet görünür; onay vermek ve mesaj göndermek için oturumu `claude-board --resume <id>` ile devam ettir. Canlılık, `ps` çıktısındaki `--session-id` ile Claude sürecine bakılarak anlaşılır.

- kapatmak: `AGENT_BOARD_TRANSCRIPTS=0`
- pencere: `AGENT_BOARD_TRANSCRIPT_HOURS` (varsayılan 2)

## bir projede kullanmak

**`claude-board` (önerilen).** Projenin klasöründe `claude` yerine bunu yaz. Bütün argümanlar claude'a geçer (`claude-board --resume` gibi). Hook'ları, kanal sunucusunu ve channels bayrağını birlikte yükler. Her açılışta "Loading development channels" uyarısı çıkar, **Enter** ile geçilir. Projede hiçbir dosya değişmez.

**sadece izleme ve onay.** Mesaj kutusu gerekmiyorsa uyarı ekranı da çıkmaz:
```sh
claude --plugin-dir ~/tools/agent-board
```

**projeye kalıcı bağlamak.** Ekipçe değil sadece sende çalışacaksa `.claude/settings.local.json` dosyasını kullan:
```sh
npm --prefix ~/tools/agent-board run -s settings > .claude/settings.local.json
```
(Dosya zaten varsa üzerine yazmak yerine içindeki `hooks` bloğunu birleştir.)

İlk açılışta sunucu kendiliğinden başlar ve `http://localhost:4317` açılır. Sayfa zaten açıksa yeni sekme açılmaz, yeni oturum mevcut sayfada belirir.

## onay nasıl çalışır

`PermissionRequest` hook'u board'a bağlanıp bekler. Claude'un terminaldeki kendi onay penceresi de **aynı anda** açıktır. Hangisinden önce cevap verirsen o geçer. Bu davranış gerçek bir etkileşimli oturumda test edildi:
- board'dan "İzin ver" denince terminal penceresi kapanır, araç çalışır ("Allowed by PermissionRequest hook").
- terminalden cevap verilince Claude board'u beklemez. Board'daki kart "terminalde cevaplandı" olarak kapanır.
- **Reddet…** butonuna yazdığın gerekçe Claude'a iletilir ve Claude ona göre yön değiştirir.
- **Bu oturumda hep izin ver** butonu, Claude'un önerdiği izin kuralını o oturuma ekler.
- sunucu kapalıysa hiçbir şey değişmez, terminal akışı normal devam eder.

## ayarlar (ortam değişkenleri)

| değişken | varsayılan | iş |
|---|---|---|
| `AGENT_BOARD_PORT` | `4317` | sunucu portu |
| `AGENT_BOARD_HOME` | `~/.agent-board` | olay kayıtları (`sessions/*.jsonl`), log |
| `AGENT_BOARD_OPEN` | — | `0`: tarayıcıyı hiç açma, `1`: her oturumda aç |
| `AGENT_BOARD_APPROVALS` | — | `0`: onayları board'a taşıma, sadece izle |
| `AGENT_BOARD_TRANSCRIPTS` | — | `0`: hook'suz oturumları transcript'ten okuma |
| `AGENT_BOARD_TRANSCRIPT_HOURS` | `2` | transcript'i bu kadar saat içinde yazılmış oturumlar okunur |

## güvenlik

Sunucu yalnızca `127.0.0.1`'e bağlanır, dışarıya istek atmaz (fontlar dahil). Onay vermek bir güvenlik kararı olduğu için:
- `/decision` yalnızca sunucunun her açılışta ürettiği ve sadece kendi sayfasına gömdüğü token ile çalışır.
- tarayıcıdan gelen yabancı `Origin` reddedilir.
- `Host` başlığı `localhost`/`127.0.0.1` değilse istek reddedilir (DNS rebinding).

## maliyet

Transcript'lerdeki `message.usage` alanları `message.id` bazında tekilleştirilir (streaming aynı mesajı 2-3 kez yazar), cache yazımı 5m/1h olarak ayrı fiyatlanır. Spike ve canlı testte sonuç Claude Code'un kendi `cost-state` toplamıyla birebir tuttu. Fiyatlar `server/pricing.json` dosyasında. Abonelikle kullanıyorsan bu gerçek fatura değil, **api eşdeğeri**.

## bilinen sınırlar

- **mesajlaşma research preview'a dayanıyor:** channels Claude Code'da deneysel bir özellik ve özel kanallar `--dangerously-load-development-channels` bayrağı istiyor. Team/Enterprise hesaplarda org yöneticisinin channels'ı açması gerekir. Mesaj Claude meşgulken gelirse sıradaki turda işlenir.
- **workflow agent'ları:** Workflow aracının içinde koşan agent'ların hook tetikleyip tetiklemediği dokümanda yok ve henüz test edilmedi. workflow'lar şimdilik "arka plan işleri" panelinde, tur sonunda görünüyor.
- **hook'tan önce açılan oturumlar:** board açılmadan başlamış oturumlar ilk olayla birlikte belirir, ama PID'leri bilinmediği için kapanınca otomatik "bitti"ye geçmezler.

## yapı

```
bin/        claude-board: claude + plugin + kanal + channels bayrağı
channel/    server.js: bağımlılıksız MCP kanal sunucusu (board ↔ Claude)
scripts/    setup.js (derle + bağla) · settings.js (proje ayarı üretir)
hooks/      emit.sh (curl, ~15ms) · permission.sh (long-poll) · ensure-server.js · hooks.json (plugin)
server/     index.js (http + SSE + statik) · store.js (state, jsonl) · approvals.js · channels.js · transcripts.js · cost.js · pricing.json
ui/         vite + react 19 + tailwind · src/components/affect/ = affectUI ücretsiz bileşenleri (MIT)
docs/       spike-findings.md: gerçek payload'lardan çıkan bulgular
```

affectUI'den kullanılan ücretsiz (MIT) bileşenler: `tool-call-card`, `thinking-loader`, `segmented-control`, `number-ticker`. Onay kutusu `decision-inbox`, görev listesi `progress-tracker` tasarımından uyarlandı. Pro bileşenlerin kaynağı kullanılmadı.
