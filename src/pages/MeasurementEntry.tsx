import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Calculator, Check, ChevronLeft, ChevronRight,
  Copy, AlertCircle, MapPin, MessageCircle, Phone, Plus, Save, Trash2
} from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useDraftState } from "../hooks/useDraftState";
import FieldInfoEditor from "../components/FieldInfoEditor";
import { emptyFieldInfo, parseFieldInfo, type FieldInfo } from "../utils/fieldInfo";
import Quotes from "./Quotes";

// ---- TYPES & CONSTANTS ----
export type ProductType = "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "diger";

export type ProductRow = { id: string; name: string | null; category: string | null; unit_price: number | null; cost_price?: number | null; is_active: boolean | null; };
export type SupplierRow = { id: string; name: string | null; };
export type SupplierProductPriceRow = { supplier_id: string; product_id: string | null; product_name: string | null; product_category?: string | null; product_type?: string | null; unit_cost: number | null; unit_price?: number | null; };
export type CustomerRow = { id: string; name: string | null; phone: string | null; address?: string | null; };

export type MeasurementItem = {
  id: string;
  roomName: string;
  widthCm: number;
  heightCm: number;
  productType: ProductType;
  selectedProductName: string;
  supplierId: string;
  supplierCost: number;
  modelName: string;
  colorName: string;
  qty: number;
  unitPrice: number;
  pile: "2" | "3";
  note: string;
  photos: string[];
  kumasGrubu?: string;
  mekanizma?: string;
  zincirYonu?: string;
  kasaTipi?: string;
  kasaRengi?: string;
  kornisTipi?: string;
  fieldInfo?: FieldInfo;
};

const PRODUCT_OPTIONS: Array<{ value: ProductType; label: string; defaultPrice: number }> = [
  { value: "stor", label: "Stor", defaultPrice: 650 },
  { value: "zebra", label: "Zebra", defaultPrice: 850 },
  { value: "tul", label: "Tül", defaultPrice: 420 },
  { value: "fon", label: "Fon", defaultPrice: 520 },
  { value: "jalousie", label: "Jaluzi", defaultPrice: 950 },
  { value: "picasso", label: "Picasso", defaultPrice: 950 },
  { value: "diger", label: "Diğer", defaultPrice: 500 },
];

function ceil10(value: number) { return Math.ceil(Math.max(0, value) / 10) * 10; }
function formatMoney(value: number) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value); }
function productLabel(type: ProductType) { return PRODUCT_OPTIONS.find((item) => item.value === type)?.label ?? "Ürün"; }

function calculate(productType: ProductType, widthCm: number, heightCm: number, qty: number, unitPrice: number, pile: "2" | "3") {
  if (productType === "tul" || productType === "fon") {
    const pileMultiplier = pile === "3" ? 3 : 2;
    const fabricWidthCm = Math.max(0, widthCm) * pileMultiplier + 15;
    const areaM2 = fabricWidthCm / 100;
    const total = areaM2 * Math.max(1, qty) * Math.max(0, unitPrice);
    return { roundedWidth: widthCm, roundedHeight: heightCm, areaM2, total, fabricWidthCm };
  }
  const minWidth = productType === "stor" ? 100 : 1;
  const minHeight = productType === "stor" ? 200 : 1;
  const roundedWidth = ceil10(Math.max(widthCm, minWidth));
  const roundedHeight = ceil10(Math.max(heightCm, minHeight));
  const areaM2 = (roundedWidth / 100) * (roundedHeight / 100);
  const total = areaM2 * Math.max(1, qty) * Math.max(0, unitPrice);
  return { roundedWidth, roundedHeight, areaM2, total, fabricWidthCm: null as number | null };
}

function normalizeProductType(value: string | null | undefined): ProductType {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
  if (normalized === "tül") return "tul";
  if (normalized === "jaluzi") return "jalousie";
  if (normalized === "diğer" || normalized === "diger") return "diger";
  if (["stor", "zebra", "tul", "fon", "jalousie", "picasso"].includes(normalized)) return normalized as ProductType;
  return "diger";
}

// Termin (teslim tarihi) ölçü aşamasında alınmaz; yalnızca siparişe çevirme/sipariş
// oluşturma aşamasında girilir (orders.delivery_due_date tek doğruluk kaynağıdır).
const STEPS = ["Müşteri", "Adres", "Ürünler"] as const;

function normalizeText(v: string | null | undefined) { return (v ?? "").trim().toLocaleLowerCase("tr-TR"); }

/** Find best supplier cost from supplier_product_prices catalog.
 *  Matching priority:
 *  1. Exact product_name match (e.g. "Stor Perde Beyaz")
 *  2. product_category match (e.g. "stor")
 *  3. product_name contains productType label (e.g. product_name includes "Stor")
 *  4. Any price row for this supplier (fallback)
 */
