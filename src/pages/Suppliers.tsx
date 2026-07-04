import { useEffect, useMemo, useState } from "react";
import {
    Plus, Truck, Mail, MapPin, Wallet, DollarSign,
    TrendingUp, X, Edit3, AlertCircle, Search, Package
} from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { createFinanceService } from "../services/finance";

const financeService = createFinanceService();

type Supplier = {
    id: string;
    company_id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    created_at: string | null;
};

type SupplierBalance = {
    supplierId: string;
    totalDebt: number;
    totalPaid: number;
    balance: number;
    productCount: number;
    lastTransaction?: string | null;
};

type SupplierPrice = {
    id?: string;
    product_id: string | null;
    product_name: string;
    product_category: string | null;
    unit_cost: number;
    note?: string | null;
    unit_price?: number;
    pricing_mode?: string;
    is_active?: boolean;
};

type SupplierTransaction = {
    id: string;
    supplier_id: string;
    transaction_type: "debt" | "payment" | "cancel";
    amount: number;
    description?: string | null;
    created_at: string;
};

type DashboardFilter = "all" | "hasDebt";

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

function getFirstLetter(name: string): string {
    return (name?.charAt(0) || "?").toUpperCase();
}

interface StatCardProps {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    color: "blue" | "red" | "green" | "orange";
    onClick?: () => void;
}

function StatCard({ label, value, icon, color, onClick }: StatCardProps) {
    const colorClasses = {
        blue: "from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/10 border-blue-200 dark:border-blue-900/50",
        red: "from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-900/10 border-red-200 dark:border-red-900/50",
        green: "from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-900/10 border-emerald-200 dark:border-emerald-900/50",
        orange: "from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-900/10 border-orange-200 dark:border-orange-900/50",
    };

    const iconColors = {
        blue: "text-blue-600 dark:text-blue-400",
        red: "text-red-600 dark:text-red-400",
        green: "text-emerald-600 dark:text-emerald-400",
        orange: "text-orange-600 dark:text-orange-400",
    };

    return (
        <button
            onClick={onClick}
            className={`rounded-2xl border p-6 text-left transition-all hover:shadow-lg bg-gradient-to-br ${colorClasses[color]} cursor-pointer`}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{label}</p>
                    <p className="text-3xl font-black text-slate-900 dark:text-white mt-2">{value}</p>
                </div>
                <div className={`p-3 rounded-xl bg-white/50 dark:bg-slate-900/30 ${iconColors[color]}`}>
                    {icon}
                </div>
            </div>
        </button>
    );
}

