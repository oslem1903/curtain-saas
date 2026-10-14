/**
 * RLS'te DELETE politikası yoksa veya satır filtrelenirse PostgREST HATA DÖNMEZ: 0 satır silinir ve
 * istek "başarılı" görünür. Silme sorgusuna `.select("id")` ekleyip sonucu bu fonksiyonla doğrulayın;
 * hiçbir satır silinmediyse kullanıcıya başarısızlık gösterilir (yetki kaldırılmaz, yalnız sessiz başarı önlenir).
 */
export function assertRowsDeleted(
    result: { data: unknown[] | null; error: { message: string } | null },
    what = "Kayıt",
): void {
    if (result.error) throw new Error(result.error.message);
    if (!result.data || result.data.length === 0) {
        throw new Error(`${what} silinemedi: işlem veritabanında uygulanmadı (yetki veya kayıt kuralı nedeniyle). Sayfayı yenileyip tekrar deneyin.`);
    }
}
