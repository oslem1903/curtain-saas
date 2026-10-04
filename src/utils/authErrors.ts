/** Supabase Auth / kayıt RPC hatalarını kullanıcıya gösterilecek Türkçe metne çevirir. */
export function friendlyAuthError(message: string | null | undefined): string {
    const raw = String(message || "").trim();
    const lower = raw.toLocaleLowerCase("tr-TR");

    if (!raw) return "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
    if (lower.includes("perdepro_email_not_confirmed") || lower.includes("email not confirmed")) {
        return "E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzdaki doğrulama bağlantısına tıklayın.";
    }
    if (lower.includes("perdepro_self_signup_disabled")) {
        return "Yeni işletme kaydı şu anda kapalı. Lütfen destek ile iletişime geçin.";
    }
    if (lower.includes("perdepro_subscription_read_only")) {
        return "Deneme veya abonelik süreniz dolduğu için yeni kayıt ve değişiklik yapılamaz. Verileriniz korunuyor.";
    }
    if (lower.includes("invalid login credentials")) return "E-posta veya şifre hatalı.";
    if (lower.includes("user already registered") || lower.includes("already been registered") || lower.includes("already registered")) {
        return "Bu e-posta ile zaten bir hesap var. Giriş yapın veya şifrenizi sıfırlayın.";
    }
    if (lower.includes("signups not allowed") || lower.includes("signup is disabled")) {
        return "Yeni hesap oluşturma şu anda kapalı. Lütfen destek ile iletişime geçin.";
    }
    if (lower.includes("password should be") || lower.includes("weak password") || lower.includes("password is too")) {
        return "Şifre yeterince güçlü değil. En az 8 karakter kullanın; harf ve rakam ekleyin.";
    }
    if (lower.includes("unable to validate email") || lower.includes("invalid email") || lower.includes("email address") && lower.includes("invalid")) {
        return "Lütfen geçerli bir e-posta adresi girin.";
    }
    if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("security purposes")) {
        return "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
    }
    if (lower.includes("otp_expired") || lower.includes("expired") && lower.includes("link")) {
        return "Bağlantının süresi dolmuş. Yeni bir bağlantı isteyin.";
    }
    if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("zaman asimina") || lower.includes("zaman aşımına")) {
        return "Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.";
    }
    if (lower.includes("start_self_service_trial") || lower.includes("schema cache")) {
        return "Kayıt altyapısı sunucuda henüz kurulmamış. Lütfen destek ile iletişime geçin.";
    }
    return raw;
}