function findSupplierCost(
  supplierId: string,
  productType: ProductType,
  modelName: string,
  supplierPrices: SupplierProductPriceRow[],
  products: ProductRow[],
): number {
  if (!supplierId) return 0;
  const forSupplier = supplierPrices.filter(sp => sp.supplier_id === supplierId);
  if (forSupplier.length === 0) return 0;

  const typeLabel = normalizeText(productLabel(productType)); // "stor", "zebra", "tül" etc.
  const normModel = normalizeText(modelName);

  // 1) exact product_name match with model_name
  if (normModel) {
    const hit = forSupplier.find(sp => normalizeText(sp.product_name) === normModel);
    if (hit?.unit_cost) return hit.unit_cost;
  }

  // 2) product_category matches productType
  const catHit = forSupplier.find(sp => normalizeText(sp.product_category) === typeLabel || normalizeText(sp.product_category) === productType);
  if (catHit?.unit_cost) return catHit.unit_cost;

  // 3) product_name contains product type label
  const nameHit = forSupplier.find(sp => normalizeText(sp.product_name).includes(typeLabel) || normalizeText(sp.product_name).includes(productType));
  if (nameHit?.unit_cost) return nameHit.unit_cost;

  // 4) Try matching through products catalog (cost_price from product)
  const product = products.find(p => normalizeText(p.name) === normModel) || products.find(p => normalizeText(p.category) === typeLabel || normalizeText(p.category) === productType);
  if (product) {
    const prodHit = forSupplier.find(sp => normalizeText(sp.product_name) === normalizeText(product.name));
    if (prodHit?.unit_cost) return prodHit.unit_cost;
    if (product.cost_price && product.cost_price > 0) return product.cost_price;
  }

  // 5) Fallback: first available price for this supplier
  const fallback = forSupplier.find(sp => (sp.unit_cost ?? 0) > 0);
  return fallback?.unit_cost ?? 0;
}

function makeNewItem(): MeasurementItem {
  return {
    id: crypto.randomUUID(),
    roomName: "", widthCm: 100, heightCm: 200, productType: "stor",
    selectedProductName: "", supplierId: "", supplierCost: 0,
    modelName: "", colorName: "", qty: 1, unitPrice: 650, pile: "2",
    note: "", photos: [], fieldInfo: emptyFieldInfo(),
  };
}

