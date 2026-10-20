# agent-board

Kurulum sayfası: https://agent-board.ofd.works

Claude Code terminalde (cmux, iTerm, ne kullanıyorsan) her zamanki gibi çalışır. agent-board makinedeki oturumları canlı bir panoda gösterir: hangisi çalışıyor, hangisi seni bekliyor, agent'lar ne yapıyor, görevler nereye geldi, ne kadara mal oldu. `claude-board` ile açtığın oturumlarda onayları ve soruları panodan cevaplar, Claude'a panodan yazarsın.

Genelden özele: **Proje → Oturum → Agent → Görev.**

## ekranlar

**sol menü.** En üstte **Şimdi**, altında açılır-kapanır projeler ve her projenin oturumları: durum noktası, `#id`, durum ve son hareket. Çalışan projeler üstte ve açık gelir, seçimin hatırlanır. Uzun süredir sessiz oturumlar ve kapanmış projeler katlanır. Telefonda menü bir çekmecedir.

Durumlar her yerde aynı kuralla hesaplanır:
- **seni bekliyor:** onay, soru ya da bir karar senden cevap bekliyor
- **çalışıyor:** bir agent çalışıyor ve son 3 dakikada olay geldi
- **boşta:** açık ama sessiz
- **kapandı:** Claude süreci sona erdi

**Şimdi.** Önce seni bekleyenler (yalnızca bir şey bekliyorsa). Sonra çalışan oturumlar kart olarak: proje, "şu an" satırı (`Bash npm test`), kaç subagent'ın çalıştığı, görev ilerlemesi, maliyet. En altta son hareket eden oturumlar, son mesajlarıyla tek satır.

**proje.** Projenin oturumları ve birleşik **görev panosu**: Yapılacak / Çalışılıyor / Review / Bitti. Her kartta işi yapan agent görünür. Review, seni bekleyen işler demek: yürüten agent onay bekliyordur ya da Claude review istemiştir.

**oturum.** Başlıkta durum ve düz bir cümle ("çalışıyor · şu an Bash npm test"), altında üç sekme:
- **Agent'lar:** orkestratör ortada, subagent'lar etrafında, nested olanlar ebeveynlerinin yönünde. Tuval yakınlaştırılıp kaydırılır: sıkıştır ya da ⌘ + tekerlek, sürükle, "Sığdır". Uzaklaşınca kartlar okunur etiketlere döner. Bir agent'a tıklayınca Etkinlik'te yalnızca onun işleri görünür.
- **Görevler:** görev varsa, o oturumun panosu.
- **Etkinlik:** araç çağrıları (argüman ve sonuçlarıyla), subagent'lar, mesajlar.

Sağda o oturumun **inbox**'ı ve tam boy **sohbet** durur.

**inbox.** Üç tür kayıt toplar:
- izin istekleri ve sorular; komut, diff ya da dosya içeriği önizlemesiyle
- Claude'un senin yerine verdiği ve itiraz edebileceğin **kararlar**
- review bekleyen işler ve okuman gereken **bilgi notları**

"Okudum" ile kapatır, "Cevapla" ile çalışan oturuma yazarsın.

## kurulum

Node 18+ ve Claude Code yeterli. Bir kez:

```sh
git clone https://github.com/omerfarukdemiral/agent-board ~/tools/agent-board
cd ~/tools/agent-board
npm run setup
```

`setup` arayüzü derler ve `claude-board` komutunu `~/.local/bin`'e bağlar. `git pull` sonrası tekrar çalıştır.

## iki kullanım şekli

**1. kurulumsuz izleme.** Board makinedeki oturumları transcript'lerinden okur: düz `claude`, cmux ya da başka bir yoldan açılmış oturumlar, son 2 saatte yazdılarsa kendiliğinden belirir.
- Agent'lar, görevler, etkinlik, sohbet ve maliyet görünür; oturum "yalnızca izleme" diye işaretlenir.
- Onay vermek ve yazmak için hook ve kanal gerekir; bunun için 2'ye geç.
- Canlılık, `ps` çıktısındaki `--session-id` ile Claude sürecine bakılarak anlaşılır.

