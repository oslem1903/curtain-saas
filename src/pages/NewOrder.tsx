import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { normalizeRole } from "../auth/roles";
import { 
    ArrowLeft, Users, Phone, Trash2, Package, 
    CreditCard, Save, Briefcase, Plus 
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

async function getContext() {
    return getEffectiveTenantContext();
}

type Customer = {
    id: string;
    name: string | null;
    phone: string | null;
};

type Supplier = {
    id: string;
    name: string | null;
};

type MeasuredAppointment = {
    id: string;
    customer_id: string | null;
    address: string | null;
    note: string | null;
    measurement_notes: string | null;
    assigned_to: string | null;
    assigned_user_id?: string | null;
    start_at: string | null;
    room_name?: string | null;
    width_cm?: number | null;
    height_cm?: number | null;
    rounded_width_cm?: number | null;
    rounded_height_cm?: number | null;
    product_type?: string | null;
    model_name?: string | null;
    color_name?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    customer?: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
};
type ProductRow = {
    id: string;
    name: string | null;
    category: string | null;
    unit_price: number | null;
    cost_price?: number | null;
    min_price: number | null;
    min_area: number | null;
    rounding_rule: number | null;
    pricing_mode: string | null;
    is_active: boolean | null;
};
type SupplierPriceRow = {
    supplier_id: string;
    product_id: string | null;
    product_name: string | null;
    unit_cost: number | null;
};
type Status = "draft" | "measured" | "quoted" | "approved" | "production" | "installation_waiting" | "completed" | "open" | "paid" | "partial";
type ProductType = "plicell" | "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "dikey_tul" | "dikey_stor" | "diger";

type OrderItemUI = {
    key: string;
    product_id: string;
    product_name: string;
    model_name: string;
    color_name: string;
    supplier_id: string;
    supplier_cost: number;
    product_type: ProductType;
    room: string;
    width_cm: number;
    height_cm: number;
    qty: number;
    unit_price: number;
    pile: "2" | "3";
    mechanism: "reducer" | "standard";
    control_type: "corded" | "tape";
};

function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function safeNumber(v: unknown, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function roundByRule(value: number, roundingRule: number) {
    const rule = Math.max(1, safeNumber(roundingRule, 1));
    return Math.ceil(value / rule) * rule;
}

function calcAreaM2ByProduct(
    widthCm: number,
    heightCm: number,
    product: ProductRow | null
) {
    const roundingRule = Math.max(1, safeNumber(product?.rounding_rule, 10));
    const minArea = Math.max(0, safeNumber(product?.min_area, 0));

    const roundedWidth = roundByRule(Math.max(1, widthCm), roundingRule);
    const roundedHeight = roundByRule(Math.max(1, heightCm), roundingRule);

    let area = (roundedWidth / 100) * (roundedHeight / 100);

    if (area < minArea) {
        area = minArea;
    }

    return {
        roundedWidth,
        roundedHeight,
        area,
    };
}

function calcLineTotalByProduct(
    area: number,
    qty: number,
    unitPrice: number,
    product: ProductRow | null
) {
    const calculated = area * qty * unitPrice;
    const minPrice = Math.max(0, safeNumber(product?.min_price, 0));

    return Math.max(calculated, minPrice);
}

function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
}

function productLabel(t: ProductType) {
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

function normalizeCategory(value: string | null | undefined) {
    return (value ?? "")
        .trim()
        .toLocaleLowerCase("tr-TR")
        .replaceAll("?", "u")
        .replaceAll("?", "i")
        .replaceAll("?", "s")
        .replaceAll("?", "g")
        .replaceAll("?", "o")
        .replaceAll("?", "c");
}

function findProductByType(products: ProductRow[], type: string) {
    return (
        products.find((p) => {
            if (!p.category) return false;
            return normalizeCategory(p.category) === normalizeCategory(type);
        }) ?? null
    );
}

function pickAppointmentCustomer(
    customer: MeasuredAppointment["customer"],
): { name: string | null; phone: string | null } | null {
    return Array.isArray(customer) ? customer[0] ?? null : customer ?? null;
}

export default function NewOrder() {
    const nav = useNavigate();
    const location = useLocation();

    const [companyId, setCompanyId] = useState<string>("");
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [measuredAppointments, setMeasuredAppointments] = useState<MeasuredAppointment[]>([]);
    const [loadingContext, setLoadingContext] = useState(true);

    const [customerInput, setCustomerInput] = useState<string>("");
    const [customerId, setCustomerId] = useState<string>("");
    const [newPhone, setNewPhone] = useState<string>("");
    const [sourceAppointmentId, setSourceAppointmentId] = useState<string>("");

    const [note, setNote] = useState("");
    const [status, setStatus] = useState<Status>("draft");
    const [items, setItems] = useState<OrderItemUI[]>([
        {
            key: uid(),
            product_id: "",
            product_name: "",
            model_name: "",
            color_name: "",
            supplier_id: "",
            supplier_cost: 0,
            product_type: "stor",
            room: "Salon",
            width_cm: 100,
            height_cm: 200,
            qty: 1,
            unit_price: 0,
            pile: "2",
            mechanism: "standard",
            control_type: "corded",
        },
    ]);

    const [fabricCost, setFabricCost] = useState<number>(0);
    const [mechanismCost, setMechanismCost] = useState<number>(0);
    const [installationCost, setInstallationCost] = useState<number>(0);
    const [depositAmount, setDepositAmount] = useState<number>(0);

    const [fabricSupplierId, setFabricSupplierId] = useState<string>("");
    const [assignedTo, setAssignedTo] = useState<string>("");
    const [staffList, setStaffList] = useState<{ id: string; full_name: string; role: string }[]>([]);
    const [newStaffName, setNewStaffName] = useState("");
    const [newStaffRole, setNewStaffRole] = useState("installer");

    const { effectiveRole: role, realRole, viewingUserId } = useRole();
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string>("");

    const [wantAppointment, setWantAppointment] = useState(true);
    const [apptTitle, setApptTitle] = useState<string>("Ölçü");
    const [apptDate, setApptDate] = useState<string>("");
    const [apptTime, setApptTime] = useState<string>("");
    const [apptAddress, setApptAddress] = useState<string>("");
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [supplierPrices, setSupplierPrices] = useState<SupplierPriceRow[]>([]);

    async function loadCompanyProducts(company_id: string) {
        let { data, error }: { data: any[] | null; error: any } = await supabase
            .from("products")
            .select("id,name,category,unit_price,cost_price,min_price,min_area,rounding_rule,pricing_mode,is_active")
            .eq("company_id", company_id)
            .eq("is_active", true);

        if (error && /cost_price/i.test(String(error.message || ""))) {
            const fallback = await supabase
                .from("products")
                .select("id,name,category,unit_price,min_price,min_area,rounding_rule,pricing_mode,is_active")
                .eq("company_id", company_id)
                .eq("is_active", true);
            data = fallback.data;
            error = fallback.error;
        }

        if (error) throw error;
        return (data ?? []) as ProductRow[];
    }

    async function loadCompanyStaff(company_id: string) {
        const { data: employees, error: eErr } = await supabase
            .from("employees")
            .select("id,user_id, full_name, target_role, is_active")
            .eq("company_id", company_id);

        if (eErr) throw eErr;
        const employeeRows = (employees ?? []).filter((employee: any) => employee.is_active !== false);

        const { data: members, error: mErr } = await supabase
            .from("company_members")
            .select("user_id")
            .eq("company_id", company_id);

        if (mErr) throw mErr;
        const employeeIds = employeeRows.map((employee: any) => employee.user_id).filter(Boolean);
        const memberIds = (members ?? []).map((m) => m.user_id).filter(Boolean);
        const ids = Array.from(new Set(employeeIds.length > 0 ? employeeIds : memberIds));
        if (ids.length === 0) {
            return employeeRows.map((employee: any) => ({
                id: employee.user_id || employee.id,
                full_name: employee.full_name || "İsimsiz",
                role: employee.target_role || "installer",
            }));
        }

        const { data: profiles, error: pErr } = await supabase
            .from("profiles")
            .select("user_id, full_name, role")
            .in("user_id", ids);

        if (pErr) throw pErr;
        const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
        const staffRows = employeeRows.length > 0
            ? employeeRows.map((employee: any) => {
                  const profile = profileById.get(employee.user_id);
                  return {
                      user_id: employee.user_id || employee.id,
                      full_name: employee.full_name || profile?.full_name || "İsimsiz",
                      role: profile?.role || employee.target_role || "installer",
                  };
              })
            : (profiles ?? []);

        return staffRows
            .filter((p) => {
                const role = normalizeRole(p.role);
                return role === "installer" || role === "measurement" || role === "personnel";
            })
            .map((p) => ({
                id: p.user_id,
                full_name: p.full_name || "İsimsiz",
                role: p.role || "staff",
            }));
    }

    async function handleCreateInlineStaff() {
        if (!companyId) { setErr("Şirket bilgisi yüklenemedi."); return; }
        if (!newStaffName.trim()) { setErr("Personel adı zorunlu."); return; }
        setErr("");
        const { data, error } = await supabase
            .from("employees")
            .insert([{
                company_id: companyId,
                full_name: newStaffName.trim(),
                target_role: newStaffRole,
                is_active: true,
            }])
            .select("id,full_name,target_role")
            .single();
        if (error) { setErr(error.message); return; }
        const staff = { id: data.id, full_name: data.full_name || newStaffName.trim(), role: data.target_role || newStaffRole };
        setStaffList((prev) => [...prev, staff].sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")));
        setAssignedTo(staff.id);
        setNewStaffName("");
    }

    async function generateInvoiceNo() {
        return "INV-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    useEffect(() => {
        let alive = true;

        async function loadInitialData() {
            setLoadingContext(true);
            setErr("");

            try {
                const ctx = await getContext();
                if (!alive) return;

                setCompanyId(ctx.company_id);

                const [customersRes, suppliersRes, companyProducts, companyStaff, measuredRes, supplierPricesRes] = await Promise.all([
                    supabase
                        .from("customers")
                        .select("id, name, phone")
                        .eq("company_id", ctx.company_id)
                        .order("name", { ascending: true })
                        .limit(1000),

                    supabase
                        .from("suppliers")
                        .select("id, name")
                        .eq("company_id", ctx.company_id)
                        .order("name", { ascending: true }),

                    loadCompanyProducts(ctx.company_id),

                    loadCompanyStaff(ctx.company_id),

                    (() => {
                        const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                        let q = supabase
                            .from("appointments")
                            .select("id, customer_id, address, note, measurement_notes, assigned_to, assigned_user_id, start_at, room_name, width_cm, height_cm, rounded_width_cm, rounded_height_cm, product_type, model_name, color_name, quantity, unit_price, customer:customers(name, phone)")
                            .eq("company_id", ctx.company_id)
                            .in("status", ["measured", "done", "planned", "onway"])
                            .eq("type", "measurement")
                            .order("start_at", { ascending: false })
                            .limit(100);
                        
                        if (role === "installer" || role === "measurement" || role === "personnel") {
                            q = q.or(`assigned_to.eq.${targetId},assigned_user_id.eq.${targetId}`);
                        }
                        return q;
                    })(),

                    supabase
                        .from("supplier_product_prices")
                        .select("supplier_id,product_id,product_name,unit_cost")
                        .eq("company_id", ctx.company_id),
                ]);

                if (!alive) return;

                if (customersRes.error) {
                    setErr("Müşteriler yüklenemedi: " + customersRes.error.message);
                    setCustomers([]);
                } else {
                    setCustomers((customersRes.data ?? []) as Customer[]);
                }
                if (suppliersRes.error) {
                    setErr((prev) => prev || "Tedarikçiler yüklenemedi: " + suppliersRes.error.message);
                    setSuppliers([]);
                } else {
                    setSuppliers((suppliersRes.data ?? []) as Supplier[]);
                }
                setProducts(companyProducts);
                if (!supplierPricesRes.error) {
                    setSupplierPrices((supplierPricesRes.data ?? []) as SupplierPriceRow[]);
                } else {
                    setSupplierPrices([]);
                }
                if (measuredRes.error) {
                    setMeasuredAppointments([]);
                } else {
                    setMeasuredAppointments((measuredRes.data ?? []) as MeasuredAppointment[]);
                }

                if (alive) {
                    setStaffList(companyStaff);
                }
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message ?? "Veriler yüklenemedi.");
                setCustomers([]);
                setSuppliers([]);
                setProducts([]);
            } finally {
                if (alive) setLoadingContext(false);
            }
        }

        loadInitialData();
        return () => { alive = false; };
    }, [role, viewingUserId, realRole]);

    const selectedCustomer = useMemo(() => {
        return customers.find((c) => c.id === customerId) ?? null;
    }, [customers, customerId]);

    const selectedMeasuredAppointment = useMemo(() => {
        return measuredAppointments.find((appt) => appt.id === sourceAppointmentId) ?? null;
    }, [measuredAppointments, sourceAppointmentId]);

    useEffect(() => {
        const state = location.state as any;
        if (state?.fromAppointment || state?.visualPreviewId) {
            if (state.customerName) setCustomerInput(state.customerName);
            if (state.customerId) setCustomerId(state.customerId);
            if (state.phone) setNewPhone(state.phone);
            if (state.address) setApptAddress(state.address);
            if (state.assignedTo) setAssignedTo(state.assignedTo);
            if (state.selectedSupplierId) setFabricSupplierId(state.selectedSupplierId);
            if (state.selectedSupplierCost) setFabricCost(safeNumber(state.selectedSupplierCost));
            if (state.totalCost) setFabricCost(safeNumber(state.totalCost));
            if (state.measurementNotes) {
                setNote(prev => `[ÖLÇÜ NOTLARI]\n${state.measurementNotes}\n\n${prev}`);
            }
            if (state.measurementAreaM2 || state.totalCost || state.totalSale || state.profit) {
                const measurementSummary = [
                    state.measurementAreaM2 ? `m²: ${safeNumber(state.measurementAreaM2).toFixed(2)}` : null,
                    state.totalCost ? `Toplam maliyet: ${formatTL(safeNumber(state.totalCost))}` : null,
                    state.totalSale ? `Toplam satış: ${formatTL(safeNumber(state.totalSale))}` : null,
                    state.profit ? `Kar: ${formatTL(safeNumber(state.profit))}` : null,
                    state.profitRate ? `Kar oranı: %${safeNumber(state.profitRate).toFixed(2)}` : null,
                ].filter(Boolean).join("\n");
                setNote(prev => `[ÖLÇÜ HESAP ÖZETİ]\n${measurementSummary}\n\n${prev}`);
            }
            if (state.visualPreviewId || state.selectedCatalogName) {
                const previewNote = [
                    state.selectedCatalogName ? `Kartela: ${state.selectedCatalogName}` : null,
                    state.selectedProductType ? `Urun tipi: ${productLabel(state.selectedProductType)}` : null,
                    state.selectedSeriesCode ? `Kod: ${state.selectedSeriesCode}` : null,
                    state.selectedModelName ? `Model: ${state.selectedModelName}` : null,
                    state.selectedVariantCode ? `Varyant: ${state.selectedVariantCode}` : null,
                    state.selectedColorName ? `Renk: ${state.selectedColorName}` : null,
                    state.selectedCatalogPrice ? `Fiyat: ${formatTL(safeNumber(state.selectedCatalogPrice))}/m2` : null,
                    state.visualPreviewId ? "Onizleme: Var" : null,
                ].filter(Boolean).join("\n");
                setNote(prev => `[KARTELA / GORSEL ONIZLEME]\n${previewNote}\n\n${prev}`);
            }
            if (state.selectedProductType || state.selectedCatalogPrice || state.widthCm || state.heightCm || state.qty) {
                setItems((prev) =>
                    prev.map((item, index) =>
                        index === 0
                            ? {
                                ...item,
                                product_id: state.selectedProductId || item.product_id,
                                product_type: (state.selectedProductType || item.product_type) as ProductType,
                                product_name: state.selectedProductName || item.product_name,
                                model_name: state.selectedModelName || state.selectedProductName || item.model_name,
                                color_name: state.selectedColorName || item.color_name,
                                supplier_id: state.selectedSupplierId || item.supplier_id,
                                supplier_cost: state.selectedSupplierCost ? safeNumber(state.selectedSupplierCost) : item.supplier_cost,
                                unit_price: state.selectedCatalogPrice ? safeNumber(state.selectedCatalogPrice) : item.unit_price,
                                width_cm: state.widthCm ? safeNumber(state.widthCm, item.width_cm) : item.width_cm,
                                height_cm: state.heightCm ? safeNumber(state.heightCm, item.height_cm) : item.height_cm,
                                qty: state.qty ? safeNumber(state.qty, item.qty) : item.qty,
                            }
                            : item
                    )
                );
            }
            setWantAppointment(false);
        }
    }, [location.state]);

    useEffect(() => {
        if (products.length === 0) return;
        const storProduct = findProductByType(products, "stor");
        if (!storProduct) return;
        setItems((prev) =>
            prev.map((item, index) =>
                index === 0 && item.unit_price === 0
                    ? { ...item, unit_price: safeNumber(storProduct.unit_price) }
                    : item
            )
        );
    }, [products]);

    useEffect(() => {
        const trimmed = customerInput.trim().toLowerCase();
        if (!trimmed) {
            setCustomerId("");
            return;
        }
        const hit = customers.find((c) => (c.name ?? "").trim().toLowerCase() === trimmed);
        if (hit) setCustomerId(hit.id);
        else setCustomerId("");
    }, [customerInput, customers]);

    useEffect(() => {
        if (selectedCustomer) setNewPhone(selectedCustomer.phone ?? "");
    }, [selectedCustomer]);

    useEffect(() => {
        if (!selectedMeasuredAppointment) return;
        const appointmentCustomer = pickAppointmentCustomer(selectedMeasuredAppointment.customer);
        if (selectedMeasuredAppointment.customer_id) setCustomerId(selectedMeasuredAppointment.customer_id);
        if (appointmentCustomer?.name) setCustomerInput(appointmentCustomer.name);
        if (appointmentCustomer?.phone) setNewPhone(appointmentCustomer.phone);
        if (selectedMeasuredAppointment.address) setApptAddress(selectedMeasuredAppointment.address);
        if (selectedMeasuredAppointment.assigned_to) setAssignedTo(selectedMeasuredAppointment.assigned_to);

        const noteParts = [
            selectedMeasuredAppointment.measurement_notes?.trim(),
            selectedMeasuredAppointment.note?.trim(),
        ].filter(Boolean);

        if (noteParts.length > 0) {
            setNote(`[KESIF / OLCU]\n${noteParts.join("\n\n")}`);
        }

        if (selectedMeasuredAppointment.width_cm || selectedMeasuredAppointment.height_cm || selectedMeasuredAppointment.product_type) {
            const measuredType = (selectedMeasuredAppointment.product_type || "stor") as ProductType;
            const measuredName = selectedMeasuredAppointment.model_name || productLabel(measuredType);
            setItems((prev) =>
                prev.map((item, index) =>
                    index === 0
                        ? {
                            ...item,
                            product_type: measuredType,
                            product_name: measuredName,
                            model_name: selectedMeasuredAppointment.model_name || item.model_name,
                            color_name: selectedMeasuredAppointment.color_name || item.color_name,
                            room: selectedMeasuredAppointment.room_name || item.room,
                            width_cm: safeNumber(selectedMeasuredAppointment.width_cm, item.width_cm),
                            height_cm: safeNumber(selectedMeasuredAppointment.height_cm, item.height_cm),
                            qty: safeNumber(selectedMeasuredAppointment.quantity, item.qty || 1),
                            unit_price: safeNumber(selectedMeasuredAppointment.unit_price, item.unit_price),
                        }
                        : item
                )
            );
        }
        setWantAppointment(false);
    }, [selectedMeasuredAppointment]);

    function updateItem(key: string, patch: Partial<OrderItemUI>) {
        setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    }

    function supplierCostFor(productId: string, productName: string, supplierId: string) {
        if (!supplierId) return 0;
        const normalizedProductName = productName.trim().toLocaleLowerCase("tr-TR");
        const hit = supplierPrices.find((price) => {
            if (price.supplier_id !== supplierId) return false;
            if (productId && price.product_id === productId) return true;
            return (price.product_name ?? "").trim().toLocaleLowerCase("tr-TR") === normalizedProductName;
        });
        return safeNumber(hit?.unit_cost);
    }

    function applySupplierToItem(key: string, supplierId: string) {
        const item = items.find((x) => x.key === key);
        if (!item) return;
        const listedCost = supplierCostFor(item.product_id, item.product_name || productLabel(item.product_type), supplierId);
        updateItem(key, {
            supplier_id: supplierId,
            supplier_cost: listedCost || item.supplier_cost,
        });
    }

    function applyProductNameToItem(key: string, productName: string) {
        const hit = products.find((product) => (product.name ?? "").trim().toLocaleLowerCase("tr-TR") === productName.trim().toLocaleLowerCase("tr-TR"));
        if (!hit) {
            updateItem(key, { product_id: "", product_name: productName });
            return;
        }
        const currentItem = items.find((item) => item.key === key);
        const supplierId = currentItem?.supplier_id || fabricSupplierId;
        const listedCost = supplierCostFor(hit.id, productName, supplierId);

        updateItem(key, {
            product_id: hit.id,
            product_name: productName,
            model_name: productName,
            product_type: (normalizeCategory(hit.category) || "diger") as ProductType,
            unit_price: safeNumber(hit.unit_price),
            supplier_cost: listedCost || safeNumber(hit.cost_price),
        });
    }

    function removeItem(key: string) {
        setItems((prev) => {
            if (prev.length <= 1) return prev;
            return prev.filter((x) => x.key !== key);
        });
    }

    function addItem() {
        const storProduct = findProductByType(products, "stor");
        setItems((prev) => [
            ...prev,
            {
                key: uid(),
                product_id: "",
                product_name: "",
                model_name: "",
                color_name: "",
                supplier_id: "",
                supplier_cost: 0,
                product_type: "stor",
                room: "",
                width_cm: 100,
                height_cm: 200,
                qty: 1,
                unit_price: safeNumber(storProduct?.unit_price),
                pile: "2",
                mechanism: "standard",
                control_type: "corded",
            },
        ]);
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
                const pileMultiplier = it.pile === "3" ? 3 : 2;
                fabric_width_cm = width * pileMultiplier + 15;
                area = fabric_width_cm / 100;
                roundedWidth = width;
                roundedHeight = height;
                line_total = area * qty * unit;
                calculation_note = `Pile 1'e ${pileMultiplier}: ${width} x ${pileMultiplier} + 15 cm dikim payi = ${fabric_width_cm} cm kumas`;
            }

            if (it.product_type === "jalousie" || it.product_type === "picasso") {
                const mechanismFactor = it.mechanism === "reducer" ? 1.12 : 1;
                const controlFactor = it.control_type === "tape" ? 1.05 : 1;
                line_total = line_total * mechanismFactor * controlFactor;
                calculation_note = `${productLabel(it.product_type)} jaluzi mantigi: ${it.mechanism === "reducer" ? "Reduktorlu" : "Reduktorsuz"} / ${it.control_type === "tape" ? "Kurdelali" : "Ipli"}`;
            }

            return {
                ...it,
                width_cm: width,
                height_cm: height,
                qty,
                unit_price: unit,
                supplier_cost: supplierCost,
                supplier_total_cost: supplierCost * area * qty,
                roundedWidth,
                roundedHeight,
                area,
                line_total,
                fabric_width_cm,
                calculation_note,
            };
        });
    }, [items, products]);

    const grandTotal = useMemo(() => {
        return itemsComputed.reduce((acc, it) => acc + safeNumber(it.line_total), 0);
    }, [itemsComputed]);

    const totalCost = useMemo(() => {
        const lineSupplierCost = itemsComputed.reduce((acc, item) => acc + safeNumber(item.supplier_total_cost), 0);
        return (safeNumber(fabricCost) || lineSupplierCost) + safeNumber(mechanismCost) + safeNumber(installationCost);
    }, [fabricCost, itemsComputed, mechanismCost, installationCost]);

    const profit = useMemo(() => grandTotal - totalCost, [grandTotal, totalCost]);

    async function ensureCustomerId(currentCompanyId: string): Promise<string> {
        if (customerId) return customerId;
        const name = customerInput.trim();
        if (!name) throw new Error("Lütfen müşteri seç ya da isim yaz.");
        const existing = customers.find((c) => (c.name ?? "").trim().toLowerCase() === name.toLowerCase());
        if (existing?.id) return existing.id;

        const payload = { company_id: currentCompanyId, name, phone: newPhone.trim() ? newPhone.trim() : null };
        const { data, error } = await supabase.from("customers").insert([payload]).select("id, name, phone").single();
        if (error) throw error;
        const newCustomer = data as Customer;
        setCustomers((prev) => {
            const next = [...prev, newCustomer];
            next.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "tr"));
            return next;
        });
        setCustomerId(newCustomer.id);
        return newCustomer.id;
    }

    async function createSupplierExpense(params: {
        company_id: string; amount: number; category: string; supplier_id?: string; orderId: string; customerName: string;
    }) {
        const amount = safeNumber(params.amount);
        if (amount <= 0 || !params.supplier_id) return;
        const supplierName = suppliers.find(s => s.id === params.supplier_id)?.name ?? params.category;
        const payload = {
            company_id: params.company_id, expense_date: new Date().toISOString(), amount, category: params.category,
            vendor: supplierName, supplier_id: params.supplier_id, order_id: params.orderId,
            status: "unpaid", note: `Sipariş maliyeti - ${params.category} - Müşteri: ${params.customerName}`,
        };
        const { error } = await supabase.from("expenses").insert(payload);
        if (error) throw new Error(`${params.category} gideri oluşturulamadı: ${error.message}`);
    }

    async function createSalesInvoiceForOrder(params: {
        company_id: string; orderId: string; customerId: string; customerName: string; 
        items: any[]; notes: string; total: number; status: Status;
    }) {
        const invoiceNo = await generateInvoiceNo();
        const taxRate = 20;
        const taxExclusive = Number((params.total / (1 + taxRate / 100)).toFixed(2));
        const taxAmount = Number((params.total - taxExclusive).toFixed(2));
        const invoiceStatus = params.status === "paid" ? "paid" : params.status === "draft" ? "draft" : "sent";

        const { data: invoiceRow, error: invoiceErr } = await supabase.from("invoices").insert([{
            company_id: params.company_id, order_id: params.orderId, customer_id: params.customerId,
            invoice_type: "sales", invoice_no: invoiceNo, date: new Date().toISOString(),
            total_tax_exclusive: taxExclusive, total_tax_amount: taxAmount, total_tax_inclusive: params.total,
            status: invoiceStatus, notes: params.notes || `Siparis faturasi - ${params.customerName}`,
        }]).select("id").single();

        if (invoiceErr) throw invoiceErr;

        const invoiceItems = params.items.map((it) => ({
            invoice_id: invoiceRow.id, company_id: params.company_id,
            description: `${productLabel(it.product_type)} - ${it.width_cm}x${it.height_cm} cm`,
            quantity: it.qty, unit_price: it.unit_price, tax_rate: taxRate, line_total: it.line_total,
        }));
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
            const cid = await ensureCustomerId(companyId);
            const customerName = selectedCustomer?.name?.trim() || customerInput.trim() || "Müşteri";
            const deposit = Math.max(0, safeNumber(depositAmount));
            const remaining = Math.max(grandTotal - deposit, 0);
            const overpayment = Math.max(deposit - grandTotal, 0);
            const paymentNote = overpayment > 0 ? `Fazla tahsilat / müşteri alacağı: ${overpayment.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}` : "";

            const { data: orderRow, error: orderErr } = await supabase.from("orders").insert([{
                customer_id: cid, company_id: companyId, note: [note.trim(), paymentNote].filter(Boolean).join("\n") || null,
                status, total_amount: grandTotal, deposit_amount: deposit,
                paid_amount: Math.max(deposit, status === "paid" ? grandTotal : 0),
                remaining_amount: status === "paid" ? 0 : remaining,
                fabric_cost: safeNumber(fabricCost), mechanism_cost: safeNumber(mechanismCost),
                installation_cost: safeNumber(installationCost), profit: safeNumber(profit),
                assigned_to: assignedTo || null,
            }]).select("id").single();

            if (orderErr) throw orderErr;
            const orderId = orderRow.id;

            if (deposit > 0) {
                await supabase.from("payments").insert({
                    company_id: companyId,
                    order_id: orderId,
                    payment_date: new Date().toISOString(),
                    amount: deposit,
                    method: "kapora",
                    note: overpayment > 0 ? paymentNote : "Kapora / ön ödeme",
                });
            }

            const itemsPayload = itemsComputed.map((it) => ({
                order_id: orderId, company_id: companyId, product_type: it.product_type,
                width_cm: it.width_cm, height_cm: it.height_cm, qty: it.qty,
                unit_price: it.unit_price, line_total: it.line_total,
                room: it.room || null,
                note: [it.product_name, it.model_name, it.color_name].filter(Boolean).join(" / ") || null,
                fabric_width_cm: it.fabric_width_cm,
                sewing_allowance_cm: it.product_type === "tul" || it.product_type === "fon" ? 15 : null,
                calculation_note: it.calculation_note || null,
                supplier_id: it.supplier_id || fabricSupplierId || null,
                supplier_unit_cost: it.supplier_cost || (fabricCost > 0 ? fabricCost / Math.max(1, itemsComputed.length) : 0),
                supplier_total_cost: it.supplier_total_cost || (fabricCost > 0 ? fabricCost / Math.max(1, itemsComputed.length) : 0),
                profit: it.line_total - (it.supplier_total_cost || (fabricCost > 0 ? fabricCost / Math.max(1, itemsComputed.length) : 0)),
                product_options: {
                    product_id: it.product_id,
                    product_name: it.product_name,
                    model_name: it.model_name,
                    color_name: it.color_name,
                    pile: it.pile,
                    mechanism: it.mechanism,
                    control_type: it.control_type,
                },
            }));
            const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
            if (itemsErr) throw itemsErr;

            if (wantAppointment && apptDate && apptTime) {
                const startAt = new Date(`${apptDate}T${apptTime}:00`).toISOString();
                await supabase.from("appointments").insert([{
                    type: "measurement", status: "planned", customer_id: cid, order_id: orderId,
                    title: apptTitle || "Ölçü", address: apptAddress || null, start_at: startAt,
                    company_id: companyId,
                    assigned_to: assignedTo || null,
                    assigned_user_id: assignedTo || null,
                    assigned_role: assignedTo ? "installer" : null,
                }]);
            }

            const firstSupplierId = fabricSupplierId || itemsComputed.find((item) => item.supplier_id)?.supplier_id || "";
            const supplierExpenseAmount = safeNumber(fabricCost) || itemsComputed.reduce((acc, item) => acc + safeNumber(item.supplier_total_cost), 0);
            if (supplierExpenseAmount > 0 && firstSupplierId) {
                await createSupplierExpense({ company_id: companyId, amount: supplierExpenseAmount, category: "Kumaş / Ürün", supplier_id: firstSupplierId, orderId, customerName });
            }

            await createSalesInvoiceForOrder({ company_id: companyId, orderId, customerId: cid, customerName, items: itemsComputed, notes: note, total: grandTotal, status });

            alert("Sipariş başarıyla kaydedildi!");
            nav("/orders");
        } catch (e: any) {
            setErr(e?.message ?? "Hata oluştu.");
        } finally {
            setSaving(false);
        }
    }

    function quoteMessage() {
        const customerName = selectedCustomer?.name?.trim() || customerInput.trim() || "Müşteri";
        return [
            `Merhaba ${customerName}, teklif toplamınız: ${formatTL(grandTotal)}.`,
            itemsComputed.map((item) => `${item.product_name || item.product_type}: ${item.width_cm}x${item.height_cm} cm x ${item.qty} - ${formatTL(item.line_total)}`).join("\n"),
        ].filter(Boolean).join("\n");
    }

    function quoteWhatsappUrl() {
        const phone = String(selectedCustomer?.phone || newPhone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
        return `https://wa.me/${phone}?text=${encodeURIComponent(quoteMessage())}`;
    }

    if (loadingContext) return <div className="p-8 text-center">Yükleniyor...</div>;

    return (
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
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
                    <button type="button" onClick={() => window.print()} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold hover:bg-slate-50 dark:border-slate-800">
                        PDF Oluştur
                    </button>
                    <a href={quoteWhatsappUrl()} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700">
                        WhatsApp Gönder
                    </a>
                    <button onClick={() => nav("/orders")} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">İptal</button>
                    <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg transition-all">
                        {saving ? "Kaydediliyor..." : "Teklifi / Siparişi Kaydet"}
                    </button>
                </div>
            </div>

            {err && <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm font-medium">Uyar?: {err}</div>}

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                        <h2 className="text-lg font-black text-slate-900 dark:text-white">Alınan Ölçüler</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Ölçü kaydını seçip hızlıca teklife/siparişe dönüştürün.</p>
                    </div>
                    <button onClick={() => nav("/measurements/new")} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        Yeni Ölçü Al
                    </button>
                </div>

                {measuredAppointments.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500 dark:bg-slate-950">
                        Henüz alınmış ölçü bulunamadı.
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                        {measuredAppointments.slice(0, 8).map((appt) => {
                            const customer = pickAppointmentCustomer(appt.customer);
                            const active = sourceAppointmentId === appt.id;
                            return (
                                <div key={appt.id} className={`rounded-2xl border p-4 ${active ? "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-black text-slate-900 dark:text-white">{customer?.name || "İsimsiz müşteri"}</div>
                                            <div className="mt-1 text-xs font-bold text-slate-500">
                                                {appt.start_at ? new Date(appt.start_at).toLocaleDateString("tr-TR") : "Tarih yok"}
                                                {appt.room_name ? ` - ${appt.room_name}` : ""}
                                            </div>
                                        </div>
                                        <div className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-700 dark:bg-slate-900">
                                            {appt.width_cm || "-"}x{appt.height_cm || "-"} cm
                                        </div>
                                    </div>
                                    <div className="mt-3 text-xs font-bold text-slate-500">
                                        {[appt.model_name || productLabel((appt.product_type || "stor") as ProductType), appt.color_name, appt.unit_price ? formatTL(safeNumber(appt.unit_price)) : null].filter(Boolean).join(" - ")}
                                    </div>
                                    <button onClick={() => setSourceAppointmentId(appt.id)} className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700">
                                        {active ? "Seçildi" : "Siparişe Dönüştür"}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
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

                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="font-bold flex items-center gap-2"><Package size={20} className="text-blue-500"/> Ürünler</h2>
                            <button onClick={addItem} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold"><Plus size={16}/> Ekle</button>
                        </div>
                        <div className="p-6 space-y-4">
                            {items.map((item, idx) => (
                                <div key={item.key} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                        <div className="sm:col-span-3">
                                            <input value={item.product_name} list="order-product-list" onChange={(e) => applyProductNameToItem(item.key, e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none" placeholder="Ürün/model seç veya yaz" />
                                            <datalist id="order-product-list">
                                                {products.map((product) => <option key={product.id} value={product.name || ""}>{product.category || ""}</option>)}
                                            </datalist>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <select value={item.product_type} onChange={(e) => updateItem(item.key, { product_type: e.target.value as ProductType })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none">
                                                <option value="stor">Stor</option><option value="zebra">Zebra</option><option value="tul">Tül</option><option value="fon">Fon</option><option value="plicell">Plicell</option><option value="jalousie">Jaluzi</option><option value="picasso">Picasso</option>
                                            </select>
                                        </div>
                                        <div className="sm:col-span-2 text-center"><input type="number" value={item.width_cm} onChange={(e) => updateItem(item.key, { width_cm: safeNumber(e.target.value) })} className="w-full px-2 py-2.5 rounded-lg border border-slate-200 text-center font-bold" placeholder="En"/></div>
                                        <div className="sm:col-span-2 text-center"><input type="number" value={item.height_cm} onChange={(e) => updateItem(item.key, { height_cm: safeNumber(e.target.value) })} className="w-full px-2 py-2.5 rounded-lg border border-slate-200 text-center font-bold" placeholder="Boy"/></div>
                                        <div className="sm:col-span-1 text-center"><input type="number" value={item.qty} onChange={(e) => updateItem(item.key, { qty: safeNumber(e.target.value, 1) })} className="w-full px-1 py-2.5 rounded-lg border border-slate-200 text-center" placeholder="Adet"/></div>
                                        <div className="sm:col-span-1 relative"><input type="number" value={item.unit_price} onChange={(e) => updateItem(item.key, { unit_price: safeNumber(e.target.value) })} className="w-full pl-2 pr-5 py-2.5 rounded-lg border border-slate-200 text-right font-black"/><span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">₺</span></div>
                                        <div className="sm:col-span-1 flex items-center justify-center"><button onClick={() => removeItem(item.key)} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button></div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                        <input value={item.model_name} onChange={(e) => updateItem(item.key, { model_name: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200" placeholder="Model / kartela" />
                                        <input value={item.color_name} onChange={(e) => updateItem(item.key, { color_name: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200" placeholder="Renk / kod" />
                                        <select value={item.supplier_id} onChange={(e) => applySupplierToItem(item.key, e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                            <option value="">Tedarikçi</option>
                                            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                                        </select>
                                        <input type="number" value={item.supplier_cost} onChange={(e) => updateItem(item.key, { supplier_cost: safeNumber(e.target.value) })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-right" placeholder="Alış maliyeti" />
                                        <input value={item.room} onChange={(e) => updateItem(item.key, { room: e.target.value })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200" placeholder="Oda (Salon, Mutfak...)" />
                                        {(item.product_type === "tul" || item.product_type === "fon") && (
                                            <select value={item.pile} onChange={(e) => updateItem(item.key, { pile: e.target.value as "2" | "3" })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                                <option value="2">Pile 1'e 2</option>
                                                <option value="3">Pile 1'e 3</option>
                                            </select>
                                        )}
                                        {(item.product_type === "jalousie" || item.product_type === "picasso") && (
                                            <>
                                                <select value={item.mechanism} onChange={(e) => updateItem(item.key, { mechanism: e.target.value as "reducer" | "standard" })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                                    <option value="standard">Redüktörsüz</option>
                                                    <option value="reducer">Redüktörlü</option>
                                                </select>
                                                <select value={item.control_type} onChange={(e) => updateItem(item.key, { control_type: e.target.value as "corded" | "tape" })} className="w-full px-3 py-2.5 rounded-lg border border-slate-200">
                                                    <option value="corded">İpli</option>
                                                    <option value="tape">Kurdelalı</option>
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
                                <div className="text-right"><div className="text-[10px] text-slate-400 font-bold uppercase">Adet</div><div className="text-xl font-bold">{itemsComputed.reduce((a,b)=>a+b.qty,0)}</div></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
                        <h2 className="font-bold flex items-center gap-2"><CreditCard size={18} className="text-blue-500"/> Maliyet</h2>
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400">Kapora / Ön Ödeme</label>
                            <input type="number" value={depositAmount} onChange={(e)=>setDepositAmount(safeNumber(e.target.value))} className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-right font-bold"/>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                                    <div className="text-slate-500">Toplam Tutar</div>
                                    <div className="font-black">{formatTL(grandTotal)}</div>
                                </div>
                                <div className="rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                                    <div>Kalan Tutar</div>
                                    <div className="font-black">{formatTL(Math.max(grandTotal - safeNumber(depositAmount), 0))}</div>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400">Kumas / Urun</label>
                            <div className="flex gap-2">
                                <input type="number" value={fabricCost} onChange={(e)=>setFabricCost(safeNumber(e.target.value))} className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-right font-bold"/>
                                <select value={fabricSupplierId} onChange={(e)=>setFabricSupplierId(e.target.value)} className="w-24 p-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border">
                                    <option value="">Tedarikci</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400">Mekanizma</label>
                            <input type="number" value={mechanismCost} onChange={(e)=>setMechanismCost(safeNumber(e.target.value))} className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-right font-bold"/>
                        </div>
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400">İşçilik</label>
                            <input type="number" value={installationCost} onChange={(e)=>setInstallationCost(safeNumber(e.target.value))} className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-right font-bold"/>
                        </div>
                        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex justify-between items-center">
                            <div><div className="text-[10px] font-bold text-emerald-600">Kar</div><div className="text-lg font-black text-emerald-700">{formatTL(profit)}</div></div>
                            <div className="text-right text-emerald-600 font-bold">{grandTotal > 0 ? ((profit/grandTotal)*100).toFixed(1) : 0}%</div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 shadow-sm">
                        <h2 className="font-bold flex items-center gap-2"><Briefcase size={18} className="text-indigo-500"/> Sorumlu</h2>
                        <select value={assignedTo} onChange={(e)=>setAssignedTo(e.target.value)} className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none font-medium">
                            <option value="">-- Personel Seçin --</option>
                            {staffList.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                        <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/50 dark:bg-indigo-900/10">
                            <div className="mb-2 text-xs font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Yeni personel ekle</div>
                            <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
                                <input value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} className="min-h-11 rounded-xl border border-indigo-100 bg-white px-3 text-sm font-bold outline-none dark:border-indigo-900 dark:bg-slate-900" placeholder="Ad soyad" />
                                <select value={newStaffRole} onChange={(e) => setNewStaffRole(e.target.value)} className="min-h-11 rounded-xl border border-indigo-100 bg-white px-3 text-sm font-bold outline-none dark:border-indigo-900 dark:bg-slate-900">
                                    <option value="installer">Montajcı</option>
                                    <option value="measurement">Ölçücü</option>
                                    <option value="personnel">Personel</option>
                                </select>
                                <button type="button" onClick={handleCreateInlineStaff} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white">
                                    Ekle
                                </button>
                            </div>
                        </div>
                        
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500">Sipariş Durumu</label>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    ["measured", "Ölçü Alındı"],
                                    ["quoted", "Teklif Verildi"],
                                    ["approved", "Onaylandı"],
                                    ["production", "İmalatta"],
                                    ["installation_waiting", "Montaj Bekliyor"],
                                    ["completed", "Tamamlandı"],
                                    ["paid", "Ödendi"],
                                    ["partial", "Kısmi"],
                                ].map(([s, label]) => (
                                    <button key={s} onClick={()=>setStatus(s as Status)} className={cn("p-2 rounded-xl border text-[10px] font-bold", status === s ? "bg-blue-600 border-blue-600 text-white shadow-lg" : "bg-white dark:bg-slate-900 border-slate-100 text-slate-500")}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3 pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-500">Randevu Oluştur</label>
                                <button onClick={()=>setWantAppointment(!wantAppointment)} className={cn("w-10 h-5 rounded-full relative transition-colors", wantAppointment ? "bg-blue-600" : "bg-slate-300")}>
                                    <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", wantAppointment ? "left-6" : "left-1")}></div>
                                </button>
                            </div>
                            {wantAppointment && (
                                <div className="space-y-2 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100">
                                    <input type="text" value={apptTitle} onChange={(e)=>setApptTitle(e.target.value)} className="w-full p-2 text-xs rounded border outline-none" placeholder="Başlık (örn: Montaj)"/>
                                    <div className="grid grid-cols-2 gap-2">
                                        <input type="date" value={apptDate} onChange={(e)=>setApptDate(e.target.value)} className="p-1.5 text-[10px] rounded border outline-none"/>
                                        <input type="time" value={apptTime} onChange={(e)=>setApptTime(e.target.value)} className="p-1.5 text-[10px] rounded border outline-none"/>
                                    </div>
                                    <textarea value={apptAddress} onChange={(e)=>setApptAddress(e.target.value)} placeholder="Farkl? Adres..." className="w-full p-2 text-[10px] rounded border h-12 outline-none"/>
                                </div>
                            )}
                        </div>
                        
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500">Notlar</label>
                            <textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Özel notlar..." className="w-full p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border outline-none text-xs h-24"/>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="lg:hidden fixed bottom-6 left-4 right-4 z-40">
                <button onClick={handleSave} disabled={saving} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-2xl transition-transform active:scale-95 flex items-center justify-center gap-2">
                    <Save size={20}/> {saving ? "Kaydediliyor..." : "Siparişi Kaydet"}
                </button>
            </div>
        </div>
    );
}