// ---- MAIN COMPONENT ----
export default function MeasurementEntry() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as any;

  const [step, setStep] = useState(1);

  // Use proper draft state management hook
  const [formState, updateFormState, clearDraft] = useDraftState('measurement_draft', {
    groupId: state?.groupId ?? crypto.randomUUID(),
    customerId: "",
    customerName: "",
    phone: "",
    address: "",
    items: [] as MeasurementItem[],
  });

  const { groupId, customerId, customerName, phone, address, items } = formState;

  // Convenience setters that work with the draft state hook
  const setGroupId = (v: string) => updateFormState({ groupId: v });
  const setCustomerId = (v: string) => updateFormState({ customerId: v });
  const setCustomerName = (v: string) => updateFormState({ customerName: v });
  const setPhone = (v: string) => updateFormState({ phone: v });
  const setAddress = (v: string) => updateFormState({ address: v });
  const setItems = (v: MeasurementItem[]) => updateFormState({ items: v });
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<SupplierProductPriceRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Load existing group if in edit mode
  useEffect(() => {
    if (!state.groupId) return;
    let alive = true;
    async function loadGroup() {
      try {
        const ctx = await getEffectiveTenantContext();
        let data, error;

        if (state.groupId.startsWith("single-")) {
          const singleId = state.groupId.replace("single-", "");
          const res = await supabase
            .from("appointments")
            .select("id,customer_id,address,room_name,width_cm,height_cm,product_type,model_name,color_name,quantity,unit_price,supplier_id,supplier_unit_cost,note,delivery_due_date,customer:customers(name,phone)")
            .eq("company_id", ctx.company_id)
            .eq("id", singleId);
          data = res.data;
          error = res.error;
        } else {
          const res = await supabase
            .from("appointments")
            .select("id,customer_id,address,room_name,width_cm,height_cm,product_type,model_name,color_name,quantity,unit_price,supplier_id,supplier_unit_cost,note,delivery_due_date,customer:customers(name,phone)")
            .eq("company_id", ctx.company_id)
            .ilike("note", `%[Grup: ${state.groupId}]%`);
          data = res.data;
          error = res.error;
        }

        if (!alive || error || !data || data.length === 0) return;

        const first = data[0];
        setGroupId(state.groupId);
        setCustomerId(first.customer_id || "");
        if (first.customer) {
          const cust = Array.isArray(first.customer) ? first.customer[0] : first.customer;
          setCustomerName(cust?.name || "");
          setPhone(cust?.phone || "");
        }
        setAddress(first.address || "");

        const loadedItems: MeasurementItem[] = data.map(row => {
          const noteStr = String(row.note || "");
          const kumasMatch = noteStr.match(/Kumaş Grubu: (.+)/);
          const mekMatch = noteStr.match(/Mekanizma: (.+)/);
          const zincirMatch = noteStr.match(/Zincir Yönü: (.+)/);
          const kasaTMatch = noteStr.match(/Kasa Tipi: (.+)/);
          const kasaRMatch = noteStr.match(/Kasa Rengi: (.+)/);
          const kornisMatch = noteStr.match(/Korniş Tipi: (.+)/);
          const pileMatch = noteStr.match(/Pile: ([23])/);

          let photos: string[] = [];
          const photoMatch = noteStr.match(/\[Photos:\s*(\[.*\])\]/);
          if (photoMatch) {
            try { photos = JSON.parse(photoMatch[1]); } catch { /* bozuk foto JSON'u yok say */ }
          }

          const cleanNote = noteStr
            .replace(/\[Grup: .*\]/g, "")
            .replace(/Kumaş Grubu: .*/g, "")
            .replace(/Mekanizma: .*/g, "")
            .replace(/Zincir Yönü: .*/g, "")
            .replace(/Kasa Tipi: .*/g, "")
            .replace(/Kasa Rengi: .*/g, "")
            .replace(/Korniş Tipi: .*/g, "")
            .replace(/Pile: .*/g, "")
            .replace(/\[Photos: .*\]/g, "")
            .trim();

          return {
            id: row.id,
            roomName: row.room_name || "",
            widthCm: row.width_cm || 100,
            heightCm: row.height_cm || 200,
            productType: normalizeProductType(row.product_type),
            selectedProductName: row.model_name || "",
            supplierId: row.supplier_id || "",
            supplierCost: row.supplier_unit_cost || 0,
            modelName: row.model_name || "",
            colorName: row.color_name || "",
            qty: row.quantity || 1,
            unitPrice: row.unit_price || 0,
            pile: pileMatch ? (pileMatch[1] as "2" | "3") : "2",
            kumasGrubu: kumasMatch ? kumasMatch[1].trim() : undefined,
            mekanizma: mekMatch ? mekMatch[1].trim() : undefined,
            zincirYonu: zincirMatch ? zincirMatch[1].trim() : undefined,
            kasaTipi: kasaTMatch ? kasaTMatch[1].trim() : undefined,
            kasaRengi: kasaRMatch ? kasaRMatch[1].trim() : undefined,
            kornisTipi: kornisMatch ? kornisMatch[1].trim() : undefined,
            note: cleanNote,
            photos,
            fieldInfo: parseFieldInfo({ color_name: row.color_name }),
          };
        });
        setItems(loadedItems);
        // Expand all loaded items
        setExpandedItems(new Set(loadedItems.map(i => i.id)));
        // Saha bilgilerini tolerant şekilde getir (field_info kolonu yoksa sessizce geç,
        // renkten türetilmiş haliyle kalır → eski kayıtlar bozulmaz)
        try {
          const ids = loadedItems.map(i => i.id);
          if (ids.length) {
            const { data: fiRows } = await supabase.from("appointments").select("id,field_info").in("id", ids);
            if (fiRows && alive) {
              const fiMap = new Map((fiRows as any[]).map(r => [r.id, r.field_info]));
              setItems(loadedItems.map(i => fiMap.get(i.id) ? { ...i, fieldInfo: parseFieldInfo(fiMap.get(i.id)) } : i));
            }
          }
        } catch { /* field_info kolonu yoksa yok say */ }
      } catch { /* grup yükleme hatası: yeni ölçü olarak devam edilir */ }
    }
    loadGroup();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groupId]);

  // Load catalogs
  useEffect(() => {
    let alive = true;
    async function loadCatalogData() {
      try {
        const ctx = await getEffectiveTenantContext();
        // products.cost_price bu kurulumda yok — yalnızca var olan kolonları seç
        // (cost_price opsiyonel maliyet ipucu; yokken maliyet ürün kartı yerine
        // tedarikçi fiyatından gelir). 400 üreten probe'a gerek yok.
        const pRes = await supabase.from("products").select("id,name,category,unit_price,is_active").eq("company_id", ctx.company_id);
        if (alive && pRes.data) setProducts(pRes.data as ProductRow[]);

        const sRes = await supabase.from("suppliers").select("id,name").eq("company_id", ctx.company_id);
        if (alive && sRes.data) setSuppliers(sRes.data as SupplierRow[]);

        // supplier_product_prices bu kurulumda product_type/unit_price şemasını
        // kullanıyor (product_name/product_category/unit_cost yok). Var olan
        // kolonları doğrudan seç ve UI tipine eşle — 400 probe yok.
        const spRes = await supabase.from("supplier_product_prices").select("supplier_id,product_type,unit_price").eq("company_id", ctx.company_id);
        if (alive && !spRes.error) {
          setSupplierPrices((spRes.data ?? []).map((p: any) => ({ ...p, product_name: p.product_type ?? null, product_category: p.product_type ?? null, unit_cost: p.unit_price ?? 0 })) as SupplierProductPriceRow[]);
        }

        const cRes = await supabase.from("customers").select("id,name,phone,address").eq("company_id", ctx.company_id).order("name").limit(500);
        if (alive && cRes.data) setCustomers(cRes.data as CustomerRow[]);
      } catch { /* katalog yükleme hatası: dropdownlar boş kalır */ }
    }
    void loadCatalogData();
    return () => { alive = false; };
  }, []);

  // Financial totals
  const { totalCost, totalSale, totalProfit } = useMemo(() => {
    let cost = 0, sale = 0;
    items.forEach(it => {
      const res = calculate(it.productType, it.widthCm, it.heightCm, it.qty, it.unitPrice, it.pile);
      sale += res.total;
      cost += res.areaM2 * Math.max(1, it.qty) * Math.max(0, it.supplierCost);
    });
    return { totalCost: cost, totalSale: sale, totalProfit: sale - cost };
  }, [items]);

  // Step completion check
  const stepComplete = useMemo(() => ({
    1: !!customerName.trim(),
    2: !!address.trim(),
    3: items.length > 0,
  }), [customerName, address, items]);

  function goStep(n: number) {
    if (n < 1 || n > 3) return;
    // Auto-add first item when entering the products step
    if (n === 3 && items.length === 0) {
      const first = makeNewItem();
      setItems([first]);
      setExpandedItems(new Set([first.id]));
    }
    setStep(n);
  }

  function addNewItem() {
    const newItem = makeNewItem();
    setItems([...items, newItem]);
    setExpandedItems(prev => new Set(prev).add(newItem.id));
  }

  function updateItem(id: string, updates: Partial<MeasurementItem>) {
    setItems(items.map(it => it.id === id ? { ...it, ...updates } : it));
  }

  function deleteItem(id: string) {
    setItems(items.filter(it => it.id !== id));
    setExpandedItems(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  function copyItem(id: string) {
    const it = items.find(i => i.id === id);
    if (!it) return;
    const newItem = { ...it, id: crypto.randomUUID(), roomName: it.roomName + " (Kopya)" };
    setItems([...items, newItem]);
    setExpandedItems(prev => new Set(prev).add(newItem.id));
  }

  function toggleExpand(id: string) {
    setExpandedItems(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  async function saveMeasurementGroup() {
    if (items.length === 0) { setError("En az 1 ürün eklemelisiniz."); return; }
    if (!customerName.trim()) { setError("Müşteri adı girilmelidir."); setStep(1); return; }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const ctx = await getEffectiveTenantContext();
      let cid = customerId;
      if (!cid && customerName) {
        const { data } = await supabase.from("customers").insert({ company_id: ctx.company_id, name: customerName, phone: phone || null, address: address || null }).select("id").single();
        if (data?.id) cid = data.id;
      }
      if (!cid) throw new Error("Müşteri belirlenemedi");

      const now = new Date().toISOString();
      const payloads = items.map(it => {
        const res = calculate(it.productType, it.widthCm, it.heightCm, it.qty, it.unitPrice, it.pile);
        const itemCost = res.areaM2 * Math.max(1, it.qty) * Math.max(0, it.supplierCost);

        let dynamicProps = "";
        if (it.kumasGrubu) dynamicProps += `\nKumaş Grubu: ${it.kumasGrubu}`;
        if (it.mekanizma) dynamicProps += `\nMekanizma: ${it.mekanizma}`;
        if (it.zincirYonu) dynamicProps += `\nZincir Yönü: ${it.zincirYonu}`;
        if (it.kasaTipi) dynamicProps += `\nKasa Tipi: ${it.kasaTipi}`;
        if (it.kasaRengi) dynamicProps += `\nKasa Rengi: ${it.kasaRengi}`;
        if (it.kornisTipi) dynamicProps += `\nKorniş Tipi: ${it.kornisTipi}`;
        // Pile yalnızca tül/fon alan hesabını etkiler; düzenlemede kaybolmaması için sakla.
        if (it.productType === "tul" || it.productType === "fon") dynamicProps += `\nPile: ${it.pile}`;
        if (it.photos.length) dynamicProps += `\n[Photos: ${JSON.stringify(it.photos)}]`;

        return {
          company_id: ctx.company_id,
          customer_id: cid,
          type: "measurement",
          title: `${productLabel(it.productType)} ölçüsü`,
          address: address || null,
          status: "done",
          done: true,
          done_at: now,
          assigned_to: ctx.user.id,
          room_name: it.roomName || null,
          width_cm: it.widthCm,
          height_cm: it.heightCm,
          rounded_width_cm: res.roundedWidth,
          rounded_height_cm: res.roundedHeight,
          product_type: it.productType,
          model_name: it.modelName || null,
          color_name: it.colorName || null,
          quantity: it.qty,
          unit_price: it.unitPrice,
          supplier_id: it.supplierId || null,
          supplier_unit_cost: it.supplierCost,
          supplier_total_cost: itemCost,
          estimated_area_m2: res.areaM2,
          estimated_total: res.total,
          delivery_due_date: null, // Termin sipariş aşamasında girilir; ölçüde alınmaz
          note: `${it.note || ""}\n[Grup: ${groupId}]${dynamicProps}`.trim(),
          measurement_notes: `${it.note || ""}\n[Grup: ${groupId}]${dynamicProps}`.trim(),
          field_info: it.fieldInfo ?? null,
        };
      });

      // Clear existing group items
      await supabase.from("appointments").delete().eq("company_id", ctx.company_id).ilike("note", `%[Grup: ${groupId}]%`);

      let { error: insErr } = await supabase.from("appointments").insert(payloads);
      // field_info kolonu yoksa (migration uygulanmamış ortam): alan olmadan tekrar dene → akış bozulmaz
      if (insErr && /field_info/i.test(insErr.message || "")) {
        const stripped = payloads.map(p => { const c: any = { ...p }; delete c.field_info; return c; });
        const retry = await supabase.from("appointments").insert(stripped);
        insErr = retry.error;
      }
      if (insErr) throw insErr;

      setSuccess("✅ Ölçü grubu kaydedildi.");
      // Başarılı kayıt sonrası draft'ı temizle
      clearDraft();
      // Kaydetme sonrası ölçü anasayfasına yönlendir
      setTimeout(() => {
        navigate("/quotes", { replace: true });
      }, 600);
    } catch (e: any) {
      setError(e.message || "Hata oluştu.");
    } finally {
      setSaving(false);
    }
  }

  const missingCostAlert = items.some(it => it.supplierCost <= 0);

  // ---- Shared input styles ----
  const inputCls = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-950 dark:focus:border-primary-400";
  const labelCls = "text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8 pb-36">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <button onClick={() => {
          clearDraft();
          navigate(-1);
        }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" /> Geri
        </button>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">{state.groupId ? "Ölçü Düzenle" : "Yeni Ölçü"}</h1>
      </div>

      {/* ALERTS */}
      {error && <div className="animate-in fade-in rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-800 dark:bg-red-950/30">{error}</div>}
      {success && <div className="animate-in fade-in rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30">{success}</div>}

      {/* STEPPER */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const stepNum = i + 1;
          const isActive = step === stepNum;
          const isDone = stepComplete[stepNum as keyof typeof stepComplete];
          return (
            <button
              key={s}
              onClick={() => goStep(stepNum)}
              className={`relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black transition-all ${isActive
                ? "bg-primary-600 text-white shadow-lg shadow-primary-600/30"
                : isDone
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
            >
              {isDone && !isActive ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs">{stepNum}</span>}
              <span className="hidden sm:inline">{s}</span>
            </button>
          );
        })}
      </div>

      {/* STEP CONTENT */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">

        {/* STEP 1: MÜŞTERI */}
        {step === 1 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={labelCls}>Müşteri Seçin veya Yazın</span>
              <select value={customerId} onChange={(e) => {
                const c = customers.find(x => x.id === e.target.value);
                setCustomerId(e.target.value);
                if (c) { setCustomerName(c.name || ""); setPhone(c.phone || ""); setAddress(c.address || ""); }
              }} className={inputCls}>
                <option value="">— Yeni Müşteri Ekle —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls}>Ad Soyad *</span>
              <input value={customerName} onChange={e => { setCustomerName(e.target.value); if (customerId) setCustomerId(""); }} placeholder="Müşteri adı soyadı" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Telefon</span>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="05XX XXX XXXX" className={inputCls} />
            </label>
          </div>
        )}

        {/* STEP 2: ADRES */}
        {step === 2 && (
          <div className="grid gap-5">
            <label>
              <span className={labelCls}>Adres / Konum Detayı</span>
              <textarea value={address} onChange={e => setAddress(e.target.value)} rows={4} className={inputCls} placeholder="Açık adres yazın..." />
            </label>
            <div className="flex flex-wrap gap-3">
              {phone && (
                <>
                  <a href={`https://wa.me/90${phone?.replace(/\D/g, '').replace(/^90/, '').replace(/^0/, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-green-100 px-4 py-2.5 text-sm font-black text-green-700 transition-colors hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
                  <a href={`tel:${phone}`} className="inline-flex items-center gap-2 rounded-xl bg-blue-100 px-4 py-2.5 text-sm font-black text-blue-700 transition-colors hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400"><Phone className="h-4 w-4" /> Ara</a>
                </>
              )}
              {address && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-purple-100 px-4 py-2.5 text-sm font-black text-purple-700 transition-colors hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400"><MapPin className="h-4 w-4" /> Haritada Aç</a>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: ÜRÜNLER */}
        {step === 3 && (
          <div className="grid gap-4">
            {items.map((item, idx) => {
              const isExpanded = expandedItems.has(item.id);
              const calc = calculate(item.productType, item.widthCm, item.heightCm, item.qty, item.unitPrice, item.pile);

              return (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm dark:border-slate-700 dark:bg-slate-800/50 overflow-hidden">
                  {/* Header - always visible */}
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-black text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">{idx + 1}</span>
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-900 dark:text-white">{item.roomName || "Alan adı girilmedi"}</div>
                        <div className="text-xs text-slate-500">{productLabel(item.productType)} • {item.widthCm}x{item.heightCm} cm • {item.qty} adet</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-black text-slate-800 dark:text-slate-200">{formatMoney(calc.total)}</span>
                      {item.supplierCost <= 0 && <AlertCircle className="h-4 w-4 text-orange-500" />}
                      <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 px-4 py-4 dark:border-slate-700">
                      {/* Actions bar */}
                      <div className="mb-4 flex justify-end gap-2">
                        <button onClick={() => copyItem(item.id)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"><Copy className="h-3 w-3" /> Kopyala</button>
                        <button onClick={() => deleteItem(item.id)} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400"><Trash2 className="h-3 w-3" /> Sil</button>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {/* Oda Adı */}
                        <label><span className={labelCls}>Oda / Alan Adı</span>
                          <input value={item.roomName} onChange={e => updateItem(item.id, { roomName: e.target.value })} placeholder="Salon, Yatak Odası..." className={inputCls} />
                        </label>

                        {/* Ürün Tipi */}
                        <label><span className={labelCls}>Ürün Tipi</span>
                          <select value={item.productType} onChange={e => {
                            const pt = e.target.value as ProductType;
                            const defaultPrice = PRODUCT_OPTIONS.find(o => o.value === pt)?.defaultPrice ?? 500;
                            const autoSupplierCost = item.supplierId
                              ? findSupplierCost(item.supplierId, pt, item.modelName, supplierPrices, products)
                              : item.supplierCost;
                            updateItem(item.id, {
                              productType: pt,
                              unitPrice: defaultPrice,
                              supplierCost: autoSupplierCost > 0 ? autoSupplierCost : item.supplierCost,
                            });
                          }} className={inputCls}>
                            {PRODUCT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>

                        {/* Tedarikçi */}
                        <label><span className={labelCls}>Tedarikçi</span>
                          <select value={item.supplierId} onChange={e => {
                            const sid = e.target.value;
                            const cost = sid
                              ? findSupplierCost(sid, item.productType, item.modelName, supplierPrices, products)
                              : 0;
                              
                            if (sid && cost === 0) {
                                alert(`Seçilen tedarikçinin fiyat listesinde bu ürün (${productLabel(item.productType)}) için bir alış maliyeti bulunamadı. Lütfen alış fiyatını manuel giriniz veya tedarikçi listesini güncelleyiniz.`);
                            }
                            
                            updateItem(item.id, {
                              supplierId: sid,
                              supplierCost: cost > 0 ? cost : item.supplierCost,
                            });
                          }} className={inputCls}>
                            <option value="">— Tedarikçi Seçin —</option>
                            {(() => {
                                const validSuppliers = suppliers.filter(s => findSupplierCost(s.id, item.productType, item.modelName, supplierPrices, products) > 0);
                                const listToRender = validSuppliers.length > 0 ? validSuppliers : suppliers;
                                return listToRender.map(s => <option key={s.id} value={s.id}>{s.name}</option>);
                            })()}
                          </select>
                        </label>

                        {/* Dimensions */}
                        <label><span className={labelCls}>En (cm)</span>
                          <input type="number" value={item.widthCm} onChange={e => updateItem(item.id, { widthCm: Number(e.target.value) })} className={inputCls} />
                        </label>
                        <label><span className={labelCls}>Boy (cm)</span>
                          <input type="number" value={item.heightCm} onChange={e => updateItem(item.id, { heightCm: Number(e.target.value) })} className={inputCls} />
                        </label>
                        <label><span className={labelCls}>Adet</span>
                          <input type="number" min={1} value={item.qty} onChange={e => updateItem(item.id, { qty: Math.max(1, Number(e.target.value)) })} className={inputCls} />
                        </label>

                        {/* Pricing */}
                        <label><span className={labelCls}>Satış Fiyatı (₺/m²)</span>
                          <input type="number" value={item.unitPrice} onChange={e => updateItem(item.id, { unitPrice: Number(e.target.value) })} className={inputCls} />
                        </label>
                        <label><span className={labelCls}>Alış Maliyeti (₺/m²)</span>
                          <input type="number" value={item.supplierCost} onChange={e => updateItem(item.id, { supplierCost: Number(e.target.value) })} className={`${inputCls} ${item.supplierCost <= 0 ? "border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/20" : ""}`} />
                          {item.supplierCost <= 0 && <span className="mt-1 text-[10px] font-bold text-orange-600">⚠️ Alış fiyatı girilmedi</span>}
                        </label>

                        {/* Model / Renk */}
                        <label><span className={labelCls}>Model Adı</span>
                          <input value={item.modelName} onChange={e => updateItem(item.id, { modelName: e.target.value })} placeholder="Model adı" className={inputCls} />
                        </label>
                        <label><span className={labelCls}>Renk</span>
                          <input value={item.colorName} onChange={e => updateItem(item.id, { colorName: e.target.value })} placeholder="Renk adı" className={inputCls} />
                        </label>

                        {/* ----- Dynamic Product Fields ----- */}

                        {/* STOR: Kumaş Grubu, Mekanizma, Zincir Yönü, Kasa Tipi */}
                        {item.productType === "stor" && (
                          <>
                            <label><span className={labelCls}>Kumaş Grubu</span><input value={item.kumasGrubu || ""} onChange={e => updateItem(item.id, { kumasGrubu: e.target.value })} className={inputCls} placeholder="1. Grup, 2. Grup..." /></label>
                            <label><span className={labelCls}>Mekanizma</span>
                              <select value={item.mekanizma || ""} onChange={e => updateItem(item.id, { mekanizma: e.target.value })} className={inputCls}>
                                <option value="">Seçin</option>
                                <option value="Yaylı">Yaylı</option>
                                <option value="Zincirli">Zincirli</option>
                                <option value="Redüktörlü">Redüktörlü</option>
                                <option value="Motorlu">Motorlu</option>
                              </select>
                            </label>
                            <label><span className={labelCls}>Zincir Yönü</span>
                              <select value={item.zincirYonu || ""} onChange={e => updateItem(item.id, { zincirYonu: e.target.value })} className={inputCls}>
                                <option value="">Seçin</option>
                                <option value="Sol">Sol</option>
                                <option value="Sağ">Sağ</option>
                              </select>
                            </label>
                            <label><span className={labelCls}>Kasa Tipi</span>
                              <select value={item.kasaTipi || ""} onChange={e => updateItem(item.id, { kasaTipi: e.target.value })} className={inputCls}>
                                <option value="">Seçin</option>
                                <option value="Açık Kasa">Açık Kasa</option>
                                <option value="Kapalı Kasa">Kapalı Kasa</option>
                                <option value="İnce Kasa">İnce Kasa</option>
                              </select>
                            </label>
                          </>
                        )}

                        {/* ZEBRA: Kumaş Grubu, Zincir Yönü, Kasa Rengi */}
                        {item.productType === "zebra" && (
                          <>
                            <label><span className={labelCls}>Kumaş Grubu</span><input value={item.kumasGrubu || ""} onChange={e => updateItem(item.id, { kumasGrubu: e.target.value })} className={inputCls} placeholder="1. Grup, 2. Grup..." /></label>
                            <label><span className={labelCls}>Zincir Yönü</span>
                              <select value={item.zincirYonu || ""} onChange={e => updateItem(item.id, { zincirYonu: e.target.value })} className={inputCls}>
                                <option value="">Seçin</option>
                                <option value="Sol">Sol</option>
                                <option value="Sağ">Sağ</option>
                              </select>
                            </label>
                            <label><span className={labelCls}>Kasa Rengi</span>
                              <select value={item.kasaRengi || ""} onChange={e => updateItem(item.id, { kasaRengi: e.target.value })} className={inputCls}>
                                <option value="">Seçin</option>
                                <option value="Beyaz">Beyaz</option>
                                <option value="Krem">Krem</option>
                                <option value="Gri">Gri</option>
                                <option value="Siyah">Siyah</option>
                                <option value="Kahverengi">Kahverengi</option>
                              </select>
                            </label>
                          </>
                        )}

                        {/* TÜL: Pile Tipi, Kumaş Türü */}
                        {item.productType === "tul" && (
                          <>
                            <label><span className={labelCls}>Pile Tipi</span>
                              <select value={item.pile} onChange={e => updateItem(item.id, { pile: e.target.value as "2" | "3" })} className={inputCls}>
                                <option value="2">1'e 2</option>
                                <option value="3">1'e 3</option>
                              </select>
                            </label>
                            <label><span className={labelCls}>Kumaş Grubu</span><input value={item.kumasGrubu || ""} onChange={e => updateItem(item.id, { kumasGrubu: e.target.value })} className={inputCls} placeholder="Kumaş türü" /></label>
                          </>
                        )}

                        {/* FON: Pile Tipi, Kumaş Türü, Korniş Tipi */}
                        {item.productType === "fon" && (
                          <>
                            <label><span className={labelCls}>Pile Tipi</span>
                              <select value={item.pile} onChange={e => updateItem(item.id, { pile: e.target.value as "2" | "3" })} className={inputCls}>
                                <option value="2">1'e 2</option>
                                <option value="3">1'e 3</option>
                              </select>
                            </label>
                            <label><span className={labelCls}>Kumaş Grubu</span><input value={item.kumasGrubu || ""} onChange={e => updateItem(item.id, { kumasGrubu: e.target.value })} className={inputCls} placeholder="Kumaş türü" /></label>
                            <label><span className={labelCls}>Korniş Tipi</span>
                              <select value={item.kornisTipi || ""} onChange={e => updateItem(item.id, { kornisTipi: e.target.value })} className={inputCls}>
                                <option value="">Seçin</option>
                                <option value="Raylar">Raylar</option>
                                <option value="Rustik">Rustik</option>
                                <option value="Metal Boru">Metal Boru</option>
                                <option value="Ahşap Boru">Ahşap Boru</option>
                              </select>
                            </label>
                          </>
                        )}

                        {/* Not */}
                        <label className="sm:col-span-2 lg:col-span-3"><span className={labelCls}>Not</span>
                          <textarea value={item.note} onChange={e => updateItem(item.id, { note: e.target.value })} rows={2} className={inputCls} placeholder="Ek notlar..." />
                        </label>
                      </div>

                      {/* Item line total */}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-100 px-4 py-3 dark:bg-slate-700/50">
                        <div className="text-xs text-slate-500">
                          Alan: {calc.areaM2.toFixed(2)} m²
                          {calc.fabricWidthCm ? ` • Kumaş eni: ${calc.fabricWidthCm} cm` : ""}
                          {item.productType === "stor" || item.productType === "zebra" || item.productType === "jalousie" || item.productType === "picasso"
                            ? ` • Yuvarlanan: ${calc.roundedWidth}x${calc.roundedHeight} cm` : ""}
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-slate-500">Satış: <b className="text-slate-800 dark:text-slate-100">{formatMoney(calc.total)}</b></span>
                          {item.supplierCost > 0 && (
                            <span className="text-slate-500">Kâr: <b className={`${calc.total - calc.areaM2 * item.qty * item.supplierCost >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatMoney(calc.total - calc.areaM2 * item.qty * item.supplierCost)}</b></span>
                          )}
                        </div>
                      </div>

                      {/* Saha Bilgileri — bu ürün satırına bağlı (kartela kodu/fotoğrafı, mekan fotoğrafları, sesli not, montaj notu) */}
                      <div className="mt-4">
                        <FieldInfoEditor
                          value={item.fieldInfo ?? emptyFieldInfo()}
                          onChange={(fi) => updateItem(item.id, { fieldInfo: fi })}
                          getCompanyId={async () => (await getEffectiveTenantContext()).company_id}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add item button */}
            <button onClick={addNewItem} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary-300 bg-primary-50 font-black text-primary-600 transition-colors hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-950/20 dark:hover:bg-primary-900/40">
              <Plus className="h-5 w-5" /> Satır Ekle
            </button>
          </div>
        )}
      </div>

      {/* STEP NAVIGATION */}
      <div className="flex items-center justify-between gap-3">
        <button
          disabled={step <= 1}
          onClick={() => goStep(step - 1)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" /> Geri
        </button>
        <div className="text-xs font-bold text-slate-400">Adım {step} / {STEPS.length}</div>
        {step < 3 ? (
          <button
            onClick={() => goStep(step + 1)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 py-2 text-sm font-black text-white shadow-lg shadow-primary-600/20 transition-colors hover:bg-primary-700"
          >
            İleri <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <div /> /* placeholder to maintain spacing */
        )}
      </div>

      {/* FINANCIAL SUMMARY */}
      {items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6 dark:border-emerald-900/50 dark:from-emerald-950/20 dark:to-green-950/20">
            <h3 className="mb-4 flex items-center gap-2 font-black text-emerald-900 dark:text-emerald-100"><Calculator className="h-5 w-5" /> Finansal Özet</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-emerald-700 dark:text-emerald-400">Toplam Satış</span><span className="font-black text-emerald-900 dark:text-emerald-100">{formatMoney(totalSale)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-emerald-700 dark:text-emerald-400">Toplam Maliyet</span><span className="font-black text-emerald-900 dark:text-emerald-100">{formatMoney(totalCost)}</span></div>
              <div className="flex justify-between border-t border-emerald-200 pt-3 dark:border-emerald-800"><span className="font-bold text-emerald-800 dark:text-emerald-200">Net Kâr</span><span className={`text-lg font-black ${totalProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatMoney(totalProfit)}</span></div>
              {missingCostAlert && <div className="mt-2 flex items-center gap-2 rounded-lg bg-orange-100 p-2 text-xs font-bold text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"><AlertCircle className="h-4 w-4 shrink-0" /> Bazı ürünlerin alış maliyeti sıfır! Kâr hesabı yanıltıcı olabilir.</div>}
            </div>
          </div>

          {/* Quick summary */}
          <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
            <h3 className="mb-4 font-black text-slate-900 dark:text-white">Ölçü Özeti</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Müşteri</span><span className="font-bold text-slate-800 dark:text-slate-200">{customerName || "—"}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Toplam Ürün</span><span className="font-bold text-slate-800 dark:text-slate-200">{items.length} kalem</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Toplam Adet</span><span className="font-bold text-slate-800 dark:text-slate-200">{items.reduce((s, i) => s + i.qty, 0)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* STICKY BOTTOM ACTIONS */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/90 p-4 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/90 md:pl-64">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {items.length > 0 && <span>{items.length} ürün • <b className="text-slate-700 dark:text-slate-200">{formatMoney(totalSale)}</b></span>}
          </div>
          <button disabled={saving || items.length === 0} onClick={saveMeasurementGroup} className="flex min-h-12 items-center gap-2 rounded-xl bg-primary-600 px-6 font-black text-white shadow-lg shadow-primary-600/30 transition-all hover:bg-primary-700 hover:shadow-xl disabled:opacity-50">
            <Save className="h-5 w-5" /> {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>

      {/* EMBEDDED QUOTES */}
      <div className="mt-8">
        <Quotes embedded={true} />
      </div>
    </div>
  );
}
