import { useEffect, useMemo, useState } from "react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

async function getContext() {
    return getEffectiveTenantContext();
}

type ProductType = "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "diger";

type ProductRow = {
    id: string;
    created_at: string | null;
    name: string | null;
    category: string | null;
    pricing_mode: string | null;
    unit_price: number | null;
    min_price: number | null;
    min_area: number | null;
    waste_rate: number | null;
    rounding_rule: number | null;
    currency: string | null;
    description: string | null;
    is_active: boolean | null;
    company_id: string | null;
    cost_price?: number | null;
};

type SupplierRow = {
    id: string;
    name: string | null;
};

type SupplierProductPrice = {
    supplier_id: string;
    product_id: string | null;
    product_name: string | null;
    product_category?: string | null;
    unit_cost: number | null;
};

type FormState = {
    name: string;
    category: ProductType;
    pricing_mode: string;
    unit_price: number;
    min_price: number;
    min_area: number;
    waste_rate: number;
    rounding_rule: number;
    currency: string;
    description: string;
    is_active: boolean;
    cost_price: number;
    supplier_id: string;
};


const emptyForm: FormState = {
    name: "",
    category: "stor",
    pricing_mode: "m2",
    unit_price: 0,
    min_price: 0,
    min_area: 2,
    waste_rate: 0,
    rounding_rule: 10,
    currency: "TL",
    description: "",
    is_active: true,
    cost_price: 0,
    supplier_id: ""
};

const PRODUCT_SELECT = `
    id,
    created_at,
    name,
    category,
    pricing_mode,
    unit_price,
    min_price,
    min_area,
    waste_rate,
    rounding_rule,
    currency,
    description,
    is_active,
    company_id,
    cost_price
`;