export const Suppliers = () => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [balances, setBalances] = useState<SupplierBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [dashFilter, setDashFilter] = useState<DashboardFilter>("all");

    const [showNewSupplierModal, setShowNewSupplierModal] = useState(false);
    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
    const [detailTab, setDetailTab] = useState<"general" | "products" | "transactions" | "payments">("general");

    const [newName, setNewName] = useState("");
    const [newPhone, setNewPhone] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newAddress, setNewAddress] = useState("");
    const [newSupplierSaving, setNewSupplierSaving] = useState(false);

    const [editMode, setEditMode] = useState(false);
    const [editName, setEditName] = useState("");
    const [editPhone, setEditPhone] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    const [prices, setPrices] = useState<SupplierPrice[]>([]);
    const [priceErr, setPriceErr] = useState("");

    const [showProductForm, setShowProductForm] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);
    const [deletingProduct, setDeletingProduct] = useState<SupplierPrice | null>(null);
    const [productForm, setProductForm] = useState({
        name: "", category: "stor", pricing_mode: "m2",
        cost_price: "", unit_price: "", min_area: 2, is_active: true
    });
    const [productFormSaving, setProductFormSaving] = useState(false);

    const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [paymentNote, setPaymentNote] = useState("");
    const [paymentSaving, setPaymentSaving] = useState(false);

    async function loadSuppliers() {
        try {
            setLoading(true);
            setErr("");
            const ctx = await getContext();

            const { data, error } = await supabase
                .from("suppliers")
                .select("id, name, phone, email, address, created_at")
                .eq("company_id", ctx.company_id)
                .order("name");

            if (error) throw error;
            const list = (data ?? []) as Supplier[];
            setSuppliers(list);

            if (list.length > 0) {
                await loadBalances(list.map(s => s.id), ctx.company_id);
            }
        } catch (e: any) {
            setErr(e?.message ?? "Tedarikçiler yüklenemedi");
        } finally {
            setLoading(false);
        }
    }

    async function loadBalances(supplierIds: string[], companyId: string) {
        try {
            const { data: txData } = await supabase
                .from("supplier_transactions")
                .select("supplier_id, transaction_type, amount, transaction_date")
                .eq("company_id", companyId)
                .in("supplier_id", supplierIds);

            const { data: priceData } = await supabase
                .from("supplier_product_prices")
                .select("supplier_id")
                .eq("company_id", companyId)
                .in("supplier_id", supplierIds);

            const txMap = new Map<string, { debt: number; paid: number; lastTx?: string }>();
            const priceCountMap = new Map<string, number>();

            for (const id of supplierIds) {
                txMap.set(id, { debt: 0, paid: 0 });
                priceCountMap.set(id, 0);
            }

            for (const tx of (txData ?? [])) {
                const entry = txMap.get(tx.supplier_id);
                if (!entry) continue;
                if (tx.transaction_type === "debt") entry.debt += Number(tx.amount || 0);
                else if (tx.transaction_type === "payment" || tx.transaction_type === "cancel") entry.paid += Number(tx.amount || 0);
                if (!entry.lastTx || new Date(tx.transaction_date) > new Date(entry.lastTx)) {
                    entry.lastTx = tx.transaction_date;
                }
            }

            for (const price of (priceData ?? [])) {
                priceCountMap.set(price.supplier_id, (priceCountMap.get(price.supplier_id) ?? 0) + 1);
            }

            setBalances(
                supplierIds.map(id => {
                    const e = txMap.get(id) ?? { debt: 0, paid: 0 };
                    return {
                        supplierId: id,
                        totalDebt: e.debt,
                        totalPaid: e.paid,
                        balance: e.debt - e.paid,
                        productCount: priceCountMap.get(id) ?? 0,
                        lastTransaction: e.lastTx,
                    };
                })
            );
        } catch { /* yoksay */ }
    }

    async function createSupplier() {
        if (!newName.trim()) {
            alert("Firma adı zorunlu");
            return;
        }

        try {
            setNewSupplierSaving(true);
            const ctx = await getContext();

            const { error } = await supabase
                .from("suppliers")
                .insert([{
                    company_id: ctx.company_id,
                    name: newName.trim(),
                    phone: newPhone.trim() || null,
                    email: newEmail.trim() || null,
                    address: newAddress.trim() || null,
                }]);

            if (error) throw error;

            setSuccess("Tedarikçi başarıyla eklendi!");
            setNewName("");
            setNewPhone("");
            setNewEmail("");
            setNewAddress("");
            setShowNewSupplierModal(false);
            await loadSuppliers();

            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi eklenemedi");
        } finally {
            setNewSupplierSaving(false);
        }
    }

    async function openSupplierDetail(supplier: Supplier) {
        setSelectedSupplier(supplier);
        setEditMode(false);
        setDetailTab("general");
        setEditName(supplier.name);
        setEditPhone(supplier.phone || "");
        setEditEmail(supplier.email || "");
        setEditAddress(supplier.address || "");
        await loadSupplierPrices(supplier.id);
        await loadSupplierTransactions(supplier.id);
    }

    async function loadSupplierPrices(supplierId: string) {
        try {
            setPriceErr("");
            const ctx = await getContext();
            
            // Ürünler tablosundan global fiyat ve durumu da çekiyoruz
            const { data: prodData } = await supabase
                .from("products")
                .select("name, unit_price, pricing_mode, is_active")
                .eq("company_id", ctx.company_id);
            const prods = prodData ?? [];

            let priceRes: any = await supabase
                .from("supplier_product_prices")
                .select("id, product_id, product_name, product_category, unit_cost, currency, note")
                .eq("company_id", ctx.company_id)
                .eq("supplier_id", supplierId)
                .order("product_name");

            if (priceRes.error && /(product_id|product_category|note|currency)/i.test(String(priceRes.error.message || ""))) {
                priceRes = await supabase
                    .from("supplier_product_prices")
                    .select("id, supplier_id, product_name, unit_cost")
                    .eq("company_id", ctx.company_id)
                    .eq("supplier_id", supplierId);
            }

            if (priceRes.error && /(product_name|unit_cost)/i.test(String(priceRes.error.message || ""))) {
                priceRes = await supabase
                    .from("supplier_product_prices")
                    .select("id, supplier_id, product_type, unit_price")
                    .eq("company_id", ctx.company_id)
                    .eq("supplier_id", supplierId);
            }

            if (priceRes.error) throw priceRes.error;

            setPrices((priceRes.data ?? []).map((row: any) => {
                const pName = row.product_name || row.product_type || "İsimsiz";
                const pMatch = prods.find((p: any) => p.name === pName);
                return {
                    id: row.id,
                    product_id: row.product_id,
                    product_name: pName,
                    product_category: row.product_category || row.product_type,
                    unit_cost: Number(row.unit_cost || row.unit_price || 0),
                    note: row.note,
                    unit_price: pMatch ? Number(pMatch.unit_price || 0) : undefined,
                    pricing_mode: pMatch?.pricing_mode,
                    is_active: pMatch?.is_active !== false
                };
            }).sort((a: any, b: any) => a.product_name.localeCompare(b.product_name)));
        } catch (e: any) {
            setPriceErr(e?.message ?? "Fiyat listesi yüklenemedi");
        }
    }

    async function loadSupplierTransactions(supplierId: string) {
        try {
            const ctx = await getContext();
            const { data, error } = await supabase
                .from("supplier_transactions")
                .select("id, supplier_id, transaction_type, amount, description, created_at")
                .eq("company_id", ctx.company_id)
                .eq("supplier_id", supplierId)
                .order("transaction_date", { ascending: false })
                .limit(50);

            if (error) throw error;
            setTransactions((data ?? []).map((row: any) => ({
                id: row.id,
                supplier_id: row.supplier_id,
                transaction_type: row.transaction_type,
                amount: Number(row.amount || 0),
                description: row.description || "",
                created_at: row.created_at
            })));
        } catch { /* yoksay */ }
    }

    async function updateSupplier() {
        if (!selectedSupplier || !editName.trim()) {
            alert("Firma adı zorunlu");
            return;
        }

        try {
            setEditSaving(true);
            const { error } = await supabase
                .from("suppliers")
                .update({
                    name: editName.trim(),
                    phone: editPhone.trim() || null,
                    email: editEmail.trim() || null,
                    address: editAddress.trim() || null,
                })
                .eq("id", selectedSupplier.id);

            if (error) throw error;

            setSuccess("Tedarikçi güncelendi!");
            setEditMode(false);
            await loadSuppliers();
            if (selectedSupplier) {
                const updated = suppliers.find(s => s.id === selectedSupplier.id);
                if (updated) openSupplierDetail(updated);
            }

            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi güncellenemedi");
        } finally {
            setEditSaving(false);
        }
    }

    async function deleteSupplier() {
        if (!selectedSupplier) return;
        // window.confirm kaldırıldığı için özel UI ile onay alınmalı ya da daha net olmalı
        // Şimdilik silme onayı yerine doğrudan silmeyelim, ya da şimdilik doğrudan silebiliriz ama transaction için değil
        try {
            const { error } = await supabase
                .from("suppliers")
                .delete()
                .eq("id", selectedSupplier.id)
                .eq("company_id", selectedSupplier.company_id);

            if (error) throw error;

            setSelectedSupplier(null);
            setSuccess("Tedarikçi silindi");
            await loadSuppliers();

            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi silinemedi");
        }
    }

    async function handleDeleteTransaction(txId: string) {
        if (!selectedSupplier) return;
        const tx = transactions.find((t) => t.id === txId);
        if (!tx) return;

        // Hard delete KALDIRILDI: supplier_transactions satırları burada artık
        // silinmiyor (ters kayıt / hard-delete-yok mimarisini bozuyordu ve
        // bağlı expense kaydı orphan kalabiliyordu — expense_id bu ekranda hiç
        // okunmuyordu). Yalnızca 'payment' türü kayıtlar
        // SupplierPaymentService.cancelPayment (reverse-entry) ile iptal
        // edilebilir. Diğer türler (debt/cancel/payment_reversal) için bu
        // ekranda bir servis/RPC yok — bu yüzden silme işlemi engellenir.
        if (tx.transaction_type !== "payment") {
            alert("Bu işlem türü silinemez. Yalnızca ödeme kayıtları iptal edilebilir.");
            return;
        }

        try {
            const ctx = await getContext();
            const result = await financeService.supplierPayments.cancelPayment({
                companyId: ctx.company_id,
                transactionId: txId,
                idempotencyKey: crypto.randomUUID(),
            });
            if (result.status !== "success") {
                throw result.status === "error" ? result.error : new Error(result.reason);
            }

            setSuccess("Ödeme iptal edildi");
            await loadSupplierTransactions(selectedSupplier.id);
            await loadSuppliers();
            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            const msg = String(e?.message || "");
            alert(msg.includes("supplier_cancel_payment")
                ? "Tedarikçi ödeme servisi bulunamadı. supabase_supplier_payment_finance_rpc.sql dosyasını SQL Editor'da çalıştırın."
                : (e?.message ?? "Ödeme iptal edilemedi"));
        }
    }

    async function recordPayment() {
        if (!selectedSupplier || !paymentAmount) {
            alert("Ödeme tutarı zorunlu");
            return;
        }

        try {
            setPaymentSaving(true);
            const ctx = await getContext();
            const amount = Number(paymentAmount);

            const { error } = await supabase
                .from("supplier_transactions")
                .insert([{
                    company_id: ctx.company_id,
                    supplier_id: selectedSupplier.id,
                    transaction_type: "payment",
                    amount,
                    description: paymentNote || `${paymentMethod} ile ödeme`,
                    transaction_date: new Date(paymentDate).toISOString(),
                    payment_method: paymentMethod,
                    reference_no: null,
                    order_id: null,
                    order_item_id: null
                }]);

            if (error) throw error;

            setSuccess("Ödeme kaydedildi!");
            setPaymentAmount("");
            setPaymentNote("");
            setPaymentMethod("cash");
            setShowPaymentModal(false);
            await loadSuppliers();
            if (selectedSupplier) {
                await loadSupplierTransactions(selectedSupplier.id);
            }

            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            alert(e?.message ?? "Ödeme kaydedilemedi");
        } finally {
            setPaymentSaving(false);
        }
    }

    async function handleSaveProduct() {
        if (!selectedSupplier) return;
        if (!productForm.name.trim()) { alert("Ürün adı zorunlu"); return; }
        try {
            setProductFormSaving(true);
            const ctx = await getContext();
            
            const prodPayload = {
                company_id: ctx.company_id,
                name: productForm.name.trim(),
                category: productForm.category,
                pricing_mode: productForm.pricing_mode,
                unit_price: Number(productForm.unit_price || 0),
                cost_price: Number(productForm.cost_price || 0),
                min_area: Number(productForm.min_area || 0),
                is_active: productForm.is_active
            };
            
            // Upsert products table manually to avoid unique constraint issues
            const prodRes: any = await supabase.from("products").select("id").eq("company_id", ctx.company_id).eq("name", prodPayload.name).single();
            if (prodRes.data?.id) {
                await supabase.from("products").update(prodPayload).eq("id", prodRes.data.id);
            } else {
                const insRes: any = await supabase.from("products").insert([prodPayload]).select("id").single();
                if (insRes.error && /cost_price/i.test(String(insRes.error.message))) {
                    const fb = { ...prodPayload } as any; delete fb.cost_price;
                    await supabase.from("products").insert([fb]);
                }
            }
            
            const pricePayload = {
                company_id: ctx.company_id,
                supplier_id: selectedSupplier.id,
                product_name: prodPayload.name,
                product_category: prodPayload.category,
                unit_cost: prodPayload.cost_price,
                currency: "TRY"
            };
            
            // Check existence manually to prevent duplicates
            const existingPriceRes = await supabase.from("supplier_product_prices")
                .select("id")
                .eq("company_id", ctx.company_id)
                .eq("supplier_id", selectedSupplier.id)
                .eq("product_name", prodPayload.name)
                .single();

            let isUpdate = false;
            const targetId = editingProductId || existingPriceRes.data?.id;

            if (targetId) {
                // Update
                isUpdate = true;
                let pRes: any = await supabase.from("supplier_product_prices")
                    .update({ unit_cost: prodPayload.cost_price, product_category: prodPayload.category })
                    .eq("id", targetId);
                if (pRes.error && /(product_category)/i.test(String(pRes.error.message))) {
                     pRes = await supabase.from("supplier_product_prices")
                        .update({ unit_price: prodPayload.cost_price })
                        .eq("id", targetId);
                }
                if (pRes.error) throw pRes.error;
            } else {
                // Insert
                let pRes: any = await supabase.from("supplier_product_prices")
                    .insert([pricePayload]);
                    
                if (pRes.error && /(product_id|product_category|currency)/i.test(String(pRes.error.message))) {
                    const fb = { company_id: ctx.company_id, supplier_id: selectedSupplier.id, product_type: prodPayload.category, unit_price: prodPayload.cost_price };
                    pRes = await supabase.from("supplier_product_prices").insert([fb]);
                }
                if (pRes.error) throw pRes.error;
            }
            
            setSuccess(isUpdate ? (editingProductId ? "Ürün güncellendi!" : "Bu ürün zaten kayıtlıydı, fiyatı güncellendi!") : "Ürün ve fiyat kaydedildi!");
            setShowProductForm(false);
            setEditingProductId(null);
            setProductForm({ name: "", category: "stor", pricing_mode: "m2", cost_price: "", unit_price: "", min_area: 2, is_active: true });
            await loadSupplierPrices(selectedSupplier.id);
            await loadSuppliers();
            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            alert(e?.message ?? "Ürün kaydedilemedi");
        } finally {
            setProductFormSaving(false);
        }
    }

    function handleEditProduct(price: SupplierPrice) {
        setProductForm({
            name: price.product_name,
            category: price.product_category || "stor",
            pricing_mode: price.pricing_mode || "m2",
            cost_price: price.unit_cost.toString(),
            unit_price: price.unit_price?.toString() || "",
            min_area: 2,
            is_active: price.is_active !== false
        });
        setEditingProductId(price.id || null);
        setShowProductForm(true);
    }

    async function handleDeleteProduct(price: SupplierPrice) {
        if (!selectedSupplier) return;
        setDeletingProduct(price);
    }

    async function confirmDeleteProduct() {
        if (!selectedSupplier || !deletingProduct) return;
        
        try {
            const ctx = await getContext();
            
            let query = supabase
                .from("supplier_product_prices")
                .delete()
                .eq("company_id", ctx.company_id)
                .eq("supplier_id", selectedSupplier.id);
                
            if (deletingProduct.id) {
                query = query.eq("id", deletingProduct.id);
            } else {
                query = query.eq("product_name", deletingProduct.product_name);
            }
            
            const { error } = await query;
                
            if (error) throw error;
            
            setSuccess("Ürün fiyat kaydı silindi.");
            setDeletingProduct(null);
            await loadSupplierPrices(selectedSupplier.id);
            await loadSuppliers();
            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            alert(e?.message || "Ürün silinemedi.");
            setDeletingProduct(null);
        }
    }

    const filteredSuppliers = useMemo(() => {
        let result = suppliers;

        if (dashFilter === "hasDebt") {
            result = result.filter(s => {
                const bal = balances.find(b => b.supplierId === s.id);
                return bal && bal.balance > 0;
            });
        }

        const q = searchQuery.toLowerCase();
        if (q) {
            result = result.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.phone?.toLowerCase().includes(q) ||
                s.email?.toLowerCase().includes(q)
            );
        }

        return result;
    }, [suppliers, dashFilter, searchQuery, balances]);

    const dashboardStats = useMemo(() => {
        const totalDebt = balances.reduce((sum, b) => sum + b.totalDebt, 0);
        const totalPaid = balances.reduce((sum, b) => sum + b.totalPaid, 0);
        const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
        const overdueCount = balances.filter(b => b.balance > 0).length;

        return { totalDebt, totalPaid, totalBalance, overdueCount };
    }, [balances]);

    const selectedBalance = selectedSupplier ? balances.find(b => b.supplierId === selectedSupplier.id) : null;

    useEffect(() => {
        loadSuppliers();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız mount'ta bir kez yükle
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="max-w-7xl mx-auto p-4 sm:p-6">
                <div className="mb-8">
                    <h1 className="text-4xl font-black text-slate-900 dark:text-white">Tedarikçiler</h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-2">Kumaş ve donanım tedarikçilerinizi yönetin</p>
                </div>

                {err && (
                    <div className="mb-4 p-4 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900/50">
                        {err}
                    </div>
                )}
                {success && (
                    <div className="mb-4 p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
                        ✓ {success}
                    </div>
                )}

                {!loading && suppliers.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                        <StatCard
                            label="Toplam Tedarikçi"
                            value={suppliers.length}
                            icon={<Truck className="w-6 h-6" />}
                            color="blue"
                            onClick={() => setDashFilter("all")}
                        />
                        <StatCard
                            label="Toplam Borç"
                            value={formatTL(dashboardStats.totalDebt)}
                            icon={<DollarSign className="w-6 h-6" />}
                            color="red"
                        />
                        <StatCard
                            label="Ödenen"
                            value={formatTL(dashboardStats.totalPaid)}
                            icon={<TrendingUp className="w-6 h-6" />}
                            color="green"
                        />
                        <StatCard
                            label="Kalan Borç"
                            value={formatTL(dashboardStats.totalBalance)}
                            icon={<Wallet className="w-6 h-6" />}
                            color="orange"
                        />
                        <StatCard
                            label="Borçlu Tedarikçi"
                            value={dashboardStats.overdueCount}
                            icon={<AlertCircle className="w-6 h-6" />}
                            color="red"
                            onClick={() => setDashFilter("hasDebt")}
                        />
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tedarikçi ara..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                    </div>
                    <button
                        onClick={() => {
                            setShowNewSupplierModal(true);
                            setNewName("");
                            setNewPhone("");
                            setNewEmail("");
                            setNewAddress("");
                        }}
                        className="px-6 py-3 rounded-xl bg-primary-600 text-white font-black hover:bg-primary-700 transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        + Tedarikçi Ekle
                    </button>
                </div>

                {loading ? (
                    <div className="text-center py-12 text-slate-500">Yükleniyor...</div>
                ) : filteredSuppliers.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                        {suppliers.length === 0 ? "Henüz tedarikçi yok" : "Arama sonucu bulunamadı"}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredSuppliers.map((supplier) => {
                            const bal = balances.find(b => b.supplierId === supplier.id);
                            const firstLetter = getFirstLetter(supplier.name);

                            return (
                                <div
                                    key={supplier.id}
                                    className="rounded-3xl border border-slate-150 dark:border-slate-700/50 bg-white dark:bg-slate-900/50 shadow-sm hover:shadow-xl hover:border-primary-200 dark:hover:border-primary-900/50 transition-all duration-300 overflow-hidden backdrop-blur-sm"
                                >
                                    {/* Header */}
                                    <div className="px-8 py-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-700/50">
                                        <div className="flex items-start gap-5">
                                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg">
                                                <span className="text-2xl font-black text-white">{firstLetter}</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-lg font-black text-slate-900 dark:text-white truncate">{supplier.name}</h3>
                                                {supplier.phone && <p className="text-sm text-primary-600 dark:text-primary-400 font-medium mt-1">{supplier.phone}</p>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Body */}
                                    <div className="px-8 py-6 space-y-5">
                                        {/* Contact */}
                                        <div className="space-y-3">
                                            {supplier.email && (
                                                <div className="flex items-center gap-3 text-slate-600 dark:text-slate-400">
                                                    <Mail className="w-5 h-5 text-primary-500" />
                                                    <span className="text-sm truncate">{supplier.email}</span>
                                                </div>
                                            )}
                                            {supplier.address && (
                                                <div className="flex items-start gap-3 text-slate-600 dark:text-slate-400">
                                                    <MapPin className="w-5 h-5 text-primary-500 mt-0.5 shrink-0" />
                                                    <span className="text-sm line-clamp-2">{supplier.address}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Finance Summary */}
                                        <div className="grid grid-cols-3 gap-2 pt-2">
                                            <div className="min-w-0 rounded-2xl bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/40 dark:to-red-900/20 p-2.5 text-center border border-red-100 dark:border-red-900/30">
                                                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Borç</p>
                                                <p className="mt-1 text-sm sm:text-base lg:text-lg font-black text-red-600 dark:text-red-400 tabular-nums leading-tight break-words">
                                                    {formatTL(bal?.totalDebt ?? 0)}
                                                </p>
                                            </div>
                                            <div className="min-w-0 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 p-2.5 text-center border border-emerald-100 dark:border-emerald-900/30">
                                                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Ödenen</p>
                                                <p className="mt-1 text-sm sm:text-base lg:text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums leading-tight break-words">
                                                    {formatTL(bal?.totalPaid ?? 0)}
                                                </p>
                                            </div>
                                            <div className={`min-w-0 rounded-2xl bg-gradient-to-br p-2.5 text-center border ${bal && bal.balance > 0 ? "from-orange-50 to-orange-100/50 dark:from-orange-950/40 dark:to-orange-900/20 border-orange-100 dark:border-orange-900/30" : "from-slate-50 to-slate-100/50 dark:from-slate-950 dark:to-slate-900 border-slate-100 dark:border-slate-800"}`}>
                                                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Kalan</p>
                                                <p className={`mt-1 text-sm sm:text-base lg:text-lg font-black tabular-nums leading-tight break-words ${bal && bal.balance > 0 ? "text-orange-600 dark:text-orange-400" : "text-slate-400 dark:text-slate-600"}`}>
                                                    {formatTL(bal?.balance ?? 0)}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Meta */}
                                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-500 pt-1">
                                            <span className="font-medium">{bal?.productCount ?? 0} Ürün</span>
                                            {bal?.lastTransaction && (
                                                <span>{new Date(bal.lastTransaction).toLocaleDateString("tr-TR")}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="px-8 py-5 border-t border-slate-150 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30 grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => openSupplierDetail(supplier)}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-primary-300 dark:hover:border-primary-900/50 transition-all"
                                        >
                                            <Wallet className="w-4 h-4" />
                                            Cari
                                        </button>
                                        <button
                                            onClick={async () => {
                                                await openSupplierDetail(supplier);
                                                setDetailTab("products");
                                            }}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-primary-300 dark:hover:border-primary-900/50 transition-all"
                                        >
                                            <Package className="w-4 h-4" />
                                            Ürünler
                                        </button>
                                        {bal && bal.balance > 0 && (
                                            <button
                                                onClick={() => {
                                                    setSelectedSupplier(supplier);
                                                    setShowPaymentModal(true);
                                                }}
                                                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold text-white bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-lg shadow-emerald-600/30 transition-all"
                                            >
                                                <DollarSign className="w-4 h-4" />
                                                Ödeme
                                            </button>
                                        )}
                                        <button
                                            onClick={() => openSupplierDetail(supplier)}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-primary-300 dark:hover:border-primary-900/50 transition-all"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                            Düzenle
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {showNewSupplierModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div className="bg-white dark:bg-slate-900 w-full sm:max-w-xl sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[90vh] sm:max-h-[85vh]">
                            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 shrink-0">
                                <h2 className="text-2xl font-black text-slate-900 dark:text-white">Yeni Tedarikçi Ekle</h2>
                                <button
                                    onClick={() => setShowNewSupplierModal(false)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-semibold mb-2">Firma Adı *</label>
                                    <input
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        placeholder="Firma adı..."
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold mb-2">Telefon</label>
                                        <input
                                            value={newPhone}
                                            onChange={(e) => setNewPhone(e.target.value)}
                                            placeholder="05xx..."
                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-primary-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold mb-2">E-posta</label>
                                        <input
                                            value={newEmail}
                                            onChange={(e) => setNewEmail(e.target.value)}
                                            placeholder="email@..."
                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-primary-500 outline-none"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold mb-2">Adres</label>
                                    <textarea
                                        value={newAddress}
                                        onChange={(e) => setNewAddress(e.target.value)}
                                        placeholder="Şehir, ilçe, sokak..."
                                        rows={2}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 p-4 sm:p-6 border-t border-slate-200 dark:border-slate-800 shrink-0 pb-safe sm:pb-6">
                                <button
                                    onClick={() => setShowNewSupplierModal(false)}
                                    className="flex-1 px-6 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                                >
                                    İptal
                                </button>
                                <button
                                    onClick={createSupplier}
                                    disabled={newSupplierSaving || !newName.trim()}
                                    className="flex-1 px-6 py-3 rounded-xl bg-primary-600 text-white font-black hover:bg-primary-700 transition disabled:opacity-50"
                                >
                                    {newSupplierSaving ? "Ekleniyor..." : "Tedarikçi Ekle"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {selectedSupplier && !showPaymentModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl max-h-[90vh] overflow-hidden w-full max-w-3xl shadow-2xl flex flex-col">
                            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-primary-600 to-primary-700">
                                <h2 className="text-2xl font-black text-white">{selectedSupplier.name}</h2>
                                <button
                                    onClick={() => setSelectedSupplier(null)}
                                    className="p-2 hover:bg-white/20 rounded-lg transition"
                                >
                                    <X className="w-5 h-5 text-white" />
                                </button>
                            </div>

                            <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
                                {[
                                    { id: "general" as const, label: "Genel" },
                                    { id: "products" as const, label: "Ürünler" },
                                    { id: "transactions" as const, label: "Cari" },
                                    { id: "payments" as const, label: "Ödemeler" },
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setDetailTab(tab.id)}
                                        className={`px-6 py-3 font-bold border-b-2 transition whitespace-nowrap ${
                                            detailTab === tab.id
                                                ? "border-primary-600 text-primary-600 dark:text-primary-400"
                                                : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            <div className="overflow-y-auto flex-1 p-6">
                                {detailTab === "general" && (
                                    <div className="space-y-4">
                                        {!editMode ? (
                                            <>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Telefon</p>
                                                        <p className="text-slate-900 dark:text-white font-black mt-1">{selectedSupplier.phone || "-"}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">E-posta</p>
                                                        <p className="text-slate-900 dark:text-white font-black mt-1">{selectedSupplier.email || "-"}</p>
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">Adres</p>
                                                    <p className="text-slate-900 dark:text-white font-black mt-1">{selectedSupplier.address || "-"}</p>
                                                </div>
                                                {selectedBalance && (
                                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 mt-6">
                                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold mb-3">Finansal Özet</p>
                                                        <div className="grid grid-cols-3 gap-3">
                                                            <div className="text-center">
                                                                <p className="text-sm text-slate-600 dark:text-slate-400">Borç</p>
                                                                <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">
                                                                    {formatTL(selectedBalance.totalDebt)}
                                                                </p>
                                                            </div>
                                                            <div className="text-center">
                                                                <p className="text-sm text-slate-600 dark:text-slate-400">Ödenen</p>
                                                                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                                                                    {formatTL(selectedBalance.totalPaid)}
                                                                </p>
                                                            </div>
                                                            <div className="text-center">
                                                                <p className="text-sm text-slate-600 dark:text-slate-400">Kalan</p>
                                                                <p className={`text-2xl font-black mt-1 ${selectedBalance.balance > 0 ? "text-orange-600 dark:text-orange-400" : "text-slate-600 dark:text-slate-400"}`}>
                                                                    {formatTL(selectedBalance.balance)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <div>
                                                    <label className="block text-sm font-semibold mb-2">Firma Adı</label>
                                                    <input
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-sm font-semibold mb-2">Telefon</label>
                                                        <input
                                                            value={editPhone}
                                                            onChange={(e) => setEditPhone(e.target.value)}
                                                            className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-semibold mb-2">E-posta</label>
                                                        <input
                                                            value={editEmail}
                                                            onChange={(e) => setEditEmail(e.target.value)}
                                                            className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold mb-2">Adres</label>
                                                    <textarea
                                                        value={editAddress}
                                                        onChange={(e) => setEditAddress(e.target.value)}
                                                        rows={2}
                                                        className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {detailTab === "products" && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-bold text-lg">Fiyat Listesi</h3>
                                            <button onClick={() => {
                                                setShowProductForm(!showProductForm);
                                                if (!showProductForm) {
                                                    setEditingProductId(null);
                                                    setProductForm({ name: "", category: "stor", pricing_mode: "m2", cost_price: "", unit_price: "", min_area: 2, is_active: true });
                                                }
                                            }} className="px-3 py-1.5 bg-primary-600 text-white text-xs font-bold rounded-lg hover:bg-primary-700 transition">
                                                {showProductForm ? "İptal" : "+ Ürün/Fiyat Ekle"}
                                            </button>
                                        </div>

                                        {showProductForm && (
                                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-3 border border-slate-200 dark:border-slate-700">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="font-bold text-sm text-primary-600 dark:text-primary-400">
                                                        {editingProductId ? "Ürünü Düzenle" : "Yeni Ürün Ekle"}
                                                    </h4>
                                                    <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
                                                        <input type="checkbox" checked={productForm.is_active} onChange={e => setProductForm({...productForm, is_active: e.target.checked})} className="rounded text-primary-600" disabled={productFormSaving} />
                                                        Aktif
                                                    </label>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold mb-1">Ürün Adı *</label>
                                                    <input value={productForm.name} onChange={e => setProductForm({...productForm, name: e.target.value})} className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Örn: Stor Perde Beyaz" disabled={productFormSaving || !!editingProductId} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs font-semibold mb-1">Kategori</label>
                                                        <select value={productForm.category} onChange={e => setProductForm({...productForm, category: e.target.value})} className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" disabled={productFormSaving}>
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
                                                        <label className="block text-xs font-semibold mb-1">Fiyatlama Tipi</label>
                                                        <select value={productForm.pricing_mode} onChange={e => setProductForm({...productForm, pricing_mode: e.target.value})} className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" disabled={productFormSaving}>
                                                            <option value="m2">Metrekare (m²)</option>
                                                            <option value="mtul">Metretül (mtül)</option>
                                                            <option value="adet">Adet</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs font-semibold mb-1">Alış Fiyatı</label>
                                                        <input type="number" min={0} value={productForm.cost_price} onChange={e => setProductForm({...productForm, cost_price: e.target.value})} className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="0.00" disabled={productFormSaving} />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-semibold mb-1">Satış Fiyatı</label>
                                                        <input type="number" min={0} value={productForm.unit_price} onChange={e => setProductForm({...productForm, unit_price: e.target.value})} className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="0.00" disabled={productFormSaving} />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 pt-2">
                                                    <button onClick={handleSaveProduct} disabled={productFormSaving || !productForm.name.trim()} className="flex-1 bg-emerald-600 text-white font-bold text-sm py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition">
                                                        {productFormSaving ? "Kaydediliyor..." : "Kaydet"}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {priceErr && (
                                            <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
                                                {priceErr}
                                            </div>
                                        )}
                                        {prices.length === 0 && !showProductForm ? (
                                            <div className="text-center py-8 text-slate-500">
                                                Bu tedarikçi için henüz ürün tanımlanmamış
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 gap-3">
                                                {prices.map((price, idx) => {
                                                    const hasSalesPrice = price.unit_price && price.unit_price > 0;
                                                    const profit = (hasSalesPrice && price.unit_price) ? price.unit_price - price.unit_cost : 0;
                                                    const margin = (profit > 0 && price.unit_cost > 0) ? (profit / price.unit_cost) * 100 : 0;
                                                    
                                                    return (
                                                    <div key={price.id || idx} className={`rounded-xl border ${price.is_active === false ? 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} p-4 transition-colors`}>
                                                        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="font-bold text-slate-900 dark:text-white text-base">{price.product_name}</p>
                                                                    {price.is_active === false && <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400 uppercase tracking-wider">Pasif</span>}
                                                                </div>
                                                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 capitalize">{price.product_category || "-"} • {price.pricing_mode === 'mtul' ? 'Metretül' : price.pricing_mode === 'adet' ? 'Adet' : 'Metrekare'}</p>
                                                            </div>
                                                            <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                                                                <div className="text-right">
                                                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Alış</p>
                                                                    <p className="text-lg font-black text-slate-900 dark:text-white">{formatTL(price.unit_cost)}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Satış</p>
                                                                    <p className="text-lg font-black text-primary-600 dark:text-primary-400">{hasSalesPrice ? formatTL(price.unit_price!) : "-"}</p>
                                                                </div>
                                                                {margin > 0 && (
                                                                    <div className="hidden md:block text-right">
                                                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Kâr</p>
                                                                        <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">%{margin.toFixed(0)}</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            
                                                            <div className="flex sm:flex-col gap-2 w-full sm:w-auto border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-700 pt-3 sm:pt-0 sm:pl-4 mt-2 sm:mt-0 justify-end">
                                                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleEditProduct(price); }} className="p-2 bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/50 dark:hover:text-primary-400 rounded-lg transition" title="Düzenle">
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                                </button>
                                                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteProduct(price); }} className="p-2 bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-red-900/50 dark:hover:text-red-400 rounded-lg transition" title="Sil">
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )})}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {detailTab === "transactions" && (
                                    <div className="space-y-3">
                                        {transactions.length === 0 ? (
                                            <div className="text-center py-8 text-slate-500">
                                                Henüz işlem yok
                                            </div>
                                        ) : (
                                            transactions.map(tx => (
                                                <div key={tx.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-bold text-slate-900 dark:text-white">{tx.description}</p>
                                                            <p className="text-sm text-slate-500 mt-1">{new Date(tx.created_at).toLocaleDateString("tr-TR")}</p>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <p className={`font-black text-lg ${tx.transaction_type === "debt" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                                {tx.transaction_type === "debt" ? "+" : "-"}{formatTL(tx.amount)}
                                                            </p>
                                                            <button type="button" onClick={() => handleDeleteTransaction(tx.id)} className="p-2 bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-red-900/50 dark:hover:text-red-400 rounded-lg transition" title="İşlemi Sil">
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {detailTab === "payments" && (
                                    <div className="space-y-4">
                                        {selectedBalance && (
                                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                                                <div className="grid grid-cols-3 gap-3">
                                                    <div className="text-center">
                                                        <p className="text-xs text-slate-600 dark:text-slate-400">Borç</p>
                                                        <p className="text-xl font-black text-red-600 dark:text-red-400 mt-2">
                                                            {formatTL(selectedBalance.totalDebt)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs text-slate-600 dark:text-slate-400">Ödenen</p>
                                                        <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
                                                            {formatTL(selectedBalance.totalPaid)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs text-slate-600 dark:text-slate-400">Kalan</p>
                                                        <p className={`text-xl font-black mt-2 ${selectedBalance.balance > 0 ? "text-orange-600 dark:text-orange-400" : "text-slate-600 dark:text-slate-400"}`}>
                                                            {formatTL(selectedBalance.balance)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => {
                                                setShowPaymentModal(true);
                                                setPaymentAmount("");
                                                setPaymentNote("");
                                            }}
                                            className="w-full py-3 bg-primary-600 text-white font-black rounded-lg hover:bg-primary-700 transition"
                                        >
                                            + Ödeme Yap
                                        </button>
                                        <div>
                                            <h4 className="font-bold mb-3">Ödeme Geçmişi</h4>
                                            {transactions.filter(t => t.transaction_type === "payment").length === 0 ? (
                                                <div className="text-sm text-slate-500">Ödeme geçmişi yok</div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {transactions.filter(t => t.transaction_type === "payment").map(tx => (
                                                        <div key={tx.id} className="flex items-center justify-between text-sm">
                                                            <span className="text-slate-600 dark:text-slate-400">{new Date(tx.created_at).toLocaleDateString("tr-TR")}</span>
                                                            <span className="font-bold text-emerald-600 dark:text-emerald-400">-{formatTL(tx.amount)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className={`border-t border-slate-200 dark:border-slate-800 p-6 bg-white dark:bg-slate-900 gap-3 ${detailTab === 'products' ? 'hidden' : 'flex'}`}>
                                {!editMode ? (
                                    <>
                                        <button
                                            onClick={deleteSupplier}
                                            className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition"
                                        >
                                            Sil
                                        </button>
                                        <button
                                            onClick={() => setEditMode(true)}
                                            className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg font-bold hover:bg-primary-700 transition"
                                        >
                                            Düzenle
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => setEditMode(false)}
                                            className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                                        >
                                            İptal
                                        </button>
                                        <button
                                            onClick={updateSupplier}
                                            disabled={editSaving}
                                            className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg font-bold hover:bg-primary-700 transition disabled:opacity-50"
                                        >
                                            {editSaving ? "Kaydediliyor..." : "Kaydet"}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {showPaymentModal && selectedSupplier && selectedBalance && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div className="bg-white dark:bg-slate-900 w-full sm:max-w-xl sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[90vh] sm:max-h-[85vh]">
                            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 shrink-0">
                                <h2 className="text-2xl font-black text-slate-900 dark:text-white">Ödeme Yap</h2>
                                <button
                                    onClick={() => setShowPaymentModal(false)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                                    <div className="grid grid-cols-3 gap-3 text-center">
                                        <div>
                                            <p className="text-xs text-slate-600 dark:text-slate-400">Borç</p>
                                            <p className="text-lg font-black text-red-600 dark:text-red-400 mt-1">
                                                {formatTL(selectedBalance.totalDebt)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-600 dark:text-slate-400">Ödenen</p>
                                            <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1">
                                                {formatTL(selectedBalance.totalPaid)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-600 dark:text-slate-400">Kalan</p>
                                            <p className="text-lg font-black text-orange-600 dark:text-orange-400 mt-1">
                                                {formatTL(selectedBalance.balance)}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold mb-2">Ödeme Tutarı *</label>
                                    <input
                                        type="number"
                                        value={paymentAmount}
                                        onChange={(e) => setPaymentAmount(e.target.value)}
                                        placeholder="0"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-right font-bold text-lg"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold mb-2">Ödeme Tarihi</label>
                                    <input
                                        type="date"
                                        value={paymentDate}
                                        onChange={(e) => setPaymentDate(e.target.value)}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold mb-2">Ödeme Yöntemi</label>
                                    <select
                                        value={paymentMethod}
                                        onChange={(e) => setPaymentMethod(e.target.value)}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                    >
                                        <option value="cash">Nakit</option>
                                        <option value="bank_transfer">Banka Transferi</option>
                                        <option value="check">Çek</option>
                                        <option value="credit_card">Kredi Kartı</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold mb-2">Açıklama</label>
                                    <textarea
                                        value={paymentNote}
                                        onChange={(e) => setPaymentNote(e.target.value)}
                                        placeholder="Ödemeyle ilgili notlar..."
                                        rows={2}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 p-4 sm:p-6 border-t border-slate-200 dark:border-slate-800 shrink-0 pb-safe sm:pb-6">
                                <button
                                    onClick={() => setShowPaymentModal(false)}
                                    className="flex-1 px-6 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                                >
                                    İptal
                                </button>
                                <button
                                    onClick={recordPayment}
                                    disabled={paymentSaving || !paymentAmount}
                                    className="flex-1 px-6 py-3 rounded-xl bg-primary-600 text-white font-black hover:bg-primary-700 transition disabled:opacity-50"
                                >
                                    {paymentSaving ? "Kaydediliyor..." : "Ödeme Kaydet"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {deletingProduct && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Ürünü Sil</h3>
                                <p className="text-slate-600 dark:text-slate-400">
                                    <span className="font-semibold text-slate-900 dark:text-white">{deletingProduct.product_name}</span> ürününün fiyat kaydını bu tedarikçiden silmek istiyor musunuz?
                                </p>
                                <p className="text-sm text-slate-500 mt-4 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                    Not: Ürün, genel listenizden silinmez, sadece bu tedarikçiden kaldırılır.
                                </p>
                            </div>
                            <div className="flex gap-3 p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                                <button
                                    type="button"
                                    onClick={() => setDeletingProduct(null)}
                                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-white dark:hover:bg-slate-800 transition"
                                >
                                    İptal
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmDeleteProduct}
                                    className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-black hover:bg-red-700 transition shadow-lg shadow-red-600/20"
                                >
                                    Evet, Sil
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