**2. `claude-board` ile tam kontrol (önerilen).** Projenin klasöründe `claude` yerine bunu yaz; bütün argümanlar claude'a geçer (`claude-board --resume <id>` gibi).
- Hook'ları, kanal sunucusunu ve channels bayrağını birlikte yükler.
- Görev araçlarını açar (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`) ve Claude'a görev listesi tutmasını, devrettiği işi görev numarasıyla (`#3 …`) başlatmasını, inbox'ı kullanmasını söyler.
- Her açılışta "Loading development channels" uyarısı çıkar, **Enter** ile geçilir.
- Projede hiçbir dosya değişmez.

İlk açılışta sunucu kendiliğinden başlar ve `http://localhost:4317` açılır. Sayfa zaten açıksa yeni sekme açılmaz.

Diğer seçenekler:
- **sadece hook'lar (onay var, mesaj yok, uyarı ekranı yok):** `claude --plugin-dir ~/tools/agent-board`
- **projeye kalıcı bağlamak (yalnızca sende):** `npm --prefix ~/tools/agent-board run -s settings > .claude/settings.local.json` (dosya varsa `hooks` bloğunu birleştir)

## onay nasıl çalışır

`PermissionRequest` hook'u board'a bağlanıp bekler; Claude'un terminaldeki onay penceresi de **aynı anda** açıktır. Hangisinden önce cevap verirsen o geçer. Gerçek etkileşimli oturumlarda test edildi:
- **board'dan "İzin ver":** terminal penceresi kapanır, araç çalışır ("Allowed by PermissionRequest hook").
- **terminalden cevap:** Claude board'u beklemez; board'daki kart "başka yerden cevaplandı" olarak kapanır. "Bu oturumda hep izin ver"den sonra Claude'un kendi onayladıkları da böyle görünür.
- **Reddet…:** yazdığın gerekçe Claude'a iletilir.
- **subagent'lar:** bekleyen istekler agent bazında takip edilir; bir subagent'ın beklemesi, başka bir agent bitince kapanmaz.
- **sunucu kapalıysa:** hiçbir şey değişmez, terminal akışı normal devam eder.

## görev ile agent eşleşmesi

Claude Code hangi görevi hangi agent'ın yaptığını kaydetmez. Board şu sırayla eşleştirir:
1. subagent açıklaması görev numarasıyla başlıyorsa (`#3 …`): kesin eşleşme. Bir görev birden fazla subagent'a bölünebilir; kartta ana agent ve "+N" görünür.
2. görevi kendi güncelleyen subagent.
3. görev başlığı ile subagent açıklaması arasındaki kelime örtüşmesi. "test" ve "npm" gibi genel kelimeler sayılmaz, dosya yollarının parçaları sayılır.
4. son çare olarak görevi güncelleyen agent.

Tahmini eşleşmeler kartın ipucunda belirtilir.

## ayarlar (ortam değişkenleri)

| değişken | varsayılan | iş |
|---|---|---|
| `AGENT_BOARD_PORT` | `4317` | sunucu portu |
| `AGENT_BOARD_HOME` | `~/.agent-board` | olay kayıtları (`sessions/*.jsonl`), log |
| `AGENT_BOARD_OPEN` | — | `0`: tarayıcıyı hiç açma, `1`: her oturumda aç |
| `AGENT_BOARD_APPROVALS` | — | `0`: onayları board'a taşıma, sadece izle |
| `AGENT_BOARD_TRANSCRIPTS` | — | `0`: hook'suz oturumları transcript'ten okuma |
| `AGENT_BOARD_TRANSCRIPT_HOURS` | `2` | bu kadar saat içinde yazılmış transcript'ler okunur |

## güvenlik ve mahremiyet

Sunucu yalnızca `127.0.0.1`'e bağlanır, dışarıya istek atmaz (fontlar dahil). Onay vermek bir güvenlik kararı olduğu için:
- `/decision`, sunucunun her açılışta ürettiği ve yalnızca kendi sayfasına gömdüğü bir token ile çalışır.
- Tarayıcıdan gelen yabancı `Origin` reddedilir.
- `Host` başlığı `localhost`/`127.0.0.1` değilse istek reddedilir (DNS rebinding).

Transcript okuma, makinedeki son 2 saatin bütün Claude oturumlarını kapsar. Her şey yerelde kalır; istemezsen `AGENT_BOARD_TRANSCRIPTS=0`.

## maliyet

Transcript'lerdeki `message.usage` alanları `message.id` bazında tekilleştirilir (streaming aynı mesajı 2-3 kez yazar), cache yazımı 5m/1h olarak ayrı fiyatlanır. Sonuç, testlerde Claude Code'un kendi `cost-state` toplamıyla birebir tuttu. Fiyatlar `server/pricing.json` dosyasında; fiyatı bilinmeyen kalemler "—" olarak gösterilir, tahmin yazılmaz. Abonelikle kullanıyorsan bu gerçek fatura değil, **api eşdeğeri**.

## bilinen sınırlar

- **mesajlaşma deneysel bir özelliğe dayanıyor:** channels Claude Code'da research preview ve özel kanallar `--dangerously-load-development-channels` bayrağı istiyor. Team/Enterprise hesaplarda org yöneticisinin channels'ı açması gerekir. Claude meşgulken gelen mesaj sıradaki turda işlenir.
- **workflow agent'ları:** Workflow aracının içinde koşan agent'lar henüz test edilmedi. Workflow'lar şimdilik oturum sayfasındaki "arka plan işleri"nde, tur sonunda görünüyor.
- **sunucu kapalıyken kaybolan olaylar:** sunucu kapalıyken gelen hook olayları kaybolur; hook'lar sessizce vazgeçer. Transcript'ten izlenen oturumlar etkilenmez, çünkü yeniden okunurlar.

## yapı

```
bin/        claude-board: claude + plugin + kanal + channels bayrağı
channel/    server.js: bağımlılıksız MCP kanal sunucusu (board ↔ Claude, reply + inbox araçları)
scripts/    setup.js (derle + bağla) · settings.js (proje ayarı üretir)
hooks/      emit.sh (curl, ~15ms) · permission.sh (long-poll) · ensure-server.js · hooks.json (plugin)
server/     index.js (http + SSE + statik) · store.js (state, jsonl, görev eşleşmesi) · approvals.js
            channels.js · transcripts.js (hook'suz oturumlar) · cost.js · pricing.json
ui/         vite + react 19 + tailwind
            src/views/: Home (Şimdi, proje) · SessionPage
            src/components/: Sidebar · AgentCanvas · FlowBoard · ProjectInbox · ChatPanel · ActivityFeed
            src/components/affect/: affectUI ücretsiz bileşenleri (MIT)
site/       kurulum sayfası (Vercel)
docs/       spike-findings.md: gerçek oturumlardan ve yük testlerinden çıkan bulgular
```

affectUI'den kullanılan ücretsiz (MIT) bileşenler: `tool-call-card`, `thinking-loader`, `segmented-control`, `number-ticker`. Onay kartı `decision-inbox`, görev listesi `progress-tracker` tasarımından uyarlandı. Pro bileşenlerin kaynağı kullanılmadı.
