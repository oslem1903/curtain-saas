/**
 * Kilit ekrani metinleri ve destek talebi içeriği.
 * Mağaza (iOS/Android) sürümlerinde satın alma, fiyat, ödeme veya lisans satın alma yönlendirmesi YOKTUR:
 * native metinler yalnızca "firma yöneticinizle görüşün / destek" der. Web ve Windows metinleri değişmez.
 */

export type LockReason =
  | "inactive_user" | "inactive_member" | "inactive_company" | "expired_trial" | "read_only" | "device_limit" | "unknown";

type Content = { title: string; text: string };

const WEB: Record<LockReason, Content> = {
  inactive_user: { title: "Hesabınız pasif", text: "Kullanıcı hesabınız pasif durumda. Firma yöneticinizle iletişime geçin." },
  inactive_member: { title: "Üyeliğiniz pasif", text: "Firma içindeki kullanıcı üyeliğiniz pasife alınmış. Firma yöneticinizle iletişime geçin." },
  inactive_company: { title: "Firma lisansı askıda", text: "Firmanızın lisansı pasif veya askıya alınmış durumda. Devam etmek için lisans yöneticinizle iletişime geçin." },
  expired_trial: { title: "Deneme süreniz doldu", text: "Deneme süreniz sona erdi. Verileriniz güvende — lisans satın aldığınızda kaldığınız yerden devam edersiniz." },
  read_only: { title: "Salt okunur mod", text: "Firmanız şu anda sadece okuma modunda. Yeni kayıt eklemek için lisansınızı yenileyin." },
  device_limit: {
    title: "Cihaz limiti doldu",
    text: "Lisansınızın izin verdiği cihaz sayısına ulaşıldı. Bu cihazdan kullanmak için yöneticinizden cihaz limitini artırmasını veya eski bir cihazı kaldırmasını isteyin.",
  },
  unknown: { title: "Erişim kilitli", text: "Hesabınız geçici olarak kilitli. Lütfen yöneticinizle iletişime geçin." },
};

/** Native: satın alma / lisans yenileme / ödeme çağrısı yok. */
const NATIVE: Record<LockReason, Content> = {
  ...WEB,
  inactive_company: { title: "Firma erişimi kapalı", text: "Firmanızın erişimi şu anda kapalı. Devam etmek için firma yöneticinizle iletişime geçin." },
  expired_trial: { title: "Deneme süreniz doldu", text: "Deneme süreniz sona erdi. Verileriniz güvende. Erişim durumunuz için firma yöneticinizle görüşün." },
  read_only: { title: "Salt okunur mod", text: "Firmanız şu anda sadece okuma modunda. Erişim durumunuz için firma yöneticinizle görüşün." },
  device_limit: {
    title: "Cihaz limiti doldu",
    text: "Bu hesap için izin verilen cihaz sayısına ulaşıldı. Bu cihazdan kullanmak için yöneticinizden cihaz limitini artırmasını veya eski bir cihazı kaldırmasını isteyin.",
  },
};

export function getLockedContent(reason: string | null | undefined, native: boolean): Content {
  const key = (reason && reason in WEB ? reason : "unknown") as LockReason;
  return (native ? NATIVE : WEB)[key];
}

export function supportButtonLabel(native: boolean, requesting: boolean): string {
  if (requesting) return "Talep gonderiliyor...";
  return native ? "Destek" : "Destek / Lisans Al";
}

export function retryCheckMessage(native: boolean): string {
  return native
    ? "Erişim durumu kontrol edildi. Erişim hâlâ kilitli görünüyor — değişiklik yapıldıysa birkaç dakika içinde tekrar deneyin."
    : "Lisans durumu kontrol edildi. Erişim hâlâ kilitli görünüyor — değişiklik yapıldıysa birkaç dakika içinde tekrar deneyin.";
}

export function supportSuccessMessage(native: boolean): string {
  return native
    ? "Destek talebiniz alındı. Yanıtlandığında bu ekrandan Tekrar Dene ile deneyebilirsiniz."
    : "Talebiniz super admin paneline dustu. Onaylandiginda bu ekrandan Tekrar Dene ile giris yapabilirsiniz.";
}

export type SupportTicketInput = {
  companyId: string;
  companyName?: string | null;
  lockReason?: string | null;
  deviceId: string;
  pageUrl: string;
  userAgent: string;
  deviceName: string;
};

/** create_support_ticket_as_locked_user parametreleri. Native'de satın alma/ödeme/fiyat dili ve 'payment' kategorisi YOK. */
export function buildSupportTicket(i: SupportTicketInput, native: boolean) {
  const isDeviceLimit = i.lockReason === "device_limit";
  const name = i.companyName || "Firma";
  const description = isDeviceLimit
    ? `${name} icin yeni cihaz giris izni isteniyor. Super admin cihaz limitini artirabilir veya eski bir cihazi kaldirabilir.`
    : native
      ? `${name} icin destek talebi olusturuldu. Durum: ${i.lockReason || "unknown"}.`
      : `${name} icin lisans/destek talebi olusturuldu. Durum: ${i.lockReason || "unknown"}.`;
  return {
    p_company_id: i.companyId,
    p_title: isDeviceLimit ? "Cihaz limiti talebi" : native ? "Destek talebi" : "Lisans / destek talebi",
    p_description: description,
    // 'payment' kategorisi yalniz web/Windows'ta (eski davranis); native'de her zaman 'request'.
    p_category: isDeviceLimit && !native ? "payment" : "request",
    p_priority: isDeviceLimit ? "high" : "medium",
    p_page_url: i.pageUrl,
    p_support_metadata: {
      kind: isDeviceLimit ? "device_limit" : native ? "support" : "license_support",
      lock_reason: i.lockReason,
      requested_device_id: i.deviceId,
      user_agent: i.userAgent.slice(0, 250),
      device_name: i.deviceName.slice(0, 120),
    },
  };
}
