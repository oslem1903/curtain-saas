# Migration 024 yerel SQL testi

Canlı veritabanına DOKUNMAZ. Boş bir yerel PostgreSQL (16) üzerinde Supabase'in
`auth` şemasını taklit eder, depodaki mevcut SQL fonksiyonlarını (022 is_company_writable,
tenant_write tetikleyicisi, 021 kullanıcı limiti, davet kodu RPC'leri, eski handle_new_user)
kurar, migration 024'ü uygular ve senaryoları çalıştırır.

Çalıştırma adımları `run_setup.sh` başındaki açıklamadadır. Sonuç: iki senaryoda da (company_members tenant
tetikleyicisi var/yok) 33/33 PASS, paralel 6 çağrıda 1 firma / 1 üyelik / 1 deneme kaydı.
