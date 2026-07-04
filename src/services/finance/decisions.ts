// ============================================================================
// Finans servis katmanı — mimari karar kaydı (FAZ 1 review sonrası netleştirildi).
//
// Bu dosya davranış İÇERMEZ; bir kararı derleme zamanında görünür ve
// yanlışlıkla göz ardı edilemez şekilde sabitler.
// ============================================================================

/**
 * FAZ 2+ yazım stratejisi: ATOMİK RPC.
 *
 * Gerekçe: Production audit'inde (tedarikçi ödemesi / tahsilat akışları)
 * bulunan en ciddi hata sınıfı, sıralı client-side insert'lerin bir kısmının
 * hatasının kontrol edilmemesiydi (örn. supplier_payments/expenses
 * insert'leri) — bu, cari bakiyesi ile gider kaydı arasında sessiz sapmaya
 * yol açabiliyordu.
 *
 * Karar: recordCollection / recordPayment / cancelPayment implementasyonları
 * (FAZ 2) TEK bir Postgres RPC çağrısı (supabase.rpc(...)) içinde, tek bir DB
 * transaction'ı olarak yazılacak. Çoklu client-side sıralı insert deseni
 * (eski kodda görülen desen) KULLANILMAYACAK.
 *
 * Sonuç: FinanceResult'ın 3 durumlu modeli (success/skipped/error) bu
 * atomiklik garantisine dayanır — "partial" (kısmi başarı) durumu KASITLI
 * OLARAK yoktur; RPC ya bütünüyle başarılı olur ya hiç yazmaz.
 *
 * Kapsam notu: Bu karar yalnızca SERVİS İMPLEMENTASYONUNU bağlar. FAZ 2'de
 * hiçbir ekran bu servislere bağlanmayacak — RPC'ler yazılıp servis
 * fonksiyonları doldurulacak; ekran entegrasyonu ayrı, sonraki bir fazdır.
 */
export const FINANCE_WRITE_STRATEGY = "atomic_rpc" as const;

export type FinanceWriteStrategy = typeof FINANCE_WRITE_STRATEGY;
