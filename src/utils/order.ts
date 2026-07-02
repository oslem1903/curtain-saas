// ============================================================================
// Sipariş (order) ortak mantık modülü — ERP genelinde TEK doğruluk kaynağı.
//
// Bu modül; üretim, montaj, tahsilat, garanti ve servis modüllerinin ortak
// kullanacağı sipariş mantığını toplar:
//   1) Durum (status) yaşam döngüsü + yardımcıları
//   2) Tahmini teslim tarihi (delivery_due_date)
//   3) Gecikme / kalan gün hesabı + renk
//   4) Montaj planlama alanları (gelecek — izole)
//   5) Kısmi teslim / order-item bazlı durum (gelecek — iskelet + TODO)
//   6) Durum→ikon eşlemesi (gelecek)
//
// Tasarım ilkesi: UI bileşenleri sipariş kurallarını BİLMEZ; tümü buradan gelir.
// React'ten bağımsızdır (yalnızca string/sınıf döner) → her modül kullanabilir.
// Yeni ERP modülü eklendiğinde refactor gerekmez; yalnızca bu modül genişletilir.
// ============================================================================

// ---------------------------------------------------------------------------
// 1) DURUM (STATUS) AKIŞI
// ---------------------------------------------------------------------------
// Kanonik sipariş yaşam döngüsü:
//   Teklif → Sipariş Alındı → Üretimde → Montaja Hazır → Montaj Bekliyor
//          → Montajda → Tamamlandı → Teslim Edildi → Arşiv
//
// NOT: orders.status kolonu serbest metindir (string | null). Bu enum tek
// doğruluk kaynağıdır; YENİ kod yalnızca bunu kullanır. Mevcut (legacy) ekranlar
// eski değerleri yazmaya devam edebilir — OKUMA tarafında normalizeOrderStatus
// tüm eski/yabancı değerleri en yakın kanonik duruma indirger (geriye dönük
// uyumluluk; migrasyon YOK, çalışan ekran bozulmaz).

export const ORDER_STATUS = {
  QUOTE: "quote",
  RECEIVED: "received",
  PRODUCTION: "production",
  READY_FOR_INSTALL: "ready_for_install",
  AWAITING_INSTALL: "awaiting_install",
  INSTALLING: "installing",
  COMPLETED: "completed",
  DELIVERED: "delivered",
  ARCHIVED: "archived",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** Akış sırası — ilerleme, "sonraki adım" ve kısmi-teslim özetinde kullanılır. */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  ORDER_STATUS.QUOTE,
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.PRODUCTION,
  ORDER_STATUS.READY_FOR_INSTALL,
  ORDER_STATUS.AWAITING_INSTALL,
  ORDER_STATUS.INSTALLING,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.ARCHIVED,
];

/** Kullanıcıya görünen Türkçe etiketler (UI buradan okur). */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  [ORDER_STATUS.QUOTE]: "Teklif",
  [ORDER_STATUS.RECEIVED]: "Sipariş Alındı",
  [ORDER_STATUS.PRODUCTION]: "Üretimde",
  [ORDER_STATUS.READY_FOR_INSTALL]: "Montaja Hazır",
  [ORDER_STATUS.AWAITING_INSTALL]: "Montaj Bekliyor",
  [ORDER_STATUS.INSTALLING]: "Montajda",
  [ORDER_STATUS.COMPLETED]: "Tamamlandı",
  [ORDER_STATUS.DELIVERED]: "Teslim Edildi",
  [ORDER_STATUS.ARCHIVED]: "Arşiv",
};

// Eski / dağınık status değerlerini kanonik duruma indirger (geriye dönük uyum).
// TODO(v2): Mevcut kayıtlardaki ("new_order", "approved", "installation_ready" vb.)
//   değerler zamanla bu kanonik kümeye migrate edilebilir (V1'de migration YOK).
const STATUS_ALIASES: Record<string, OrderStatus> = {
  // — Teklif / sipariş başlangıcı —
  quoted: ORDER_STATUS.QUOTE,
  quote: ORDER_STATUS.QUOTE,
  pending: ORDER_STATUS.QUOTE,
  draft: ORDER_STATUS.QUOTE,
  measured: ORDER_STATUS.QUOTE,
  new_order: ORDER_STATUS.RECEIVED,
  approved: ORDER_STATUS.RECEIVED,
  // — Üretim —
  in_progress: ORDER_STATUS.PRODUCTION,
  imalat: ORDER_STATUS.PRODUCTION,
  // — Montaja hazır —
  installation_ready: ORDER_STATUS.READY_FOR_INSTALL,
  montaja_hazir: ORDER_STATUS.READY_FOR_INSTALL,
  // — Montaj bekliyor (montaja gönderildi, atama/planlama aşaması) —
  installation_waiting: ORDER_STATUS.AWAITING_INSTALL,
  installation_planned: ORDER_STATUS.AWAITING_INSTALL,
  montaj_bekliyor: ORDER_STATUS.AWAITING_INSTALL,
  montaj_planlandi: ORDER_STATUS.AWAITING_INSTALL,
  waiting: ORDER_STATUS.AWAITING_INSTALL,
  planned: ORDER_STATUS.AWAITING_INSTALL,
  assigned: ORDER_STATUS.AWAITING_INSTALL,
  // — Montajda —
  montajda: ORDER_STATUS.INSTALLING,
  onway: ORDER_STATUS.INSTALLING,
  // — Tamamlandı —
  installation_completed: ORDER_STATUS.COMPLETED,
  montaj_tamamlandi: ORDER_STATUS.COMPLETED,
  // — Teslim / kapanış —
  delivered_closed: ORDER_STATUS.DELIVERED,
  closed: ORDER_STATUS.DELIVERED,
  teslim_edildi: ORDER_STATUS.DELIVERED,
  // — Arşiv —
  arsiv: ORDER_STATUS.ARCHIVED,
};

