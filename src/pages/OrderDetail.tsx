import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { supabase, getEffectiveTenantContext } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import FieldInfoGallery from "../components/FieldInfoGallery";
import { parseFieldInfo } from "../utils/fieldInfo";
import { normalizeOrderStatus, ORDER_STATUS } from "../utils/order";
import { postSupplierDebt } from "../utils/supplierCari";
import { createFinanceService } from "../services/finance";

const financeService = createFinanceService();
import { 
    Plus, 
    Trash2, 
    Phone,
    Image as ImageIcon,
    PackageCheck,
    Pencil,
    X,
    Camera as CameraIcon,
    CheckCircle2,
} from "lucide-react";


type ProductType = "plicell" | "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "dikey_tul" | "dikey_stor" | "diger";

type OrderRow = {
    id: string;
    created_at: string | null;
    status: string | null;
    note?: string | null;
    total_amount: number | null;
    paid_amount?: number | null;
    deposit_amount?: number | null;
    remaining_amount?: number | null;
    fabric_cost?: number | null;
    mechanism_cost?: number | null;
    installation_cost?: number | null;
    labor_cost?: number | null;
    transport_cost?: number | null;
    customer_id?: string | null;
    company_id?: string | null;
    assigned_to?: string | null;
    delivery_due_date?: string | null;
    customers?: { name: string; phone: string; address?: string | null } | null;
};

type SupplierRow = { id: string; name: string | null };

type ProductCatalogRow = {
    id: string;
    name: string | null;
    category: string | null;
    unit_price: number | null;
    cost_price: number | null;
    min_area: number | null;
    rounding_rule: number | null;
    waste_rate: number | null;
};

type OrderItemRow = {
    id: string;
    product_type: ProductType | null;
    width_cm: number | null;
    height_cm: number | null;
    qty: number | null;
    unit_price: number | null;
    line_total: number | null;
    room: string | null;
    note: string | null;
    calculation_note?: string | null;
    fabric_width_cm?: number | null;
    supplier_id?: string | null;
    supplier_unit_cost?: number | null;
    supplier_total_cost?: number | null;
    supplier_transaction_id?: string | null;
    profit?: number | null;
    area_m2?: number | null;
    product_options?: Record<string, any> | null;
    suppliers?: SupplierRow | SupplierRow[] | null;
};

type VisualPreviewRow = {
    id: string;
    preview_image_url: string | null;
    original_photo_url: string | null;
    note: string | null;
    selected_catalog_variant_id: string | null;
    catalog_variant?: {
        variant_code: string | null;
        color_name: string | null;
        price_per_m2: number | null;
        texture_image_url: string | null;
        series?: {
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        } | Array<{
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        }> | null;
    } | Array<{
        variant_code: string | null;
        color_name: string | null;
        price_per_m2: number | null;
        texture_image_url: string | null;
        series?: {
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        } | Array<{
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        }> | null;
    }> | null;
};

type PaymentRow = {
    id: string;
    payment_date: string | null;
    amount: number | null;
    method: string | null;
    note: string | null;
};

type InstallationJobRow = {
    id: string;
    status: string | null;
    assigned_staff_id?: string | null;
    // Montaj Geçmişi timeline için (workflow şemasında garanti kolonlar):
    created_at?: string | null;
    updated_at?: string | null;
    scheduled_date?: string | null;
};

// Montaj Geçmişi olayı — mevcut veriden türetilir (yeni tablo/sorgu yok).
type InstallationTimelineEvent = {
    key: string;
    label: string;
    detail?: string | null;
    at?: string | null;
    done: boolean;
};

function fmtTimelineDate(value?: string | null): string {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("tr-TR");
}

function fmtTimelineDateTime(value?: string | null): string {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Montaj Geçmişi olaylarını mevcut yüklü veriden türetir (installation_jobs + order).
 * Yeni tablo/sorgu yok. Türetilemeyen alanlar TODO ile işaretli:
 *  - "Montajcı atandı" kesin zamanı: ayrı atama/audit kaydı gerekir (şimdilik zamansız).
 *  - "Tahmini teslim tarihi DEĞİŞTİ" geçmişi: değişiklik log'u gerekir; şimdilik güncel değer gösterilir.
 */
function buildInstallationTimeline(
    order: { delivery_due_date?: string | null } | null,
    job: InstallationJobRow | null,
    staffList: Array<{ id: string; full_name: string }>,
): InstallationTimelineEvent[] {
    if (!job) return [];
    const installerName = job.assigned_staff_id
        ? (staffList.find((s) => s.id === job.assigned_staff_id)?.full_name ?? "Montajcı")
        : null;
    const completed = normalizeOrderStatus(job.status) === ORDER_STATUS.COMPLETED;
    return [
        { key: "sent", label: "Montaja gönderildi", at: job.created_at ?? null, done: true },
        // TODO: kesin atama zamanı için atama/durum audit kaydı gerekir (şu an tablo yok).
        { key: "assigned", label: "Montajcı atandı", detail: installerName, at: null, done: !!job.assigned_staff_id },
        // TODO: tarih DEĞİŞİKLİK geçmişi için audit/log gerekir; şimdilik güncel değer gösterilir.
        { key: "delivery", label: "Tahmini teslim tarihi", detail: order?.delivery_due_date ? fmtTimelineDate(order.delivery_due_date) : null, at: null, done: !!order?.delivery_due_date },
        { key: "completed", label: "Montaj tamamlandı", at: completed ? (job.updated_at ?? null) : null, done: completed },
    ];
}

function fmtTL(n?: number | null) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(n ?? 0));
}

function staffRoleLabel(role: string) {
    if (role === "admin") return "Yönetici";
    if (role === "installer") return "Montajci";
    if (role === "accountant") return "Muhasebe";
    return "Personel";
}

function orderStatusLabel(status?: string | null) {
    const s = String(status ?? "").toLowerCase();
    if (s === "new_order") return "Yeni Sipariş";
    if (s === "montaja_hazir") return "Montaja Hazır";
    if (s === "montaj_planlandi") return "Montaj Planlandı";
    if (s === "montajda") return "Montajda";
    if (s === "montaj_tamamlandi") return "Montaj Tamamlandı";
    if (s === "installation_ready") return "Montaja Hazır";
    if (s === "installation_planned") return "Montaj Planlandı";
    if (s === "installing") return "Montajda";
    if (s === "installation_completed") return "Montaj Tamamlandı";
    if (s === "delivered_closed") return "Teslim Edildi / Kapandı";
    if (s === "measured") return "Ölçü Alındı";
    if (s === "quoted" || s === "draft") return "Teklif Verildi";
    if (s === "approved") return "Onaylandı";
    if (s === "production") return "İmalatta";
    if (s === "installation_waiting") return "Montaj Bekliyor";
    if (s === "completed") return "Tamamlandı";
    if (s === "paid") return "Ödendi";
    if (s === "partial") return "Kısmi Ödendi";
    if (s === "open") return "Açık";
    return status || "Sipariş";
}

function extractPhotoUrls(note?: string | null) {
    const matches = String(note ?? "").match(/https?:\/\/[^\s)]+/g) ?? [];
    return Array.from(new Set(matches.filter((url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url))));
}

