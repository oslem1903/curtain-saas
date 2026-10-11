# Migration 026 yerel testleri

Yalnızca yerel/test PostgreSQL içindir; canlı veritabanında çalıştırmayın.

```bash
sudo -u postgres ./run_all.sh t26
```

- `40_live_state_for_026.sql`: canlıdaki ilgili fonksiyon/politikaların salt okunur incelemeyle çıkarılmış kopyası (açıklar dahil).
- `39_seed_026.sql`: aynı adlı iki firma, yöneticiler, saha personeli.
- `38_vuln_before_026.sql`: 026 öncesi iki açığın (kendini super_admin yapma, başka firmaya kendini ekleme) gösterimi.
- `41_tests_026.sql`: 66 kontrol (yetki, aynı ad/ID, bitir/uzat/özel erişim, ücretsiz deneme sıfırlanmaz, eski/ücretli firmalar, audit).