function safeNumber(v: unknown, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function formatTL(n: number | null | undefined) {
    const value = Number(n ?? 0);
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(value);
}

function categoryLabel(category: string | null | undefined) {
    switch (category) {
        case "stor":
            return "Stor";
        case "zebra":
            return "Zebra";
        case "tul":
            return "Tül";
        case "fon":
            return "Fon";
        case "jalousie":
            return "Jaluzi";
        case "picasso":
            return "Picasso";
        default:
            return "Diğer";
    }
}

function normalizeName(value: string | null | undefined) {
    return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

export default function Products() {
    const [companyId, setCompanyId] = useState<string>("");
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [supplierPrices, setSupplierPrices] = useState<SupplierProductPrice[]>([]);
    const [supplierPriceErr, setSupplierPriceErr] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState("");

    const [editingId, setEditingId] = useState<string>("");
    const [form, setForm] = useState<FormState>(emptyForm);

    const [search, setSearch] = useState("");
    const [showPassive, setShowPassive] = useState(true);

    useEffect(() => {
        let alive = true;

        async function loadData() {
            setLoading(true);
            setErr("");
            setSuccess("");

            try {
                const ctx = await getContext();
                if (!alive) return;

                setCompanyId(ctx.company_id);

                const suppliersRes = await supabase
                    .from("suppliers")
                    .select("id,name")
                    .eq("company_id", ctx.company_id)
                    .order("name", { ascending: true });

                if (!suppliersRes.error) {
                    setSuppliers((suppliersRes.data ?? []) as SupplierRow[]);
                }

                let priceRes: any = await supabase
                    .from("supplier_product_prices")
                    .select("supplier_id,product_id,product_name,product_category,unit_cost")
                    .eq("company_id", ctx.company_id);

                if (priceRes.error && /product_category/i.test(String(priceRes.error.message || ""))) {
                    priceRes = await supabase
                        .from("supplier_product_prices")
                        .select("supplier_id,product_id,product_name,unit_cost")
                        .eq("company_id", ctx.company_id);
                }

                if (!priceRes.error) {
                    setSupplierPrices((priceRes.data ?? []) as SupplierProductPrice[]);
                    setSupplierPriceErr("");
                } else {
                    setSupplierPrices([]);
                    setSupplierPriceErr("");
                }

                let { data, error }: { data: any[] | null; error: any } = await supabase
                    .from("products")
                    .select(PRODUCT_SELECT)
                    .eq("company_id", ctx.company_id)
                    .order("name", { ascending: true });

                if (error && /cost_price/i.test(String(error.message || ""))) {
                    const fallback = await supabase
                        .from("products")
                        .select(PRODUCT_SELECT.replace(",\n    cost_price", ""))
                        .eq("company_id", ctx.company_id)
                        .order("name", { ascending: true });
                    data = fallback.data;
                    error = fallback.error;
                }

                if (error) throw error;
                if (!alive) return;

                setProducts((data ?? []) as ProductRow[]);
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message ?? "Ürünler yüklenemedi.");
            } finally {
                if (!alive) return;
                setLoading(false);
            }
        }

        loadData();

        return () => {
            alive = false;
        };
    }, []);

    const filteredProducts = useMemo(() => {
        const q = search.trim().toLocaleLowerCase("tr-TR");

        return products.filter((p) => {
            const matchesActive = showPassive ? true : p.is_active !== false;

            const haystack = [
                p.name ?? "",
                p.category ?? "",
                p.description ?? "",
            ]
                .join(" ")
                .toLocaleLowerCase("tr-TR");

            const matchesSearch = !q || haystack.includes(q);

            return matchesActive && matchesSearch;
        });
    }, [products, search, showPassive]);

    function resetForm() {
        setForm(emptyForm);
        setEditingId("");
        setSuccess("");
    }

    function fillFormFromRow(row: ProductRow) {
        setEditingId(row.id);
        setForm({
            name: row.name ?? "",
            category: (row.category as ProductType) || "stor",
            pricing_mode: row.pricing_mode ?? "m2",
            unit_price: safeNumber(row.unit_price),
            min_price: safeNumber(row.min_price),
            min_area: safeNumber(row.min_area, 2),
            waste_rate: safeNumber(row.waste_rate),
            rounding_rule: safeNumber(row.rounding_rule, 10),
            currency: row.currency ?? "TL",
            description: row.description ?? "",
            is_active: row.is_active ?? true,
            cost_price: safeNumber(row.cost_price),
            supplier_id: supplierForProduct(row)?.supplier_id ?? "",
        });

        setSuccess("");
        setErr("");
        window.setTimeout(() => {
            document.getElementById("product-form-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
    }

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    function findSupplierCategoryPrice(supplierId: string, category: ProductType | string, productName?: string) {
        if (!supplierId) return null;

        const categoryValue = normalizeName(category);
        const categoryName = normalizeName(categoryLabel(category));
        const productNameValue = normalizeName(productName);

        return supplierPrices.find((price) => {
            if (price.supplier_id !== supplierId) return false;

            const priceCategory = normalizeName(price.product_category);
            const priceName = normalizeName(price.product_name);

            return (
                priceCategory === categoryValue ||
                priceCategory === categoryName ||
                priceName === categoryValue ||
                priceName === categoryName ||
                (!!productNameValue && priceName === productNameValue)
            );
        }) ?? null;
    }

    function handleNameChange(name: string) {
        setForm((prev) => {
            const existingPrice = findSupplierCategoryPrice(prev.supplier_id, prev.category, name);

            return {
                ...prev,
                name,
                cost_price: existingPrice ? safeNumber(existingPrice.unit_cost) : prev.cost_price,
            };
        });
    }

    function handleCategoryChange(category: ProductType) {
        setForm((prev) => {
            const existingPrice = findSupplierCategoryPrice(prev.supplier_id, category, prev.name);

            return {
                ...prev,
                category,
                cost_price: existingPrice ? safeNumber(existingPrice.unit_cost) : prev.cost_price,
            };
        });
    }

    function handleSupplierChange(supplierId: string) {
        setForm((prev) => {
            const existingPrice = findSupplierCategoryPrice(supplierId, prev.category, prev.name);

            return {
                ...prev,
                supplier_id: supplierId,
                cost_price: existingPrice ? safeNumber(existingPrice.unit_cost) : prev.cost_price,
            };
        });
    }

    async function handleSave() {
        setErr("");
        setSuccess("");

        if (!companyId) {
            setErr("Şirket bilgisi yüklenemedi.");
            return;
        }
        if (!form.name.trim()) {
            setErr("Ürün adı zorunlu.");
            return;
        }

        if (form.unit_price < 0) {
            setErr("Birim fiyat negatif olamaz.");
            return;
        }

        if (form.min_price < 0) {
            setErr("Minimum fiyat negatif olamaz.");
            return;
        }

        if (form.min_area < 0) {
            setErr("Minimum alan negatif olamaz.");
            return;
        }

        if (form.rounding_rule < 0) {
            setErr("Yuvarlama kuralı negatif olamaz.");
            return;
        }

        if (!form.supplier_id && form.cost_price > 0) {
            setErr("Alış fiyatı kaydedebilmek için lütfen bir tedarikçi seçin.");
            return;
        }

        setSaving(true);

        try {
            const payload = {
                company_id: companyId,
                name: form.name.trim(),
                category: form.category,
                pricing_mode: form.pricing_mode || "m2",
                unit_price: safeNumber(form.unit_price),
                min_price: safeNumber(form.min_price),
                min_area: safeNumber(form.min_area),
                waste_rate: safeNumber(form.waste_rate),
                rounding_rule: safeNumber(form.rounding_rule),
                currency: form.currency.trim() || "TL",
                description: form.description.trim() || null,
                is_active: form.is_active,
                cost_price: safeNumber(form.cost_price),
            };

            let savedProduct: ProductRow;

            if (editingId) {
                let { data, error }: { data: any | null; error: any } = await supabase
                    .from("products")
                    .update(payload)
                    .eq("id", editingId)
                    .select(PRODUCT_SELECT)
                    .single();

                if (error && /cost_price/i.test(String(error.message || ""))) {
                    const fallbackPayload = { ...payload };
                    delete (fallbackPayload as Partial<typeof payload>).cost_price;
                    const fallback = await supabase
                        .from("products")
                        .update(fallbackPayload)
                        .eq("id", editingId)
                        .select(PRODUCT_SELECT.replace(",\n    cost_price", ""))
                        .single();
                    data = fallback.data;
                    error = fallback.error;
                }

                if (error) throw error;
                savedProduct = data as ProductRow;

                setProducts((prev) =>
                    prev
                        .map((x) => (x.id === editingId ? savedProduct : x))
                        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "tr"))
                );

                setSuccess("Ürün güncellendi.");
            } else {
                let { data, error }: { data: any | null; error: any } = await supabase
                    .from("products")
                    .insert([payload])
                    .select(PRODUCT_SELECT)
                    .single();

                if (error && /cost_price/i.test(String(error.message || ""))) {
                    const fallbackPayload = { ...payload };
                    delete (fallbackPayload as Partial<typeof payload>).cost_price;
                    const fallback = await supabase
                        .from("products")
                        .insert([fallbackPayload])
                        .select(PRODUCT_SELECT.replace(",\n    cost_price", ""))
                        .single();
                    data = fallback.data;
                    error = fallback.error;
                }

                if (error) throw error;
                savedProduct = data as ProductRow;

                setProducts((prev) =>
                    [...prev, savedProduct].sort((a, b) =>
                        (a.name ?? "").localeCompare(b.name ?? "", "tr")
                    )
                );

                setSuccess("Ürün eklendi.");
            }

            if (form.supplier_id) {
                await saveSupplierProductPrice(savedProduct);
            }

            resetForm();
        } catch (e: any) {
            setErr(e?.message ?? "Kayıt sırasında hata oluştu.");
        } finally {
            setSaving(false);
        }
    }

    function supplierForProduct(row: ProductRow) {
        const productName = normalizeName(row.name);
        const categoryValue = normalizeName(row.category);
        const categoryName = normalizeName(categoryLabel(row.category));
        return supplierPrices.find((price) => {
            if (price.product_id === row.id) return true;
            const priceCategory = normalizeName(price.product_category);
            const priceName = normalizeName(price.product_name);
            return priceCategory === categoryValue || priceCategory === categoryName || priceName === productName || priceName === categoryName;
        }) ?? null;
    }

    function supplierName(id: string | null | undefined) {
        if (!id) return "";
        return suppliers.find((supplier) => supplier.id === id)?.name || "";
    }

    async function saveSupplierProductPrice(product: ProductRow) {
        if (!form.supplier_id) return;
        const row = {
            company_id: companyId,
            supplier_id: form.supplier_id,
            product_id: product.id,
            product_name: product.name || form.name.trim(),
            product_category: product.category || form.category,
            unit_cost: safeNumber(form.cost_price),
            updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
            .from("supplier_product_prices")
            .upsert([row], { onConflict: "company_id,supplier_id,product_name" });

        if (error) {
            setSupplierPriceErr("Ürün kaydedildi. Tedarikçi alış fiyatı bağlantısı henüz aktif değil.");
            return;
        }

        setSupplierPriceErr("");
        setSupplierPrices((prev) => {
            const next = prev.filter((price) =>
                !(price.supplier_id === row.supplier_id &&
                    (price.product_id === row.product_id || normalizeName(price.product_name) === normalizeName(row.product_name)))
            );
            return [...next, {
                supplier_id: row.supplier_id,
                product_id: row.product_id,
                product_name: row.product_name,
                product_category: row.product_category,
                unit_cost: row.unit_cost,
            }];
        });
    }

    async function toggleActive(row: ProductRow) {
        setErr("");
        setSuccess("");

        try {
            const nextValue = !(row.is_active !== false);

            let { data, error }: { data: any | null; error: any } = await supabase
                .from("products")
                .update({ is_active: nextValue })
                .eq("id", row.id)
                .eq("company_id", companyId)
                .select(PRODUCT_SELECT)
                .single();

            if (error && /cost_price/i.test(String(error.message || ""))) {
                const fallback = await supabase
                    .from("products")
                    .update({ is_active: nextValue })
                    .eq("id", row.id)
                    .eq("company_id", companyId)
                    .select(PRODUCT_SELECT.replace(",\n    cost_price", ""))
                    .single();
                data = fallback.data ? { ...((fallback.data ?? {}) as Partial<ProductRow>), cost_price: row.cost_price } : fallback.data;
                error = fallback.error;
            }

            if (error) throw error;

            const updatedRow = { ...row, ...((data ?? {}) as Partial<ProductRow>), is_active: nextValue };

            setProducts((prev) =>
                prev.map((x) => (x.id === row.id ? updatedRow : x))
            );

            if (editingId === row.id) {
                setForm((prev) => ({ ...prev, is_active: nextValue }));
            }

            setSuccess(nextValue ? "Ürün aktifleştirildi." : "Ürün pasife alındı.");
        } catch (e: any) {
            setErr(e?.message ?? "Durum güncellenemedi.");
        }
    }

    return (
        <div className="p-6 max-w-7xl">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Fiyat Listesi</h1>
                    <p className="text-slate-500 mt-1">
                        Ürün, m² fiyatı, minimum alan ve yuvarlama kurallarını buradan yönet.
                    </p>
                </div>
            </div>

            {err ? (
                <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
                    {err}
                </div>
            ) : null}

            {success ? (
                <div className="mt-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {success}
                </div>
            ) : null}

            {supplierPriceErr ? (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                    {supplierPriceErr}
                </div>
            ) : null}

            <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div id="product-form-panel" className="xl:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 scroll-mt-24">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold">
                            {editingId ? "Ürün Düzenle" : "Yeni Ürün"}
                        </h2>

                        {editingId ? (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                                disabled={saving}
                            >
                                Yeni Kayıt
                            </button>
                        ) : null}
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium">Ürün Adı</label>
                            <input
                                className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                value={form.name}
                                onChange={(e) => handleNameChange(e.target.value)}
                                placeholder="Örn: Stor Perde"
                                disabled={saving}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium">Kategori</label>
                            <select
                                className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                value={form.category}
                                onChange={(e) => handleCategoryChange(e.target.value as ProductType)}
                                disabled={saving}
                            >
                                <option value="stor">Stor</option>
                                <option value="zebra">Zebra</option>
                                <option value="tul">Tül</option>
                                <option value="fon">Fon</option>
                                <option value="jalousie">Jaluzi</option>
                                <option value="picasso">Picasso</option>
                                <option value="diger">Diğer</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-sm font-medium">Fiyatlama Tipi</label>
                            <select
                                className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                value={form.pricing_mode}
                                onChange={(e) => setField("pricing_mode", e.target.value)}
                                disabled={saving}
                            >
                                <option value="m2">m²</option>
                                <option value="adet">Adet</option>
                                <option value="mtul">Metre Tül</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className="text-sm font-medium">Bu ürün hangi tedarikçiden alınıyor?</label>
                                <select
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.supplier_id}
                                    onChange={(e) => handleSupplierChange(e.target.value)}
                                    disabled={saving}
                                >
                                    <option value="">Tedarikçi seçilmedi</option>
                                    {suppliers.map((supplier) => (
                                        <option key={supplier.id} value={supplier.id}>
                                            {supplier.name || "İsimsiz tedarikçi"}
                                        </option>
                                    ))}
                                </select>
                                <div className="mt-1 text-xs text-slate-500">
                                    Seçilen tedarikçi ve alış fiyatı, tedarikçi fiyat listesine de kaydedilir.
                                </div>
                            </div>

                            <div>
                                <label className="text-sm font-medium">Bu tedarikçiden alış fiyatı</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.cost_price}
                                    onChange={(e) => setField("cost_price", safeNumber(e.target.value))}
                                    disabled={saving}
                                />
                            </div>
    
                                <div>
                                    <label className="text-sm font-medium">Satış Fiyatı</label>
                                    <input
                                        type="number"
                                        min={0}
                                        className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                        value={form.unit_price}
                                        onChange={(e) => setField("unit_price", safeNumber(e.target.value))}
                                        disabled={saving}
                                    />
                                </div>
    
                                <div className="col-span-2">
                                     <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                         <div className="text-xs text-slate-500">Tahmini Kâr Marjı</div>
                                         <div className={`text-lg font-bold ${form.unit_price > 0 && ((form.unit_price - form.cost_price) / form.unit_price) < 0.2 ? 'text-red-500' : 'text-emerald-500'}`}>
                                             %{form.unit_price > 0 ? (((form.unit_price - form.cost_price) / form.unit_price) * 100).toFixed(1) : '0.0'}
                                         </div>
                                     </div>
                                </div>


                            <div>
                                <label className="text-sm font-medium">Min. Fiyat</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.min_price}
                                    onChange={(e) => setField("min_price", safeNumber(e.target.value))}
                                    disabled={saving}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">Min. Alan (m²)</label>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.min_area}
                                    onChange={(e) => setField("min_area", safeNumber(e.target.value))}
                                    disabled={saving}
                                />
                            </div>

                            <div>
                                <label className="text-sm font-medium">Yuvarlama (cm)</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.rounding_rule}
                                    onChange={(e) => setField("rounding_rule", safeNumber(e.target.value))}
                                    disabled={saving}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">Fire Oranı</label>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.waste_rate}
                                    onChange={(e) => setField("waste_rate", safeNumber(e.target.value))}
                                    disabled={saving}
                                />
                            </div>

                            <div>
                                <label className="text-sm font-medium">Para Birimi</label>
                                <input
                                    className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                    value={form.currency}
                                    onChange={(e) => setField("currency", e.target.value)}
                                    disabled={saving}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium">Açıklama</label>
                            <textarea
                                rows={3}
                                className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                value={form.description}
                                onChange={(e) => setField("description", e.target.value)}
                                placeholder="Not, kumaş bilgisi, marka vb."
                                disabled={saving}
                            />
                        </div>

                        <div>
                            <label className="inline-flex items-center gap-2 text-sm font-medium">
                                <input
                                    type="checkbox"
                                    checked={form.is_active}
                                    onChange={(e) => setField("is_active", e.target.checked)}
                                    disabled={saving}
                                />
                                Aktif ürün
                            </label>
                        </div>

                        <div className="pt-2 flex gap-3">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving || loading || !companyId}
                                className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : editingId ? "Güncelle" : "Kaydet"}
                            </button>

                            <button
                                type="button"
                                onClick={resetForm}
                                disabled={saving}
                                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                                Temizle
                            </button>
                        </div>
                    </div>
                </div>

                <div className="xl:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                        <h2 className="text-lg font-semibold">Tanımlı Ürünler</h2>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                                placeholder="Ürün ara..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />

                            <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={showPassive}
                                    onChange={(e) => setShowPassive(e.target.checked)}
                                />
                                Pasifleri göster
                            </label>
                        </div>
                    </div>

                    {loading ? (
                        <div className="text-sm text-slate-500">Ürünler yükleniyor...</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-sm text-slate-500">Gösterilecek ürün bulunamadı.</div>
                    ) : (
                        <div className="space-y-3">
                            {filteredProducts.map((row) => (
                                <div
                                    key={row.id}
                                    className={`rounded-xl border p-4 ${row.is_active !== false
                                        ? "border-slate-200 dark:border-slate-800"
                                        : "border-amber-200 bg-amber-50/50 dark:border-amber-800"
                                        }`}
                                >
                                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="font-semibold text-lg">
                                                    {row.name || "İsimsiz Ürün"}
                                                </div>

                                                <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                                    {categoryLabel(row.category)}
                                                </span>

                                                <span
                                                    className={`text-xs px-2 py-1 rounded-full border ${row.is_active !== false
                                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                        : "bg-amber-50 text-amber-700 border-amber-200"
                                                        }`}
                                                >
                                                    {row.is_active !== false ? "Aktif" : "Pasif"}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                                                <div>
                                                    Satis Fiyati: <b>{formatTL(row.unit_price)}</b>
                                                </div>
                                                <div>
                                                    Maliyet: <b>{formatTL(row.cost_price)}</b>
                                                </div>
                                                <div>
                                                    Tedarikçi: <b>{supplierName(supplierForProduct(row)?.supplier_id) || "Seçilmedi"}</b>
                                                </div>
                                                <div className={row.unit_price && row.cost_price && ((row.unit_price - row.cost_price) / row.unit_price) < 0.2 ? 'text-red-500 font-bold' : 'text-emerald-600 font-bold'}>
                                                    Kar Marji: %{row.unit_price && row.unit_price > 0 ? (((row.unit_price - (row.cost_price || 0)) / row.unit_price) * 100).toFixed(1) : '0'}
                                                </div>
                                                <div>
                                                    Min. Fiyat: <b>{formatTL(row.min_price)}</b>
                                                </div>

                                                <div>
                                                    Min. Alan: <b>{safeNumber(row.min_area)} m²</b>
                                                </div>
                                                <div>
                                                    Yuvarlama: <b>{safeNumber(row.rounding_rule)} cm</b>
                                                </div>
                                                <div>
                                                    Fiyatlama: <b>{row.pricing_mode || "-"}</b>
                                                </div>
                                                <div>
                                                    Fire: <b>{safeNumber(row.waste_rate)}</b>
                                                </div>
                                            </div>

                                            {row.description ? (
                                                <div className="text-sm text-slate-500">
                                                    {row.description}
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => fillFormFromRow(row)}
                                                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm"
                                            >
                                                Düzenle
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => toggleActive(row)}
                                                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm"
                                            >
                                                {row.is_active !== false ? "Pasife Al" : "Aktif Yap"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
