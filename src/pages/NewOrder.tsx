import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { normalizeRole } from "../auth/roles";
import { ArrowLeft, Users, Phone, Trash2, Package, Save, Briefcase, Plus, ChevronDown, ChevronUp, Search } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getNotificationSettings, scheduleReminderNotification } from "../utils/localNotifications";
import { findDuplicatePhone, duplicatePhoneMessage, phoneConstraintMessage } from "../utils/phoneUtils";

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
async function getContext() { return getEffectiveTenantContext(); }

type Customer = { id: string; name: string | null; phone: string | null; };
type Supplier = { id: string; name: string | null; };
type MeasuredAppointment = {
    id: string; customer_id: string | null; address: string | null; note: string | null;
    measurement_notes: string | null; assigned_to: string | null; assigned_user_id?: string | null;
    start_at: string | null; room_name?: string | null; width_cm?: number | null; height_cm?: number | null;
    rounded_width_cm?: number | null; rounded_height_cm?: number | null; product_type?: string | null;
    model_name?: string | null; color_name?: string | null; quantity?: number | null; unit_price?: number | null;
    supplier_id?: string | null; supplier_unit_cost?: number | null;
    customer?: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
};
type ProductRow = {
    id: string; name: string | null; category: string | null; unit_price: number | null;
    cost_price?: number | null; min_price: number | null; min_area: number | null;
    rounding_rule: number | null; pricing_mode: string | null; is_active: boolean | null;
};
type SupplierPriceRow = {
    supplier_id: string; product_id: string | null; product_name: string | null;
    product_category?: string | null; product_type?: string | null; unit_cost: number | null; unit_price?: number | null;
};
type Status = "new_order" | "draft" | "measured" | "quoted" | "approved" | "production" | "installation_ready" | "installation_waiting" | "installation_planned" | "installing" | "installation_completed" | "delivered_closed" | "completed" | "open" | "paid" | "partial";
type ProductType = "plicell" | "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "dikey_tul" | "dikey_stor" | "diger";
type OrderItemUI = {
    key: string; product_id: string; product_name: string; model_name: string; color_name: string;
    supplier_id: string; supplier_cost: number; product_type: ProductType; room: string;
    width_cm: number; height_cm: number; qty: number; unit_price: number;
    pile: "2" | "3"; mechanism: "reducer" | "standard"; control_type: "corded" | "tape";
};
type StaffOption = { id: string; userId: string | null; employeeId: string | null; full_name: string; role: string; };

function uid() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function safeNumber(v: unknown, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function roundByRule(value: number, roundingRule: number) { const rule = Math.max(1, safeNumber(roundingRule, 1)); return Math.ceil(value / rule) * rule; }

function calcAreaM2ByProduct(widthCm: number, heightCm: number, product: ProductRow | null) {
    const roundingRule = Math.max(1, safeNumber(product?.rounding_rule, 10));
    const minArea = Math.max(0, safeNumber(product?.min_area, 0));
    const roundedWidth = roundByRule(Math.max(1, widthCm), roundingRule);
    const roundedHeight = roundByRule(Math.max(1, heightCm), roundingRule);
    let area = (roundedWidth / 100) * (roundedHeight / 100);
    if (area < minArea) area = minArea;
    return { roundedWidth, roundedHeight, area };
}

function calcLineTotalByProduct(area: number, qty: number, unitPrice: number, product: ProductRow | null) {
    const calculated = area * qty * unitPrice;
    const minPrice = Math.max(0, safeNumber(product?.min_price, 0));
    return Math.max(calculated, minPrice);
}

function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

function productLabel(t: ProductType) {
    switch (t) {
        case "plicell": return "Plicell"; case "stor": return "Stor"; case "zebra": return "Zebra";
        case "tul": return "Tül"; case "fon": return "Fon"; case "jalousie": return "Jaluzi";
        case "dikey_tul": return "Dikey Tül"; case "dikey_stor": return "Dikey Stor"; case "picasso": return "Picasso";
        default: return "Diğer";
    }
}

function normalizeCategory(value: string | null | undefined) { return (value ?? "").trim().toLocaleLowerCase("tr-TR"); }
function normalizeText(value: string | null | undefined) { return (value ?? "").trim().toLocaleLowerCase("tr-TR"); }

function findProductByType(products: ProductRow[], type: string) {
    return products.find((p) => p.category && normalizeCategory(p.category) === normalizeCategory(type)) ?? null;
}

function pickAppointmentCustomer(customer: MeasuredAppointment["customer"]): { name: string | null; phone: string | null } | null {
    return Array.isArray(customer) ? customer[0] ?? null : customer ?? null;
}

function parseTurkishMoney(value: string | null | undefined) {
    const text = String(value ?? "");
    const match = text.match(/(?:Tedarikçi maliyeti|Maliyet fiyatı):\s*([₺\d.,\s]+)/i);
    if (!match) return 0;
    const normalized = match[1].replace(/[₺\s]/g, "").replace(/\./g, "").replace(",", ".");
    return safeNumber(normalized);
}

function parseSupplierName(value: string | null | undefined) {
    const match = String(value ?? "").match(/Tedarikçi:\s*(.+)/i);
    return match?.[1]?.split("\n")[0]?.trim() ?? "";
}

function normalizeProductType(value: string | null | undefined): ProductType {
    const normalized = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
    if (normalized === "tül" || normalized === "tul") return "tul";
    if (normalized === "jaluzi" || normalized === "jalousie") return "jalousie";
    if (["stor", "zebra", "fon", "picasso", "plicell", "dikey_tul", "dikey_stor"].includes(normalized)) return normalized as ProductType;
    return "diger";
}

function hasStructuredMeasurementNotes(...notes: Array<string | null | undefined>) {
    return notes.some((raw) => /\[ÖLÇÜ\]|\[OLCU\]|En\/Boy:/i.test(String(raw ?? "")));
}

function parseDimensionsFromNotes(...notes: Array<string | null | undefined>) {
    for (const raw of notes) {
        const text = String(raw ?? "");
        const match = text.match(/En\/Boy:\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i)
            ?? text.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*cm/i);
        if (match) return { width_cm: safeNumber(match[1]), height_cm: safeNumber(match[2]) };
    }
    return null;
}

function parseRoomFromNotes(...notes: Array<string | null | undefined>) {
    for (const raw of notes) {
        const match = String(raw ?? "").match(/\[ÖLÇÜ\]\s*([^-\n]+?)\s*-\s*/i)
            ?? String(raw ?? "").match(/\[OLCU\]\s*([^-\n]+?)\s*-\s*/i);
        if (match?.[1]) return match[1].trim();
    }
    return "";
}

function parseQtyFromNotes(...notes: Array<string | null | undefined>) {
    for (const raw of notes) {
        const match = String(raw ?? "").match(/Adet:\s*(\d+)/i);
        if (match) return Math.max(1, safeNumber(match[1], 1));
    }
    return null;
}

function parseProductTypeFromNotes(...notes: Array<string | null | undefined>): ProductType | null {
    for (const raw of notes) {
        const match = String(raw ?? "").match(/\[ÖLÇÜ\]\s*[^-\n]+\s*-\s*([^\n]+)/i)
            ?? String(raw ?? "").match(/\[OLCU\]\s*[^-\n]+\s*-\s*([^\n]+)/i);
        if (match?.[1]) return normalizeProductType(match[1].trim());
    }
    return null;
}

function parseSaleUnitPriceFromNotes(...notes: Array<string | null | undefined>) {
    for (const raw of notes) {
        const match = String(raw ?? "").match(/(?:Satış fiyatı|Birim fiyat):\s*([₺\d.,\s]+)/i);
        if (match) {
            const normalized = match[1].replace(/[₺\s]/g, "").replace(/\./g, "").replace(",", ".");
            return safeNumber(normalized);
        }
    }
    return null;
}

function resolveMeasurementFields(appt: MeasuredAppointment) {
    const noteSources = [appt.measurement_notes, appt.note];
    const structured = hasStructuredMeasurementNotes(...noteSources);
    const parsedDims = parseDimensionsFromNotes(...noteSources);
    const parsedRoom = parseRoomFromNotes(...noteSources);
    const parsedQty = parseQtyFromNotes(...noteSources);
    const parsedType = parseProductTypeFromNotes(...noteSources);
    const parsedUnitPrice = parseSaleUnitPriceFromNotes(...noteSources);
    const notes = noteSources.filter(Boolean).join("\n");

    const preferNotes = structured && Boolean(parsedDims?.width_cm && parsedDims?.height_cm);

    return {
        structured,
        notes,
        productType: normalizeProductType(preferNotes && parsedType ? parsedType : (appt.product_type || parsedType || "stor")),
        width_cm: preferNotes
            ? safeNumber(parsedDims?.width_cm)
            : safeNumber(appt.width_cm ?? appt.rounded_width_cm ?? parsedDims?.width_cm, 100),
        height_cm: preferNotes
            ? safeNumber(parsedDims?.height_cm)
            : safeNumber(appt.height_cm ?? appt.rounded_height_cm ?? parsedDims?.height_cm, 200),
        room: (preferNotes && parsedRoom) ? parsedRoom : (appt.room_name || parsedRoom || ""),
        qty: preferNotes && parsedQty ? parsedQty : Math.max(1, safeNumber(appt.quantity, parsedQty ?? 1)),
        unit_price: preferNotes && parsedUnitPrice
            ? parsedUnitPrice
            : safeNumber(appt.unit_price, parsedUnitPrice ?? 0),
        supplierCost: Math.max(safeNumber(appt.supplier_unit_cost), parseTurkishMoney(notes)),
        supplierName: parseSupplierName(notes),
    };
}

