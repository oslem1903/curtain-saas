import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Plus, Printer, Save, Send, ShoppingCart, Trash2 } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { logAction } from "../utils/audit";
import { notifyInvoiceCreated } from "../services/notificationManager";

type InvoiceItem = {
    id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    tax_rate: number;
};

type PartyOption = {
    id: string;
    name: string;
    email?: string | null;
};

type OrderOption = {
    id: string;
    total_amount?: number | null;
    customer_id?: string | null;
    customers?: { name: string | null } | Array<{ name: string | null }> | null;
};

function emptyItem(): InvoiceItem {
    return {
        description: "",
        quantity: 1,
        unit_price: 0,
        tax_rate: 20,
    };
}

function toPartyName(
    value: { name: string | null } | Array<{ name: string | null }> | null | undefined,
) {
    if (Array.isArray(value)) return value[0]?.name || "İsimsiz";
    return value?.name || "İsimsiz";
}

async function resolveCompanyId() {
    return getEffectiveTenantContext().then((ctx) => ctx.company_id).catch(() => null);
}

async function nextInvoiceNo() {
    const year = new Date().getFullYear();
    const { data: lastInv } = await supabase
        .from("invoices")
        .select("invoice_no")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lastInv?.invoice_no) return `FAT${year}00001`;

    const numeric = lastInv.invoice_no.match(/\d+$/);
    if (!numeric) return `${lastInv.invoice_no}1`;

    const next = (parseInt(numeric[0], 10) + 1).toString().padStart(numeric[0].length, "0");
    const prefix = lastInv.invoice_no.slice(0, lastInv.invoice_no.length - numeric[0].length);
    return `${prefix}${next}`;
}

function formatMoney(value: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
}

