# quicker

Toplama çıkarma sorularını en hızlı çözenin kazandığı, sunucuda yürüyen çok oyunculu bir hesap yarışı. Botlara karşı
hemen yarışabilir ya da bir lobi kurup arkadaşlarını davet bağlantısıyla çağırabilirsin.

- Next.js 16 (App Router), React 19, Tailwind CSS 4
- Veritabanı yok, hesap yok: herkes misafir olarak oynar
- Yarışı sunucu yönetir: sorular, süre, puan, botlar ve sıralama sunucuda belirlenir; tarayıcı yalnızca yazılan cevabı gönderir
- Canlı durum Server-Sent Events ile gelir, cevaplar POST ile gider

## Çalıştırma

Node.js 20.9 veya üstü gerekir.

```bash
npm install
cp .env.example .env.local   # QUICKER_GUEST_SECRET'ı doldur (32+ karakter)
npm run dev                  # http://localhost:3000
```

Üretim için:

```bash
npm run build
npm run start
```

## Ortam değişkenleri

| Değişken | Gerekli | Açıklama |
| --- | --- | --- |
| `QUICKER_GUEST_SECRET` | Evet | Misafir çerezini imzalar; tarayıcı lobideki yerini bununla geri bulur. En az 32 karakter. |
| `QUICKER_TRUST_PROXY` | Hayır | Uygulama `X-Real-IP` / `X-Forwarded-For` yazan bir ters vekilin arkasındaysa `true`. Açıkken ağ başına sınırlar (lobi başına kişi, istek sınırları) çalışır. Doğrudan erişimde boş bırak: başlıklar taklit edilebilir. |

## Önemli notlar

- **Tek süreç:** Odalar bellekte tutulur. Uygulamayı tek bir `next start` süreci olarak çalıştır; birden çok kopya ya da sunucusuz (serverless) dağıtım odaları paylaşamaz. Yeniden başlatma süren yarışları düşürür.
- **Ters vekil:** SSE akışı için vekilin yanıtı tamponlamaması gerekir (`X-Accel-Buffering: no` gönderilir).

## Klasörler

```
src/lib/engine.ts            yarış kuralları (saf TypeScript: sorular, puan, botlar)
src/lib/server/registry.ts   bellekteki oda kaydı ve 250 ms'lik saat
src/app/api/quicker/*        akış (SSE), cevap, lobi ve katılma uçları
src/components/quicker/*     oyun ekranı, lobi, tuş takımı, geri bildirim
```

## Lisans

[PolyForm Noncommercial 1.0.0](LICENSE). Kişisel, eğitim ve ticari olmayan kullanım serbesttir.

**Ticari kullanım için izin alın.**

---

[GameKodBank için yapıldı](https://gamekodbank.com)