function supplierCostFromCatalog(product: ProductRow | null, supplierId: string, supplierPrices: SupplierPriceRow[]) {
    if (!product) return 0;
    const normalizedName = normalizeText(product.name);
    const normalizedCategory = normalizeText(product.category);
    const hit = supplierPrices.find((price) => {
        if (supplierId && price.supplier_id !== supplierId) return false;
        if (product.id && price.product_id === product.id) return true;
        return normalizeText(price.product_name) === normalizedName || normalizeText(price.product_category) === normalizedCategory;
    });
    return safeNumber(hit?.unit_cost, safeNumber(product.cost_price));
}

function buildOrderItemFromAppointment(
    appt: MeasuredAppointment,
    products: ProductRow[],
    suppliers: Supplier[],
    supplierPrices: SupplierPriceRow[],
): OrderItemUI {
    const resolved = resolveMeasurementFields(appt);
    const productType = resolved.productType;
    const product = products.find((p) => appt.model_name && normalizeText(p.name) === normalizeText(appt.model_name))
        ?? findProductByType(products, productType);

    let supplierId = appt.supplier_id || "";
    if (!supplierId && resolved.supplierName) {
        supplierId = suppliers.find((s) => normalizeText(s.name) === normalizeText(resolved.supplierName))?.id || "";
    }

    const supplierCost = Math.max(
        resolved.supplierCost,
        supplierCostFromCatalog(product, supplierId, supplierPrices),
    );

    const unit_price = resolved.unit_price > 0
        ? resolved.unit_price
        : safeNumber(product?.unit_price);

    return {
        key: uid(),
        product_id: product?.id || "",
        product_name: appt.model_name || product?.name || "",
        model_name: appt.model_name || product?.name || "",
        color_name: appt.color_name || "",
        supplier_id: supplierId,
        supplier_cost: supplierCost,
        product_type: product ? ((normalizeCategory(product.category) || productType) as ProductType) : productType,
        room: resolved.room,
        width_cm: resolved.width_cm,
        height_cm: resolved.height_cm,
        qty: resolved.qty,
        unit_price,
        pile: "2",
        mechanism: "standard",
        control_type: "corded",
    };
}