/** Serbest-metin status'u kanonik OrderStatus'a indirger. Boş/bilinmeyen → RECEIVED. */
export function normalizeOrderStatus(raw: string | null | undefined): OrderStatus {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return ORDER_STATUS.RECEIVED;
  const alias = STATUS_ALIASES[key];
  if (alias) return alias;
  const canonical = ORDER_STATUS_FLOW.find((s) => s === key);
  return canonical ?? ORDER_STATUS.RECEIVED;
}

/** Kullanıcıya görünen durum etiketi (serbest-metin status'tan). */
export function orderStatusLabel(raw: string | null | undefined): string {
  return ORDER_STATUS_LABEL[normalizeOrderStatus(raw)];
}

/** Akıştaki sıradaki durum (UI ileride "İlerlet" için kullanabilir). Son adımda null. */
export function nextOrderStatus(raw: string | null | undefined): OrderStatus | null {
  const idx = ORDER_STATUS_FLOW.indexOf(normalizeOrderStatus(raw));
  return idx >= 0 && idx < ORDER_STATUS_FLOW.length - 1 ? ORDER_STATUS_FLOW[idx + 1] : null;
}

/** Sipariş arşivlenmiş mi? (Arşiv listelerinden filtrelemek için.) */
export function isArchivedStatus(raw: string | null | undefined): boolean {
  return normalizeOrderStatus(raw) === ORDER_STATUS.ARCHIVED;
}

/** Sipariş "kapandı" mı? (Teslim edildi veya arşiv — gecikme hesabı dışı tutulur.) */
export function isClosedStatus(raw: string | null | undefined): boolean {
  const s = normalizeOrderStatus(raw);
  return s === ORDER_STATUS.DELIVERED || s === ORDER_STATUS.ARCHIVED;
}

// ---------------------------------------------------------------------------
// 2) TAHMİNİ TESLİM TARİHİ (delivery_due_date) — tek doğruluk kaynağı
// ---------------------------------------------------------------------------
// V1: Teslim tarihi SİPARİŞ seviyesinde TEK alandır → orders.delivery_due_date.
//   "Teklif → Siparişe Çevir" (Quotes) ve "Doğrudan Sipariş" (NewOrder) ekranları
//   teslim tarihini buradan okur/yazar; iki ekran asla farklı davranmaz.

/** Kullanıcıya gösterilen alan adı. UI'da yalnızca "Termin" yazılmaz. */
export const DELIVERY_DATE_LABEL = "Tahmini Teslim Tarihi";

/** date input `min` değeri (YYYY-MM-DD): bugünden öncesi seçilemez. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Teslim tarihi geçerli (dolu) mu? Sipariş oluşturma/çevirme bunu zorunlu kılar. */
export function isValidDeliveryDate(date: string | null | undefined): boolean {
  return !!(date && date.trim());
}

/**
 * Sipariş insert/update payload'una eklenecek teslim-tarihi alanları.
 * V1: order seviyesinde tek alan döner → { delivery_due_date }.
 *
 * TODO(v2 — order item bazlı teslim): Bu fonksiyon opsiyonel bir kalem listesi
 *   alıp her order_item için ayrı teslim tarihi üretebilir (örn.
 *   order_items.product_options JSON'una ya da order_items.delivery_due_date
 *   kolonuna). Çağıran ekranlar (Quotes/NewOrder) değişmeden bu tek nokta evrilir.
 */
export function orderDeliveryFields(date: string): { delivery_due_date: string } {
  return { delivery_due_date: date };
}

// ---------------------------------------------------------------------------
// 3) GECİKME / KALAN GÜN MANTIĞI
// ---------------------------------------------------------------------------
export type DeliveryUrgency = "none" | "ok" | "soon" | "due" | "overdue";

/** Teslime kalan gün sayısı (negatif = gecikme). Tarih yoksa/bozuksa null. */
export function daysRemaining(
  dueDate: string | null | undefined,
  from: Date = new Date(),
): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return null;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  return Math.ceil((due - start) / 86_400_000);
}