function safeNumber(v: unknown, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function productLabel(t: ProductType | string | null | undefined) {
    switch (t) {
        case "plicell": return "Plicell";
        case "stor": return "Stor";
        case "zebra": return "Zebra";
        case "tul": return "Tül";
        case "fon": return "Fon";
        case "jalousie": return "Jaluzi";
        case "dikey_tul": return "Dikey Tül";
        case "dikey_stor": return "Dikey Stor";
        case "picasso": return "Picasso";
        default: return "Diğer";
    }
}

function computeLineItem(params: {
    width_cm: number;
    height_cm: number;
    qty: number;
    unit_price: number;
    supplier_unit_cost: number;
    // Ürün kartından gelen hesap kuralları (opsiyonel — yoksa eski davranış korunur)
    min_area?: number;
    rounding_rule?: number;
    waste_rate?: number;
}) {
    const w = Math.max(0, params.width_cm);
    const h = Math.max(0, params.height_cm);
    const qty = Math.max(1, params.qty);
    const unit = Math.max(0, params.unit_price);
    const purchaseUnit = Math.max(0, params.supplier_unit_cost);
    const rounding = Math.max(0, params.rounding_rule ?? 0);
    // Yuvarlama kuralı varsa en/boy yukarı yuvarlanır (ör. 10 cm); yoksa ham ölçü kullanılır
    const rw = rounding >= 1 ? Math.ceil(w / rounding) * rounding : w;
    const rh = rounding >= 1 ? Math.ceil(h / rounding) * rounding : h;
    let area = rw > 0 && rh > 0 ? (rw / 100) * (rh / 100) : 1;
    const waste = Math.max(0, params.waste_rate ?? 0);
    if (waste > 0) area = area * (1 + waste / 100);
    const minArea = Math.max(0, params.min_area ?? 0);
    // Eski taban (min 1 m²) korunur; ürün min. alanı bundan büyükse o uygulanır
    const effectiveArea = Math.max(area, 1, minArea);
    const line_total = effectiveArea * unit * qty;
    const supplier_total_cost = purchaseUnit * effectiveArea * qty;
    const profit = line_total - supplier_total_cost;
    return { area_m2: effectiveArea, line_total, supplier_total_cost, profit };
}

/** Ürün kategorisini ProductType'a normalize eder. */
function normalizeCategory(c: string | null | undefined): ProductType {
    const v = String(c ?? "").toLowerCase().trim();
    const valid = ["plicell", "stor", "zebra", "tul", "fon", "jalousie", "picasso", "dikey_tul", "dikey_stor", "diger"];
    return (valid.includes(v) ? v : "diger") as ProductType;
}

function supplierNameFromItem(item: OrderItemRow, suppliers: SupplierRow[]) {
    const joined = Array.isArray(item.suppliers) ? item.suppliers[0] : item.suppliers;
    if (joined?.name) return joined.name;
    return suppliers.find((s) => s.id === item.supplier_id)?.name || "—";
}

function canEditOrderLines(role: RoleState) {
    return role === "admin" || role === "accountant";
}

export default function OrderDetail() {
    const { id } = useParams<{ id: string }>();
    const nav = useNavigate();
    const [order, setOrder] = useState<OrderRow | null>(null);
    const [items, setItems] = useState<OrderItemRow[]>([]);
    const [role, setRole] = useState<RoleState>("unknown");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [staffList, setStaffList] = useState<Array<{ id: string; full_name: string; role: string; hasAccount: boolean }>>([]);
    const [assignedTo, setAssignedTo] = useState("");
    const [showNewInstaller, setShowNewInstaller] = useState(false);
    const [newInstallerName, setNewInstallerName] = useState("");
    const [newInstallerSaving, setNewInstallerSaving] = useState(false);
    const [visualPreviews, setVisualPreviews] = useState<VisualPreviewRow[]>([]);
    const [payments, setPayments] = useState<PaymentRow[]>([]);
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("nakit");
    const [paymentNote, setPaymentNote] = useState("");
    const [paymentError, setPaymentError] = useState("");
    const [paymentSuccess, setPaymentSuccess] = useState("");
    const [installationJob, setInstallationJob] = useState<InstallationJobRow | null>(null);
    const [workflowMessage, setWorkflowMessage] = useState("");
    const [workflowError, setWorkflowError] = useState("");
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [completingInstallation, setCompletingInstallation] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancellingOrder, setCancellingOrder] = useState(false);

    // Maliyet giriş alanları
    const [mechanismCostInput, setMechanismCostInput] = useState("");
    const [installationCostInput, setInstallationCostInput] = useState("");
    const [laborCostInput, setLaborCostInput] = useState("");
    const [transportCostInput, setTransportCostInput] = useState("");
    const [costSaving, setCostSaving] = useState(false);
    const [costSaveMsg, setCostSaveMsg] = useState("");

    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [supplierPrices, setSupplierPrices] = useState<Array<{ supplier_id: string; product_name: string | null; product_category: string | null; unit_cost: number | null }>>([]);
    const [itemFormError, setItemFormError] = useState("");
    const [editingItemId, setEditingItemId] = useState<string | null>(null);

    // Yeni Ürün Formu State
    const [pType, setPType] = useState<ProductType>("stor");
    const [pWidth, setPWidth] = useState("");
    const [pHeight, setPHeight] = useState("");
    const [pQty, setPQty] = useState("1");
    const [pPrice, setPPrice] = useState("");
    const [pPurchaseCost, setPPurchaseCost] = useState("");
    const [pSupplierId, setPSupplierId] = useState("");
    const [pRoom, setPRoom] = useState("");
    const [pNote, setPNote] = useState("");
    const [pModelName, setPModelName] = useState("");
    const [pColorName, setPColorName] = useState("");
    // Tedarikçi vade tarihi (opsiyonel) — order_items'ta DEĞİL, supplier_transactions.due_date'te tutulur.
    const [pSupplierDueDate, setPSupplierDueDate] = useState("");
    // Düzenleme açıldığında mevcut vade — dirty (kaydedilmemiş değişiklik) karşılaştırması için.
    const pSupplierDueDateInitRef = useRef("");
    // Ürün fotoğrafı state'leri
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string>("");
    const photoInputRef = useRef<HTMLInputElement>(null);
    // Ürün katalog seçimi (Ürünler / Fiyat Listesi'nden otomatik doldurma)
    const [productsCatalog, setProductsCatalog] = useState<ProductCatalogRow[]>([]);
    const [pProductId, setPProductId] = useState("");
    const [pMinArea, setPMinArea] = useState(0);
    const [pRounding, setPRounding] = useState(0);
    const [pWaste, setPWaste] = useState(0);

    async function loadData() {
        if (!id) return;
        setLoading(true);
        try {
            const { data: o } = await supabase.from("orders").select("*, customers(name, phone, address)").eq("id", id).single();
            const itemsRes = await supabase
                .from("order_items")
                .select("*, suppliers(id, name)")
                .eq("order_id", id)
                .order("created_at");
            let i = itemsRes.data;
            const itemsErr = itemsRes.error;
            if (itemsErr) {
                // Fallback: bazı kolonlar yoksa temel alanlarla dene
                const fb = await supabase
                    .from("order_items")
                    .select("id, product_type, width_cm, height_cm, qty, unit_price, line_total, room, note, supplier_id, supplier_unit_cost, supplier_total_cost, profit, area_m2, suppliers(id, name)")
                    .eq("order_id", id)
                    .order("created_at");
                i = fb.data;
            }

            if (o?.company_id) {
                const { data: supplierRows } = await supabase
                    .from("suppliers")
                    .select("id, name")
                    .eq("company_id", o.company_id)
                    .order("name", { ascending: true });
                setSuppliers((supplierRows ?? []) as SupplierRow[]);

                // Tedarikçi alış fiyat listesi (ürün/tedarikçi seçilince otomatik doldurma için).
                // product_category kolonu bazı kurulumlarda yoktur — fallback ile yine de çekilir.
                let priceRes: any = await supabase
                    .from("supplier_product_prices")
                    .select("supplier_id,product_name,product_category,unit_cost")
                    .eq("company_id", o.company_id);
                if (priceRes.error) {
                    priceRes = await supabase
                        .from("supplier_product_prices")
                        .select("supplier_id,product_name,unit_cost")
                        .eq("company_id", o.company_id);
                }
                if (priceRes.error) {
                    priceRes = await supabase
                        .from("supplier_product_prices")
                        .select("supplier_id,product_type,unit_price")
                        .eq("company_id", o.company_id);
                    if (!priceRes.error) {
                        priceRes = { data: (priceRes.data ?? []).map((p: any) => ({ supplier_id: p.supplier_id, product_name: p.product_type ?? null, product_category: p.product_type ?? null, unit_cost: p.unit_price ?? 0 })), error: null };
                    }
                }
                setSupplierPrices(priceRes.error ? [] : ((priceRes.data ?? []) as typeof supplierPrices));

                // Ürün kataloğu (ürün seçilince tedarikçi/alış fiyatı/hesap kuralları otomatik gelsin).
                // Eksik kolona karşı kademeli fallback. NOT: bazı kurulumlarda products.cost_price
                // kolonu YOKTUR (alış fiyatı supplier_product_prices'tan gelir) — bu yüzden
                // cost_price'sız varyantlar da denenir, aksi hâlde katalog hiç yüklenmez.
                const PRODUCT_SELECTS = [
                    "id,name,category,unit_price,cost_price,min_area,rounding_rule,waste_rate,is_active",
                    "id,name,category,unit_price,cost_price,min_area,rounding_rule,is_active",
                    "id,name,category,unit_price,cost_price,is_active",
                    "id,name,category,unit_price,min_area,rounding_rule,is_active",
                    "id,name,category,unit_price,is_active",
                    "id,name,category,unit_price",
                ];
                let prodRes: any = { data: null, error: { message: "init" } };
                for (const sel of PRODUCT_SELECTS) {
                    prodRes = await supabase
                        .from("products")
                        .select(sel)
                        .eq("company_id", o.company_id)
                        .order("name", { ascending: true });
                    if (!prodRes.error) break;
                }
                const catalog = prodRes.error ? [] : ((prodRes.data ?? []) as any[]).filter((p) => p.is_active !== false);
                setProductsCatalog(catalog as ProductCatalogRow[]);
            } else {
                setSuppliers([]);
                setSupplierPrices([]);
                setProductsCatalog([]);
            }
            const { data: previews } = await supabase
                .from("visual_previews")
                .select("id, preview_image_url, original_photo_url, note, selected_catalog_variant_id, catalog_variant:catalog_variants(variant_code, color_name, price_per_m2, texture_image_url, series:catalog_series(product_type, series_code, model_name))")
                .eq("order_id", id)
                .order("created_at", { ascending: false });
            const { data: paymentRows } = await supabase
                .from("payments")
                .select("id,payment_date,amount,method,note")
                .eq("order_id", id)
                .order("payment_date", { ascending: false });
            const { data: jobRow } = await supabase
                .from("installation_jobs")
                .select("id,status,assigned_staff_id,created_at,updated_at,scheduled_date")
                .eq("order_id", id)
                .maybeSingle();
            
            setOrder(o);
            setItems(i ?? []);
            setVisualPreviews((previews ?? []) as VisualPreviewRow[]);
            setPayments((paymentRows ?? []) as PaymentRow[]);
            // Maliyet giriş alanlarını mevcut değerlerle doldur (null → "0")
            setMechanismCostInput(String(o?.mechanism_cost ?? 0));
            setInstallationCostInput(String(o?.installation_cost ?? 0));
            setLaborCostInput(String(o?.labor_cost ?? 0));
            setTransportCostInput(String(o?.transport_cost ?? 0));
            setInstallationJob((jobRow ?? null) as InstallationJobRow | null);
            setAssignedTo(jobRow?.assigned_staff_id || o?.assigned_to || "");

            // ── Eski kayıt backfill (güvenli, best-effort) ────────────────────────────
            // Montajcı atanmadan tamamlanmış (ör. "Hülya Telek") eski completed job'lar:
            //   - assigned_staff_id boş + order.assigned_to dolu → montajcıyı bağla (backfill)
            //   - installer_fee boş/0 → order.installation_cost (montaj bedeli) ile doldur
            // Böylece hakediş InstallerLedger earned'a düşer. Montajcı HİÇ yoksa OTOMATİK
            // bağlama YOK — kullanıcı uyarılır. Yalnız var olan kaydın eksik alanları tamamlanır;
            // migration/RPC/yeni tablo yok, cari/ödeme mantığına dokunulmaz. İdempotent: alan
            // dolunca sonraki yüklemelerde koşul sağlanmaz.
            if (jobRow && jobRow.status === "completed" && !jobRow.assigned_staff_id) {
                const orderAssignee = o?.assigned_to || "";
                if (orderAssignee) {
                    await supabase.from("installation_jobs")
                        .update({ assigned_staff_id: orderAssignee })
                        .eq("id", jobRow.id)
                        .then(() => {}, () => {});
                    const montajFee = Math.max(0, safeNumber(o?.installation_cost));
                    if (montajFee > 0) {
                        const { data: feeRow, error: feeErr } = await supabase
                            .from("installation_jobs")
                            .select("installer_fee")
                            .eq("id", jobRow.id)
                            .maybeSingle();
                        if (!feeErr && feeRow && safeNumber(feeRow.installer_fee) <= 0) {
                            await supabase.from("installation_jobs")
                                .update({ installer_fee: montajFee })
                                .eq("id", jobRow.id)
                                .then(() => {}, () => {});
                        }
                    }
                    setInstallationJob((prev) => prev ? { ...prev, assigned_staff_id: orderAssignee } : prev);
                    setAssignedTo(orderAssignee);
                } else {
                    setWorkflowError("Bu montaj, montajcı atanmadan tamamlanmış. Hakedişin montajcı cariye düşmesi için önce montajcı atayın.");
                }
            }

            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: prof } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
                if (prof) {
                    setRole(normalizeRole(prof.role));
                }

                const { data: companyMember } = await supabase
                    .from("company_members")
                    .select("company_id")
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (companyMember?.company_id) {
                    const { data: members } = await supabase
                        .from("company_members")
                        .select("user_id")
                        .eq("company_id", companyMember.company_id);

                    const { data: employees } = await supabase
                        .from("employees")
                        .select("id,user_id,full_name,target_role,is_active")
                        .eq("company_id", companyMember.company_id)
                        .eq("is_active", true)
                        .order("full_name");

                    const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean);
                    const employeeUserIds = (employees ?? []).map((employee: any) => employee.user_id).filter(Boolean);
                    const allUserIds = Array.from(new Set([...userIds, ...employeeUserIds]));
                    if (allUserIds.length > 0 || (employees ?? []).length > 0) {
                        let profiles: any[] = [];
                        if (allUserIds.length > 0) {
                            const profileRes = await supabase
                                .from("profiles")
                                .select("user_id, full_name, role")
                                .in("user_id", allUserIds)
                                .order("full_name");
                            profiles = profileRes.data ?? [];
                        }

                        const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
                        const mergedStaff = new Map<string, { id: string; full_name: string; role: string; hasAccount: boolean }>();

                        (profiles ?? []).forEach((item) => {
                            mergedStaff.set(item.user_id, {
                                id: item.user_id,
                                full_name: item.full_name || "İsimsiz",
                                role: item.role || "installer",
                                hasAccount: true,
                            });
                        });

                        (employees ?? []).forEach((employee: any) => {
                            // Hesabı olan montajcı user_id ile, olmayan employee.id ile listelenir.
                            // (orders.assigned_to FK'sı yalnızca user_id kabul eder; hesabı olmayanlar
                            //  montaj takibi/cari tarafına employee.id ile bağlanır)
                            const staffId = employee.user_id || employee.id;
                            const profile = employee.user_id ? profileById.get(employee.user_id) : null;
                            mergedStaff.set(staffId, {
                                id: staffId,
                                full_name: employee.full_name || profile?.full_name || "İsimsiz",
                                role: profile?.role || employee.target_role || "installer",
                                hasAccount: Boolean(employee.user_id),
                            });
                        });

                        setStaffList(Array.from(mergedStaff.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")));
                    }
                }
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }

    useEffect(() => {
        loadData();
        // `loadData` is intentionally excluded to prevent unnecessary reruns.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const previewLine = useMemo(() => computeLineItem({
        width_cm: safeNumber(pWidth),
        height_cm: safeNumber(pHeight),
        qty: safeNumber(pQty, 1),
        unit_price: safeNumber(pPrice),
        supplier_unit_cost: safeNumber(pPurchaseCost),
        min_area: pMinArea,
        rounding_rule: pRounding,
        waste_rate: pWaste,
    }), [pWidth, pHeight, pQty, pPrice, pPurchaseCost, pMinArea, pRounding, pWaste]);

    const orderPhotoUrls = useMemo(() => {
        const urls = new Set<string>();
        if (order) {
            extractPhotoUrls(order.note).forEach(u => urls.add(u));
        }
        items.forEach(it => {
            extractPhotoUrls(it.note).forEach(u => urls.add(u));
        });
        return Array.from(urls);
    }, [order, items]);

    function resetItemForm() {
        setEditingItemId(null);
        setPType("stor");
        setPWidth("");
        setPHeight("");
        setPQty("1");
        setPPrice("");
        setPPurchaseCost("");
        setPSupplierId("");
        setPRoom("");
        setPNote("");
        setPModelName("");
        setPColorName("");
        setPProductId("");
        setPMinArea(0);
        setPRounding(0);
        setPWaste(0);
        setItemFormError("");
        setPhoto(null);
        setPhotoPreview("");
        setPSupplierDueDate("");
        pSupplierDueDateInitRef.current = "";
    }

    async function startEditItem(item: OrderItemRow) {
        setEditingItemId(item.id);
        setPType((item.product_type || "stor") as ProductType);
        setPWidth(String(item.width_cm ?? ""));
        setPHeight(String(item.height_cm ?? ""));
        setPQty(String(item.qty ?? 1));
        setPPrice(String(item.unit_price ?? ""));
        setPPurchaseCost(String(item.supplier_unit_cost ?? ""));
        setPSupplierId(item.supplier_id || "");
        setPRoom(item.room || "");
        
        // Extract photo from item.note
        const urls = extractPhotoUrls(item.note);
        const itemPhotoUrl = urls[0] || "";
        setPhotoPreview(itemPhotoUrl);
        setPhoto(null);

        // Remove the photo url from the displayed note
        const textNote = item.note ? item.note.replace(/https?:\/\/[^\s)]+/g, "").trim() : "";
        setPNote(textNote);

        // product_options içinden model/renk al
        const opts = item.product_options ?? {};
        setPModelName(opts.model_name ?? opts.product_name ?? "");
        setPColorName(opts.color_name ?? "");
        // Mevcut satır düzenlenirken kayıtlı ölçü/tutar korunur (yeni hesap kuralı uygulanmaz)
        setPProductId("");
        setPMinArea(0);
        setPRounding(0);
        setPWaste(0);
        setItemFormError("");
        window.scrollTo({ top: 0, behavior: "smooth" });

        // Mevcut tedarikçi borcunun vadesini (supplier_transactions.due_date) forma yansıt.
        // Migration/yeni tablo yok; var olan kayıttan SADECE due_date okunur (update/insert yok).
        // Öncelik: kaleme bağlı supplier_transaction_id. Yoksa (ör. NewOrder'dan gelen,
        // order_item'a bağlanmamış borçlar) → order_id + supplier_id + 'debt' ile en güncel
        // borcun vadesini fallback olarak oku. Bulunamazsa alan boş kalır.
        let dueInit = "";
        if (item.supplier_transaction_id) {
            const { data: tx } = await supabase
                .from("supplier_transactions")
                .select("due_date")
                .eq("id", item.supplier_transaction_id)
                .maybeSingle();
            dueInit = tx?.due_date ? String(tx.due_date).slice(0, 10) : "";
        } else if (id && item.supplier_id) {
            const { data: tx } = await supabase
                .from("supplier_transactions")
                .select("due_date")
                .eq("order_id", id)
                .eq("supplier_id", item.supplier_id)
                .eq("transaction_type", "debt")
                .order("transaction_date", { ascending: false })
                .limit(1)
                .maybeSingle();
            dueInit = tx?.due_date ? String(tx.due_date).slice(0, 10) : "";
        }
        setPSupplierDueDate(dueInit);
        pSupplierDueDateInitRef.current = dueInit;
    }

    function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0] ?? null;
        setPhoto(file);
        if (photoPreview && !photoPreview.startsWith("data:")) URL.revokeObjectURL(photoPreview);

        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target?.result as string;
                setPhotoPreview(base64);
            };
            reader.readAsDataURL(file);
        } else {
            setPhotoPreview("");
        }
    }

    async function handlePhotoPick() {
        if (!Capacitor.isNativePlatform()) {
            photoInputRef.current?.click();
            return;
        }

        try {
            const captured = await CapacitorCamera.getPhoto({
                quality: 80,
                resultType: CameraResultType.Uri,
                source: CameraSource.Prompt,
                saveToGallery: false,
                promptLabelHeader: "Fotoğraf ekle",
                promptLabelPhoto: "Kameradan çek",
                promptLabelPicture: "Galeriden seç",
            });

            if (!captured.webPath) return;
            const response = await fetch(captured.webPath);
            const blob = await response.blob();
            const extension = captured.format || blob.type.split("/")[1] || "jpg";
            const file = new File([blob], `olcu-fotografi-${Date.now()}.${extension}`, { type: blob.type || `image/${extension}` });

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target?.result as string;
                setPhoto(file);
                setPhotoPreview(base64);
            };
            reader.readAsDataURL(file);
        } catch (err: any) {
            const message = String(err?.message ?? err ?? "");
            if (!/cancel|cancelled|canceled|dismiss/i.test(message)) {
                alert(`Fotoğraf alınamadı: ${message || "Kamera açılamadı."}`);
            }
        }
    }

    async function uploadPhoto(companyId: string) {
        let fileToUpload = photo;

        if (!fileToUpload && photoPreview.startsWith("data:")) {
            try {
                const res = await fetch(photoPreview);
                const blob = await res.blob();
                const name = `olcu-${Date.now()}.jpg`;
                fileToUpload = new File([blob], name, { type: blob.type });
            } catch {
                return { url: null as string | null, warning: "" };
            }
        }

        if (!fileToUpload) {
            if (photoPreview && /^https?:\/\//i.test(photoPreview)) return { url: photoPreview, warning: "" };
            return { url: null as string | null, warning: "" };
        }

        const safeName = fileToUpload.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const path = `${companyId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("measurement-photos").upload(path, fileToUpload, { upsert: false });
        if (uploadError) return { url: null, warning: `Fotoğraf kaydı atlandı: ${uploadError.message}` };
        const { data } = supabase.storage.from("measurement-photos").getPublicUrl(path);
        return { url: data.publicUrl, warning: "" };
    }

    /** Seçili ürün için varsayılan tedarikçi ve alış fiyatını bulur. */
    function defaultSupplierForProduct(p: ProductCatalogRow): { supplierId: string; cost: number } {
        const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("tr-TR");
        const nameN = norm(p.name);
        const catN = norm(p.category);
        const labelN = norm(productLabel(normalizeCategory(p.category)));
        const productCost = safeNumber(p.cost_price);
        const matches = supplierPrices.filter((price) => {
            const pn = norm(price.product_name);
            const pc = norm(price.product_category);
            return (!!nameN && pn === nameN) || pc === catN || pc === labelN || pn === catN || pn === labelN;
        });
        // Fiyatı dolu olan eşleşmeyi tercih et; yoksa ilk eşleşmeyi al
        const hit = matches.find((m) => safeNumber(m.unit_cost) > 0) ?? matches[0];
        if (hit) {
            const hitCost = safeNumber(hit.unit_cost);
            // Tedarikçi fiyatı boşsa ürün kartındaki alış fiyatına (cost_price) düş
            return { supplierId: hit.supplier_id, cost: hitCost > 0 ? hitCost : productCost };
        }
        return { supplierId: "", cost: productCost };
    }

    /**
     * Fiyat Listesi'nden ürün seçilince formu otomatik doldurur:
     * ürün türü, varsayılan tedarikçi, alış fiyatı, hesap kuralları (min alan/yuvarlama/fire)
     * ve önerilen satış fiyatı. Kullanıcı sonra tedarikçi/fiyatı değiştirebilir.
     */
    function applyCatalogProduct(productId: string) {
        setPProductId(productId);
        if (!productId) return;
        const p = productsCatalog.find((x) => x.id === productId);
        if (!p) return;
        setPType(normalizeCategory(p.category));
        setPModelName(p.name || "");
        setPMinArea(safeNumber(p.min_area));
        setPRounding(safeNumber(p.rounding_rule));
        setPWaste(safeNumber(p.waste_rate));
        if (p.unit_price != null && safeNumber(p.unit_price) > 0) setPPrice(String(safeNumber(p.unit_price)));
        const def = defaultSupplierForProduct(p);
        setPSupplierId(def.supplierId);
        setPPurchaseCost(def.cost > 0 ? String(def.cost) : "");
    }

    // ── Kaydedilmemiş değişiklik takibi ───────────────────────────────────────
    const editingOriginal = useMemo(
        () => items.find((i) => i.id === editingItemId) ?? null,
        [items, editingItemId],
    );
    const itemFormDirty = useMemo(() => {
        if (editingItemId && editingOriginal) {
            const o = editingOriginal;
            const opts = o.product_options ?? {};
            return (
                pType !== ((o.product_type || "stor") as ProductType) ||
                pWidth !== String(o.width_cm ?? "") ||
                pHeight !== String(o.height_cm ?? "") ||
                pQty !== String(o.qty ?? 1) ||
                pPrice !== String(o.unit_price ?? "") ||
                pPurchaseCost !== String(o.supplier_unit_cost ?? "") ||
                pSupplierId !== (o.supplier_id || "") ||
                pRoom !== (o.room || "") ||
                pNote !== (o.note || "") ||
                pModelName !== (opts.model_name ?? opts.product_name ?? "") ||
                pColorName !== (opts.color_name ?? "") ||
                pSupplierDueDate !== pSupplierDueDateInitRef.current
            );
        }
        // Yeni satır modu: anlamlı bir alan dolduysa kirli say
        return !!(pWidth || pHeight || pPrice || pModelName.trim() || pColorName.trim() || pRoom.trim() || pNote.trim() || pSupplierId || pSupplierDueDate);
    }, [editingItemId, editingOriginal, pType, pWidth, pHeight, pQty, pPrice, pPurchaseCost, pSupplierId, pRoom, pNote, pModelName, pColorName, pSupplierDueDate]);

    // Sayfa yenileme / kapatma / donanım geri tuşunda kaydedilmemiş değişiklik uyarısı
    useEffect(() => {
        if (!itemFormDirty) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [itemFormDirty]);

    async function recalcAndSaveOrderTotals(nextItems: OrderItemRow[]) {
        if (!id || !order) return;
        const salesTotal = nextItems.reduce((s, x) => s + safeNumber(x.line_total), 0);
        const purchaseTotal = nextItems.reduce((s, x) => s + safeNumber(x.supplier_total_cost), 0);
        const lineProfit = nextItems.reduce((s, x) => s + safeNumber(x.profit), 0);
        const paid = safeNumber(order.paid_amount ?? order.deposit_amount);
        const remaining = Math.max(salesTotal - paid, 0);

        const { error } = await supabase.from("orders").update({
            total_amount: salesTotal,
            supplier_total_cost: purchaseTotal,
            fabric_cost: purchaseTotal,
            gross_profit: lineProfit,
            profit: lineProfit,
            remaining_amount: remaining,
        }).eq("id", id);

        if (error) throw error;
    }

    async function postSupplierDebtForLine(params: {
        companyId: string;
        orderId: string;
        orderItemId: string;
        supplierId: string;
        amount: number;
        description: string;
        // Vade (opsiyonel): supplier varsayılan vadesi/manuel giriş eklenince iletilir.
        dueDate?: string | null;
        supplierDueDays?: number | null;
    }) {
        const result = await postSupplierDebt({
            companyId: params.companyId,
            orderId: params.orderId,
            supplierId: params.supplierId,
            amount: params.amount,
            description: params.description,
            orderItemId: params.orderItemId,
            dueDate: params.dueDate ?? null,
            supplierDueDays: params.supplierDueDays ?? null,
        });
        if (result.status === "error") {
            console.warn("Tedarikçi cari kaydı oluşturulamadı:", result.message);
        }
    }

    function supplierNameById(sid: string) {
        return suppliers.find((s) => s.id === sid)?.name || "Tedarikçi";
    }

    // Seçili ürün + tedarikçi için kayıtlı alış fiyatını bulur (yoksa null).
    function purchaseCostForSupplier(supplierId: string): number | null {
        if (!supplierId) return null;
        const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("tr-TR");
        const nameN = norm(pModelName);
        const labelN = norm(productLabel(pType));
        const typeN = norm(pType);
        const hit = supplierPrices.find((p) => {
            if (p.supplier_id !== supplierId) return false;
            const pn = norm(p.product_name);
            const pc = norm(p.product_category);
            return (!!nameN && pn === nameN) || pc === labelN || pc === typeN || pn === labelN || pn === typeN;
        });
        return hit ? safeNumber(hit.unit_cost) : null;
    }

    // Tedarikçi seçimi değişince alış fiyatını otomatik doldur (satış fiyatı sabit kalır).
    function applySupplierToForm(supplierId: string) {
        setPSupplierId(supplierId);
        const cost = purchaseCostForSupplier(supplierId);
        if (cost != null && cost > 0) setPPurchaseCost(String(cost));
    }

    function buildItemPayload(photoUrl?: string | null) {
        const w = safeNumber(pWidth);
        const h = safeNumber(pHeight);
        const q = Math.max(1, safeNumber(pQty, 1));
        const u = safeNumber(pPrice);
        const purchaseUnit = safeNumber(pPurchaseCost);
        const computed = computeLineItem({ width_cm: w, height_cm: h, qty: q, unit_price: u, supplier_unit_cost: purchaseUnit, min_area: pMinArea, rounding_rule: pRounding, waste_rate: pWaste });

        if (w <= 0 || h <= 0) throw new Error("En ve boy 0'dan büyük olmalı.");
        if (u <= 0) throw new Error("Birim fiyat 0'dan büyük olmalı.");

        const cleanNote = pNote.trim();
        const finalNote = [cleanNote, photoUrl].filter(Boolean).join("\n");

        // Saha bilgileri (field_info) kalemde tutulur; düzenlemede KAYBOLMASIN.
        const existingItem = editingItemId ? items.find((it) => it.id === editingItemId) : null;
        const existingFieldInfo = parseFieldInfo(existingItem?.product_options);

        return {
            product_type: pType,
            width_cm: w,
            height_cm: h,
            qty: q,
            unit_price: u,
            area_m2: computed.area_m2,
            line_total: computed.line_total,
            room: pRoom.trim() || null,
            note: finalNote || null,
            supplier_id: pSupplierId || null,
            supplier_unit_cost: purchaseUnit,
            supplier_total_cost: computed.supplier_total_cost,
            profit: computed.profit,
            product_options: {
                product_name: pModelName.trim() || "",
                model_name: pModelName.trim() || "",
                color_name: pColorName.trim() || "",
                swatch_photo_url: existingFieldInfo.swatch_photo_url,
                field_info: existingFieldInfo,
            },
        };
    }

    async function handleSaveItem() {
        if (!id || !order) return;
        setSaving(true);
        setItemFormError("");
        try {
            const companyId = order.company_id;
            if (!companyId) throw new Error("Şirket bilgisi bulunamadı.");

            const uploaded = await uploadPhoto(companyId);
            const payload = buildItemPayload(uploaded.url);

            // Tedarikçi vade tarihi (opsiyonel): boşsa null. Vade order_items'ta değil,
            // supplier_transactions.due_date'te tutulur.
            const manualDueDate = pSupplierDueDate.trim() ? pSupplierDueDate : null;

            if (editingItemId) {
                const { error } = await supabase
                    .from("order_items")
                    .update(payload)
                    .eq("id", editingItemId);
                if (error) throw error;

                // ── Tedarikçi cari senkronizasyonu ────────────────────────────────
                // Tedarikçi değişiminde mevcut borcu MUTASYONA UĞRATMAYIZ; çünkü eski
                // tedarikçiye ödeme yapılmış olabilir. Bunun yerine eski tedarikçiye
                // "iptal" (cancel) hareketi, yeni tedarikçiye temiz bir "borç" atarız.
                const oldItem = items.find((item) => item.id === editingItemId);
                const oldTxId = oldItem?.supplier_transaction_id;
                const oldSupplierId = oldItem?.supplier_id || "";
                const oldCost = safeNumber(oldItem?.supplier_total_cost);
                const newSupplierId = payload.supplier_id || "";
                const newCost = payload.supplier_total_cost;
                const custName = order.customers?.name || "Müşteri";
                const lineLabel = `${productLabel(payload.product_type)} (${payload.room || "Alan"})`;
                const refNo = id.slice(0, 8).toUpperCase();
                const nowIso = new Date().toISOString();

                if (oldSupplierId && newSupplierId && oldSupplierId === newSupplierId) {
                    // Aynı tedarikçi — yalnızca borç tutarını güncelle
                    if (oldTxId) {
                        // Mevcut borç korunur; tutar/açıklama ile birlikte yalnızca vade
                        // (due_date) metadata'sı güncellenir. Boşaltıldıysa null yazılır.
                        await supabase.from("supplier_transactions").update({
                            amount: newCost,
                            description: `Sipariş ürün güncellendi: ${custName} - ${lineLabel}`,
                            due_date: manualDueDate,
                        }).eq("id", oldTxId);
                    } else {
                        // Kalem cari harekete bağlı DEĞİL (ör. NewOrder'dan gelen toplu borç,
                        // order seviyesinde tek 'debt' olarak yazılır; kaleme bağlanmaz).
                        // Yeni TAM borç yaratmak çift sayım olur (toplu borç bu kalemi zaten içerir).
                        // Bunun yerine yalnız net farkı (delta) işleriz: artış → 'debt', azalış → 'cancel'.
                        // Mevcut borç mutasyona uğratılmaz (ödeme yapılmış olabilir).
                        const delta = newCost - oldCost;
                        if (delta > 0) {
                            await supabase.from("supplier_transactions").insert({
                                company_id: companyId,
                                supplier_id: newSupplierId,
                                order_id: id,
                                order_item_id: editingItemId,
                                transaction_date: nowIso,
                                transaction_type: "debt",
                                amount: delta,
                                description: `Sipariş ürün maliyeti arttı: ${custName} - ${lineLabel}`,
                                reference_no: refNo,
                                ...(manualDueDate ? { due_date: manualDueDate } : {}),
                            });
                        } else if (delta < 0) {
                            await supabase.from("supplier_transactions").insert({
                                company_id: companyId,
                                supplier_id: newSupplierId,
                                order_id: id,
                                order_item_id: editingItemId,
                                transaction_date: nowIso,
                                transaction_type: "cancel",
                                amount: -delta,
                                description: `Sipariş ürün maliyeti azaldı: ${custName} - ${lineLabel}`,
                                reference_no: refNo,
                            });
                        }
                        // delta === 0 → cari hareket gerekmez
                    }
                } else if (oldSupplierId !== newSupplierId) {
                    // Tedarikçi değişti / kaldırıldı / yeni eklendi
                    // 1) Eski tedarikçinin borcunu iptal et (ödeme yapılmışsa bakiye düzeltme hareketi)
                    if (oldSupplierId && oldCost > 0) {
                        await supabase.from("supplier_transactions").insert({
                            company_id: companyId,
                            supplier_id: oldSupplierId,
                            order_id: id,
                            order_item_id: editingItemId,
                            transaction_date: nowIso,
                            transaction_type: "cancel",
                            amount: oldCost,
                            description: newSupplierId
                                ? `Tedarikçi değişikliği: ${supplierNameById(oldSupplierId)} firmasından ${supplierNameById(newSupplierId)} firmasına aktarıldı (eski borç iptal)`
                                : `Tedarikçi kaldırıldı: ${custName} - ${lineLabel}`,
                            reference_no: refNo,
                        });
                    }
                    // 2) Yeni tedarikçiye borç işle (ya da tedarikçi kaldırıldıysa bağlantıyı temizle)
                    if (newSupplierId && newCost > 0) {
                        await postSupplierDebtForLine({
                            companyId, orderId: id, orderItemId: editingItemId,
                            supplierId: newSupplierId, amount: newCost,
                            description: oldSupplierId
                                ? `Tedarikçi değişikliği: ${supplierNameById(oldSupplierId)} firmasından ${supplierNameById(newSupplierId)} firmasına aktarıldı`
                                : `Sipariş ürün eklendi: ${custName} - ${lineLabel}`,
                            dueDate: manualDueDate,
                        });
                    } else {
                        await supabase.from("order_items").update({ supplier_transaction_id: null }).eq("id", editingItemId);
                    }
                }
            } else {
                const { data: inserted, error } = await supabase
                    .from("order_items")
                    .insert({ ...payload, order_id: id, company_id: companyId })
                    .select("id")
                    .single();
                if (error) throw error;

                if (payload.supplier_id) {
                    await postSupplierDebtForLine({
                        companyId,
                        orderId: id,
                        orderItemId: inserted.id,
                        supplierId: payload.supplier_id,
                        amount: payload.supplier_total_cost,
                        description: `Sipariş ürün eklendi: ${order.customers?.name || "Müşteri"} - ${productLabel(payload.product_type)} (${payload.room || "Alan"})`,
                        dueDate: manualDueDate,
                    });
                }
            }

            const { data: freshItems } = await supabase
                .from("order_items")
                .select("line_total, supplier_total_cost, profit")
                .eq("order_id", id);
            await recalcAndSaveOrderTotals((freshItems ?? []) as OrderItemRow[]);
            resetItemForm();
            await loadData();
        } catch (e: unknown) {
            setItemFormError(e instanceof Error ? e.message : "Ürün satırı kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteItem(itemId: string) {
        if (!id || !order) return;
        // window.confirm kaldırıldı
        setSaving(true);
        setItemFormError("");
        try {
            // Silinmeden önce tedarikçi cari iptal kaydı oluştur
            const itemToDelete = items.find((item) => item.id === itemId);
            if (itemToDelete?.supplier_id && safeNumber(itemToDelete.supplier_total_cost) > 0) {
                await supabase.from("supplier_transactions").insert({
                    company_id: order.company_id,
                    supplier_id: itemToDelete.supplier_id,
                    order_id: id,
                    order_item_id: itemId,
                    transaction_date: new Date().toISOString(),
                    transaction_type: "cancel",
                    amount: safeNumber(itemToDelete.supplier_total_cost),
                    description: `Sipariş satırı silindi: ${order.customers?.name || "Müşteri"} - ${productLabel(itemToDelete.product_type)} (${itemToDelete.room || "Alan"})`,
                    reference_no: id.slice(0, 8).toUpperCase(),
                });
            }

            const { error } = await supabase.from("order_items").delete().eq("id", itemId);
            if (error) throw error;
            if (editingItemId === itemId) resetItemForm();

            const { data: freshItems } = await supabase
                .from("order_items")
                .select("line_total, supplier_total_cost, profit")
                .eq("order_id", id);
            await recalcAndSaveOrderTotals((freshItems ?? []) as OrderItemRow[]);
            await loadData();
        } catch (e: unknown) {
            setItemFormError(e instanceof Error ? e.message : "Ürün satırı silinemedi.");
        } finally {
            setSaving(false);
        }
    }

    async function handleUpdateAssignedTo() {
        if (!id) return;
        setSaving(true);
        try {
            const selected = staffList.find((s) => s.id === assignedTo);

            // Montajcı DEĞİŞTİ mi + sipariş montaj tamamlanmış durumda mı? (aşağıda aşama sıfırlama için)
            const prevInstaller = installationJob?.assigned_staff_id || order?.assigned_to || "";
            const installerChanged = (assignedTo || "") !== prevInstaller;
            const wasCompleted = order?.status === "montaj_tamamlandi"
                || order?.status === "installation_completed"
                || installationJob?.status === "completed";

            // orders.assigned_to FK'sı auth.users'a bağlı — yalnızca hesabı olan
            // montajcılar yazılabilir; hesabı olmayanlarda alan boş bırakılır,
            // bağlantı montaj takibi üzerinden kurulur.
            const orderAssignee = selected?.hasAccount ? assignedTo : null;
            const { error } = await supabase.from("orders").update({ assigned_to: orderAssignee }).eq("id", id);
            if (error) {
                const isFK = /foreign key|fkey|assigned_to/i.test(error.message);
                alert(isFK ? "Montajcı atanamadı: Seçilen kişi sistemde kayıtlı kullanıcı değil." : error.message);
                return;
            }

            // Montaj Takibi + Montajcı Cari bağlantısı: bu siparişin montaj işine montajcıyı KESİN işle.
            // InstallerLedger hakedişi installation_jobs.assigned_staff_id kolonundan okur — aynı
            // kolona yazıyoruz. Hata artık sessizce yutulmuyor (0 satır = henüz job yok, hata değil).
            const jobUpdate = await supabase.from("installation_jobs")
                .update({ assigned_staff_id: assignedTo || null })
                .eq("order_id", id)
                .select("id");
            if (jobUpdate.error) {
                console.warn("[montaj-ata] installation_jobs.assigned_staff_id yazılamadı:", jobUpdate.error.message);
                alert("Montajcı siparişe atandı ancak montaj işine bağlanamadı: " + jobUpdate.error.message);
            } else {
                console.info("[montaj-ata] assigned_staff_id yazıldı:", { assignedTo, orderAssignee, etkilenenJob: jobUpdate.data?.length ?? 0 });
            }

            // Montajcı değiştiyse ve montaj TAMAMLANMIŞSA aşamayı BAŞA al: tamamlanmış iş eski
            // montajcıya bağlı kalmasın; yeni montajcının hakedişi için kullanıcı yeniden
            // "Montaj Tamamlandı"ya basmalı. Hakediş completed işten türediğinden, iş "waiting"e
            // dönünce eski hakediş otomatik düşer. Veri silinmez; yalnız status geri alınır.
            if (installerChanged && wasCompleted) {
                await supabase.from("installation_jobs")
                    .update({ status: "waiting" })
                    .eq("order_id", id)
                    .then(() => {}, () => {});
                await supabase.from("orders")
                    .update({ status: "installation_ready" })
                    .eq("id", id)
                    .then(() => {}, () => {});
                setWorkflowMessage("Montajcı değişti. Montaj aşaması sıfırlandı — tamamlamak için yeniden 'Montaj Tamamlandı'ya basın.");
            }

            await loadData();
        } finally {
            setSaving(false);
        }
    }

    async function handleAddInstaller() {
        const name = newInstallerName.trim();
        if (!name) { alert("Montajcı adı girin."); return; }
        if (!order?.company_id) return;
        setNewInstallerSaving(true);
        try {
            // Aynı isimle kayıtlı aktif montajcı varsa yenisini oluşturma, onu seç
            const existing = staffList.find((s) => s.full_name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"));
            if (existing) {
                setAssignedTo(existing.id);
                setNewInstallerName("");
                setShowNewInstaller(false);
                return;
            }

            const { data, error } = await supabase.from("employees").insert({
                company_id: order.company_id,
                full_name: name,
                target_role: "installer",
                is_active: true,
            }).select("id, full_name").single();
            if (error) {
                if (/duplicate|unique/i.test(String(error.message || ""))) {
                    alert("Bu isimde bir montajcı zaten kayıtlı. Listeden seçebilirsiniz.");
                    return;
                }
                throw error;
            }
            setStaffList((prev) =>
                [...prev, { id: data.id, full_name: data.full_name || name, role: "installer", hasAccount: false }]
                    .sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")));
            setAssignedTo(data.id);
            setNewInstallerName("");
            setShowNewInstaller(false);
        } catch {
            alert("Montajcı eklenemedi. Lütfen tekrar deneyin.");
        } finally {
            setNewInstallerSaving(false);
        }
    }

    async function handleSaveCosts() {
        if (!id) return;
        const mechCost    = Math.max(0, safeNumber(mechanismCostInput));
        const instCost    = Math.max(0, safeNumber(installationCostInput));
        const laborCost   = Math.max(0, safeNumber(laborCostInput));
        const transCost   = Math.max(0, safeNumber(transportCostInput));
        setCostSaving(true);
        setCostSaveMsg("");
        try {
            const { error } = await supabase
                .from("orders")
                .update({
                    mechanism_cost:    mechCost,
                    installation_cost: instCost,
                    labor_cost:        laborCost,
                    transport_cost:    transCost,
                })
                .eq("id", id);
            if (error) {
                // labor_cost / transport_cost sütunları henüz migration uygulanmamışsa
                // graceful fallback: sadece mevcut sütunları kaydet
                if (/labor_cost|transport_cost|column.*does not exist/i.test(error.message)) {
                    const { error: fallbackErr } = await supabase
                        .from("orders")
                        .update({ mechanism_cost: mechCost, installation_cost: instCost })
                        .eq("id", id);
                    if (fallbackErr) throw fallbackErr;
                    setOrder((prev) => prev ? { ...prev, mechanism_cost: mechCost, installation_cost: instCost } : prev);
                    setCostSaveMsg("⚠️ İşçilik/nakliye kaydedilemedi (migration bekleniyor). Diğer maliyetler kaydedildi.");
                    window.setTimeout(() => setCostSaveMsg(""), 5000);
                    return;
                }
                throw error;
            }
            setOrder((prev) => prev
                ? { ...prev, mechanism_cost: mechCost, installation_cost: instCost, labor_cost: laborCost, transport_cost: transCost }
                : prev
            );
            setCostSaveMsg("Maliyetler kaydedildi.");
            window.setTimeout(() => setCostSaveMsg(""), 3000);
        } catch (e: any) {
            setCostSaveMsg("Hata: " + (e?.message ?? "Kaydedilemedi."));
        } finally {
            setCostSaving(false);
        }
    }

    async function handleAddPayment() {
        if (!id || !order) return;
        const amount = Number(paymentAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setPaymentError("Tahsilat tutarı 0'dan büyük olmalı.");
            return;
        }

        setSaving(true);
        setPaymentError("");
        setPaymentSuccess("");
        try {
            // paid_amount/remaining_amount artik customer_record_collection RPC
            // tarafindan payments ledger'indan yeniden turetilerek yaziliyor.
            // orders.status ARTIK BU AKISTAN GUNCELLENMIYOR: bu kolon ayni zamanda
            // is akisi durumu (order.ts::ORDER_STATUS) icin de kullanildigindan,
            // RPC bilincli olarak status'a dokunmuyor (bkz. customerCollectionService.ts
            // basindaki arastirma notu — cakisma riski).
            const result = await financeService.customerCollections.recordCollection({
                companyId: order.company_id!,
                orderId: id,
                amount,
                method: paymentMethod,
                note: paymentNote || "Sipariş tahsilatı",
                idempotencyKey: crypto.randomUUID(),
            });
            if (result.status !== "success") {
                throw result.status === "error" ? result.error : new Error(result.reason);
            }

            const { isOverpayment, overpaymentAmount } = result.data;

            // Fazla tahsilat notu RPC'nin kapsamında degil (RPC yalnizca bilgi olarak
            // isOverpayment/overpaymentAmount doner) — mevcut davranisi korumak icin
            // ayri bir direkt yazim olarak burada tutuluyor.
            if (isOverpayment) {
                await supabase
                    .from("orders")
                    .update({
                        note: [order.note, `Fazla tahsilat / müşteri alacağı: ${fmtTL(overpaymentAmount)}`].filter(Boolean).join("\n"),
                    })
                    .eq("id", id);
            }

            setPaymentAmount("");
            setPaymentNote("");
            setShowPaymentForm(false);
            setPaymentSuccess(isOverpayment ? `Ödeme kaydedildi. Müşteri alacaklı: ${fmtTL(overpaymentAmount)}` : "Ödeme kaydedildi.");
            await loadData();
        } catch (e: any) {
            const msg = String(e?.message || "");
            setPaymentError(msg.includes("customer_record_collection")
                ? "Tahsilat servisi bulunamadı. supabase_customer_collection_finance_rpc.sql dosyasını SQL Editor'da çalıştırın."
                : (e?.message ?? "Ödeme kaydedilemedi."));
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-10 text-center font-bold">Yükleniyor...</div>;
    if (!order) return <div className="p-10 ">Sipariş bulunamadı.</div>;

    const salesTotal = items.reduce((s, x) => s + safeNumber(x.line_total), 0);
    const purchaseTotal = items.reduce((s, x) => s + safeNumber(x.supplier_total_cost), 0);
    const paid = Number(order.paid_amount ?? order.deposit_amount ?? 0);
    const remaining = Math.max(salesTotal - paid, 0);
    const overpayment = Math.max(paid - salesTotal, 0);
    const linesEditable = canEditOrderLines(role);
    const showCostColumns = role === "admin" || role === "accountant";
    const itemTableColSpan = 5 + (showCostColumns ? 2 : 0) + (linesEditable ? 1 : 0);

    async function handleMarkInstallationReady() {
        if (!id || !order) return;
        setSaving(true);
        setWorkflowError("");
        setWorkflowMessage("");
        try {
            if (installationJob) {
                setWorkflowError("Bu sipariş zaten montaj takibinde.");
                return;
            }

            const firstItem = items[0] ?? null;
            const productType = Array.from(new Set(items.map((item) => String(item.product_type ?? "").trim()).filter(Boolean))).join(", ");
            const room = Array.from(new Set(items.map((item) => item.room).filter(Boolean) as string[])).join(", ");
            const measurementNotes = items
                .map((item) => `${item.room || "Alan"}: ${item.width_cm || "-"}x${item.height_cm || "-"} cm x${item.qty || 1}`)
                .join("\n");

            const { data, error } = await supabase
                .from("installation_jobs")
                .insert([{
                    company_id: order.company_id,
                    order_id: id,
                    customer_id: order.customer_id || null,
                    customer_name: order.customers?.name || null,
                    phone: order.customers?.phone || null,
                    address: order.customers?.address || null,
                    product_type: productType || null,
                    room: room || null,
                    width: firstItem?.width_cm ?? null,
                    height: firstItem?.height_cm ?? null,
                    total_amount: Number(order.total_amount ?? salesTotal ?? 0),
                    notes: [order.note, measurementNotes].filter(Boolean).join("\n") || null,
                    status: "waiting",
                    // Siparişte montajcı seçildiyse montaj işine taşı
                    // (Montaj Takibi + Montajcı Cari bu alandan okur)
                    assigned_staff_id: assignedTo || order.assigned_to || null,
                }])
                .select("id,status")
                .single();

            if (error) {
                if (/installation_jobs|schema cache|could not find|does not exist/i.test(String(error.message || ""))) {
                    setWorkflowError("Montaj takip tablosu henüz Supabase'te yok veya schema cache yenilenmedi. Lütfen supabase_installation_workflow.sql migration dosyasını çalıştırın.");
                    return;
                }
                if (/duplicate|unique|installation_jobs_order_unique/i.test(String(error.message || ""))) {
                    setWorkflowError("Bu sipariş zaten montaj takibinde.");
                    return;
                }
                throw error;
            }

            const { error: updateError } = await supabase
                .from("orders")
                .update({ status: "installation_ready" })
                .eq("id", id);
            if (updateError) throw updateError;

            setInstallationJob(data as InstallationJobRow);
            setOrder((prev) => prev ? { ...prev, status: "installation_ready" } : prev);
            setWorkflowMessage("Sipariş Montaj Takibi'ne aktarıldı.");
        } catch (e: any) {
            setWorkflowError(e?.message ?? "Montaj kaydı oluşturulamadı.");
        } finally {
            setSaving(false);
        }
    }

    // Montaja göndermeyi geri al — yalnızca montajcı henüz iş yapmadıysa (job "waiting").
    // Sipariş durumunu montaj öncesine döndürür; legacy yazım korunur ("new_order").
    async function handleUndoSendToInstallation() {
        if (!id || !installationJob) return;
        if (installationJob.status && installationJob.status !== "waiting") {
            setWorkflowError("Montaj başladığı için geri alınamaz. Önce montaj takibinden durumu sıfırlayın.");
            return;
        }
        setSaving(true);
        setWorkflowError("");
        setWorkflowMessage("");
        try {
            const ctx = await getEffectiveTenantContext();
            const { error: delErr } = await supabase
                .from("installation_jobs")
                .delete()
                .eq("id", installationJob.id)
                .eq("company_id", ctx.company_id);
            if (delErr) throw delErr;

            // TODO: önceki durumu birebir saklayıp geri yükle (şimdilik Sipariş Alındı'ya döner).
            const { error: updErr } = await supabase
                .from("orders")
                .update({ status: "new_order" })
                .eq("id", id);
            if (updErr) throw updErr;

            setInstallationJob(null);
            setOrder((prev) => prev ? { ...prev, status: "new_order" } : prev);
            setWorkflowMessage("Montaja gönderme geri alındı. Sipariş yeniden 'Sipariş Alındı' durumunda.");
        } catch (e: any) {
            setWorkflowError(e?.message ?? "Geri alınamadı.");
        } finally {
            setSaving(false);
        }
    }

    const currentInstallerId = installationJob?.assigned_staff_id || order?.assigned_to || "";

    const isInstallationActive = installationJob && installationJob.status !== "completed";
    const isInstallationCompleted = installationJob?.status === "completed" ||
        order?.status === "montaj_tamamlandi" ||
        order?.status === "installation_completed";

    // "Montaja Gönder" yalnızca doğru durumda aktif (kanonik normalize üzerinden):
    // henüz montaj işi yokken ve sipariş Sipariş Alındı / Üretimde / Montaja Hazır iken.
    const normalizedOrderStatus = normalizeOrderStatus(order?.status);
    const canSendToInstallation = !installationJob && !isInstallationCompleted && (
        normalizedOrderStatus === ORDER_STATUS.RECEIVED ||
        normalizedOrderStatus === ORDER_STATUS.PRODUCTION ||
        normalizedOrderStatus === ORDER_STATUS.READY_FOR_INSTALL
    );
    const canUndoSendToInstallation = !!installationJob && (!installationJob.status || installationJob.status === "waiting");

    async function handleCompleteInstallation() {
        if (!id || !installationJob) return;
        // Montajcı OPSİYONEL (solo perdeci kendi montajını atamadan da tamamlayabilir).
        // Atanmışsa hakediş o montajcının carisine işlenir; atanmamışsa hakediş OLUŞMAZ.
        const effectiveInstaller = installationJob.assigned_staff_id || order?.assigned_to || "";
        setCompletingInstallation(true);
        setWorkflowError("");
        try {
            const ctx = await getEffectiveTenantContext();
            const now = new Date().toISOString();

            // 1. Montaj işini tamamlandı olarak işaretle. assigned_staff_id boşsa sipariş
            // montajcısıyla BACKFILL et → completed job montajcıya bağlı kalır, hakediş cari'ye düşer.
            // Geniş güncelleme dene (completed_at + updated_at kolonları varsa)
            let { error: jobError } = await supabase
                .from("installation_jobs")
                .update({ status: "completed", completed_at: now, updated_at: now, ...(effectiveInstaller ? { assigned_staff_id: effectiveInstaller } : {}) })
                .eq("id", installationJob.id)
                .eq("company_id", ctx.company_id);

            // Kolon yoksa minimal güncellemeye düş
            if (jobError && /completed_at|updated_at|column.*does not exist/i.test(jobError.message || "")) {
                const fallback = await supabase
                    .from("installation_jobs")
                    .update({ status: "completed", ...(effectiveInstaller ? { assigned_staff_id: effectiveInstaller } : {}) })
                    .eq("id", installationJob.id)
                    .eq("company_id", ctx.company_id);
                jobError = fallback.error;
            }
            if (jobError) throw jobError;

            // 1b. Hakediş seed: Montajcı cari (InstallerLedger) "Toplam Hakediş"i tamamlanan
            // işlerin installer_fee toplamından TÜRETİR. İş completed olurken installer_fee
            // boş/0 ise siparişin montaj bedeli (order.installation_cost) ile doldururuz; böylece
            // tamamlanınca hakediş cari'ye düşer. Manuel girilmiş fee EZİLMEZ. Bu adım ayrı ve
            // best-effort: completion akışını bozmaz, installer_fee kolonu yoksa sessizce geçilir.
            // (Yeni tablo/şema/ödeme mantığı yok; earned türetilmiş olduğundan çift kayıt olmaz.)
            const montajFee = Math.max(0, safeNumber(order?.installation_cost));
            if (effectiveInstaller && montajFee > 0) {
                const { data: feeRow, error: feeErr } = await supabase
                    .from("installation_jobs")
                    .select("installer_fee")
                    .eq("id", installationJob.id)
                    .maybeSingle();
                if (!feeErr && feeRow && safeNumber(feeRow.installer_fee) <= 0) {
                    await supabase
                        .from("installation_jobs")
                        .update({ installer_fee: montajFee })
                        .eq("id", installationJob.id)
                        .eq("company_id", ctx.company_id);
                }
            }

            // 2. Sipariş durumunu güncelle
            const { error: orderError } = await supabase
                .from("orders")
                .update({ status: "montaj_tamamlandi" })
                .eq("id", id)
                .eq("company_id", ctx.company_id);
            if (orderError) throw orderError;

            // UI anlık güncelle
            setInstallationJob((prev) => prev ? { ...prev, status: "completed", ...(effectiveInstaller ? { assigned_staff_id: effectiveInstaller } : {}) } : prev);
            setOrder((prev) => prev ? { ...prev, status: "montaj_tamamlandi" } : prev);
            console.info("[montaj-tamamla] hakediş için yazılan:", { effectiveInstaller: effectiveInstaller || "(yok - hakediş oluşmadı)", montajFee, status: "completed" });
            setWorkflowMessage("✅ Montaj tamamlandı olarak işaretlendi. Montajcı cari ekranı otomatik güncellenecek.");
            setShowCompleteModal(false);
            await loadData(); // job + backfill'i tazele (ledger ekranı açılınca güncel okur)
        } catch (e: any) {
            setWorkflowError(e?.message ?? "Montaj tamamlanamadı.");
            setShowCompleteModal(false);
        } finally {
            setCompletingInstallation(false);
        }
    }

    // Siparişi Geri Al / İptal Et — VERİ SİLMEZ; bağlı cari etkilerini cancel hareketiyle dengeler:
    //   • Tedarikçi borcu: bu siparişin açık borcu (Σdebt − Σcancel) kadar 'cancel' hareketi.
    //   • Montaj işi: status "cancelled" → tamamlanmış sayılmaz, hakediş (earned) düşer.
    //   • Sipariş: status "cancelled" + remaining_amount 0 → müşteride fantom bakiye kalmaz.
    // Ödeme/borç formüllerine dokunmaz; yalnız dengeleyici hareket + status yazar. Migration yok.
    async function handleCancelOrder() {
        if (!id || !order) return;
        setCancellingOrder(true);
        setWorkflowError("");
        setWorkflowMessage("");
        try {
            const ctx = await getEffectiveTenantContext();
            const companyId = order.company_id ?? ctx.company_id;
            const nowIso = new Date().toISOString();
            const custName = order.customers?.name || "Müşteri";
            const refNo = id.slice(0, 8).toUpperCase();

            // 1) Tedarikçi cari: bu siparişin tedarikçi bazında AÇIK borcunu (Σdebt − Σcancel)
            //    hesapla ve kalan kadar 'cancel' işle (mevcut cancel'ları çift saymadan).
            const { data: supTxs } = await supabase
                .from("supplier_transactions")
                .select("supplier_id, transaction_type, amount")
                .eq("company_id", companyId)
                .eq("order_id", id);
            const openBySupplier = new Map<string, number>();
            (supTxs ?? []).forEach((t: any) => {
                if (!t.supplier_id) return;
                const amt = safeNumber(t.amount);
                if (t.transaction_type === "debt") openBySupplier.set(t.supplier_id, (openBySupplier.get(t.supplier_id) ?? 0) + amt);
                else if (t.transaction_type === "cancel") openBySupplier.set(t.supplier_id, (openBySupplier.get(t.supplier_id) ?? 0) - amt);
            });
            for (const [supplierId, open] of openBySupplier) {
                if (open > 0.01) {
                    await supabase.from("supplier_transactions").insert({
                        company_id: companyId,
                        supplier_id: supplierId,
                        order_id: id,
                        transaction_date: nowIso,
                        transaction_type: "cancel",
                        amount: open,
                        description: `Sipariş iptali: ${custName} - borç iptal edildi`,
                        reference_no: refNo,
                    });
                }
            }

            // 2) Montaj işi: iptal → tamamlanmış sayılmaz (hakediş düşer). Silme yok, best-effort.
            await supabase.from("installation_jobs")
                .update({ status: "cancelled" })
                .eq("order_id", id)
                .eq("company_id", companyId)
                .then(() => {}, () => {});

            // 2b) Gider accrual + satış faturası: iptal İŞARETLE (SİLME YOK). Böylece Toplam Gider
            // ve fatura/ciro iptal edilen siparişi saymaz. best-effort — kayıt yoksa sessiz geçilir.
            await supabase.from("expenses")
                .update({ status: "cancelled" })
                .eq("order_id", id)
                .eq("company_id", companyId)
                .then(() => {}, () => {});
            await supabase.from("invoices")
                .update({ status: "cancelled" })
                .eq("order_id", id)
                .eq("company_id", companyId)
                .then(() => {}, () => {});

            // 3) Sipariş: iptal + kalan bakiye sıfırla (müşteride fantom alacak kalmasın).
            const { error: ordErr } = await supabase
                .from("orders")
                .update({ status: "cancelled", remaining_amount: 0 })
                .eq("id", id)
                .eq("company_id", companyId);
            if (ordErr) throw ordErr;

            setShowCancelModal(false);
            const collected = safeNumber(order.paid_amount ?? order.deposit_amount);
            setWorkflowMessage(collected > 0
                ? `Sipariş iptal edildi. Tedarikçi borcu ve montaj hakedişi geri alındı. Not: Müşteriden tahsil edilen ${fmtTL(collected)} varsa iadesi manuel yapılmalıdır.`
                : "Sipariş iptal edildi. Tedarikçi borcu ve montaj hakedişi geri alındı.");
            await loadData();
        } catch (e: any) {
            setWorkflowError(e?.message ?? "Sipariş iptal edilemedi.");
            setShowCancelModal(false);
        } finally {
            setCancellingOrder(false);
        }
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-24 px-4">
            {/* Header / Üst Kart */}
            <div className="bg-white dark:bg-slate-900 rounded-[24px] sm:rounded-[32px] border border-slate-100 dark:border-slate-800 p-4 sm:p-6 lg:p-8 shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-primary-600 mb-2">
                            <span className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-black tracking-widest uppercase text-emerald-700 dark:text-emerald-300">
                                {orderStatusLabel(order.status)}
                            </span>
                            <span className="px-3 py-1 rounded-full bg-primary-50 dark:bg-primary-900/20 text-[10px] font-black tracking-widest uppercase">
                                {order.status === 'draft' ? 'TEKLİF / ÖLÇÜ' : 'SİPARİŞ'}
                            </span>
                            <span className="text-xs text-slate-400 font-bold">#{order.id.slice(0,8)}</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                            {order.customers?.name || "İsimsiz Müşteri"}
                        </h1>
                        <div className="mt-4 flex flex-wrap gap-4">
                            <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                                <Phone className="w-4 h-4" /> {order.customers?.phone || "-"}
                            </div>
                        </div>
                    </div>

                    <div className="w-full bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-4 text-left sm:w-auto sm:min-w-[240px] sm:p-6 sm:text-right">
                        <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Sipariş Toplamı</div>
                        <div className="text-2xl sm:text-3xl font-black text-primary-600 tracking-tighter">{fmtTL(salesTotal)}</div>
                    </div>
                </div>

                {(role === "admin" || role === "accountant") && order.status !== "cancelled" && (
                    <div className="mt-4 flex justify-end">
                        <button
                            type="button"
                            onClick={() => setShowCancelModal(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                        >
                            <X className="w-4 h-4" /> Siparişi Geri Al / İptal Et
                        </button>
                    </div>
                )}

                {(role === "admin" || role === "accountant") && (
                    <div className="mt-6 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                            <div>
                                <div className="text-xs text-slate-400 font-black uppercase tracking-widest">Atanan Montajcı</div>
                                <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">
                                    {staffList.find((staff) => staff.id === currentInstallerId)
                                        ? `${staffList.find((staff) => staff.id === currentInstallerId)?.full_name} (${staffRoleLabel(staffList.find((staff) => staff.id === currentInstallerId)?.role || "installer")})`
                                        : "Henüz montajcı atanmadı"}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowNewInstaller((v) => !v)}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-white px-4 py-2 text-sm font-black text-primary-700 hover:bg-primary-50 dark:border-primary-900 dark:bg-slate-900 dark:text-primary-300 sm:w-auto"
                            >
                                <Plus className="w-4 h-4" />
                                Yeni Montajcı Ekle
                            </button>
                        </div>
                        {showNewInstaller && (
                            <div className="mb-3 flex flex-col sm:flex-row gap-2">
                                <input
                                    value={newInstallerName}
                                    onChange={(e) => setNewInstallerName(e.target.value)}
                                    placeholder="Montajcı adı soyadı"
                                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm"
                                />
                                <button
                                    onClick={handleAddInstaller}
                                    disabled={newInstallerSaving}
                                    className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60 sm:w-auto"
                                >
                                    {newInstallerSaving ? "Ekleniyor..." : "Ekle"}
                                </button>
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-3">
                            <select
                                value={assignedTo}
                                onChange={(e) => setAssignedTo(e.target.value)}
                                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3"
                            >
                                <option value="">Montajcı seç / atamayı kaldır</option>
                                {staffList.map((staff) => (
                                    <option key={staff.id} value={staff.id}>
                                        {staff.full_name} ({staffRoleLabel(staff.role)})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleUpdateAssignedTo}
                                disabled={saving || assignedTo === currentInstallerId}
                                className="w-full px-5 py-3 rounded-xl bg-primary-600 text-white font-bold disabled:opacity-60 sm:w-auto"
                            >
                                {saving ? "Kaydediliyor..." : currentInstallerId ? "Montajcıyı Değiştir" : "Montajcıyı Ata"}
                            </button>
                        </div>
                        {staffList.length === 0 ? (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                                Henüz montajcı kartı yok. "Yeni Montajcı Ekle" ile hemen oluşturabilirsiniz.
                            </div>
                        ) : null}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-50 dark:border-slate-800">
                    <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100/50">
                        <div className="text-[10px] text-emerald-600 font-black mb-1">TAHSİLAT</div>
                        <div className="text-xl font-black text-emerald-700">{fmtTL(paid)}</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100/50">
                        <div className="text-[10px] text-rose-600 font-black mb-1">KALAN</div>
                        <div className="text-xl font-black text-rose-700">{fmtTL(remaining)}</div>
                    </div>
                    {overpayment > 0 ? (
                        <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-900/10 border border-blue-100">
                            <div className="text-[10px] text-blue-600 font-black mb-1">MÜŞTERİ ALACAKLI</div>
                            <div className="text-xl font-black text-blue-700">{fmtTL(overpayment)}</div>
                        </div>
                    ) : null}
                    {(role === 'admin' || role === 'accountant') && (
                        <button type="button" onClick={() => setShowPaymentForm((value) => !value)} className="bg-emerald-600 hover:bg-emerald-700 text-white p-4 rounded-2xl font-black shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2">
                             + Ödeme Ekle
                        </button>
                    )}
                </div>

                {paymentError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{paymentError}</div> : null}
                {paymentSuccess ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{paymentSuccess}</div> : null}
                {workflowError ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{workflowError}</div> : null}
                {workflowMessage ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{workflowMessage}</div> : null}

                {(role === "admin" || role === "accountant") ? (
                    <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1">
                                <div className="text-xs font-black uppercase tracking-widest text-slate-400">Montaj İş Akışı</div>
                                <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">
                                    {isInstallationCompleted
                                        ? "✅ Montaj tamamlandı."
                                        : installationJob
                                            ? `Bu sipariş montaj takibinde (${installationJob.status || "waiting"}).`
                                            : "Üretim tamamlandıysa siparişi montaj takibine aktarın."}
                                </div>
                                {isInstallationActive && (
                                    <div className="mt-1 text-xs text-amber-600 font-bold">Montaj henüz tamamlanmadı. Montajcı işi bitirdikten sonra onaylayın.</div>
                                )}
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                {/* Montaja Gönder — yalnızca doğru durumda (kanonik normalize üzerinden) aktif */}
                                {canSendToInstallation && (
                                    <button
                                        type="button"
                                        onClick={handleMarkInstallationReady}
                                        disabled={saving}
                                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 text-sm font-black text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                    >
                                        <PackageCheck className="h-5 w-5" />
                                        Montaja Gönder
                                    </button>
                                )}
                                {/* Montaja göndermeyi geri al — yalnızca montaj henüz başlamadıysa */}
                                {canUndoSendToInstallation && (
                                    <button
                                        type="button"
                                        onClick={handleUndoSendToInstallation}
                                        disabled={saving}
                                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 sm:w-auto"
                                    >
                                        <X className="h-5 w-5" />
                                        Montaja Göndermeyi Geri Al
                                    </button>
                                )}
                                {/* Montajı Tamamla butonu — takibde ve henüz tamamlanmamışsa */}
                                {isInstallationActive && (
                                    <button
                                        type="button"
                                        onClick={() => setShowCompleteModal(true)}
                                        disabled={saving || completingInstallation}
                                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto shadow-lg shadow-emerald-600/20"
                                    >
                                        <CheckCircle2 className="h-5 w-5" />
                                        Montajı Tamamla
                                    </button>
                                )}
                                {/* Tamamlandı badge */}
                                {isInstallationCompleted && (
                                    <span className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-100 px-5 text-sm font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 sm:w-auto">
                                        <CheckCircle2 className="h-5 w-5" />
                                        Montaj Tamamlandı
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Montaj Geçmişi — sade ERP timeline; olaylar mevcut veriden türetilir (yeni sorgu yok) */}
                        {installationJob && (
                            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                                <div className="text-xs font-black uppercase tracking-widest text-slate-400">Montaj Geçmişi</div>
                                <ol className="mt-3">
                                    {buildInstallationTimeline(order, installationJob, staffList).map((ev, idx, arr) => (
                                        <li key={ev.key} className="relative flex gap-3 pb-4 last:pb-0">
                                            {idx < arr.length - 1 && (
                                                <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
                                            )}
                                            <span className={`relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${ev.done ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"}`} aria-hidden />
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-sm font-bold ${ev.done ? "text-slate-800 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{ev.label}</div>
                                                {ev.detail ? <div className="text-xs text-slate-500 dark:text-slate-400">{ev.detail}</div> : null}
                                                {ev.at ? <div className="text-[11px] text-slate-400">{fmtTimelineDateTime(ev.at)}</div> : null}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        )}
                    </div>
                ) : null}

                {/* Siparişi Geri Al / İptal Onay Modalı */}
                {showCancelModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                        <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl dark:bg-slate-900 overflow-hidden">
                            <div className="bg-rose-50 dark:bg-rose-900/20 p-6 text-center">
                                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40">
                                    <X className="h-8 w-8 text-rose-600" />
                                </div>
                                <h2 className="text-lg font-black text-slate-900 dark:text-white">Siparişi Geri Al / İptal Et</h2>
                                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                                    Bu sipariş <strong>iptal</strong> edilsin mi?
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                    Tedarikçi borcu iptal hareketiyle geri alınır, montaj işi iptal edilir, montajcı hakedişi düşer. Kayıtlar silinmez. Tahsil edilen ödemelerin iadesi manuel yapılır.
                                </p>
                            </div>
                            <div className="flex gap-3 p-4">
                                <button
                                    type="button"
                                    onClick={() => setShowCancelModal(false)}
                                    disabled={cancellingOrder}
                                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                                >
                                    Vazgeç
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleCancelOrder()}
                                    disabled={cancellingOrder}
                                    className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-60 shadow-lg shadow-rose-600/20"
                                >
                                    {cancellingOrder ? "İşleniyor..." : "Evet, İptal Et"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Montajı Tamamla Onay Modalı */}
                {showCompleteModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                        <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl dark:bg-slate-900 overflow-hidden">
                            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-6 text-center">
                                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                                </div>
                                <h2 className="text-lg font-black text-slate-900 dark:text-white">Montajı Tamamla</h2>
                                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                                    Bu sipariş <strong>montaj tamamlandı</strong> olarak işaretlensin mi?
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                    Onaylanınca sipariş durumu güncellenecek ve montajcı iş geçmişine işlenecek.
                                </p>
                            </div>
                            <div className="flex gap-3 p-4">
                                <button
                                    type="button"
                                    onClick={() => setShowCompleteModal(false)}
                                    disabled={completingInstallation}
                                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                                >
                                    İptal
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleCompleteInstallation()}
                                    disabled={completingInstallation}
                                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60 shadow-lg shadow-emerald-600/20"
                                >
                                    {completingInstallation ? "İşleniyor..." : "✅ Evet, Tamamla"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showPaymentForm ? (
                    <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto]">
                            <input type="number" min={0} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="min-h-12 rounded-xl border border-emerald-200 bg-white px-4 font-bold outline-none dark:border-emerald-900 dark:bg-slate-900" placeholder="Tahsilat tutarı" />
                            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="min-h-12 rounded-xl border border-emerald-200 bg-white px-4 font-bold outline-none dark:border-emerald-900 dark:bg-slate-900">
                                <option value="nakit">Nakit</option>
                                <option value="kart">Kart</option>
                                <option value="havale">Havale/EFT</option>
                                <option value="diger">Diğer</option>
                            </select>
                            <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="min-h-12 rounded-xl border border-emerald-200 bg-white px-4 font-bold outline-none dark:border-emerald-900 dark:bg-slate-900" placeholder="Açıklama" />
                            <button type="button" onClick={handleAddPayment} disabled={saving} className="min-h-12 rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-60 sm:col-span-2 lg:col-span-1">
                                Kaydet
                            </button>
                        </div>
                    </div>
                ) : null}

                {payments.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="text-xs font-black uppercase tracking-widest text-slate-400">Tahsilat Geçmişi</div>
                        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                            {payments.map((payment) => (
                                <div key={payment.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-black">{fmtTL(payment.amount)}</div>
                                        <div className="text-xs text-slate-500">{payment.method || "Ödeme"} - {payment.note || "Açıklama yok"}</div>
                                    </div>
                                    <div className="text-xs font-bold text-slate-500">{payment.payment_date ? new Date(payment.payment_date).toLocaleDateString("tr-TR") : "-"}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Sol: Ürün Listesi ve Ekleme */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Ürün Ekleme Formu */}
                    {linesEditable && (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-primary-100 dark:border-primary-900/30 p-6">
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <h2 className="text-lg font-black flex items-center gap-2 text-slate-900 dark:text-white uppercase tracking-tighter">
                                    {editingItemId ? <Pencil className="w-5 h-5 text-primary-600" /> : <Plus className="w-5 h-5 text-primary-600" />}
                                    {editingItemId ? "Ürün Satırını Düzenle" : "Yeni Ölçü / Ürün Ekle"}
                                </h2>
                                {editingItemId ? (
                                    <button type="button" onClick={resetItemForm} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">
                                        <X className="w-4 h-4" /> İptal
                                    </button>
                                ) : null}
                            </div>
                            {productsCatalog.length > 0 && (
                                <div className="mb-3">
                                    <label className="text-[11px] font-black uppercase tracking-wide text-slate-400">Ürün (Fiyat Listesi)</label>
                                    <select value={pProductId} onChange={e => applyCatalogProduct(e.target.value)} className="mt-1 w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold">
                                        <option value="">Ürün seç (tedarikçi & alış fiyatı otomatik gelir)</option>
                                        {productsCatalog.map((p) => (
                                            <option key={p.id} value={p.id}>{(p.name || "İsimsiz")} — {productLabel(normalizeCategory(p.category))}</option>
                                        ))}
                                    </select>
                                    <div className="mt-1 text-[11px] text-slate-400">Ürün seçilince tedarikçi, alış fiyatı, min. alan, yuvarlama ve fire otomatik dolar. İstersen aşağıdan değiştirebilirsin.</div>
                                </div>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <select value={pType} onChange={e => setPType(e.target.value as ProductType)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold">
                                    <option value="plicell">Plicell</option>
                                    <option value="stor">Stor</option>
                                    <option value="zebra">Zebra</option>
                                    <option value="tul">Tül</option>
                                    <option value="fon">Fon</option>
                                    <option value="jalousie">Jaluzi</option>
                                    <option value="dikey_tul">Dikey Tül</option>
                                    <option value="dikey_stor">Dikey Stor</option>
                                    <option value="picasso">Picasso</option>
                                    <option value="diger">Diğer</option>
                                </select>
                                <input type="number" min={0} placeholder="En (cm) *" value={pWidth} onChange={e => setPWidth(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input type="number" min={0} placeholder="Boy (cm) *" value={pHeight} onChange={e => setPHeight(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input type="number" min={0} placeholder="Birim Fiyat (₺/m²) *" value={pPrice} onChange={e => setPPrice(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                                <input placeholder="Oda / Bölüm" value={pRoom} onChange={e => setPRoom(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <select value={pSupplierId} onChange={e => applySupplierToForm(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" required>
                                    <option value="">Tedarikçi seç *</option>
                                    {suppliers.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name || "İsimsiz"}</option>
                                    ))}
                                </select>
                                <input type="number" min={0} placeholder="Alış maliyeti (₺/m²)" value={pPurchaseCost} onChange={e => setPPurchaseCost(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input type="number" min={1} placeholder="Adet" value={pQty} onChange={e => setPQty(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                                <input placeholder="Model adı" value={pModelName} onChange={e => setPModelName(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input placeholder="Renk / kod" value={pColorName} onChange={e => setPColorName(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input placeholder="Ürün notu" value={pNote} onChange={e => setPNote(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Tedarikçi vade tarihi (opsiyonel)</span>
                                    <input type="date" value={pSupplierDueDate} onChange={e => setPSupplierDueDate(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                </label>
                            </div>
                            <div className="mt-3">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handlePhotoPick}
                                        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-500 hover:border-primary-400 hover:text-primary-600"
                                    >
                                        <CameraIcon className="h-4 w-4" />
                                        Fotoğraf Çek / Ekle
                                    </button>
                                    {photoPreview && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPhoto(null);
                                                setPhotoPreview("");
                                            }}
                                            className="text-xs text-rose-500 hover:underline font-bold"
                                        >
                                            Fotoğrafı Kaldır
                                        </button>
                                    )}
                                </div>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={onPhotoChange}
                                    className="hidden"
                                />
                                {photoPreview && (
                                    <div className="mt-2 relative inline-block">
                                        <img src={photoPreview} alt="Ürün fotoğrafı önizleme" className="h-32 w-48 object-cover rounded-xl border border-slate-200 dark:border-slate-700" />
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm">
                                <span className="font-bold text-slate-500">Hesaplanan satış tutarı</span>
                                <span className="font-black text-primary-600">{fmtTL(previewLine.line_total)}</span>
                            </div>
                            {itemFormError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{itemFormError}</div> : null}
                            {itemFormDirty ? (
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                    <span className="flex items-center gap-2">⚠️ Kaydedilmemiş değişiklikler var. Çıkmadan önce kaydedin.</span>
                                    <button
                                        type="button"
                                        onClick={handleSaveItem}
                                        disabled={saving}
                                        className="shrink-0 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow disabled:opacity-60"
                                    >
                                        {saving ? "Kaydediliyor..." : editingItemId ? "Satırı Kaydet" : "Satıra Ekle"}
                                    </button>
                                </div>
                            ) : null}
                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                <button type="button" onClick={handleSaveItem} disabled={saving} className="flex-1 bg-primary-600 hover:bg-primary-700 text-white p-4 rounded-2xl font-black shadow-lg disabled:opacity-60">
                                    {saving ? "Kaydediliyor..." : editingItemId ? "SATIRI GÜNCELLE" : "SATIRA EKLE"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { if (!itemFormDirty || window.confirm("Kaydedilmemiş değişiklikler var. Vazgeçilsin mi?")) resetItemForm(); }}
                                    disabled={saving}
                                    className="px-5 py-4 rounded-2xl border border-slate-200 dark:border-slate-700 font-black text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                                >
                                    Vazgeç
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Ürün Tablosu */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
                            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">🛒 Ürün Listesi</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                                        <th className="px-4 py-4">Ürün Türü</th>
                                        <th className="px-4 py-4">Oda</th>
                                        <th className="px-4 py-4 text-center">Ölçü</th>
                                        <th className="px-4 py-4">Tedarikçi</th>
                                        {showCostColumns && <th className="px-4 py-4 text-right">Alış</th>}
                                        <th className="px-4 py-4 text-right">Satış</th>
                                        {showCostColumns && <th className="px-4 py-4 text-right">Kar</th>}
                                        {linesEditable && <th className="px-4 py-4 text-right">İşlem</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                    {items.length === 0 ? (
                                        <tr>
                                            <td colSpan={itemTableColSpan} className="px-6 py-10 text-center text-sm font-bold text-slate-400">
                                                Henüz ürün satırı eklenmedi.
                                            </td>
                                        </tr>
                                    ) : items.map(it => (
                                        <tr key={it.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                                            <td className="px-4 py-5">
                                                <div className="font-black text-slate-900 dark:text-white uppercase text-sm">{productLabel(it.product_type)}</div>
                                                {(it.product_options?.model_name || it.product_options?.color_name) && (
                                                    <div className="mt-0.5 text-[11px] text-slate-500">
                                                        {[it.product_options.model_name, it.product_options.color_name].filter(Boolean).join(" / ")}
                                                    </div>
                                                )}
                                                <FieldInfoGallery info={parseFieldInfo(it.product_options)} compact />
                                                {it.note ? <div className="mt-1 text-[11px] text-slate-400">{it.note}</div> : null}
                                            </td>
                                            <td className="px-4 py-5 text-sm font-bold text-slate-600">{it.room || "—"}</td>
                                            <td className="px-4 py-5 text-center font-mono text-xs">{it.width_cm}×{it.height_cm} <span className="text-slate-400">x{it.qty ?? 1}</span></td>
                                            <td className="px-4 py-5 text-sm font-bold text-slate-700 dark:text-slate-200">
                                                {it.supplier_id ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => nav(`/suppliers/${it.supplier_id}`)}
                                                        className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                                                        title="Tedarikçiye git"
                                                    >
                                                        {supplierNameFromItem(it, suppliers)}
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 opacity-60"><path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd"/><path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd"/></svg>
                                                    </button>
                                                ) : (
                                                    <span>{supplierNameFromItem(it, suppliers)}</span>
                                                )}
                                            </td>
                                            {showCostColumns && (
                                                <td className="px-4 py-5 text-right text-sm font-bold text-slate-600">{fmtTL(it.supplier_total_cost)}</td>
                                            )}
                                            <td className="px-4 py-5 text-right font-black text-slate-900 dark:text-white">{fmtTL(it.line_total)}</td>
                                            {showCostColumns && (
                                                <td className="px-4 py-5 text-right font-black text-emerald-600">{fmtTL(it.profit ?? safeNumber(it.line_total) - safeNumber(it.supplier_total_cost))}</td>
                                            )}
                                            {linesEditable && (
                                                <td className="px-4 py-5 text-right">
                                                    <div className="inline-flex gap-1">
                                                        <button type="button" onClick={() => startEditItem(it)} className="p-2 text-primary-600 hover:bg-primary-50 rounded-xl" title="Düzenle">
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button type="button" onClick={() => handleDeleteItem(it.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl" title="Sil">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Sağ: Maliyet & Notlar */}
                <div className="lg:col-span-4 space-y-6">
                    {visualPreviews.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6">
                            <h2 className="text-xl font-black mb-4 uppercase tracking-tighter flex items-center gap-2">
                                <ImageIcon className="w-5 h-5 text-primary-600" />
                                Seçilen Kartela
                            </h2>
                            <div className="space-y-4">
                                {visualPreviews.map((preview) => {
                                    const variant = Array.isArray(preview.catalog_variant) ? preview.catalog_variant[0] : preview.catalog_variant;
                                    const series = Array.isArray(variant?.series) ? variant?.series[0] : variant?.series;
                                    return (
                                        <div key={preview.id} className="rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                                            {preview.preview_image_url ? (
                                                <img src={preview.preview_image_url} alt="Önizleme Görseli" className="h-48 w-full object-cover" />
                                            ) : null}
                                            <div className="p-4 text-sm">
                                                <div className="font-black text-slate-900 dark:text-white">
                                                    {series?.series_code || "-"} {series?.model_name || ""} {variant?.variant_code || ""}
                                                </div>
                                                <div className="mt-1 text-slate-500">Müşteri Seçimi: {variant?.color_name || "-"} / {series?.product_type || "-"}</div>
                                                {variant?.texture_image_url ? <div className="mt-1 text-slate-500 break-all">Texture: {variant.texture_image_url}</div> : null}
                                                <div className="mt-2 font-bold text-primary-600">{fmtTL(variant?.price_per_m2)} / m²</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {orderPhotoUrls.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6">
                            <h2 className="text-xl font-black mb-4 uppercase tracking-tighter flex items-center gap-2">
                                <ImageIcon className="w-5 h-5 text-primary-600" />
                                Ölçü Fotoğrafları
                            </h2>
                            <div className="grid grid-cols-2 gap-3">
                                {orderPhotoUrls.map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-slate-100 dark:border-slate-800">
                                        <img src={url} alt="Ölçü fotoğrafı" className="h-32 w-full object-cover" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Maliyet Kutusu (Sadece Admin/Muhasebe) */}
                    {(role === 'admin' || role === 'accountant') && (() => {
                        const mechCostVal   = Math.max(0, safeNumber(mechanismCostInput));
                        const instCostVal   = Math.max(0, safeNumber(installationCostInput));
                        const laborCostVal  = Math.max(0, safeNumber(laborCostInput));
                        const transCostVal  = Math.max(0, safeNumber(transportCostInput));
                        const totalCostAll  = purchaseTotal + mechCostVal + instCostVal + laborCostVal + transCostVal;
                        const netProfit     = salesTotal - totalCostAll;
                        const profitMargin  = salesTotal > 0 ? (netProfit / salesTotal) * 100 : 0;

                        return (
                            <div className="bg-slate-900 text-white rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl -mr-16 -mt-16" />
                                <h2 className="text-lg font-black mb-6 text-primary-400 uppercase tracking-tighter">🚨 Kâr Analizi</h2>

                                {/* Özet kartları */}
                                <div className="grid grid-cols-2 gap-3 mb-6">
                                    <div className="rounded-2xl bg-white/5 p-3 text-center">
                                        <div className="text-[10px] font-black opacity-50 mb-1 uppercase tracking-wider">Toplam Satış</div>
                                        <div className="text-lg font-black text-white">{fmtTL(salesTotal)}</div>
                                    </div>
                                    <div className="rounded-2xl bg-white/5 p-3 text-center">
                                        <div className="text-[10px] font-black opacity-50 mb-1 uppercase tracking-wider">Toplam Maliyet</div>
                                        <div className="text-lg font-black text-rose-400">{fmtTL(totalCostAll)}</div>
                                    </div>
                                    <div className="rounded-2xl bg-emerald-500/10 p-3 text-center">
                                        <div className="text-[10px] font-black opacity-50 mb-1 uppercase tracking-wider">Brüt Kâr</div>
                                        <div className={`text-lg font-black ${netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtTL(netProfit)}</div>
                                    </div>
                                    <div className="rounded-2xl bg-white/5 p-3 text-center">
                                        <div className="text-[10px] font-black opacity-50 mb-1 uppercase tracking-wider">Kâr Marjı</div>
                                        <div className={`text-lg font-black ${profitMargin >= 0 ? "text-emerald-400" : "text-rose-400"}`}>%{profitMargin.toFixed(1)}</div>
                                    </div>
                                </div>

                                {/* Detaylı maliyet kalemleri */}
                                <div className="space-y-1 mb-5 border-t border-white/5 pt-4">
                                    <div className="flex justify-between text-xs opacity-50">
                                        <span>Kumaş / Alış Maliyeti</span><span>{fmtTL(purchaseTotal)}</span>
                                    </div>

                                    {/* Giriş alanları */}
                                    {([
                                        { label: "Mekanizma",  value: mechanismCostInput,    setter: setMechanismCostInput },
                                        { label: "Montaj",     value: installationCostInput, setter: setInstallationCostInput },
                                        { label: "İşçilik",    value: laborCostInput,        setter: setLaborCostInput },
                                        { label: "Nakliye",    value: transportCostInput,    setter: setTransportCostInput },
                                    ] as const).map(({ label, value, setter }) => (
                                        <div key={label} className="flex items-center justify-between gap-2">
                                            <label className="text-xs opacity-50 shrink-0">{label}</label>
                                            <input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                value={value}
                                                onChange={(e) => setter(e.target.value)}
                                                placeholder="0"
                                                className="w-28 rounded-lg bg-white/10 border border-white/15 px-2 py-1 text-xs font-bold text-white placeholder-white/25 outline-none focus:ring-1 focus:ring-emerald-400 text-right"
                                            />
                                        </div>
                                    ))}
                                </div>

                                {/* Kaydet butonu */}
                                <button
                                    type="button"
                                    onClick={handleSaveCosts}
                                    disabled={costSaving}
                                    className="w-full rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 text-xs font-black text-white disabled:opacity-50 transition"
                                >
                                    {costSaving ? "Kaydediliyor..." : "Maliyetleri Kaydet"}
                                </button>
                                {costSaveMsg && (
                                    <div className={`mt-2 text-xs font-bold text-center ${costSaveMsg.startsWith("Hata") ? "text-rose-400" : costSaveMsg.startsWith("⚠️") ? "text-amber-400" : "text-emerald-400"}`}>
                                        {costSaveMsg}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-8">
                        <h2 className="text-xl font-black mb-4 uppercase tracking-tighter">📝 Sipariş Notu</h2>
                        <div className="text-sm text-slate-500 font-medium leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl min-h-[100px]">
                            {order.note || "Herhangi bir özel not eklenmemiş."}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
