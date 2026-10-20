# agent-board

Claude Code terminalde (cmux, iTerm, ne kullanıyorsan) her zamanki gibi çalışır. agent-board hook'larla dinler, tarayıcıda canlı bir pano gösterir. Onay ya da seçim gereken anlarda cevabı oradan verebilirsin, çalışan oturuma oradan mesaj da yazabilirsin.

- **agent ağacı:** orkestratör ve altında subagent'lar (nested dahil). durum, süre, araç sayısı, anlık araç, model, token ve api eşdeğeri maliyet.
- **onay kutusu:** izin istekleri (Bash komutu, Edit diff'i, Write içeriği önizlemeli) ve `AskUserQuestion` soruları. tüm açık oturumlardan tek kutuda toplanır.
- **mesaj kutusu:** `claude-board` ile açılan oturumlara board'dan yazarsın. Claude mesajı terminaldeki oturumunda alır, board'a `reply` aracıyla cevap verir.
- **etkinlik akışı:** prompt'lar, araç çağrıları (argüman ve sonuçlarıyla), subagent'lar, cevaplar. agent kartına tıklayınca akış o agent'a filtrelenir.
- **görevler:** `TaskCreate`/`TaskUpdate`/`TodoWrite` ile kurulan liste, canlı ilerleme.
- **arka plan işleri:** tur sonunda Claude'un bildirdiği workflow'lar ve arka plan agent'ları.
- **dikkat:** bekleyen karar sayısı sekme başlığında, oturum sekmesinde ve (izin verirsen) masaüstü bildiriminde görünür.

## kurulum

Node 18+ ve Claude Code yeterli. Bir kez:

```sh
git clone https://github.com/omerfarukdemiral/agent-board ~/tools/agent-board
cd ~/tools/agent-board
npm run setup
```

`setup` arayüzü derler ve `claude-board` komutunu `~/.local/bin`'e bağlar. `git pull` sonrası tekrar çalıştır.

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
server/     index.js (http + SSE + statik) · store.js (state, jsonl) · approvals.js · channels.js · cost.js · pricing.json
ui/         vite + react 19 + tailwind · src/components/affect/ = affectUI ücretsiz bileşenleri (MIT)
docs/       spike-findings.md: gerçek payload'lardan çıkan bulgular
```

affectUI'den kullanılan ücretsiz (MIT) bileşenler: `tool-call-card`, `thinking-loader`, `segmented-control`, `number-ticker`. Onay kutusu `decision-inbox`, görev listesi `progress-tracker` tasarımından uyarlandı. Pro bileşenlerin kaynağı kullanılmadı.