/**
 * Sipariş gecikmiş mi? Teslim/arşiv edilmiş siparişler gecikmiş sayılmaz.
 * status opsiyoneldir; verilirse kapalı siparişler hariç tutulur.
 */
export function isDelayed(
  dueDate: string | null | undefined,
  status?: string | null,
  from: Date = new Date(),
): boolean {
  if (status != null && isClosedStatus(status)) return false;
  const d = daysRemaining(dueDate, from);
  return d !== null && d < 0;
}

/** Teslim aciliyeti kategorisi (renk/ikon eşlemesi bunun üzerinden yapılır). */
export function deliveryUrgency(
  dueDate: string | null | undefined,
  status?: string | null,
  from: Date = new Date(),
): DeliveryUrgency {
  if (status != null && isClosedStatus(status)) return "none";
  const d = daysRemaining(dueDate, from);
  if (d === null) return "none";
  if (d < 0) return "overdue";
  if (d <= 2) return "due";
  if (d <= 7) return "soon";
  return "ok";
}

/**
 * Teslim durumuna göre Tailwind metin-renk sınıfı. UI ileride kullanır.
 * Tek yerde toplanır ki tüm ERP modülleri aynı renk dilini paylaşsın.
 */
export function deliveryStatusColor(
  dueDate: string | null | undefined,
  status?: string | null,
  from: Date = new Date(),
): string {
  switch (deliveryUrgency(dueDate, status, from)) {
    case "overdue": return "text-red-600 dark:text-red-400";
    case "due": return "text-orange-600 dark:text-orange-400";
    case "soon": return "text-amber-600 dark:text-amber-400";
    case "ok": return "text-emerald-600 dark:text-emerald-400";
    default: return "text-slate-500 dark:text-slate-400";
  }
}

// ---------------------------------------------------------------------------
// 4) MONTAJ PLANLAMA ALANLARI — GELECEK (V1'de KULLANILMAZ)
// ---------------------------------------------------------------------------
// TODO(v2 montaj planlama): orders objesine eklenecek alanlar. Şimdilik YALNIZCA
//   tip düzeyinde izole edildi; DB kolonu / migration YOK. Eklenince montaj
//   ekranı ve sorgular bu tipi kullanır (yeniden tasarım gerekmez).
export interface OrderMountPlanning {
  /** Planlanan montaj tarihi (ISO). TODO: ileride orders.future_mount_date kolonu. */
  futureMountDate?: string | null;
  /** Atanacak montajcı id'si. TODO: ileride orders.future_installer kolonu. */
  futureInstaller?: string | null;
}

// ---------------------------------------------------------------------------
// 5) KISMİ TESLİM — ORDER ITEM BAZLI DURUM (GELECEK — iskelet + TODO)
// ---------------------------------------------------------------------------
// V1: Sipariş TEK PARÇADIR (tek status + tek teslim tarihi).
// TODO(v2 kısmi teslim): İleride her order_item kendi durumunu taşıyabilir:
//   "perde teslim edildi", "stor bekliyor", "tül üretimde" gibi. Geçiş için aynı
//   OrderStatus enum'u kalem seviyesinde de kullanılır; siparişin özet durumu
//   kalemlerin en geri (akışta en erken) durumundan türetilir. DB tarafı:
//   order_items.status / order_items.delivery_due_date (migration V2'de).
//
// Aşağıdaki yardımcı, kalem-bazlı geçişte özet durumu hesaplamak için HAZIRDIR;
// V1'de çağrılmaz, sadece mimari iskelet olarak bulunur.
export function aggregateOrderStatus(itemStatuses: Array<string | null | undefined>): OrderStatus {
  if (itemStatuses.length === 0) return ORDER_STATUS.RECEIVED;
  let minIdx = ORDER_STATUS_FLOW.length - 1;
  for (const s of itemStatuses) {
    const idx = ORDER_STATUS_FLOW.indexOf(normalizeOrderStatus(s));
    if (idx >= 0 && idx < minIdx) minIdx = idx;
  }
  return ORDER_STATUS_FLOW[minIdx];
}

// ---------------------------------------------------------------------------
// 6) DURUM → İKON EŞLEMESİ (GELECEK)
// ---------------------------------------------------------------------------
// TODO(ui): Durum→ikon eşlemesi burada toplanacak. İkon ADLARI string olarak
//   tutulur (örn. lucide isimleri); bileşen importu UI katmanında çözülür ki bu
//   modül React'ten bağımsız kalsın. Örnek (ileride aktifleştirilecek):
//   export const ORDER_STATUS_ICON: Record<OrderStatus, string> = {
//     quote: "FileText", received: "ClipboardCheck", production: "Factory",
//     ready_for_install: "PackageCheck", installing: "Wrench",
//     completed: "CheckCircle2", delivered: "Truck", archived: "Archive",
//   };
