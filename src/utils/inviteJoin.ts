/** Davet kanıtı yetki değildir; firma/rol sunucuda user_invites kaydından okunur. */
export function inviteSignupMetadata(token: string, code: string, fullName: string) {
    return {
        full_name: fullName,
        perdepro_invite: token ? { token } : { code: code.trim().toUpperCase() },
    };
}

export function friendlyInviteJoinError(error: unknown): string {
    const raw = String((error as { message?: string })?.message || error || "").toLowerCase();
    if (/email_not_verified|email not confirmed/.test(raw)) return "Önce e-postanıza gelen bağlantıyla adresinizi doğrulayın, ardından devam edin.";
    if (/invite_expired|suresi dol|süresi dol/.test(raw)) return "Davetin süresi dolmuş. Firma yöneticinizden yeni bir davet isteyin.";
    if (/invite_email_mismatch|farkli|farklı/.test(raw)) return "Bu davet başka bir e-posta adresine ait. Davet edilen hesapla giriş yapın.";
    if (/invite_used|kullanilmis|kullanılmış/.test(raw)) return "Bu davet daha önce kullanılmış. Firma yöneticinizden yeni bir davet isteyin.";
    if (/invite_invalid|bulunamad|gecersiz|geçersiz/.test(raw)) return "Davet bulunamadı. E-posta adresinizi ve davet kodunu kontrol edin.";
    if (/member_inactive|profile_inactive/.test(raw)) return "Hesabınızın erişimi durdurulmuş. Firma yöneticinizle iletişime geçin.";
    if (/company_unavailable|firma aktif|firma lisans/.test(raw)) return "Firma şu anda yeni üyelik kabul edemiyor. Firma yöneticinizle iletişime geçin.";
    if (/member_limit|kullanıcı limit|kullanici limit/.test(raw)) return "Firmanın kullanıcı sınırına ulaşıldı. Firma yöneticinizle iletişime geçin.";
    if (/invalid login credentials|already registered/.test(raw)) return "Mevcut hesabınızın e-posta ve şifresini kontrol edin. Gerekirse giriş ekranından şifrenizi sıfırlayın.";
    return "Davet şu anda tamamlanamadı. Hesabınız korunuyor; bağlantınızı kontrol edip tekrar deneyin. Sorun sürerse firma yöneticinizle iletişime geçin.";
}
