# ozidijital-web: PerdePRO Windows indirme + platform bolumu (yama)

`oslem1903/ozidijital-web` (master) uzerine: `git apply marketing/ozidijital-web-perdepro-platforms.patch`

Icerik: PerdePRO urun sayfasina "Windows icin Indir" + "7 Gun Ucretsiz Dene", Windows (aktif) / iOS / Android ("Cok Yakin")
kartlari, onayli bilgilendirme metni ve "senkronizasyon internet gerektirir" notu.
Tek merkez: `src/lib/perdepro.ts` (surum, indirme baglantisi, SHA-256, magaza baglantilari - bos = "Cok Yakinda").

Yayin oncesi (sirayla):
1. `gh release create v1.0.15-windows release/PerdePRO-Setup-1.0.15.exe --repo oslem1903/curtain-saas --target 4ad7efb`
2. Indirilen dosyanin SHA-256'si `047721614781E5AC446DAA30537FF85E2D7710C4E65D9EC423AA5C74FF9485D9` ile ayni mi kontrol et.
3. Yamayi uygula, `npm run build`, yayinla.
Not: site derlemesi bu oturumda calistirilmadi (derleme izni verilmedi) - yama derlenmeden yayinlanmamali.
