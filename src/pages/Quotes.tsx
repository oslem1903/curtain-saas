import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "../hooks/usePersistedState";
import {
  ArrowLeft, CheckCircle2, CircleDashed, FilePlus2, Pencil, Phone,
  RefreshCw, Ruler, Search, XCircle,
} from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { DELIVERY_DATE_LABEL, todayISO, isValidDeliveryDate, orderDeliveryFields } from "../utils/order";
import { postSupplierDebt } from "../utils/supplierCari";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  order_id: string | null;
  customer_id: string | null;
  address: string | null;
  room_name: string | null;
  product_type: string | null;
  model_name: string | null;
  color_name: string | null;
  width_cm: number | null;
  height_cm: number | null;
  quantity: number | null;
  unit_price: number | null;
  supplier_id: string | null;
  supplier_unit_cost: number | null;
  note: string | null;
  customer: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

type QuoteGroup = {
  groupId: string;
  rows: QuoteRow[];
  customer: { name: string | null; phone: string | null } | null;
  status: "pending" | "converted" | "cancelled";
  createdAt: string | null;
  totalEstimate: number;
};

type QuoteStatus = "pending" | "converted" | "cancelled";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function customerOf(row: QuoteRow): { name: string | null; phone: string | null } | null {
  return Array.isArray(row.customer) ? (row.customer[0] ?? null) : (row.customer ?? null);
}

function quoteStatus(row: QuoteRow): QuoteStatus {
  if (String(row.status ?? "").toLowerCase() === "cancelled") return "cancelled";
  if (row.order_id) return "converted";
  return "pending";
}

function productLabel(t: string | null | undefined): string {
  const map: Record<string, string> = {
    stor: "Stor", zebra: "Zebra", tul: "Tül", fon: "Fon",
    jalousie: "Jaluzi", picasso: "Picasso", plicell: "Plicell",
    dikey_tul: "Dikey Tül", dikey_stor: "Dikey Stor",
  };
  return map[String(t ?? "").toLowerCase()] ?? (t || "Ürün");
}

function calcEstimate(row: QuoteRow): number {
  const w = (row.width_cm ?? 0) / 100;
  const h = (row.height_cm ?? 0) / 100;
  const qty = Math.max(1, row.quantity ?? 1);
  const price = row.unit_price ?? 0;
  return w * h * qty * price;
}

function fmtTL(n: number): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return "-"; }
}