export default function InvoiceDetail() {
    const { id } = useParams();
    const nav = useNavigate();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [companyId, setCompanyId] = useState("");

    const [type, setType] = useState("sales");
    const [no, setNo] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
    const [customerId, setCustomerId] = useState("");
    const [supplierId, setSupplierId] = useState("");
    const [orderId, setOrderId] = useState("");
    const [status, setStatus] = useState("draft");
    const [dueDate, setDueDate] = useState("");
    const [paidAmount, setPaidAmount] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState("");
    const [notes, setNotes] = useState("");
    const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);

    const [contacts, setContacts] = useState<PartyOption[]>([]);
    const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
    const [orders, setOrders] = useState<OrderOption[]>([]);
    const [showOrderPicker, setShowOrderPicker] = useState(false);

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const subTotal = useMemo(
        () => items.reduce((acc, it) => acc + Number(it.quantity || 0) * Number(it.unit_price || 0), 0),
        [items],
    );
    const taxTotal = useMemo(
        () =>
            items.reduce(
                (acc, it) =>
                    acc + Number(it.quantity || 0) * Number(it.unit_price || 0) * (Number(it.tax_rate || 0) / 100),
                0,
            ),
        [items],
    );
    const grandTotal = useMemo(() => subTotal + taxTotal, [subTotal, taxTotal]);
    const remainingAmount = useMemo(() => Math.max(grandTotal - Number(paidAmount || 0), 0), [grandTotal, paidAmount]);
    const selectedPartyName = useMemo(() => {
        if (type.startsWith("sales")) return contacts.find((contact) => contact.id === customerId)?.name || "Musteri";
        return suppliers.find((supplier) => supplier.id === supplierId)?.name || "Tedarikci";
    }, [contacts, customerId, supplierId, suppliers, type]);

    async function loadData() {
        setLoading(true);
        const currentCompanyId = await resolveCompanyId();
        setCompanyId(currentCompanyId ?? "");

        if (!currentCompanyId) {
            setLoading(false);
            return;
        }

        const [custs, sups, ords] = await Promise.all([
            supabase.from("customers").select("id, name, email").eq("company_id", currentCompanyId).order("name"),
            supabase.from("suppliers").select("id, name").eq("company_id", currentCompanyId).order("name"),
            supabase
                .from("orders")
                .select("id, total_amount, customer_id, customers(id, name, email)")
                .eq("company_id", currentCompanyId)
                .order("created_at", { ascending: false })
                .limit(20),
        ]);

        setContacts(
            (custs.data ?? []).map((row) => ({
                id: row.id,
                name: row.name || "İsimsiz Musteri",
            })),
        );
        setSuppliers(
            (sups.data ?? []).map((row) => ({
                id: row.id,
                name: row.name || "İsimsiz Tedarikci",
            })),
        );
        setOrders((ords.data ?? []) as OrderOption[]);

        if (id && id !== "new") {
            const { data } = await supabase
                .from("invoices")
                .select("*, invoice_items(*)")
                .eq("id", id)
                .eq("company_id", currentCompanyId)
                .single();

            if (data) {
                setType(data.invoice_type || "sales");
                setNo(data.invoice_no || "");
                setDate(new Date(data.date).toISOString().split("T")[0]);
                setCustomerId(data.customer_id || "");
                setSupplierId(data.supplier_id || "");
                setOrderId(data.order_id || "");
                setStatus(data.status || "draft");
                setDueDate(data.due_date ? new Date(data.due_date).toISOString().split("T")[0] : "");
                setPaidAmount(Number(data.paid_amount || 0));
                setPaymentMethod(data.payment_method || "");
                setNotes(data.notes || "");
                setItems(
                    (data.invoice_items ?? []).map((item: any) => ({
                        id: item.id,
                        description: item.description || "",
                        quantity: Number(item.quantity || 1),
                        unit_price: Number(item.unit_price || 0),
                        tax_rate: Number(item.tax_rate || 20),
                    })),
                );
            }
        } else {
            setNo(await nextInvoiceNo());
            setItems([emptyItem()]);
        }

        setLoading(false);
    }

    function handlePrint() {
        window.print();
    }

    async function handleImportFromOrder(orderId: string) {
        const { data: order } = await supabase
            .from("orders")
            .select("customer_id, order_items(*)")
            .eq("id", orderId)
            .single();

        if (!order) return;

        setCustomerId(order.customer_id || "");
        setOrderId(orderId);
        setItems(
            (order.order_items ?? []).map((item: any) => ({
                description: `${item.product_type || "Urun"} - ${item.width_cm || 0}x${item.height_cm || 0} cm`,
                quantity: Number(item.qty || 1),
                unit_price: Number(item.unit_price || 0),
                tax_rate: 20,
            })),
        );
        setShowOrderPicker(false);
    }

    function updateItem(index: number, patch: Partial<InvoiceItem>) {
        setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }

    async function handleSave() {
        if (!companyId) return;

        setSaving(true);
        try {
            const invoiceData = {
                company_id: companyId,
                order_id: orderId || null,
                invoice_type: type,
                invoice_no: no,
                date: new Date(date).toISOString(),
                due_date: dueDate ? new Date(dueDate).toISOString() : null,
                customer_id: customerId || null,
                supplier_id: supplierId || null,
                status,
                paid_amount: paidAmount,
                remaining_amount: remainingAmount,
                payment_method: paymentMethod || null,
                notes,
                total_tax_exclusive: subTotal,
                total_tax_amount: taxTotal,
                total_tax_inclusive: grandTotal,
            };

            const itemsToSave = items.map((item) => ({
                description: item.description || "Urun/Hizmet",
                quantity: item.quantity,
                unit_price: item.unit_price,
                tax_rate: item.tax_rate,
                line_total: item.quantity * item.unit_price * (1 + item.tax_rate / 100),
            }));

            // Use atomic RPC function for invoice save
            const invoiceId = id === "new" ? null : id;
            const { data, error } = await supabase.rpc("record_invoice_save", {
                p_company_id: companyId,
                p_invoice_id: invoiceId,
                p_invoice_data: invoiceData,
                p_items_data: itemsToSave,
            });

            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || "Fatura kaydedilemedi.");

            // Log audit trail (fire-and-forget, don't block if it fails)
            logAction("invoice_saved", "invoice", data.invoice_id || invoiceId || "", {
                invoice_type: invoiceData.invoice_type,
                total: invoiceData.total_tax_inclusive,
                items_count: items.length,
                timestamp: new Date().toISOString()
            }).catch(err => console.error("Audit log failed:", err));

            // Send invoice notification email to customer (fire-and-forget)
            if (type === "sales" && customerId) {
              const customer = contacts.find(c => c.id === customerId);
              if (customer?.email) {
                notifyInvoiceCreated({
                  customerEmail: customer.email,
                  customerName: customer.name || "Müşteri",
                  invoiceNumber: no,
                  invoiceId: data.invoice_id || invoiceId || "",
                  totalAmount: invoiceData.total_tax_inclusive,
                  dueDate: dueDate,
                  itemsCount: items.length,
                }).catch(err => console.error("Invoice notification failed:", err));
              }
            }

            nav("/invoices");
        } catch (e: any) {
            alert(e?.message ?? "Fatura kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    function handlePdfPreview() {
        const rows = items
            .map(
                (item) => `
                    <tr>
                        <td>${item.description || "Urun/Hizmet"}</td>
                        <td>${item.quantity}</td>
                        <td>${formatMoney(item.unit_price)}</td>
                        <td>%${item.tax_rate}</td>
                        <td>${formatMoney(item.quantity * item.unit_price * (1 + item.tax_rate / 100))}</td>
                    </tr>`,
            )
            .join("");

        const win = window.open("", "_blank", "width=900,height=1100");
        if (!win) return;
        win.document.write(`
            <html>
                <head>
                    <title>${no || "Fatura"}</title>
                    <style>
                        body { font-family: Arial, sans-serif; color: #0f172a; padding: 32px; }
                        .top { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
                        h1 { margin: 0 0 8px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #cbd5e1; padding: 10px; font-size: 13px; text-align: left; }
                        th { background: #f1f5f9; }
                        .totals { margin-left: auto; margin-top: 24px; width: 320px; }
                        .line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
                        .grand { font-weight: 800; font-size: 18px; }
                    </style>
                </head>
                <body>
                    <div class="top">
                        <div>
                            <h1>Fatura</h1>
                            <div>No: ${no || "-"}</div>
                            <div>Tarih: ${date}</div>
                            <div>Vade: ${dueDate || "-"}</div>
                        </div>
                        <div>
                            <strong>${selectedPartyName}</strong>
                            <div>Siparis: ${orderId ? `#${orderId.slice(0, 8)}` : "-"}</div>
                            <div>Odeme: ${paymentMethod || "-"}</div>
                        </div>
                    </div>
                    <table>
                        <thead><tr><th>Aciklama</th><th>Miktar</th><th>Birim</th><th>KDV</th><th>Toplam</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                    <div class="totals">
                        <div class="line"><span>Ara Toplam</span><strong>${formatMoney(subTotal)}</strong></div>
                        <div class="line"><span>KDV</span><strong>${formatMoney(taxTotal)}</strong></div>
                        <div class="line grand"><span>Genel Toplam</span><span>${formatMoney(grandTotal)}</span></div>
                        <div class="line"><span>Tahsil Edilen</span><strong>${formatMoney(Number(paidAmount || 0))}</strong></div>
                        <div class="line"><span>Kalan Bakiye</span><strong>${formatMoney(remainingAmount)}</strong></div>
                    </div>
                </body>
            </html>
        `);
        win.document.close();
        win.focus();
    }

    function handleWhatsAppShare() {
        const text = [
            `Fatura: ${no || "-"}`,
            `Musteri: ${selectedPartyName}`,
            `Toplam: ${formatMoney(grandTotal)}`,
            `Tahsil edilen: ${formatMoney(Number(paidAmount || 0))}`,
            `Kalan bakiye: ${formatMoney(remainingAmount)}`,
        ].join("\n");
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    }

    if (loading) {
        return <div className="p-6">Yukleniyor...</div>;
    }

    return (
        <div className="mx-auto max-w-5xl pb-24">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                    onClick={() => nav("/invoices")}
                    className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900 no-print"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Listeye Don
                </button>

                <div className="flex flex-col gap-3 sm:flex-row no-print">
                    {id === "new" ? (
                        <div className="relative">
                            <button
                                onClick={() => setShowOrderPicker((prev) => !prev)}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 py-3 text-sm font-medium text-blue-600 transition hover:bg-blue-50 sm:w-auto sm:py-2"
                            >
                                <ShoppingCart className="h-4 w-4" />
                                Siparisten Aktar
                            </button>
                            {showOrderPicker ? (
                                <div className="absolute right-0 top-full z-[100] mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                                    <div className="mb-2 text-xs font-bold uppercase text-slate-400">Son Siparisler</div>
                                    <div className="space-y-1">
                                        {orders.map((order) => (
                                            <button
                                                key={order.id}
                                                onClick={() => handleImportFromOrder(order.id)}
                                                className="w-full rounded-lg p-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                            >
                                                <div className="text-sm font-semibold">{toPartyName(order.customers)}</div>
                                                <div className="text-[11px] text-slate-500">
                                                    #{order.id.slice(0, 8)} - {formatMoney(Number(order.total_amount || 0))}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <button
                        onClick={handlePdfPreview}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 sm:w-auto sm:py-2"
                    >
                        <Eye className="h-4 w-4" />
                        PDF Önizleme
                    </button>
                    <button
                        onClick={handleWhatsAppShare}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 px-4 py-3 text-emerald-700 transition hover:bg-emerald-50 sm:w-auto sm:py-2"
                    >
                        <Send className="h-4 w-4" />
                        WhatsApp
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 sm:w-auto sm:py-2"
                    >
                        <Printer className="h-4 w-4" />
                        Yazdır
                    </button>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-white shadow-lg transition hover:bg-primary-700 disabled:opacity-70 sm:w-auto sm:py-2"
                    >
                        <Save className="h-5 w-5" />
                        {saving ? "Kaydediliyor..." : "Kaydet"}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                        <h2 className="mb-4 text-lg font-bold">Fatura Bilgileri</h2>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Fatura Tipi</label>
                                <select
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50"
                                    value={type}
                                    onChange={(e) => setType(e.target.value)}
                                >
                                    <option value="sales">Satis Faturasi</option>
                                    <option value="purchase">Alis Faturasi</option>
                                    <option value="sales_return">Satis Iade</option>
                                    <option value="purchase_return">Alis Iade</option>
                                </select>
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Fatura No</label>
                                <input
                                    type="text"
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={no}
                                    onChange={(e) => setNo(e.target.value)}
                                    placeholder="FAT202600001"
                                />
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Tarih</label>
                                <input
                                    type="date"
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Vade Tarihi</label>
                                <input
                                    type="date"
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Sipariş Bağlantısı</label>
                                <input
                                    type="text"
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={orderId ? `#${orderId.slice(0, 8)}` : ""}
                                    readOnly
                                    placeholder="Siparişten aktarılmadı"
                                />
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Durum</label>
                                <select
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value)}
                                >
                                    <option value="draft">Taslak</option>
                                    <option value="sent">Kesildi</option>
                                    <option value="partial">Kısmi Ödendi</option>
                                    <option value="paid">Tam Ödendi</option>
                                    <option value="overdue">Gecikmiş</option>
                                    <option value="cancelled">İptal</option>
                                </select>
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Ödeme Yöntemi</label>
                                <select
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={paymentMethod}
                                    onChange={(e) => setPaymentMethod(e.target.value)}
                                >
                                    <option value="">Seçilmedi</option>
                                    <option value="nakit">Nakit</option>
                                    <option value="kredi_karti">Kredi Kartı</option>
                                    <option value="havale_eft">Havale/EFT</option>
                                    <option value="cek_senet">Çek/Senet</option>
                                </select>
                            </div>
                            <div>
                                <label className="px-1 text-xs font-semibold uppercase text-slate-500">Tahsil Edilen</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={paidAmount}
                                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <h2 className="text-lg font-bold">Kalemler</h2>
                            <button
                                onClick={() => setItems((prev) => [...prev, emptyItem()])}
                                className="inline-flex items-center gap-2 text-sm font-bold text-primary-600 hover:underline"
                            >
                                <Plus className="h-4 w-4" />
                                Satir Ekle
                            </button>
                        </div>

                        <div className="space-y-3">
                            {items.map((item, idx) => (
                                <div
                                    key={idx}
                                    className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/20"
                                >
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr),88px,120px,100px,48px] md:items-end">
                                        <div className="min-w-0">
                                            <label className="text-[10px] font-bold uppercase text-slate-400">Aciklama</label>
                                            <input
                                                type="text"
                                                className="mt-1 w-full border-b border-slate-200 bg-transparent p-2 focus:outline-none dark:border-slate-700"
                                                value={item.description}
                                                onChange={(e) => updateItem(idx, { description: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400">Miktar</label>
                                            <input
                                                type="number"
                                                className="mt-1 w-full border-b border-slate-200 bg-transparent p-2 focus:outline-none dark:border-slate-700"
                                                value={item.quantity}
                                                onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400">Birim Fiyat</label>
                                            <input
                                                type="number"
                                                className="mt-1 w-full border-b border-slate-200 bg-transparent p-2 focus:outline-none dark:border-slate-700"
                                                value={item.unit_price}
                                                onChange={(e) => updateItem(idx, { unit_price: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400">KDV %</label>
                                            <select
                                                className="mt-1 w-full border-b border-slate-200 bg-transparent p-2 focus:outline-none dark:border-slate-700"
                                                value={item.tax_rate}
                                                onChange={(e) => updateItem(idx, { tax_rate: Number(e.target.value) })}
                                            >
                                                <option value={20}>20</option>
                                                <option value={10}>10</option>
                                                <option value={1}>1</option>
                                                <option value={0}>0</option>
                                            </select>
                                        </div>
                                        <button
                                            onClick={() =>
                                                setItems((prev) => {
                                                    const next = prev.filter((_, index) => index !== idx);
                                                    return next.length > 0 ? next : [emptyItem()];
                                                })
                                            }
                                            className="rounded-lg p-2 text-red-500 transition hover:bg-red-50"
                                            title="Satiri sil"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                        <h2 className="mb-4 text-lg font-bold">Muhatap Bilgisi</h2>
                        {type.startsWith("sales") ? (
                            <div>
                                <label className="text-xs font-semibold uppercase text-slate-500">Musteri</label>
                                <select
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={customerId}
                                    onChange={(e) => setCustomerId(e.target.value)}
                                >
                                    <option value="">Secilmedi</option>
                                    {contacts.map((contact) => (
                                        <option key={contact.id} value={contact.id}>
                                            {contact.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div>
                                <label className="text-xs font-semibold uppercase text-slate-500">Tedarikci</label>
                                <select
                                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                >
                                    <option value="">Secilmedi</option>
                                    {suppliers.map((supplier) => (
                                        <option key={supplier.id} value={supplier.id}>
                                            {supplier.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-800">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm text-slate-500">
                                    <span>Müşteri / Tedarikçi</span>
                                    <span className="text-right font-semibold text-slate-700 dark:text-slate-200">{selectedPartyName}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-slate-500">
                                    <span>Sipariş</span>
                                    <span>{orderId ? `#${orderId.slice(0, 8)}` : "-"}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-slate-500">
                                    <span>Ara Toplam</span>
                                    <span>{formatMoney(subTotal)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-slate-500">
                                    <span>Toplam KDV</span>
                                    <span>{formatMoney(taxTotal)}</span>
                                </div>
                                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-lg font-bold text-slate-900 dark:border-slate-800 dark:text-white">
                                    <span>Genel Toplam</span>
                                    <span className="text-right break-words">{formatMoney(grandTotal)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-emerald-600">
                                    <span>Tahsil Edilen</span>
                                    <span className="font-bold">{formatMoney(Number(paidAmount || 0))}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-amber-600">
                                    <span>Kalan Bakiye</span>
                                    <span className="font-bold">{formatMoney(remainingAmount)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-slate-500">
                                    <span>Ödeme Yöntemi</span>
                                    <span>{paymentMethod || "-"}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                        <label className="text-xs font-semibold uppercase text-slate-500">Notlar ve Aciklamalar</label>
                        <textarea
                            className="mt-1 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Orn: vade bilgisi, banka detaylari..."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
