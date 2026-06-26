import { useEffect, useMemo, useState } from "react";
import { Plus, Truck, Phone, Mail, Package, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type Supplier = {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    created_at: string | null;
};

async function getContext() {
    return getEffectiveTenantContext();
}

function formatTL(value: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
}

const DEFAULT_PRICE_PRODUCTS: Product[] = [
    { id: "default-stor", name: "Stor", category: "Stor", unit_price: null },
    { id: "default-zebra", name: "Zebra", category: "Zebra", unit_price: null },
    { id: "default-tul", name: "Tül", category: "Tül", unit_price: null },
    { id: "default-fon", name: "Fon", category: "Fon", unit_price: null },
    { id: "default-plicell", name: "Plicell", category: "Plicell", unit_price: null },
    { id: "default-jaluzi", name: "Jaluzi", category: "Jaluzi", unit_price: null },
    { id: "default-dikey-tul", name: "Dikey Tül", category: "Dikey Tül", unit_price: null },
    { id: "default-dikey-stor", name: "Dikey Stor", category: "Dikey Stor", unit_price: null },
    { id: "default-picasso", name: "Picasso", category: "Picasso", unit_price: null },
];

function normalizeName(value: string | null | undefined) {
    return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function isDefaultProduct(product: Product) {
    return product.id.startsWith("default-");
}

export const Suppliers = () => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [selected, setSelected] = useState<Supplier | null>(null);
    const [editName, setEditName] = useState("");
    const [editPhone, setEditPhone] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [prices, setPrices] = useState<SupplierPrice[]>([]);
    const [priceErr, setPriceErr] = useState("");
    const [priceSaving, setPriceSaving] = useState(false);

    function openEdit(s: Supplier) {
        setSelected(s);
        setEditName(s.name ?? "");
        setEditPhone(s.phone ?? "");
        setEditEmail(s.email ?? "");
        setEditAddress(s.address ?? "");
        void loadSupplierPrices(s.id);
    }

    const totalSupplierCost = useMemo(
        () => prices.reduce((acc, price) => acc + Number(price.unit_cost || 0), 0),
        [prices],
    );

    const priceListProducts = useMemo(() => {
        const seen = new Set<string>();
        const rows: Product[] = [];

        [...DEFAULT_PRICE_PRODUCTS, ...products].forEach((product) => {
            const key = normalizeName(product.name || product.category || product.id);
            if (!key || seen.has(key)) return;
            seen.add(key);
            rows.push(product);
        });

        return rows;
    }, [products]);

    async function updateSupplier() {
        if (!selected) return;

        try {
            setSaving(true);

            const { error } = await supabase
                .from("suppliers")
                .update({
                    name: editName,
                    phone: editPhone,
                    email: editEmail,
                    address: editAddress,
                })
                .eq("id", selected.id);

            if (error) throw error;

            setSelected(null);
            await loadSuppliers();
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi güncellenemedi.");
        } finally {
            setSaving(false);
        }
    }
    async function deleteSupplier() {
        if (!selected) return;

        const ok = window.confirm("Bu tedarikçiyi silmek istiyor musunuz?");
        if (!ok) return;

        try {
            setDeleting(true);

            const { error } = await supabase
                .from("suppliers")
                .delete()
                .eq("id", selected.id);

            if (error) throw error;

            setSelected(null);
            await loadSuppliers();
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi silinemedi.");
        } finally {
            setDeleting(false);
        }
    }

    async function loadSuppliers() {
        try {
            setLoading(true);
            setErr("");

            const ctx = await getContext();

            const [supplierRes, productRes] = await Promise.all([
                supabase
                    .from("suppliers")
                    .select("id,name,phone,email,address,created_at")
                    .eq("company_id", ctx.company_id)
                    .order("created_at", { ascending: false }),
                supabase
                    .from("products")
                    .select("id,name,category,unit_price,cost_price")
                    .eq("company_id", ctx.company_id)
                    .eq("is_active", true)
                    .order("name", { ascending: true }),
            ]);

            if (supplierRes.error) throw supplierRes.error;

            setSuppliers((supplierRes.data ?? []) as Supplier[]);
            if (productRes.error && /cost_price/i.test(String(productRes.error.message || ""))) {
                const fallback = await supabase
                    .from("products")
                    .select("id,name,category,unit_price")
                    .eq("company_id", ctx.company_id)
                    .eq("is_active", true)
                    .order("name", { ascending: true });
                if (!fallback.error) setProducts((fallback.data ?? []) as Product[]);
            } else if (!productRes.error) {
                setProducts((productRes.data ?? []) as Product[]);
            }
        } catch (e: any) {
            setErr(e?.message ?? "Tedarikçiler yüklenemedi.");
            setSuppliers([]);
        } finally {
            setLoading(false);
        }

    }

    async function loadSupplierPrices(supplierId: string) {
        try {
            setPriceErr("");
            const ctx = await getContext();
            const { data, error } = await supabase
                .from("supplier_product_prices")
                .select("id,product_id,product_name,product_category,unit_cost,note")
                .eq("company_id", ctx.company_id)
                .eq("supplier_id", supplierId)
                .order("product_name", { ascending: true });
            if (error) throw error;
            setPrices((data ?? []).map((row: any) => ({ ...row, unit_cost: Number(row.unit_cost || 0) })));
        } catch (e: any) {
            setPrices([]);
            setPriceErr(
                /supplier_product_prices/i.test(String(e?.message || ""))
                    ? "Tedarikçi fiyat listesi tablosu yok. supabase_supplier_product_prices.sql dosyasını Supabase SQL Editor'da çalıştırın."
                    : e?.message ?? "Fiyat listesi yüklenemedi.",
            );
        }
    }

    function priceForProduct(product: Product) {
        const productName = product.name ?? "";
        return prices.find((price) =>
            (!isDefaultProduct(product) && price.product_id === product.id) ||
            normalizeName(price.product_name) === normalizeName(productName),
        );
    }

    function updatePriceForProduct(product: Product, value: number) {
        const productName = product.name || product.category || "İsimsiz ürün";
        const productId = isDefaultProduct(product) ? null : product.id;
        setPrices((prev) => {
            const existing = prev.find((price) =>
                (productId && price.product_id === productId) ||
                normalizeName(price.product_name) === normalizeName(productName),
            );
            if (existing) {
                return prev.map((price) =>
                    price === existing
                        ? { ...price, product_id: productId, product_name: productName, product_category: product.category, unit_cost: value }
                        : price,
                );
            }
            return [...prev, { product_id: productId, product_name: productName, product_category: product.category, unit_cost: value }];
        });
    }

    async function saveSupplierPrices() {
        if (!selected) return;
        try {
            setPriceSaving(true);
            setPriceErr("");
            const ctx = await getContext();
            const rows = prices
                .filter((price) => price.product_name.trim())
                .map((price) => ({
                    company_id: ctx.company_id,
                    supplier_id: selected.id,
                    product_id: price.product_id,
                    product_name: price.product_name.trim(),
                    product_category: price.product_category,
                    unit_cost: Number(price.unit_cost || 0),
                    note: price.note || null,
                    updated_at: new Date().toISOString(),
                }));
            if (rows.length === 0) return;
            const { error } = await supabase
                .from("supplier_product_prices")
                .upsert(rows, { onConflict: "company_id,supplier_id,product_name" });
            if (error) throw error;
            await loadSupplierPrices(selected.id);
            alert("Tedarikçi fiyat listesi kaydedildi.");
        } catch (e: any) {
            setPriceErr(
                /supplier_product_prices/i.test(String(e?.message || ""))
                    ? "Önce supabase_supplier_product_prices.sql dosyasını Supabase SQL Editor'da çalıştırın."
                    : e?.message ?? "Fiyat listesi kaydedilemedi.",
            );
        } finally {
            setPriceSaving(false);
        }
    }

    useEffect(() => {
        loadSuppliers();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                        Tedarikçiler
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Kumaş ve donanım tedarikçilerinizi yönetin.
                    </p>
                </div>

                <Link
                    to="/suppliers/new"
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium shadow-md shadow-primary-600/20 transition-all inline-flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    Tedarikçi Ekle
                </Link>
            </div>

            {loading ? (
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm text-slate-500">
                    Yükleniyor...
                </div>
            ) : err ? (
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-red-200 shadow-sm text-red-600">
                    {err}
                </div>
            ) : suppliers.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                        <Truck className="w-8 h-8 text-slate-400" />
                    </div>

                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        Henüz Tedarikçi Yok
                    </h3>

                    <p className="text-slate-500 dark:text-slate-400 max-w-sm mt-2">
                        Siparişleri ve bakiyeleri takip etmek için tedarikçilerinizi buraya ekleyin.
                    </p>

                    <Link
                        to="/suppliers/new"
                        className="mt-6 px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                        İlk Tedarikçinizi Ekleyin
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {suppliers.map((s) => (
                        <div
                            key={s.id}
                            onClick={() => openEdit(s)}
                            className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:shadow-md hover:border-primary-300 transition"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                        {s.name}
                                    </h3>
                                    {s.address ? (
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                            {s.address}
                                        </p>
                                    ) : null}
                                </div>

                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                    <Truck className="w-5 h-5 text-slate-500" />
                                </div>
                            </div>

                            <div className="mt-4 space-y-2 text-sm">
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                    <Phone className="w-4 h-4" />
                                    <span>{s.phone || "-"}</span>
                                </div>

                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                    <Mail className="w-4 h-4" />
                                    <span>{s.email || "-"}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {selected && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                Tedarikçi Düzenle
                            </h2>
                            <button
                                onClick={() => setSelected(null)}
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                                Kapat
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Firma Adı</label>
                            <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Telefon</label>
                            <input
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">E-posta</label>
                            <input
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Adres</label>
                            <textarea
                                value={editAddress}
                                onChange={(e) => setEditAddress(e.target.value)}
                                rows={4}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            />
                        </div>

                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h3 className="flex items-center gap-2 text-base font-black text-slate-900 dark:text-white">
                                        <Package className="h-5 w-5 text-primary-600" />
                                        Fiyat Listesi Gir
                                    </h3>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        Bu tedarikçiden her ürünü kaça aldığınızı yazın. Siparişte kar hesabına otomatik düşer.
                                    </p>
                                </div>
                                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold dark:bg-slate-800">
                                    Toplam liste: {formatTL(totalSupplierCost)}
                                </div>
                            </div>

                            {priceErr ? (
                                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                    {priceErr}
                                </div>
                            ) : null}

                            <div className="mt-4 max-h-72 overflow-y-auto space-y-2 pr-1">
                                {priceListProducts.length === 0 ? (
                                    <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                                        Önce Ürünler menüsünden ürün/fiyat listesi tanımlayın.
                                    </div>
                                ) : (
                                    priceListProducts.map((product) => {
                                        const price = priceForProduct(product);
                                        return (
                                            <div
                                                key={product.id}
                                                className="grid grid-cols-[1fr_130px] gap-2 rounded-xl border border-slate-100 p-3 dark:border-slate-800"
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                                                        {product.name || "İsimsiz ürün"}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {product.category || "-"} • Satış: {formatTL(Number(product.unit_price || 0))}
                                                    </div>
                                                </div>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={price?.unit_cost ?? ""}
                                                    onChange={(e) => updatePriceForProduct(product, Number(e.target.value))}
                                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm font-black dark:border-slate-700 dark:bg-slate-950"
                                                    placeholder="Alış ₺"
                                                />
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={saveSupplierPrices}
                                disabled={priceSaving || !selected}
                                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60"
                            >
                                <Save className="h-4 w-4" />
                                {priceSaving ? "Kaydediliyor..." : "Fiyat Listesini Kaydet"}
                            </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-2">
                            <button
                                onClick={deleteSupplier}
                                disabled={deleting}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-60"
                            >
                                {deleting ? "Siliniyor..." : "Sil"}
                            </button>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setSelected(null)}
                                    className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium"
                                >
                                    Vazgeç
                                </button>

                                <button
                                    onClick={updateSupplier}
                                    disabled={saving || !editName.trim()}
                                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-60"
                                >
                                    {saving ? "Kaydediliyor..." : "Güncelle"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

type Product = {
    id: string;
    name: string | null;
    category: string | null;
    unit_price: number | null;
    cost_price?: number | null;
};

type SupplierPrice = {
    id?: string;
    product_id: string | null;
    product_name: string;
    product_category: string | null;
    unit_cost: number;
    note?: string | null;
};