function parseGroupId(note: string | null): string | null {
  if (!note) return null;
  const m = note.match(/\[Grup:\s*([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Quotes({ embedded = false }: { embedded?: boolean } = {}) {
  const nav = useNavigate();

  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = usePersistedState<"all" | QuoteStatus>("perdepro.quotes.status", "all");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  // Termin (teslim tarihi) siparişe çevirme aşamasında girilir; her teklif grubu için ayrı tutulur.
  const [terminDates, setTerminDates] = useState<Record<string, string>>({});

  async function loadData() {
    setLoading(true);
    setErr("");
    try {
      const ctx = await getEffectiveTenantContext();

      let { data, error } = await supabase
        .from("appointments")
        .select("id,created_at,status,order_id,customer_id,address,room_name,product_type,model_name,color_name,width_cm,height_cm,quantity,unit_price,supplier_id,supplier_unit_cost,note,customer:customers(name,phone)")
        .eq("company_id", ctx.company_id)
        .eq("type", "measurement")
        .in("status", ["done", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        const fb = await supabase
          .from("appointments")
          .select("id,created_at,status,order_id,customer_id,address,room_name,product_type,model_name,color_name,width_cm,height_cm,quantity,unit_price,note,customer:customers(name,phone)")
          .eq("company_id", ctx.company_id)
          .eq("type", "measurement")
          .in("status", ["done", "cancelled"])
          .order("created_at", { ascending: false })
          .limit(200);
        data = (fb.data ?? []).map((r: any) => ({ ...r, order_id: r.order_id ?? null, supplier_id: null, supplier_unit_cost: null }));
        error = fb.error;
      }

      if (error) throw error;
      setRows((data ?? []) as QuoteRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Teklifler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  async function handleCancelGroup(group: QuoteGroup) {
    if (!window.confirm("Bu gruptaki tüm teklifleri iptal etmek istediğinize emin misiniz?")) return;
    setCancelling(group.groupId);
    try {
      const ctx = await getEffectiveTenantContext();
      const ids = group.rows.map(r => r.id);
      const { error } = await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .in("id", ids)
        .eq("company_id", ctx.company_id);
      if (error) throw error;
      setRows((prev) => prev.map((r) => ids.includes(r.id) ? { ...r, status: "cancelled" } : r));
    } catch (e: any) {
      alert("İptal edilemedi: " + (e?.message ?? "Hata"));
    } finally {
      setCancelling(null);
    }
  }

  async function handleConvertGroup(group: QuoteGroup) {
    const customerName = group.customer?.name || "Müşteri";
    // window.confirm kaldırıldı, bazen tarayıcı tarafından engellenebiliyor.

    // Tahmini teslim tarihi zorunlu: sipariş tarihsiz oluşturulamaz.
    const termin = (terminDates[group.groupId] ?? "").trim();
    if (!isValidDeliveryDate(termin)) {
      setErr(`${DELIVERY_DATE_LABEL} zorunludur. Siparişe çevirmeden önce tarihi girin.`);
      return;
    }

    setConverting(group.groupId);
    try {
      const ctx = await getEffectiveTenantContext();
      
      const customerId = group.rows[0].customer_id;
      if (!customerId) throw new Error("Müşteri kimliği bulunamadı.");

      let totalLineTotal = 0;
      let totalSupplierLineTotal = 0;

      const itemsPayload = group.rows.map(row => {
        const widthM  = (row.width_cm  ?? 100) / 100;
        const heightM = (row.height_cm ?? 200) / 100;
        const qty      = Math.max(1, row.quantity ?? 1);
        const unitPrice = row.unit_price ?? 0;
        const supplierUnitCost = row.supplier_unit_cost ?? 0;
        const areaM2    = widthM * heightM;
        const lineTotal = areaM2 * qty * unitPrice;
        const supplierLineTotal = areaM2 * qty * supplierUnitCost;
        
        totalLineTotal += lineTotal;
        totalSupplierLineTotal += supplierLineTotal;

        const isTulFon = row.product_type === "tul" || row.product_type === "fon";
        const productNote = [row.model_name, row.color_name, row.room_name].filter(Boolean).join(" / ") || null;
        
        return {
          company_id: ctx.company_id,
          product_type: row.product_type || "stor",
          width_cm: row.width_cm ?? 100,
          height_cm: row.height_cm ?? 200,
          qty,
          unit_price: unitPrice,
          line_total: lineTotal,
          room: row.room_name || null,
          note: productNote,
          sewing_allowance_cm: isTulFon ? 15 : null,
          supplier_id: row.supplier_id || null,
          supplier_unit_cost: supplierUnitCost,
          supplier_total_cost: supplierLineTotal,
          profit: lineTotal - supplierLineTotal,
        };
      });

      const profitAmt = totalLineTotal - totalSupplierLineTotal;

      // 1) Sipariş oluştur
      const fullOrderPayload = {
          customer_id:       customerId,
          company_id:        ctx.company_id,
          note:              null,
          status:            "new_order",
          total_amount:      totalLineTotal,
          deposit_amount:    0,
          paid_amount:       0,
          remaining_amount:  totalLineTotal,
          fabric_cost:       totalSupplierLineTotal,
          mechanism_cost:    0,
          installation_cost: 0,
          labor_cost:        0,
          transport_cost:    0,
          profit:            profitAmt,
      };

      let orderId;
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .insert([fullOrderPayload])
        .select("id")
        .single();
        
      if (orderErr) {
        console.warn("orders full insert failed, trying minimal:", orderErr.message);
        // Şemada olmayabilecek maliyet kolonlarını ayıkla; kalan alanlarla tekrar dene.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { labor_cost, transport_cost, profit, fabric_cost, mechanism_cost, installation_cost, ...minimalOrderPayload } = fullOrderPayload as any;
        const { data: minRow, error: minErr } = await supabase
          .from("orders")
          .insert([minimalOrderPayload])
          .select("id")
          .single();
        if (minErr) throw minErr;
        orderId = minRow.id;
      } else {
        orderId = orderRow.id;
      }

      // 2) Termin tarihi — kullanıcı tarafından siparişe çevirmede girilir (zorunlu).
      // orders.delivery_due_date tek doğruluk kaynağıdır; ölçüden (appointments) okunmaz.
      try {
        await supabase.from("orders").update(orderDeliveryFields(termin))
          .eq("id", orderId).eq("company_id", ctx.company_id);
      } catch { /* delivery_due_date kolonu yoksa sessizce geç; sipariş yine oluşur */ }

      // 3) Sipariş kalemleri ekle
      const insertItems = itemsPayload.map(item => ({
        ...item, order_id: orderId,
      }));
      let insertedItems: any[] = [];
      const { data: fullItemsData, error: itemErr } = await supabase.from("order_items").insert(insertItems).select("id, supplier_id, supplier_total_cost, product_type, room");
      if (itemErr) {
        // Bazı kolonlar tabloda olmayabilir - minimal insert dene
        console.warn("order_items full insert failed, trying minimal:", itemErr.message);
        // Şemada olmayabilecek kalem kolonlarını ayıkla; kalan alanlarla tekrar dene.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const minimalItems = insertItems.map(({ sewing_allowance_cm, supplier_total_cost, profit, ...rest }) => rest);
        const { data: minItemsData, error: minErr } = await supabase.from("order_items").insert(minimalItems).select("id, supplier_id, supplier_total_cost, product_type, room");
        if (minErr) throw minErr;
        insertedItems = minItemsData || [];
      } else {
        insertedItems = fullItemsData || [];
      }

      // 4) Tedarikçi borçları (Her kalem için ayrı ayrı işleyip order_item'a bağlayalım)
      for (const item of insertedItems) {
        if (item.supplier_id && item.supplier_total_cost > 0) {
          try {
            const productLabelStr = item.product_type === "stor" ? "Stor" : item.product_type === "zebra" ? "Zebra" : item.product_type === "tul" ? "Tül" : item.product_type === "fon" ? "Fon" : item.product_type || "Ürün";
            const lineLabel = `${productLabelStr} (${item.room || "Alan"})`;
            await postSupplierDebt({
              companyId: ctx.company_id,
              orderId,
              supplierId: item.supplier_id,
              amount: item.supplier_total_cost,
              description: `Sipariş ürün eklendi: ${customerName} - ${lineLabel}`,
              orderItemId: item.id,
              // Vade: supplier varsayılan vadesi/manuel giriş eklenince iletilir (şimdilik null).
              supplierDueDays: null,
            });
          } catch (e) { console.warn("Supplier transaction insert failed:", e); }
        }
      }

      // 5) Appointment'ları siparişe bağla
      const apptIds = group.rows.map(r => r.id);
      await supabase.from("appointments").update({ order_id: orderId }).in("id", apptIds).eq("company_id", ctx.company_id);

      setRows(prev => prev.map(r => apptIds.includes(r.id) ? { ...r, order_id: orderId } : r));
      nav("/orders", { state: { newOrderId: orderId } });
    } catch (e: any) {
      console.error("Sipariş oluşturma hatası tam log:", e, e?.stack);
      alert("Sipariş oluşturulamadı.\n\nHata:\n" + (e?.message ?? "Bilinmeyen hata") + "\n\n" + (e?.stack ?? ""));
    } finally {
      setConverting(null);
    }
  }

  function handleEditGroup(group: QuoteGroup) {
    nav("/measurements/new", {
      state: {
        groupId: group.groupId,
        customerId: group.rows[0].customer_id,
      },
    });
  }

  const grouped = useMemo(() => {
    const groupsMap = new Map<string, QuoteGroup>();

    rows.forEach(row => {
      const gId = parseGroupId(row.note) || `single-${row.id}`;
      if (!groupsMap.has(gId)) {
        groupsMap.set(gId, {
          groupId: gId,
          rows: [],
          customer: customerOf(row),
          status: quoteStatus(row),
          createdAt: row.created_at,
          totalEstimate: 0
        });
      }
      const g = groupsMap.get(gId)!;
      g.rows.push(row);
      g.totalEstimate += calcEstimate(row);
      if (quoteStatus(row) === "converted") g.status = "converted";
      if (quoteStatus(row) === "pending" && g.status === "cancelled") g.status = "pending";
    });

    return Array.from(groupsMap.values());
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return grouped.filter((group) => {
      const matchStatus = statusFilter === "all" || group.status === statusFilter;
      const matchSearch = !s
        || (group.customer?.name ?? "").toLowerCase().includes(s)
        || (group.customer?.phone ?? "").toLowerCase().includes(s)
        || group.rows.some(r => 
             (r.room_name ?? "").toLowerCase().includes(s) || 
             productLabel(r.product_type).toLowerCase().includes(s)
           );
      return matchStatus && matchSearch;
    });
  }, [grouped, search, statusFilter]);

  const counts = useMemo(() => ({
    pending: grouped.filter(g => g.status === "pending").length,
    converted: grouped.filter(g => g.status === "converted").length,
    cancelled: grouped.filter(g => g.status === "cancelled").length,
  }), [grouped]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {!embedded && (
            <button onClick={() => nav(-1)} className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">Teklifler</h1>
            <p className="text-xs text-slate-400 mt-0.5">Ölçü kayıtları gruplanmış teklifler olarak görünür.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
          {!embedded && (
            <button onClick={() => nav("/measurements/new")} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-black text-white hover:bg-primary-700">
              <Ruler className="h-4 w-4" /> Yeni Ölçü Al
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Teklif Bekliyor", count: counts.pending, color: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300", status: "pending" as const },
          { label: "Siparişe Çevrildi", count: counts.converted, color: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", status: "converted" as const },
          { label: "İptal Edildi", count: counts.cancelled, color: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400", status: "cancelled" as const },
        ].map(({ label, count, color, status }) => (
          <button key={status} onClick={() => setStatusFilter(statusFilter === status ? "all" : status)} className={`rounded-2xl border p-3 text-center transition ${color} ${statusFilter === status ? "ring-2 ring-offset-1 ring-current" : ""}`}>
            <div className="text-2xl font-black">{count}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide mt-0.5">{label}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input type="text" placeholder="Arama yap..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-900" />
        </div>
        {statusFilter !== "all" && <button onClick={() => setStatusFilter("all")} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700">Filtreyi Temizle</button>}
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center dark:border-slate-700 dark:bg-slate-800/30">
          <Ruler className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="font-bold text-slate-500 dark:text-slate-400">Teklif bulunamadı.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((group) => (
            <div key={group.groupId} className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${group.status === "pending" ? "border-amber-200" : group.status === "converted" ? "border-emerald-200" : "border-slate-200 opacity-60"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap border-b border-slate-100 pb-4 mb-4 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    {group.status === "pending" && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700"><CircleDashed className="h-3 w-3" /> Teklif Bekliyor</span>}
                    {group.status === "converted" && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Siparişe Çevrildi</span>}
                    {group.status === "cancelled" && <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500"><XCircle className="h-3 w-3" /> İptal Edildi</span>}
                    <span className="text-[10px] text-slate-400">{fmtDate(group.createdAt)}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-black text-slate-900 dark:text-white text-lg">{group.customer?.name || "Müşteri"}</span>
                    {group.customer?.phone && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" />{group.customer.phone}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-500">Grup Toplamı</div>
                  <div className="text-xl font-black text-slate-900 dark:text-white">{fmtTL(group.totalEstimate)}</div>
                  <div className="text-xs text-slate-400">{group.rows.length} Ürün Kalemi</div>
                </div>
              </div>

              <div className="space-y-2 mb-5">
                {group.rows.map((row, i) => (
                  <div key={row.id} className="flex justify-between items-center rounded-xl bg-slate-50 px-4 py-2 text-sm dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                      <span className="font-black text-slate-400">{i + 1}.</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">{row.room_name || "Alan"}</span>
                      <span className="text-slate-500">{productLabel(row.product_type)}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>{row.width_cm}x{row.height_cm} cm</span>
                      <span className="font-black text-slate-800 dark:text-slate-200">{fmtTL(calcEstimate(row))}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                {group.status === "pending" && (
                  <>
                    {/* Tahmini teslim tarihi — Siparişe Çevir'in ÜZERİNDE, tek satır sade tarih seçici (modalsız). */}
                    <label className="flex items-center justify-end gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                      <span>{DELIVERY_DATE_LABEL} <span className="text-red-500">*</span></span>
                      <input
                        type="date"
                        value={terminDates[group.groupId] ?? ""}
                        min={todayISO()}
                        onChange={e => setTerminDates(prev => ({ ...prev, [group.groupId]: e.target.value }))}
                        className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold outline-none focus:border-primary-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleEditGroup(group)} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /> Düzenle</button>
                      <button onClick={() => handleCancelGroup(group)} disabled={cancelling === group.groupId} className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800"><XCircle className="h-4 w-4" /> İptal Et</button>
                      <button onClick={() => void handleConvertGroup(group)} disabled={converting === group.groupId || !isValidDeliveryDate(terminDates[group.groupId])} title={!isValidDeliveryDate(terminDates[group.groupId]) ? `Önce ${DELIVERY_DATE_LABEL.toLowerCase()}ni girin` : undefined} className="inline-flex items-center gap-1 rounded-xl bg-primary-600 px-5 py-2 text-sm font-black text-white shadow-lg shadow-primary-600/30 hover:bg-primary-700 disabled:opacity-60"><FilePlus2 className="h-4 w-4" /> {converting === group.groupId ? "Oluşturuluyor..." : "Siparişe Çevir"}</button>
                    </div>
                  </>
                )}
                {group.status === "converted" && (
                  <button onClick={() => nav(`/orders`)} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800">Siparişi Görüntüle →</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
