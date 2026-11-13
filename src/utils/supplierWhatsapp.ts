// Siparişten tedarikçiye WhatsApp paylaşımı — SAF fonksiyonlar (DB yazmaz).
// Mesaja yalnızca seçilen tedarikçinin kalemleri girer; müşteri adı/telefonu/adresi,
// satış fiyatı, maliyet ve iç notlar KASITLI olarak mesajın dışında tutulur.
// phoneUtils.normalizePhone ile AYNI kural (o dosya supabase istemcisini import ettiği için saf kalsın diye burada).
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "9" + digits;
  if (digits.length === 10) return "90" + digits;
  return digits;
}

export type SupplierShareItem = {
  product_type?: string | null;
  width_cm?: number | null;
  height_cm?: number | null;
  qty?: number | null;
  supplier_id?: string | null;
  product_options?: Record<string, any> | null;
};

export type SupplierShareLine = { label: string; item: SupplierShareItem };

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function fmtCm(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return String(Math.round(v * 100) / 100).replace(".", ",");
}

/** Siparişteki farklı tedarikçi kimlikleri (boş olanlar hariç, sıra korunur). */
export function distinctSupplierIds(items: SupplierShareItem[]): string[] {
  const seen: string[] = [];
  for (const it of items) {
    const id = it.supplier_id;
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

export function itemsForSupplier<T extends SupplierShareItem>(items: T[], supplierId: string): T[] {
  return items.filter((it) => it.supplier_id === supplierId);
}

/** Geçerli WhatsApp numarası (E.164 rakamları, TR cep: 90 5XX...) veya null. */
export function whatsappPhoneDigits(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  if (!n) return null;
  if (/^905\d{9}$/.test(n)) return n;
  // Yurt dışı: ülke koduyla başlayan 11-15 hane (0 ile başlamayan)
  const hasPlus = typeof raw === "string" && raw.trim().startsWith("+");
  if (hasPlus && /^[1-9]\d{10,14}$/.test(n)) return n;
  return null;
}

export function whatsappUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}

export type SupplierMessageInput = {
  orderNo: string;
  supplierName: string;
  items: Array<SupplierShareItem & { productLabel: string }>;
};

export function buildSupplierMessage(input: SupplierMessageInput): string {
  const lines: string[] = [];
  lines.push(`Merhaba ${clean(input.supplierName) || ""}`.trim() + ",");
  lines.push(`Sipariş No: #${input.orderNo}`);
  lines.push("");
  input.items.forEach((it, i) => {
    const po = (it.product_options ?? {}) as Record<string, any>;
    const fi = (po.field_info ?? {}) as Record<string, any>;
    const model = clean(po.model_name) || clean(fi.model_name);
    const color = clean(po.color_name) || clean(fi.color_name);
    const code = clean(po.product_code) || clean(fi.product_code) || clean(fi.swatch_code);
    const supplierNote = clean(po.supplier_note) || clean(fi.supplier_note);
    const name = [it.productLabel, model].filter(Boolean).join(" - ");
    const isRail = it.product_type === "dekoratif_ray";
    const size = isRail
      ? `En: ${fmtCm(it.width_cm)} cm`
      : `${fmtCm(it.width_cm)} × ${fmtCm(it.height_cm)} cm (en × boy)`;
    lines.push(`${i + 1}) ${name}`);
    if (color) lines.push(`   Renk: ${color}`);
    if (code && code !== color) lines.push(`   Ürün kodu: ${code}`);
    lines.push(`   Ölçü: ${size}`);
    lines.push(`   Adet: ${Math.max(1, Number(it.qty) || 1)}`);
    if (supplierNote) lines.push(`   Not: ${supplierNote}`);
  });
  lines.push("");
  lines.push("Teşekkürler.");
  return lines.join("\n");
}
