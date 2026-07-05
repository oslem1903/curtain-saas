// ============================================================================
// Yedekleme / Dışa Aktarma — çok sayfalı (multi-sheet) Excel üretimi.
//
// Ayarlar > "Yedekleme / Dışa Aktarma" bölümü buradan çağrılır. Yalnızca OKUMA
// yapar: hiçbir finans/cari hesaplama, insert/update, migration veya RPC yok.
//
// Yaklaşım: her tabloyu company_id (+ opsiyonel entity filtresi) ile çeker,
// tarih aralığını CLIENT-SIDE uygular (DATE/timestamptz kolon-tipi farklarından
// etkilenmemek için) ve kullanıcı dostu Türkçe başlıklarla ayrı bir sheet'e yazar.
// ============================================================================
import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";

export type BackupOptions = {
  companyId: string;
  dateFrom: string; // "YYYY-MM-DD"
  dateTo: string; // "YYYY-MM-DD"
  customerId?: string | null;
  supplierId?: string | null;
  installerId?: string | null;
};

export type BackupResult = { filename: string; sheetCounts: Record<string, number> };

const ORDER_STATUS: Record<string, string> = {
  new_order: "Sipariş Alındı",
  siparis_alindi: "Sipariş Alındı",
  uretimde: "Üretimde",
  montaja_hazir: "Montaja Hazır",
  montaj_planlandi: "Montaj Planlandı",
  montajda: "Montajda",
  montaj_tamamlandi: "Montaj Tamamlandı",
  installation_completed: "Montaj Tamamlandı",
  teslim_edildi: "Teslim Edildi",
  paid: "Ödendi",
  draft: "Taslak",
  cancelled: "İptal",
  iptal: "İptal",
};
const APPT_STATUS: Record<string, string> = {
  planned: "Planlandı",
  done: "Tamamlandı",
  completed: "Tamamlandı",
  cancelled: "İptal",
};
const TX_TYPE: Record<string, string> = { debt: "Borç", payment: "Ödeme", cancel: "İptal" };

const num = (v: any) => (v == null || v === "" ? 0 : Number(v) || 0);
const fmtDate = (v: any) => (v ? new Date(v).toLocaleDateString("tr-TR") : "");
const shortId = (v: any) => (v ? String(v).slice(0, 8).toUpperCase() : "");

