# PerdePRO 1.0.23 (Android versionCode 23)

- Mağaza (iOS/Android) kilit ekranı: satın alma / fiyat / ödeme / lisans alma dili kaldırıldı; destek düğmesi yalnızca "Destek",
  talep "Destek talebi" (kategori request). Web ve Windows aynen.
- Mağaza sürümlerinde `billing_campaign_quote` sorgusu çalışmaz.
- AAB: `release/PerdePRO-1.0.23.aab`, release anahtarı SHA-256 `4B:FB:8A:66:...:E7:2F:D3` (1.0.22 ile aynı). Play Console'a YÜKLENMEDİ.
- iOS için yeni build başlatılmadı (iOS sonraki build bu değişikliği içerir).

## iOS 1.0.23 (build 27)
- Codemagic #24 (iOS build 26, App Store'da 1.0.22) `0eb069e` release dalindan derlendi; fix dalindaki duzeltmeleri
  (Kayit Ol geri yukleme `d5b8cae`, kalici hesap silme `30d3a1a`, giris oncesi guncelleme kapisi, `eaeef2f`/`3c47003`) ICERMIYORDU.
- 1.0.23 / build 27: bu duzeltmeleri + native kilit ekrani duzeltmesini birlestiren HEAD'den derlenir. Mevcut App Store surumu 1.0.22 oldugu icin 1.0.23.