export default function NewOrder() {
    const nav = useNavigate();
    const location = useLocation();

    // location.state'i component construct anında oku — herhangi bir useEffect çalışmadan önce.
    // Bu sayede useState lazy initializer'lar quote verisini render #0'da kullanabilir.
    const savedQuoteState = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('order_quote_state') || '{}') : {};
    const _qs = (location.state ?? {}) as Record<string, any>;
    // Use location.state if provided, otherwise use saved state from localStorage
    const quoteState = Object.keys(_qs).length > 0 ? _qs : savedQuoteState;
    // fromQuote: Quotes.tsx'ten "Siparişe Çevir" ile gelindiğinde true
    const isQuoteConversion = !!(quoteState.fromQuote || (quoteState.fromAppointment && (quoteState.selectedProductType || quoteState.widthCm || quoteState.heightCm)));

    const [companyId, setCompanyId] = useState<string>("");
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [measuredAppointments, setMeasuredAppointments] = useState<MeasuredAppointment[]>([]);
    const [loadingContext, setLoadingContext] = useState(true);

    // Quote dönüşümünde müşteri bilgilerini anında başlat — useEffect bekleme
    const [customerInput, setCustomerInput] = useState<string>(isQuoteConversion ? (quoteState.customerName ?? "") : "");
    const [customerId, setCustomerId] = useState<string>(isQuoteConversion ? (quoteState.customerId ?? "") : "");

    // Auto-save quote state to localStorage
    useEffect(() => {
      localStorage.setItem('order_quote_state', JSON.stringify(quoteState));
    }, [quoteState]);
    const [newPhone, setNewPhone] = useState<string>(isQuoteConversion ? (_qs.phone ?? "") : "");
    const [sourceAppointmentId, setSourceAppointmentId] = useState<string>(
        isQuoteConversion ? (_qs.measurementId || _qs.appointmentId || "") : ""
    );
    const [pendingConvertAppointmentId, setPendingConvertAppointmentId] = useState<string>("");
    const [note, setNote] = useState("");
    const [status, setStatus] = useState<Status>("new_order");

    // Quote dönüşümünde ürün satırını anında başlat — varsayılan "Salon 100×200" satırı gelmesin
    const [items, setItems] = useState<OrderItemUI[]>(() => {
        if (isQuoteConversion) {
            return [{
                key: uid(),
                product_id: _qs.selectedProductId || "",
                product_type: ((_qs.selectedProductType as ProductType) || "stor"),
                product_name: _qs.selectedProductName || _qs.selectedModelName || "",
                model_name: _qs.selectedModelName || _qs.selectedProductName || "",
                color_name: _qs.selectedColorName || "",
                supplier_id: _qs.selectedSupplierId || _qs.supplierId || "",
                supplier_cost: safeNumber(_qs.selectedSupplierCost ?? _qs.supplierCost, 0),
                unit_price: safeNumber(_qs.selectedCatalogPrice, 0),
                width_cm: safeNumber(_qs.widthCm, 100),
                height_cm: safeNumber(_qs.heightCm, 200),
                qty: safeNumber(_qs.qty, 1),
                room: _qs.roomName || "",
                pile: "2",
                mechanism: "standard",
                control_type: "corded",
            }];
        }
        return [{
            key: uid(), product_id: "", product_name: "", model_name: "", color_name: "",
            supplier_id: "", supplier_cost: 0, product_type: "stor", room: "Salon",
            width_cm: 100, height_cm: 200, qty: 1, unit_price: 0, pile: "2", mechanism: "standard", control_type: "corded",
        }];
    });

    const [fabricSupplierId, setFabricSupplierId] = useState<string>(isQuoteConversion ? (_qs.selectedSupplierId || "") : "");
    const [assignedTo, setAssignedTo] = useState<string>("");
    const [staffList, setStaffList] = useState<StaffOption[]>([]);
    const [newStaffName, setNewStaffName] = useState("");
    const [newStaffRole, setNewStaffRole] = useState("installer");
    const [showAddStaff, setShowAddStaff] = useState(false);
    const { effectiveRole: role, realRole, viewingUserId } = useRole();
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string>("");
    // Quote dönüşümünde randevu ekleme formu gösterilmesin
    const [wantAppointment, setWantAppointment] = useState(!isQuoteConversion);
    const [apptTitle, setApptTitle] = useState<string>("Ölçü");
    const [apptDate, setApptDate] = useState<string>("");
    const [apptTime, setApptTime] = useState<string>("");
    const [apptAddress, setApptAddress] = useState<string>(isQuoteConversion ? (_qs.address ?? "") : "");
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [supplierPrices, setSupplierPrices] = useState<SupplierPriceRow[]>([]);

    // Filtre state'leri
    const [olcuSearch, setOlcuSearch] = useState("");
    const [olcuProductFilter, setOlcuProductFilter] = useState("");
    const [olcuDateFilter, setOlcuDateFilter] = useState("");

    async function loadCompanyProducts(company_id: string) {
        let { data, error }: { data: any[] | null; error: any } = await supabase
            .from("products").select("id,name,category,unit_price,cost_price,min_price,min_area,rounding_rule,pricing_mode,is_active")
            .eq("company_id", company_id).eq("is_active", true);
        if (error && /cost_price/i.test(String(error.message || ""))) {
            const fallback = await supabase.from("products")
                .select("id,name,category,unit_price,min_price,min_area,rounding_rule,pricing_mode,is_active")
                .eq("company_id", company_id).eq("is_active", true);
            data = fallback.data; error = fallback.error;
        }
        if (error) throw error;
        return (data ?? []) as ProductRow[];
    }

    async function loadCompanyStaff(company_id: string) {
        const { data: employees, error: eErr } = await supabase.from("employees")
            .select("id,user_id,full_name,target_role,is_active").eq("company_id", company_id);
        if (eErr) throw eErr;
        const employeeRows = (employees ?? []).filter((e: any) => e.is_active !== false);
        const { data: members, error: mErr } = await supabase.from("company_members").select("user_id").eq("company_id", company_id);
        if (mErr) throw mErr;
        const employeeIds = employeeRows.map((e: any) => e.user_id).filter(Boolean);
        const memberIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
        const ids = Array.from(new Set(employeeIds.length > 0 ? employeeIds : memberIds));
        if (ids.length === 0) {
            return employeeRows.map((e: any) => ({ id: e.user_id || `employee:${e.id}`, userId: e.user_id || null, employeeId: e.id || null, full_name: e.full_name || "İsimsiz", role: e.target_role || "installer" }));
        }
        const { data: profiles, error: pErr } = await supabase.from("profiles").select("user_id,full_name,role").in("user_id", ids);
        if (pErr) throw pErr;
        const profileById = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
        const staffRows: StaffOption[] = employeeRows.length > 0
            ? employeeRows.map((e: any) => { const p = profileById.get(e.user_id); return { id: e.user_id || `employee:${e.id}`, userId: e.user_id || null, employeeId: e.id || null, full_name: e.full_name || p?.full_name || "İsimsiz", role: p?.role || e.target_role || "installer" }; })
            : (profiles ?? []).map((p: any) => ({ id: p.user_id, userId: p.user_id, employeeId: null, full_name: p.full_name || "İsimsiz", role: p.role || "staff" }));
        return staffRows.filter((p) => { const r = normalizeRole(p.role); return r === "installer" || r === "measurement" || r === "personnel"; })
            .map((p) => ({ id: p.id, userId: p.userId, employeeId: p.employeeId, full_name: p.full_name || "İsimsiz", role: p.role || "staff" }));
    }

    async function handleCreateInlineStaff() {
        if (!companyId) { setErr("Şirket bilgisi yüklenemedi."); return; }
        if (!newStaffName.trim()) { setErr("Personel adı zorunlu."); return; }
        setErr("");
        const { data, error } = await supabase.from("employees")
            .insert([{ company_id: companyId, full_name: newStaffName.trim(), target_role: newStaffRole, is_active: true }])
            .select("id,full_name,target_role").single();
        if (error) { setErr(error.message); return; }
        const staff = { id: `employee:${data.id}`, userId: null, employeeId: data.id, full_name: data.full_name || newStaffName.trim(), role: data.target_role || newStaffRole };
        setStaffList((prev) => [...prev, staff].sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")));
        setAssignedTo(staff.id);
        setNewStaffName("");
        setShowAddStaff(false);
    }

    async function generateInvoiceNo() { return "INV-" + Math.random().toString(36).substring(2, 8).toUpperCase(); }

    useEffect(() => {
        let alive = true;
        async function loadInitialData() {
            setLoadingContext(true); setErr("");
            try {
                const ctx = await getContext();
                if (!alive) return;
                setCompanyId(ctx.company_id);
                const [customersRes, suppliersRes, companyProducts, companyStaff, measuredRes, supplierPricesRes] = await Promise.all([
                    supabase.from("customers").select("id,name,phone").eq("company_id", ctx.company_id).order("name", { ascending: true }).limit(1000),
                    supabase.from("suppliers").select("id,name").eq("company_id", ctx.company_id).order("name", { ascending: true }),
                    loadCompanyProducts(ctx.company_id),
                    loadCompanyStaff(ctx.company_id),
                    (async () => {
                        const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                        // Genişletilmiş select — measurement_notes, assigned_user_id, rounded_* sütunları
                        // appointments tablosunda olmayabilir; hata alınırsa sadece temel sütunlarla tekrar dener.
                        let q = supabase.from("appointments")
                            .select("id,customer_id,address,note,measurement_notes,assigned_to,assigned_user_id,start_at,room_name,width_cm,height_cm,rounded_width_cm,rounded_height_cm,product_type,model_name,color_name,quantity,unit_price,supplier_id,supplier_unit_cost,customer:customers(name,phone)")
                            .eq("company_id", ctx.company_id).in("status", ["measured", "done", "planned", "onway"]).eq("type", "measurement")
                            .order("start_at", { ascending: false }).limit(100);
                        if (role === "installer" || role === "measurement" || role === "personnel")
                            q = q.or(`assigned_to.eq.${targetId},assigned_user_id.eq.${targetId}`);
                        const result = await q;
                        if (!result.error) return result;

                        // Fallback: genişletilmiş sütunlar olmadan tekrar dene
                        let q2 = supabase.from("appointments")
                            .select("id,customer_id,address,note,assigned_to,start_at,room_name,width_cm,height_cm,product_type,model_name,color_name,quantity,unit_price,supplier_id,supplier_unit_cost,customer:customers(name,phone)")
                            .eq("company_id", ctx.company_id).in("status", ["measured", "done", "planned", "onway"]).eq("type", "measurement")
                            .order("start_at", { ascending: false }).limit(100);
                        if (role === "installer" || role === "measurement" || role === "personnel")
                            q2 = q2.eq("assigned_to", targetId);
                        return q2;
                    })(),
                    supabase.from("supplier_product_prices").select("supplier_id,product_name,product_category,unit_cost").eq("company_id", ctx.company_id),
                ]);
                if (!alive) return;
                setCustomers(customersRes.error ? [] : ((customersRes.data ?? []) as Customer[]));
                setSuppliers(suppliersRes.error ? [] : ((suppliersRes.data ?? []) as Supplier[]));
                setProducts(companyProducts);
                if (!supplierPricesRes.error) {
                    setSupplierPrices((supplierPricesRes.data ?? []) as SupplierPriceRow[]);
                } else if (/(product_id|product_category)/i.test(String(supplierPricesRes.error.message || ""))) {
                    const fp = await supabase.from("supplier_product_prices").select("supplier_id,product_name,unit_cost").eq("company_id", ctx.company_id);
                    setSupplierPrices(fp.error ? [] : ((fp.data ?? []) as SupplierPriceRow[]));
                } else if (/(product_name|unit_cost)/i.test(String(supplierPricesRes.error.message || ""))) {
                    const fp = await supabase.from("supplier_product_prices").select("supplier_id,product_type,unit_price").eq("company_id", ctx.company_id);
                    setSupplierPrices(fp.error ? [] : ((fp.data ?? []) as SupplierPriceRow[]).map((p) => ({ ...p, product_name: p.product_type ?? null, product_category: p.product_type ?? null, unit_cost: p.unit_price ?? 0 })));
                } else { setSupplierPrices([]); }
                setMeasuredAppointments(measuredRes.error ? [] : ((measuredRes.data ?? []) as MeasuredAppointment[]));
                if (alive) setStaffList(companyStaff);
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message ?? "Veriler yüklenemedi.");
                setCustomers([]); setSuppliers([]); setProducts([]);
            } finally { if (alive) setLoadingContext(false); }
        }
        loadInitialData();
        return () => { alive = false; };
    }, [role, viewingUserId, realRole]);

    const selectedCustomer = useMemo(() => customers.find((c) => c.id === customerId) ?? null, [customers, customerId]);
    const filteredAppointments = useMemo(() => {
        return measuredAppointments.filter(appt => {
            const customer = pickAppointmentCustomer(appt.customer);
            const name = (customer?.name ?? "").toLocaleLowerCase("tr-TR");
            if (olcuSearch && !name.includes(olcuSearch.toLocaleLowerCase("tr-TR"))) return false;
            if (olcuProductFilter && appt.product_type !== olcuProductFilter) return false;
            if (olcuDateFilter && appt.start_at && !appt.start_at.startsWith(olcuDateFilter)) return false;
            return true;
        });
    }, [measuredAppointments, olcuSearch, olcuProductFilter, olcuDateFilter]);

    function convertAppointmentToOrder(appt: MeasuredAppointment, options?: { keepExtraLines?: boolean }) {
        const apptCustomer = pickAppointmentCustomer(appt.customer);
        const measurementLine = buildOrderItemFromAppointment(appt, products, suppliers, supplierPrices);

        setSourceAppointmentId(appt.id);
        if (appt.customer_id) setCustomerId(appt.customer_id);
        if (apptCustomer?.name) setCustomerInput(apptCustomer.name);
        if (apptCustomer?.phone) setNewPhone(apptCustomer.phone);
        if (appt.address) setApptAddress(appt.address);
        if (appt.assigned_to) setAssignedTo(appt.assigned_to);

        const noteParts = [appt.measurement_notes?.trim(), appt.note?.trim()].filter(Boolean);
        if (noteParts.length > 0) setNote(`[KESIF / OLCU]\n${noteParts.join("\n\n")}`);

        if (measurementLine.supplier_id) setFabricSupplierId(measurementLine.supplier_id);
        setItems((prev) => {
            if (options?.keepExtraLines && prev.length > 1) return [measurementLine, ...prev.slice(1)];
            return [measurementLine];
        });
        setWantAppointment(false);
        setErr("");
    }

    useEffect(() => {
        const state = location.state as any;
        if (!state?.fromAppointment && !state?.fromQuote && !state?.visualPreviewId && !state?.measurementId && !state?.appointmentId && !state?.customerId) return;

        // Müşteri ve adres alanlarını hemen set et (lazy init zaten yaptıysa üzerine yazmak sorun değil)
        if (state.customerName) setCustomerInput(state.customerName);
        if (state.customerId) setCustomerId(state.customerId);
        if (state.phone) setNewPhone(state.phone);
        if (state.address) setApptAddress(state.address);
        if (state.assignedTo) setAssignedTo(state.assignedTo);
        if (state.selectedSupplierId) setFabricSupplierId(state.selectedSupplierId);
        if (state.measurementNotes) setNote((prev) => `[ÖLÇÜ NOTLARI]\n${state.measurementNotes}\n\n${prev}`);
        if (state.measurementAreaM2 || state.totalCost || state.totalSale || state.profit) {
            const s = [
                state.measurementAreaM2 ? `m²: ${safeNumber(state.measurementAreaM2).toFixed(2)}` : null,
                state.totalCost ? `Toplam maliyet: ${formatTL(safeNumber(state.totalCost))}` : null,
                state.totalSale ? `Toplam satış: ${formatTL(safeNumber(state.totalSale))}` : null,
                state.profit ? `Kar: ${formatTL(safeNumber(state.profit))}` : null,
                state.profitRate ? `Kar oranı: %${safeNumber(state.profitRate).toFixed(2)}` : null,
            ].filter(Boolean).join("\n");
            setNote((prev) => `[ÖLÇÜ HESAP ÖZETİ]\n${s}\n\n${prev}`);
        }

        const incomingMeasurementId = state.measurementId || state.appointmentId || "";
        if (incomingMeasurementId) {
            setSourceAppointmentId(incomingMeasurementId);
            // Her akışta (quote + MeasurementEntry) DB fetch başlat — catalog yüklenince convertAppointmentToOrder çalışır
            setPendingConvertAppointmentId(incomingMeasurementId);
        }

        setWantAppointment(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state]);

    useEffect(() => {
        if (!pendingConvertAppointmentId) return;
        // Catalog verisi (products, suppliers, supplierPrices) yüklenene kadar bekle.
        // loadingContext false olunca tüm veri hazır — buildOrderItemFromAppointment doğru çalışır.
        if (loadingContext) return;

        const appt = measuredAppointments.find((item) => item.id === pendingConvertAppointmentId);
        if (appt) {
            convertAppointmentToOrder(appt);
            setPendingConvertAppointmentId("");
            return;
        }

        let alive = true;
        async function fetchAndConvert() {
            try {
                const ctx = await getContext();
                // Önce genişletilmiş sütunlarla dene
                let { data, error } = await supabase
                    .from("appointments")
                    .select("id,customer_id,address,note,measurement_notes,assigned_to,assigned_user_id,start_at,room_name,width_cm,height_cm,rounded_width_cm,rounded_height_cm,product_type,model_name,color_name,quantity,unit_price,supplier_id,supplier_unit_cost,customer:customers(name,phone)")
                    .eq("id", pendingConvertAppointmentId)
                    .eq("company_id", ctx.company_id)
                    .maybeSingle();
                // Genişletilmiş sütunlar yoksa temel sütunlarla tekrar dene
                if (error) {
                    const fb = await supabase
                        .from("appointments")
                        .select("id,customer_id,address,note,assigned_to,start_at,room_name,width_cm,height_cm,product_type,model_name,color_name,quantity,unit_price,customer:customers(name,phone)")
                        .eq("id", pendingConvertAppointmentId)
                        .eq("company_id", ctx.company_id)
                        .maybeSingle();
                    data = fb.data as any;
                    error = fb.error;
                }
                if (!alive) return;
                if (error || !data) {
                    setErr("Ölçü bilgisi alınamadı, lütfen Teklifler sayfasından tekrar seçin.");
                    return;
                }
                convertAppointmentToOrder(data as MeasuredAppointment);
                setPendingConvertAppointmentId("");
            } catch {
                if (alive) setErr("Ölçü bilgisi alınamadı, lütfen Teklifler sayfasından tekrar seçin.");
            }
        }
        void fetchAndConvert();
        return () => { alive = false; };
        // convertAppointmentToOrder intentionally excluded.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingConvertAppointmentId, loadingContext, measuredAppointments, products, suppliers, supplierPrices]);

    useEffect(() => {
        if (products.length === 0) return;
        // Quote dönüşümünde ürün satırı zaten set edildi — varsayılan stor fiyatı ezmesin
        if (isQuoteConversion) return;
        const storProduct = findProductByType(products, "stor");
        if (!storProduct) return;
        setItems((prev) => prev.map((item, index) => index === 0 && item.unit_price === 0 ? { ...item, unit_price: safeNumber(storProduct.unit_price) } : item));
    }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const trimmed = customerInput.trim().toLowerCase();
        if (!trimmed) {
            // Müşteri adı boşsa ve liste yüklendiyse temizle; yüklenmemişse state'deki ID'yi koru
            if (customers.length > 0) setCustomerId("");
            return;
        }
        const hit = customers.find((c) => (c.name ?? "").trim().toLowerCase() === trimmed);
        if (hit) setCustomerId(hit.id);
        else if (customers.length > 0) setCustomerId(""); // yüklendiyse ve eşleşme yoksa temizle
    }, [customerInput, customers]);

    useEffect(() => { if (selectedCustomer) setNewPhone(selectedCustomer.phone ?? ""); }, [selectedCustomer]);

    function updateItem(key: string, patch: Partial<OrderItemUI>) {
        setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    }

    function productForItem(item: OrderItemUI) {
        return products.find((p) => p.id === item.product_id)
            ?? products.find((p) => normalizeText(p.name) === normalizeText(item.product_name))
            ?? findProductByType(products, item.product_type);
    }

    function supplierCostForProduct(product: ProductRow | null, supplierId = "") {
        if (!product) return { supplierId: supplierId || "", cost: 0 };
        const normalizedName = normalizeText(product.name);
        const normalizedCategory = normalizeText(product.category);
        const normalizedTypeLabel = normalizeText(productLabel((normalizeCategory(product.category) || "diger") as ProductType));
        const hit = supplierPrices.find((price) => {
            if (supplierId && price.supplier_id !== supplierId) return false;
            if (product.id && price.product_id === product.id) return true;
            const pn = normalizeText(price.product_name);
            const pc = normalizeText(price.product_category);
            return pn === normalizedName || pn === normalizedCategory || pc === normalizedCategory || pc === normalizedTypeLabel;
        });
        return { supplierId: supplierId || hit?.supplier_id || "", cost: safeNumber(hit?.unit_cost, safeNumber(product.cost_price)) };
    }

    async function persistSupplierPurchasePriceForItem(item: OrderItemUI) {
        const supplierId = item.supplier_id || fabricSupplierId;
        const cost = safeNumber(item.supplier_cost);
        const product = productForItem(item);
        const productName = (item.product_name || product?.name || productLabel(item.product_type)).trim();
        if (!companyId || !supplierId || !productName || cost <= 0) return "";
        const payload = { company_id: companyId, supplier_id: supplierId, product_name: productName, product_category: product?.category || productLabel(item.product_type), unit_cost: cost, currency: "TRY", note: "Sipariş ekranından kaydedildi" };
        const { data, error } = await supabase.from("supplier_product_prices").upsert([payload], { onConflict: "company_id,supplier_id,product_name" }).select("supplier_id,product_name,product_category,unit_cost").single();
        if (error && /(product_id|product_name|unit_cost|product_category|currency|note)/i.test(String(error.message || ""))) {
            const fp: Record<string, any> = { company_id: payload.company_id, supplier_id: payload.supplier_id, product_type: payload.product_category, unit_price: payload.unit_cost };
            const upd = await supabase.from("supplier_product_prices").update({ unit_price: fp.unit_price }).eq("company_id", payload.company_id).eq("supplier_id", payload.supplier_id).eq("product_type", fp.product_type).select("id");
            let rd: any = null;
            if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) {
                rd = { supplier_id: payload.supplier_id, product_name: fp.product_type, product_category: fp.product_type, unit_cost: fp.unit_price };
            } else {
                const retry = await supabase.from("supplier_product_prices").insert([fp]).select("supplier_id,product_type,unit_price").single();
                if (retry.error) return retry.error.message;
                rd = { ...retry.data, product_name: retry.data?.product_type ?? null, product_category: retry.data?.product_type ?? null, unit_cost: retry.data?.unit_price ?? 0 };
            }
            if (rd) setSupplierPrices((prev) => { const next = prev.filter((p) => !(p.supplier_id === rd.supplier_id && normalizeText(p.product_name) === normalizeText(rd.product_name))); return [...next, rd as SupplierPriceRow]; });
            return "";
        }
        if (error) return error.message;
        if (data) setSupplierPrices((prev) => { const next = prev.filter((p) => !(p.supplier_id === data.supplier_id && normalizeText(p.product_name) === normalizeText(data.product_name))); return [...next, data as SupplierPriceRow]; });
        return "";
    }

    async function persistSupplierPurchasePriceFromField(key: string) {
        const item = items.find((r) => r.key === key);
        if (!item) return;
        const warning = await persistSupplierPurchasePriceForItem(item);
        if (warning) setErr(`Tedarikçi alış fiyatı kaydedilemedi: ${warning}`);
    }

    function applySupplierToItem(key: string, supplierId: string) {
        const item = items.find((x) => x.key === key);
        if (!item) return;
        const product = productForItem(item);
        const listedCost = supplierCostForProduct(product, supplierId);
        updateItem(key, { supplier_id: supplierId, supplier_cost: listedCost.cost });
    }

    function applyProductIdToItem(key: string, productId: string) {
        if (!productId) { updateItem(key, { product_id: "", product_name: "" }); return; }
        const hit = products.find((p) => p.id === productId);
        if (!hit) return;
        const currentItem = items.find((item) => item.key === key);
        const supplierId = currentItem?.supplier_id || fabricSupplierId;
        const listedCost = supplierCostForProduct(hit, supplierId);
        updateItem(key, { product_id: hit.id, product_name: hit.name || "", model_name: currentItem?.model_name || hit.name || "", product_type: (normalizeCategory(hit.category) || "diger") as ProductType, supplier_id: currentItem?.supplier_id || listedCost.supplierId || "", unit_price: safeNumber(hit.unit_price), supplier_cost: listedCost.cost });
    }

    function applyProductTypeToItem(key: string, productType: ProductType) {
        const item = items.find((x) => x.key === key);
        const product = findProductByType(products, productType);
        if (!item || !product) { updateItem(key, { product_type: productType }); return; }
        const supplierId = item.supplier_id || fabricSupplierId;
        const listedCost = supplierCostForProduct(product, supplierId);
        updateItem(key, { product_type: productType, product_id: product.id, product_name: product.name || item.product_name, model_name: item.model_name || product.name || "", supplier_id: item.supplier_id || listedCost.supplierId || "", unit_price: item.unit_price || safeNumber(product.unit_price), supplier_cost: listedCost.cost });
    }

    useEffect(() => {
        if (products.length === 0 && supplierPrices.length === 0) return;
        setItems((prev) => {
            let changed = false;
            const next = prev.map((item) => {
                const product = productForItem(item);
                const supplierId = item.supplier_id || fabricSupplierId;
                const listedCost = supplierCostForProduct(product, supplierId);
                const nextSupplierId = item.supplier_id || listedCost.supplierId || "";
                const shouldFillCost = safeNumber(item.supplier_cost) <= 0 || (supplierId && item.supplier_id === supplierId);
                const nextCost = shouldFillCost ? listedCost.cost : item.supplier_cost;
                if (nextSupplierId === item.supplier_id && nextCost === item.supplier_cost) return item;
                changed = true;
                return { ...item, supplier_id: nextSupplierId, supplier_cost: nextCost };
            });
            return changed ? next : prev;
        });
    }, [fabricSupplierId, products, supplierPrices]);

    function removeItem(key: string) { setItems((prev) => prev.length <= 1 ? prev : prev.filter((x) => x.key !== key)); }

    function addItem() {
        const storProduct = findProductByType(products, "stor");
        setItems((prev) => [...prev, { key: uid(), product_id: "", product_name: "", model_name: "", color_name: "", supplier_id: "", supplier_cost: 0, product_type: "stor", room: "", width_cm: 100, height_cm: 200, qty: 1, unit_price: safeNumber(storProduct?.unit_price), pile: "2", mechanism: "standard", control_type: "corded" }]);
    }

    const itemsComputed = useMemo(() => {
        return items.map((it) => {
            const width = Math.max(0, safeNumber(it.width_cm));
            const height = Math.max(0, safeNumber(it.height_cm));
            const qty = Math.max(1, safeNumber(it.qty, 1));
            const unit = Math.max(0, safeNumber(it.unit_price));
            const supplierCost = Math.max(0, safeNumber(it.supplier_cost));
            const matchedProduct = findProductByType(products, it.product_type);
            let { roundedWidth, roundedHeight, area } = calcAreaM2ByProduct(width, height, matchedProduct);
            let line_total = calcLineTotalByProduct(area, qty, unit, matchedProduct);
            let fabric_width_cm: number | null = null;
            let calculation_note = "";
            if (it.product_type === "tul" || it.product_type === "fon") {
                const pm = it.pile === "3" ? 3 : 2;
                fabric_width_cm = width * pm + 15;
                area = fabric_width_cm / 100; roundedWidth = width; roundedHeight = height;
                line_total = area * qty * unit;
                calculation_note = `Pile 1'e ${pm}: ${width} x ${pm} + 15 cm dikim payi = ${fabric_width_cm} cm kumas`;
            }
            if (it.product_type === "jalousie" || it.product_type === "picasso") {
                const mf = it.mechanism === "reducer" ? 1.12 : 1;
                const cf = it.control_type === "tape" ? 1.05 : 1;
                line_total = line_total * mf * cf;
                calculation_note = `${productLabel(it.product_type)}: ${it.mechanism === "reducer" ? "Reduktorlu" : "Reduktorsuz"} / ${it.control_type === "tape" ? "Kurdelali" : "Ipli"}`;
            }
            return { ...it, width_cm: width, height_cm: height, qty, unit_price: unit, supplier_cost: supplierCost, supplier_total_cost: supplierCost * area * qty, roundedWidth, roundedHeight, area, line_total, fabric_width_cm, calculation_note };
        });
    }, [items, products]);

    const grandTotal = useMemo(() => itemsComputed.reduce((acc, it) => acc + safeNumber(it.line_total), 0), [itemsComputed]);
    const totalCost = useMemo(() => itemsComputed.reduce((acc, it) => acc + safeNumber(it.supplier_total_cost), 0), [itemsComputed]);
    const profit = useMemo(() => grandTotal - totalCost, [grandTotal, totalCost]);

    async function ensureCustomerId(cid: string): Promise<string> {
        if (customerId) return customerId;
        const name = customerInput.trim();
        if (!name) throw new Error("Lütfen müşteri seç ya da isim yaz.");
        const existing = customers.find((c) => (c.name ?? "").trim().toLowerCase() === name.toLowerCase());
        if (existing?.id) return existing.id;

        // Telefon duplicate kontrolü — yeni müşteri oluşturulmadan önce
        if (newPhone.trim()) {
            const duplicate = await findDuplicatePhone({ companyId: cid, phone: newPhone.trim() });
            if (duplicate) {
                throw new Error(duplicatePhoneMessage(duplicate.name, newPhone.trim()));
            }
        }

        const payload = { company_id: cid, name, phone: newPhone.trim() ? newPhone.trim() : null };
        const { data, error } = await supabase.from("customers").insert([payload]).select("id,name,phone").single();
        if (error) {
            throw new Error(phoneConstraintMessage(error.message, newPhone.trim()));
        }
        const nc = data as Customer;
        setCustomers((prev) => [...prev, nc].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "tr")));
        setCustomerId(nc.id);
        return nc.id;
    }

    async function createSupplierExpense(params: { company_id: string; amount: number; category: string; supplier_id?: string; orderId: string; customerName: string; }) {
        const amount = safeNumber(params.amount);
        if (amount <= 0 || !params.supplier_id) return;
        const supplierName = suppliers.find(s => s.id === params.supplier_id)?.name ?? params.category;
        await supabase.from("expenses").insert({ company_id: params.company_id, expense_date: new Date().toISOString(), amount, category: params.category, vendor: supplierName, supplier_id: params.supplier_id, order_id: params.orderId, status: "unpaid", note: `Sipariş maliyeti - ${params.category} - Müşteri: ${params.customerName}` });
    }

    async function createSalesInvoiceForOrder(params: { company_id: string; orderId: string; customerId: string; customerName: string; items: any[]; notes: string; total: number; status: Status; }) {
        const invoiceNo = await generateInvoiceNo();
        const taxRate = 20;
        const taxExclusive = Number((params.total / (1 + taxRate / 100)).toFixed(2));
        const taxAmount = Number((params.total - taxExclusive).toFixed(2));
        const invoiceStatus = params.status === "paid" ? "paid" : params.status === "draft" ? "draft" : "sent";
        const { data: invoiceRow, error: invoiceErr } = await supabase.from("invoices").insert([{ company_id: params.company_id, order_id: params.orderId, customer_id: params.customerId, invoice_type: "sales", invoice_no: invoiceNo, date: new Date().toISOString(), total_tax_exclusive: taxExclusive, total_tax_amount: taxAmount, total_tax_inclusive: params.total, status: invoiceStatus, notes: params.notes || `Siparis faturasi - ${params.customerName}` }]).select("id").single();
        if (invoiceErr) throw invoiceErr;
        const invoiceItems = params.items.map((it) => ({ invoice_id: invoiceRow.id, company_id: params.company_id, description: `${productLabel(it.product_type)} - ${it.width_cm}x${it.height_cm} cm`, quantity: it.qty, unit_price: it.unit_price, tax_rate: taxRate, line_total: it.line_total }));
        const { error: itemErr } = await supabase.from("invoice_items").insert(invoiceItems);
        if (itemErr) throw itemErr;
    }

    async function handleSave() {
        setErr("");
        if (!companyId) { setErr("Şirket bilgisi yüklenemedi."); return; }
        if (!customerId && !customerInput.trim()) { setErr("Lütfen müşteri seçin."); return; }
        if (itemsComputed.length === 0) { setErr("En az 1 ürün eklemelisiniz."); return; }
        setSaving(true);
        try {
            const supplierPriceWarnings = (await Promise.all(items.map((item) => persistSupplierPurchasePriceForItem(item)))).filter(Boolean);
            const cid = await ensureCustomerId(companyId);
            const customerName = selectedCustomer?.name?.trim() || customerInput.trim() || "Müşteri";
            const selectedStaff = staffList.find((s) => s.id === assignedTo) ?? null;
            const assignedUserId = selectedStaff?.userId || (assignedTo && !assignedTo.startsWith("employee:") ? assignedTo : "");
            const deposit = 0;

            // Validate: "Ödendi" durumunda deposit veya tam ödeme gerekli
            if (status === "paid" && deposit <= 0) {
              throw new Error("Sipariş 'Ödendi' durumunda ise ödeme kaydı gereklidir. Lütfen kapora veya tam ödeme tutarı giriniz.");
            }

            const remaining = Math.max(grandTotal - deposit, 0);
            const overpayment = Math.max(deposit - grandTotal, 0);
            const paymentNote = overpayment > 0 ? `Fazla tahsilat / müşteri alacağı: ${overpayment.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}` : "";
            // Validate items before creating order to prevent orphaned records
            for (const it of itemsComputed) {
              if (!it.width_cm || it.width_cm <= 0) throw new Error(`${it.product_name || it.product_type}: Genişlik 0'dan büyük olmalı`);
              if (!it.height_cm || it.height_cm <= 0) throw new Error(`${it.product_name || it.product_type}: Yükseklik 0'dan büyük olmalı`);
              if (!it.qty || it.qty <= 0) throw new Error(`${it.product_name || it.product_type}: Miktar 0'dan büyük olmalı`);
            }

            const { data: orderRow, error: orderErr } = await supabase.from("orders").insert([{ customer_id: cid, company_id: companyId, note: [note.trim(), paymentNote].filter(Boolean).join("\n") || null, status, total_amount: grandTotal, deposit_amount: deposit, paid_amount: Math.max(deposit, status === "paid" ? grandTotal : 0), remaining_amount: status === "paid" ? 0 : remaining, fabric_cost: safeNumber(totalCost), mechanism_cost: 0, installation_cost: 0, profit: safeNumber(profit), assigned_to: assignedUserId || null }]).select("id").single();
            if (orderErr) throw orderErr;
            const orderId = orderRow.id;

            if (deposit > 0) {
              const { error: paymentErr } = await supabase.from("payments").insert({ company_id: companyId, order_id: orderId, payment_date: new Date().toISOString(), amount: deposit, method: "kapora", note: overpayment > 0 ? paymentNote : "Kapora / ön ödeme" });
              if (paymentErr) {
                // Payment error - delete order to prevent orphan
                await supabase.from("orders").delete().eq("id", orderId);
                throw new Error(`Ödeme kaydı oluşturulamadı: ${paymentErr.message}`);
              }
            }

            const itemsPayload = itemsComputed.map((it) => ({ order_id: orderId, company_id: companyId, product_type: it.product_type, width_cm: it.width_cm, height_cm: it.height_cm, qty: it.qty, unit_price: it.unit_price, line_total: it.line_total, room: it.room || null, note: [it.product_name, it.model_name, it.color_name].filter(Boolean).join(" / ") || null, fabric_width_cm: it.fabric_width_cm, sewing_allowance_cm: it.product_type === "tul" || it.product_type === "fon" ? 15 : null, calculation_note: it.calculation_note || null, supplier_id: it.supplier_id || fabricSupplierId || null, supplier_unit_cost: it.supplier_cost, supplier_total_cost: it.supplier_total_cost, profit: it.line_total - it.supplier_total_cost, product_options: { product_id: it.product_id, product_name: it.product_name, model_name: it.model_name, color_name: it.color_name, pile: it.pile, mechanism: it.mechanism, control_type: it.control_type } }));
            const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
            if (itemsErr) {
              // Items error - delete order + payment to prevent orphans
              await supabase.from("orders").delete().eq("id", orderId);
              throw new Error(`Sipariş kalemleri eklenemedi: ${itemsErr.message}`);
            }
            if (wantAppointment && apptDate && apptTime) {
                const startAt = new Date(`${apptDate}T${apptTime}:00`).toISOString();
                const { data: appointmentRow, error: apptErr } = await supabase.from("appointments").insert([{ type: "measurement", status: "planned", customer_id: cid, order_id: orderId, title: apptTitle || "Ölçü", address: apptAddress || null, start_at: startAt, company_id: companyId, assigned_to: assignedUserId || null, assigned_user_id: assignedUserId || null, assigned_role: assignedUserId ? "installer" : null }]).select("id").single();
                if (apptErr) {
                  console.error("Appointment creation error:", apptErr);
                  alert("Sipariş oluşturuldu ama randevu kaydı yapılamadı. Lütfen randevuyu manuel olarak oluşturun.");
                } else if (appointmentRow?.id) {
                    try {
                      await scheduleReminderNotification({
                        id: `appointment:${appointmentRow.id}`,
                        title: apptTitle || "Ölçü Randevusu",
                        customerName,
                        phone: selectedCustomer?.phone || newPhone,
                        address: apptAddress || "",
                        taskType: "measurement",
                        startAt,
                        reminderOffset: getNotificationSettings().defaultReminderOffset,
                        detailUrl: `/appointments/${appointmentRow.id}`,
                      });
                    } catch (reminderErr) {
                      console.error("Reminder scheduling error:", reminderErr);
                      // Don't fail the whole operation for reminder error
                    }
                }
            }
            const firstSupplierId = fabricSupplierId || itemsComputed.find((it) => it.supplier_id)?.supplier_id || "";
            const supplierExpenseAmount = itemsComputed.reduce((acc, it) => acc + safeNumber(it.supplier_total_cost), 0);
            if (supplierExpenseAmount > 0 && firstSupplierId) await createSupplierExpense({ company_id: companyId, amount: supplierExpenseAmount, category: "Kumaş / Ürün", supplier_id: firstSupplierId, orderId, customerName });
            await createSalesInvoiceForOrder({ company_id: companyId, orderId, customerId: cid, customerName, items: itemsComputed, notes: note, total: grandTotal, status });
            const cariWarnings: string[] = [];
            for (const it of itemsComputed) {
                const suppId = it.supplier_id || fabricSupplierId;
                const cost = it.supplier_total_cost;
                if (!suppId) continue;
                if (cost <= 0) { cariWarnings.push(`"${it.product_name || it.product_type}" ürününde alış maliyeti girilmemiş.`); continue; }
                const { data: existing } = await supabase.from("supplier_transactions").select("id").eq("order_id", orderId).eq("supplier_id", suppId).eq("transaction_type", "debt").maybeSingle();
                if (existing) continue;
                const { error: cariErr } = await supabase.from("supplier_transactions").insert({ company_id: companyId, supplier_id: suppId, order_id: orderId, transaction_date: new Date().toISOString(), transaction_type: "debt", amount: cost, description: `${customerName} - ${it.product_name || productLabel(it.product_type)} sipariş maliyeti`, reference_no: orderId.slice(0, 8).toUpperCase() });
                if (cariErr) cariWarnings.push(`Cari hareket oluşturulamadı: ${cariErr.message}`);
            }
            if (cariWarnings.length > 0) console.warn("Cari uyarılar:", cariWarnings);
            // Quotes.tsx'ten "Siparişe Çevir" ile gelindiyse ölçü kaydına order_id yaz
            if (sourceAppointmentId) {
                const { error: updErr } = await supabase
                    .from("appointments")
                    .update({ order_id: orderId })
                    .eq("id", sourceAppointmentId)
                    .eq("company_id", companyId);
                if (updErr) console.warn("Teklif order_id güncellenemedi:", updErr.message);
            }
            alert(supplierPriceWarnings.length > 0 ? `Sipariş kaydedildi. Bazı alış fiyatları yazılamadı: ${supplierPriceWarnings.join(" | ")}` : "Sipariş başarıyla kaydedildi!");
            // Teklif dönüşümüyse Teklifler sayfasına dön (Siparişe Çevrildi görünsün), değilse Siparişler'e
            nav(sourceAppointmentId ? "/quotes" : "/orders");
        } catch (e: any) {
            setErr(e?.message ?? "Hata oluştu.");
        } finally { setSaving(false); }
    }

    if (loadingContext) return <div className="p-8 text-center">Yükleniyor...</div>;

    return (
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6 pb-28">
            {/* Başlık */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => nav(-1)} className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 transition shadow-sm">
                        <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Teklif / Sipariş Oluştur</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Alınan ölçüden teklif hazırlayın, müşteri onaylayınca siparişe çevirin.</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => window.print()} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold hover:bg-slate-50 dark:border-slate-800">PDF Oluştur</button>
                    <button onClick={() => nav("/orders")} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">İptal</button>
                    <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg">
                        {saving ? "Kaydediliyor..." : "Teklifi / Siparişi Kaydet"}
                    </button>
                </div>
            </div>

            {err && <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm font-medium">{err}</div>}

            {/* ── ALINAN ÖLÇÜLER ── */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Başlık + Filtreler */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-black text-slate-900 dark:text-white">Alınan Ölçüler</h2>
                            <p className="text-xs text-slate-400 mt-0.5">{measuredAppointments.length} kayıt · Seçip siparişe dönüştürün</p>
                        </div>
                        <button
                            onClick={() => nav("/measurements/new")}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-black text-white hover:bg-primary-700"
                        >
                            <Plus size={14} /> Yeni Ölçü Al
                        </button>
                    </div>

                    {/* Filtre satırı */}
                    <div className="flex flex-wrap gap-2">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Müşteri ara..."
                                value={olcuSearch}
                                onChange={e => setOlcuSearch(e.target.value)}
                                className="h-8 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:border-primary-400 w-24 sm:w-36"
                            />
                        </div>
                        <select
                            value={olcuProductFilter}
                            onChange={e => setOlcuProductFilter(e.target.value)}
                            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs outline-none focus:border-primary-400"
                        >
                            <option value="">Tüm Ürünler</option>
                            <option value="stor">Stor</option>
                            <option value="zebra">Zebra</option>
                            <option value="tul">Tül</option>
                            <option value="fon">Fon</option>
                            <option value="jalousie">Jaluzi</option>
                            <option value="picasso">Picasso</option>
                        </select>
                        <input
                            type="date"
                            value={olcuDateFilter}
                            onChange={e => setOlcuDateFilter(e.target.value)}
                            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs outline-none focus:border-primary-400"
                        />
                        {(olcuSearch || olcuProductFilter || olcuDateFilter) && (
                            <button
                                onClick={() => { setOlcuSearch(""); setOlcuProductFilter(""); setOlcuDateFilter(""); }}
                                className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                                Temizle
                            </button>
                        )}
                    </div>
                </div>

                {measuredAppointments.length === 0 ? (
                    <div className="p-6 text-sm font-bold text-slate-400 text-center">Henüz alınmış ölçü bulunamadı.</div>
                ) : filteredAppointments.length === 0 ? (
                    <div className="p-6 text-sm text-slate-400 text-center">Filtreyle eşleşen ölçü bulunamadı.</div>
                ) : (
                    <>
                        {/* ── Masaüstü tablo ── */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-400">Müşteri</th>
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-400">Tarih</th>
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-400">Oda</th>
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-400">Ürün</th>
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-400">Ölçü</th>
                                        <th className="px-4 py-2 text-right text-[10px] font-black uppercase tracking-wide text-slate-400">Tutar</th>
                                        <th className="px-4 py-2 text-right text-[10px] font-black uppercase tracking-wide text-slate-400">İşlem</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAppointments.slice(0, 25).map((appt) => {
                                        const customer = pickAppointmentCustomer(appt.customer);
                                        const active = sourceAppointmentId === appt.id;
                                        return (
                                            <tr
                                                key={appt.id}
                                                onClick={() => convertAppointmentToOrder(appt, { keepExtraLines: true })}
                                                className={`border-b border-slate-50 dark:border-slate-800/50 cursor-pointer transition-colors ${active ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
                                            >
                                                <td className="px-4 py-2.5">
                                                    <div className="font-bold text-slate-900 dark:text-white text-sm leading-tight">{customer?.name || "İsimsiz"}</div>
                                                    {active && <div className="text-[10px] text-blue-600 font-black">✓ Seçildi</div>}
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                                                    {appt.start_at ? new Date(appt.start_at).toLocaleDateString("tr-TR") : "-"}
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[80px] truncate">
                                                    {appt.room_name || "-"}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                                        {productLabel((appt.product_type || "stor") as ProductType)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                                    {appt.width_cm && appt.height_cm ? `${appt.width_cm}×${appt.height_cm}` : "-"}
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-xs font-black text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                                    {appt.unit_price ? formatTL(safeNumber(appt.unit_price)) : "-"}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={e => { e.stopPropagation(); nav(`/appointments/${appt.id}`); }}
                                                            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-bold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                                                        >
                                                            Detay
                                                        </button>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); convertAppointmentToOrder(appt, { keepExtraLines: true }); }}
                                                            className={`rounded-lg px-2.5 py-1 text-[11px] font-black whitespace-nowrap transition-colors ${active ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                                                        >
                                                            {active ? "✓ Aktarıldı" : "Siparişe Dönüştür"}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filteredAppointments.length > 25 && (
                                <div className="p-3 text-center text-xs text-slate-400 border-t border-slate-100 dark:border-slate-800">
                                    İlk 25 kayıt gösteriliyor. Daraltmak için filtre kullanın.
                                </div>
                            )}
                        </div>

                        {/* ── Mobil kart görünümü ── */}
                        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                            {filteredAppointments.slice(0, 25).map((appt) => {
                                const customer = pickAppointmentCustomer(appt.customer);
                                const active = sourceAppointmentId === appt.id;
                                return (
                                    <div
                                        key={appt.id}
                                        onClick={() => convertAppointmentToOrder(appt, { keepExtraLines: true })}
                                        className={`p-3 cursor-pointer transition-colors ${active ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-black text-slate-900 dark:text-white text-sm">{customer?.name || "İsimsiz"}</span>
                                                    <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                                                        {productLabel((appt.product_type || "stor") as ProductType)}
                                                    </span>
                                                    {active && <span className="text-[10px] text-blue-600 font-black">✓ Seçildi</span>}
                                                </div>
                                                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
                                                    {appt.start_at && <span>{new Date(appt.start_at).toLocaleDateString("tr-TR")}</span>}
                                                    {appt.room_name && <span>{appt.room_name}</span>}
                                                    {appt.width_cm && appt.height_cm && <span className="font-mono">{appt.width_cm}×{appt.height_cm}</span>}
                                                    {appt.unit_price ? <span className="font-black text-slate-600 dark:text-slate-300">{formatTL(safeNumber(appt.unit_price))}</span> : null}
                                                </div>
                                            </div>
                                            <button
                                                onClick={e => { e.stopPropagation(); convertAppointmentToOrder(appt, { keepExtraLines: true }); }}
                                                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-black ${active ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                                            >
                                                {active ? "✓" : "Aktar"}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    {/* Müşteri */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500">Müşteri</label>
                                <div className="relative">
                                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input type="text" list="cust-list" value={customerInput} onChange={(e) => setCustomerInput(e.target.value)} placeholder="İsim Soyisim" className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 outline-none" />
                                    <datalist id="cust-list">{customers.map(c => <option key={c.id} value={c.name || ""}>{c.phone}</option>)}</datalist>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500">Telefon</label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="5XX XXX XX XX" className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 outline-none" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Ürünler */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="font-bold flex items-center gap-2"><Package size={20} className="text-blue-500" /> Ürünler</h2>
                            <button onClick={addItem} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold"><Plus size={16} /> Ekle</button>
                        </div>
                        <div className="p-6 space-y-4">
                            {items.map((item, idx) => (
                                <div key={item.key} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                        <div className="sm:col-span-3">
                                            <select value={item.product_id} onChange={(e) => applyProductIdToItem(item.key, e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none bg-white dark:bg-slate-900">
                                                <option value="">Ürün/model seç</option>
                                                {products.map((p) => <option key={p.id} value={p.id}>{[p.name, p.unit_price ? formatTL(safeNumber(p.unit_price)) : null].filter(Boolean).join(" - ")}</option>)}
                                            </select>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <select value={item.product_type} onChange={(e) => applyProductTypeToItem(item.key, e.target.value as ProductType)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none">
                                                <option value="stor">Stor</option><option value="zebra">Zebra</option><option value="tul">Tül</option>
                                                <option value="fon">Fon</option><option value="plicell">Plicell</option><option value="jalousie">Jaluzi</option><option value="picasso">Picasso</option>
                                            </select>
                                        </div>
                                        <div className="sm:col-span-2"><input type="number" value={item.width_cm} onChange={(e) => updateItem(item.key, { width_cm: safeNumber(e.target.value) })} className="w-full px-2 py-2.5 rounded-lg border border-slate-200 text-center font-bold" placeholder="En" /></div>
                                        <div className="sm:col-span-2"><input type="number" value={item.height_cm} onChange={(e) => updateItem(item.key, { height_cm: safeNumber(e.target.value) })} className="w-full px-2 py-2.5 rounded-lg border border-slate-200 text-center font-bold" placeholder="Boy" /></div>
                                        <div className="sm:col-span-1"><input type="number" value={item.qty} onChange={(e) => updateItem(item.key, { qty: safeNumber(e.target.value, 1) })} className="w-full px-1 py-2.5 rounded-lg border border-slate-200 text-center" placeholder="Adet" /></div>
                                        <div className="sm:col-span-1 relative"><input type="number" value={item.unit_price} onChange={(e) => updateItem(item.key, { unit_price: safeNumber(e.target.value) })} className="w-full pl-2 pr-5 py-2.5 rounded-lg border border-slate-200 text-right font-black" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">₺</span></div>
                                        <div className="sm:col-span-1 flex items-center justify-center"><button onClick={() => removeItem(item.key)} className="p-2 text-slate-300 hover:text-red-500"><Trash2 size={18} /></button></div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                        <input value={item.model_name} onChange={(e) => updateItem(item.key, { model_name: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200" placeholder="Model / kartela" />
                                        <input value={item.color_name} onChange={(e) => updateItem(item.key, { color_name: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200" placeholder="Renk / kod" />
                                        <select value={item.supplier_id} onChange={(e) => applySupplierToItem(item.key, e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                            <option value="">Tedarikçi</option>
                                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                        <input type="number" value={item.supplier_cost} onChange={(e) => updateItem(item.key, { supplier_cost: safeNumber(e.target.value) })} onBlur={() => persistSupplierPurchasePriceFromField(item.key)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-right" placeholder="Alış maliyeti" />
                                        <input value={item.room} onChange={(e) => updateItem(item.key, { room: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200" placeholder="Oda (Salon, Mutfak...)" />
                                        {(item.product_type === "tul" || item.product_type === "fon") && (
                                            <select value={item.pile} onChange={(e) => updateItem(item.key, { pile: e.target.value as "2" | "3" })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                                <option value="2">Pile 1'e 2</option><option value="3">Pile 1'e 3</option>
                                            </select>
                                        )}
                                        {(item.product_type === "jalousie" || item.product_type === "picasso") && (
                                            <>
                                                <select value={item.mechanism} onChange={(e) => updateItem(item.key, { mechanism: e.target.value as "reducer" | "standard" })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                                    <option value="standard">Redüktörsüz</option><option value="reducer">Redüktörlü</option>
                                                </select>
                                                <select value={item.control_type} onChange={(e) => updateItem(item.key, { control_type: e.target.value as "corded" | "tape" })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                                    <option value="corded">İpli</option><option value="tape">Kurdelalı</option>
                                                </select>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                                        <span className="text-slate-500">{itemsComputed[idx].fabric_width_cm ? `${itemsComputed[idx].fabric_width_cm} cm kumaş` : `${itemsComputed[idx].area.toFixed(2)} m²`}</span>
                                        <span className="font-bold">{formatTL(itemsComputed[idx].line_total)}</span>
                                    </div>
                                    {itemsComputed[idx].calculation_note ? <div className="text-[11px] text-slate-500">{itemsComputed[idx].calculation_note}</div> : null}
                                </div>
                            ))}
                            <div className="p-6 rounded-3xl bg-slate-900 text-white flex justify-between items-center">
                                <div><div className="text-[10px] text-slate-400 font-bold uppercase">Toplam</div><div className="text-2xl font-black">{formatTL(grandTotal)}</div></div>
                                <div className="text-right"><div className="text-[10px] text-slate-400 font-bold uppercase">Adet</div><div className="text-xl font-bold">{itemsComputed.reduce((a, b) => a + b.qty, 0)}</div></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sağ kolon */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 shadow-sm">
                        <h2 className="font-bold flex items-center gap-2"><Briefcase size={18} className="text-indigo-500" /> Sorumlu</h2>
                        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none font-medium">
                            <option value="">-- Personel Seçin --</option>
                            {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>

                        <div>
                            <button type="button" onClick={() => setShowAddStaff((v) => !v)} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-indigo-600 hover:text-indigo-800">
                                {showAddStaff ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                Yeni Personel Ekle
                            </button>
                            {showAddStaff && (
                                <div className="mt-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/50 dark:bg-indigo-900/10">
                                    <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
                                        <input value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} className="min-h-11 rounded-xl border border-indigo-100 bg-white px-3 text-sm font-bold outline-none dark:border-indigo-900 dark:bg-slate-900" placeholder="Ad soyad" />
                                        <select value={newStaffRole} onChange={(e) => setNewStaffRole(e.target.value)} className="min-h-11 rounded-xl border border-indigo-100 bg-white px-3 text-sm font-bold outline-none dark:border-indigo-900 dark:bg-slate-900">
                                            <option value="installer">Montajcı</option>
                                            <option value="measurement">Ölçücü</option>
                                            <option value="personnel">Personel</option>
                                        </select>
                                        <button type="button" onClick={handleCreateInlineStaff} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white">Ekle</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500">Sipariş Durumu</label>
                            <div className="grid grid-cols-2 gap-2">
                                {([["new_order", "Yeni Sipariş"], ["production", "İmalatta"], ["installation_ready", "Montaja Hazır"], ["installation_planned", "Montaj Planlandı"], ["installing", "Montajda"], ["installation_completed", "Montaj Tamamlandı"], ["delivered_closed", "Teslim Edildi / Kapandı"], ["quoted", "Teklif"]] as const).map(([s, label]) => (
                                    <button key={s} onClick={() => setStatus(s as Status)} className={cn("p-2 rounded-xl border text-[10px] font-bold", status === s ? "bg-blue-600 border-blue-600 text-white shadow-lg" : "bg-white dark:bg-slate-900 border-slate-100 text-slate-500")}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3 pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-500">Randevu Oluştur</label>
                                <button onClick={() => setWantAppointment(!wantAppointment)} className={cn("w-10 h-5 rounded-full relative transition-colors", wantAppointment ? "bg-blue-600" : "bg-slate-300")}>
                                    <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", wantAppointment ? "left-6" : "left-1")}></div>
                                </button>
                            </div>
                            {wantAppointment && (
                                <div className="space-y-2 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100">
                                    <input type="text" value={apptTitle} onChange={(e) => setApptTitle(e.target.value)} className="w-full p-2 text-xs rounded border outline-none" placeholder="Başlık (örn: Montaj)" />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className="p-1.5 text-[10px] rounded border outline-none" />
                                        <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className="p-1.5 text-[10px] rounded border outline-none" />
                                    </div>
                                    <textarea value={apptAddress} onChange={(e) => setApptAddress(e.target.value)} placeholder="Farklı Adres..." className="w-full p-2 text-[10px] rounded border h-12 outline-none" />
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500">Notlar</label>
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Özel notlar..." className="w-full p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border outline-none text-xs h-24" />
                        </div>

                        <button onClick={handleSave} disabled={saving} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black shadow-lg flex items-center justify-center gap-2">
                            <Save size={18} />
                            {saving ? "Kaydediliyor..." : "Teklifi / Siparişi Kaydet"}
                        </button>
                    </div>
                </div>
            </div>

            <div className="lg:hidden fixed bottom-6 left-4 right-4 z-40">
                <button onClick={handleSave} disabled={saving} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-2xl flex items-center justify-center gap-2">
                    <Save size={20} /> {saving ? "Kaydediliyor..." : "Siparişi Kaydet"}
                </button>
            </div>
        </div>
    );
}