/** company + opsiyonel eşitlik filtreleriyle güvenli çekim; hata olursa boş dizi döner. */
async function safeSelect(
  table: string,
  companyId: string,
  eqFilters: Record<string, string | null | undefined> = {},
): Promise<any[]> {
  try {
    let q = supabase.from(table).select("*").eq("company_id", companyId);
    for (const [col, val] of Object.entries(eqFilters)) {
      if (val) q = q.eq(col, val);
    }
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

export async function exportBackupWorkbook(opts: BackupOptions): Promise<BackupResult> {
  const { companyId, dateFrom, dateTo, customerId, supplierId, installerId } = opts;

  // Tarih aralığı (client-side): [fromMs, toMs]. Tarihi olmayan kayıt aralık dışı sayılmaz.
  const fromMs = new Date(`${dateFrom}T00:00:00`).getTime();
  const toMs = new Date(`${dateTo}T23:59:59.999`).getTime();
  const inRange = (v: any) => {
    if (!v) return true;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? true : t >= fromMs && t <= toMs;
  };

  // ── İsim eşleme haritaları (id → ad) ────────────────────────────────────────
  const [customersRaw, suppliersRaw, employeesRaw] = await Promise.all([
    safeSelect("customers", companyId),
    safeSelect("suppliers", companyId),
    safeSelect("employees", companyId),
  ]);
  const customerName = new Map<string, string>();
  customersRaw.forEach((c) => c?.id && customerName.set(c.id, c.name || "İsimsiz"));
  const supplierName = new Map<string, string>();
  suppliersRaw.forEach((s) => s?.id && supplierName.set(s.id, s.name || "İsimsiz"));
  const installerName = new Map<string, string>();
  employeesRaw.forEach((e) => {
    const nm = e?.full_name || "Montajcı";
    if (e?.id) installerName.set(e.id, nm);
    if (e?.user_id) installerName.set(e.user_id, nm);
  });

  // Sipariş → müşteri (tahsilat/ödeme satırlarını müşteri adıyla zenginleştirmek için)
  const ordersAll = await safeSelect("orders", companyId);
  const orderCustomer = new Map<string, string>();
  ordersAll.forEach((o) => o?.id && orderCustomer.set(o.id, o.customer_id || ""));

  // ── 1) Siparişler ───────────────────────────────────────────────────────────
  const orders = ordersAll
    .filter((o) => (!customerId || o.customer_id === customerId) && inRange(o.created_at))
    .map((o) => ({
      "Sipariş No": shortId(o.id),
      Tarih: fmtDate(o.created_at),
      Müşteri: customerName.get(o.customer_id) || "",
      Durum: ORDER_STATUS[String(o.status)] || o.status || "",
      "Toplam Tutar": num(o.total_amount),
      Ödenen: num(o.paid_amount ?? o.deposit_amount),
      Kalan: num(o.remaining_amount),
      "Teslim Tarihi": fmtDate(o.delivery_due_date),
      "Ödeme Vadesi": fmtDate(o.payment_due_date),
      Not: o.note || "",
    }));

  // ── 2) Ölçüler (appointments type=measurement, tüm durumlar) ─────────────────
  const apptAll = await safeSelect("appointments", companyId, { customer_id: customerId });
  const measurements = apptAll
    .filter((a) => a.type === "measurement" && inRange(a.created_at ?? a.start_at))
    .map((a) => ({
      Tarih: fmtDate(a.created_at ?? a.start_at),
      Müşteri: customerName.get(a.customer_id) || "",
      Adres: a.address || "",
      Oda: a.room_name || a.room || "",
      Ürün: a.product_type || "",
      Model: a.model_name || "",
      Renk: a.color_name || "",
      "En (cm)": a.width_cm ?? "",
      "Boy (cm)": a.height_cm ?? "",
      Adet: a.quantity ?? "",
      Durum: APPT_STATUS[String(a.status)] || a.status || "",
      Not: a.note || "",
    }));

  // ── 3) Teklifler (measurement + status done/cancelled) ───────────────────────
  const quotes = apptAll
    .filter(
      (a) => a.type === "measurement" && ["done", "cancelled"].includes(String(a.status)) && inRange(a.created_at),
    )
    .map((a) => ({
      Tarih: fmtDate(a.created_at),
      Müşteri: customerName.get(a.customer_id) || "",
      Adres: a.address || "",
      Ürün: a.product_type || "",
      Model: a.model_name || "",
      Renk: a.color_name || "",
      "En (cm)": a.width_cm ?? "",
      "Boy (cm)": a.height_cm ?? "",
      Adet: a.quantity ?? "",
      "Birim Fiyat": num(a.unit_price),
      Durum: APPT_STATUS[String(a.status)] || a.status || "",
      "Siparişe Dönüştü": a.order_id ? "Evet" : "Hayır",
    }));

  // ── 4) Müşteriler ────────────────────────────────────────────────────────────
  const customers = customersRaw
    .filter((c) => (!customerId || c.id === customerId) && inRange(c.created_at))
    .map((c) => ({
      Ad: c.name || "",
      Telefon: c.phone || "",
      Adres: c.address || "",
      "E-posta": c.email || "",
      "Kayıt Tarihi": fmtDate(c.created_at),
    }));

  // ── 5) Tedarikçi Cari ────────────────────────────────────────────────────────
  const supTxRaw = await safeSelect("supplier_transactions", companyId, { supplier_id: supplierId });
  const supplierLedger = supTxRaw
    .filter((t) => inRange(t.transaction_date))
    .map((t) => ({
      Tarih: fmtDate(t.transaction_date),
      Tedarikçi: supplierName.get(t.supplier_id) || "",
      Tür: TX_TYPE[String(t.transaction_type)] || t.transaction_type || "",
      Tutar: num(t.amount),
      Açıklama: t.description || "",
      "Evrak No": t.reference_no || "",
      Vade: fmtDate(t.due_date),
      "Sipariş No": shortId(t.order_id),
    }));

  // ── 6) Montajcı Cari / Hakediş (tamamlanan işler + ödeme/iptal hareketleri) ──
  const jobsRaw = await safeSelect("installation_jobs", companyId, { assigned_staff_id: installerId });
  const instTxRaw = await safeSelect("installer_transactions", companyId, { installer_id: installerId });

  // Hesap-sahibi montajcı adı doldurma: employees'te OLMAYAN ama işe/harekete atanmış id'ler
  // (ör. solo Yönetici kendini montajcı atar) için isimleri profiles'tan tamamla; aksi halde
  // sheet'te "Montajcı" adı BOŞ çıkar. Salt-okuma, best-effort — tutar/filtre/toplam değişmez.
  const referencedInstallerIds = new Set<string>();
  jobsRaw.forEach((j) => { if (j?.assigned_staff_id) referencedInstallerIds.add(j.assigned_staff_id); });
  instTxRaw.forEach((t) => { if (t?.installer_id) referencedInstallerIds.add(t.installer_id); });
  const missingInstallerIds = Array.from(referencedInstallerIds).filter((idv) => !installerName.has(idv));
  if (missingInstallerIds.length > 0) {
    try {
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", missingInstallerIds);
      if (!error) {
        (profs ?? []).forEach((p: any) => {
          if (p?.user_id) installerName.set(p.user_id, (p.full_name || "").trim() || "Montajcı");
        });
      }
    } catch {
      // profiles okunamadı → ad boş kalır (mevcut davranış); export bozulmaz.
    }
  }

  const installerLedger: any[] = [];
  jobsRaw
    .filter((j) => String(j.status) === "completed" && inRange(j.scheduled_date ?? j.updated_at))
    .forEach((j) =>
      installerLedger.push({
        Tarih: fmtDate(j.scheduled_date ?? j.updated_at),
        Montajcı: installerName.get(j.assigned_staff_id) || "",
        Tür: "Hakediş",
        Tutar: num(j.installer_fee),
        Açıklama: `${j.customer_name || ""} - ${j.product_type || ""}`.trim(),
      }),
    );
  instTxRaw
    .filter((t) => inRange(t.transaction_date))
    .forEach((t) =>
      installerLedger.push({
        Tarih: fmtDate(t.transaction_date),
        Montajcı: installerName.get(t.installer_id) || "",
        Tür: TX_TYPE[String(t.transaction_type)] || t.transaction_type || "",
        Tutar: num(t.amount),
        Açıklama: t.description || "",
      }),
    );

  // ── 7) Tahsilatlar (payments — müşteri tahsilatları) ─────────────────────────
  const payRaw = await safeSelect("payments", companyId);
  const collections = payRaw
    .filter((p) => {
      if (!inRange(p.payment_date)) return false;
      if (customerId) return orderCustomer.get(p.order_id) === customerId;
      return true;
    })
    .map((p) => ({
      Tarih: fmtDate(p.payment_date),
      Müşteri: customerName.get(orderCustomer.get(p.order_id) || "") || "",
      "Sipariş No": shortId(p.order_id),
      Tutar: num(p.amount),
      Yöntem: p.method || p.payment_method || "",
      Not: p.note || "",
    }));

  // ── 8) Ödemeler (giden: tedarikçi + montajcı ödemeleri) ──────────────────────
  // supplier_payments artık legacy/write-orphan (bkz. supplier_record_payment RPC —
  // yalnızca supplier_transactions + expenses'e yazar). Gerçek kaynak: supTxRaw
  // (madde 5'te zaten çekildi) içindeki 'payment'/'credit' türü — Accounting.tsx'teki
  // aynı modelle ('payment_reversal' bilinçli olarak dışarıda bırakılır).
  const payments: any[] = [];
  supTxRaw
    .filter((p) => (String(p.transaction_type) === "payment" || String(p.transaction_type) === "credit") && inRange(p.transaction_date))
    .forEach((p) =>
      payments.push({
        Tarih: fmtDate(p.transaction_date),
        Tür: "Tedarikçi",
        Alıcı: supplierName.get(p.supplier_id) || "",
        Tutar: num(p.amount),
        Yöntem: p.payment_method || "",
        Not: p.description || "",
      }),
    );
  instTxRaw
    .filter((t) => String(t.transaction_type) === "payment" && inRange(t.transaction_date))
    .forEach((t) =>
      payments.push({
        Tarih: fmtDate(t.transaction_date),
        Tür: "Montajcı",
        Alıcı: installerName.get(t.installer_id) || "",
        Tutar: num(t.amount),
        Yöntem: t.payment_method || "",
        Not: t.description || "",
      }),
    );

  // ── Workbook üret ────────────────────────────────────────────────────────────
  const sheets: Array<[string, any[]]> = [
    ["Siparişler", orders],
    ["Ölçüler", measurements],
    ["Teklifler", quotes],
    ["Müşteriler", customers],
    ["Tedarikçi Cari", supplierLedger],
    ["Montajcı Cari", installerLedger],
    ["Tahsilatlar", collections],
    ["Ödemeler", payments],
  ];

  const wb = XLSX.utils.book_new();
  const sheetCounts: Record<string, number> = {};
  for (const [name, rows] of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Bilgi: "Bu tarih aralığında kayıt yok" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    sheetCounts[name] = rows.length;
  }

  const today = new Date().toISOString().slice(0, 10);
  const filename = `PerdePRO_Yedek_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
  return { filename, sheetCounts };
}
