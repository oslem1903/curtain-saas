/**
 * RLS'te DELETE politikası yoksa veya satır filtrelenirse PostgREST HATA DÖNMEZ: 0 satır silinir ve
 * istek "başarılı" görünür. Silme sorgusuna `.select("id")` ekleyip sonucu bu fonksiyonla doğrulayın;
 * hiçbir satır silinmediyse kullanıcıya başarısızlık gösterilir (yetki kaldırılmaz, yalnız sessiz başarı önlenir).
 */
export function assertRowsDeleted(
    result: { data: unknown[] | null; error: { message: string } | null },
    what = "Kayıt",
    expected = 1,
): void {
    if (result.error) throw new Error(result.error.message);
    const n = result.data?.length ?? 0;
    if (n === 0) {
        throw new Error(`${what} silinemedi: işlem veritabanında uygulanmadı (yetki veya kayıt kuralı nedeniyle). Sayfayı yenileyip tekrar deneyin.`);
    }
    if (n < expected) {
        throw new Error(`${what}: beklenen ${expected} kayıttan yalnız ${n} tanesi silindi. Liste yenileniyor; işlemi kontrol edin.`);
    }
}
