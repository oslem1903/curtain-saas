import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, Calculator, FilePlus2, ImagePlus, Ruler, Save, UserPlus } from "lucide-react";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type ProductType = "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "diger";

type ProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  unit_price: number | null;
  cost_price?: number | null;
  is_active: boolean | null;
};

type SupplierRow = {
  id: string;
  name: string | null;
};

type SupplierProductPriceRow = {
  supplier_id: string;
  product_id: string | null;
  product_name: string | null;
  product_category?: string | null;
  unit_cost: number | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  address?: string | null;
};

type PreviousMeasurementRow = {
  id: string;
  start_at: string | null;
  address: string | null;
  room_name?: string | null;
  width_cm?: number | null;
  height_cm?: number | null;
  product_type?: string | null;
  model_name?: string | null;
  color_name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  measurement_notes?: string | null;
};

function readRelatedCustomer(value: any): CustomerRow | null {
  const customer = Array.isArray(value) ? value[0] : value;
  if (!customer?.id) return null;
  return {
    id: customer.id,
    name: customer.name ?? null,
    phone: customer.phone ?? null,
    address: customer.address ?? null,
  };
}

function mergeCustomerRows(...groups: CustomerRow[][]) {
  const seen = new Set<string>();
  const merged: CustomerRow[] = [];

  for (const group of groups) {
    for (const customer of group) {
      if (!customer.id || seen.has(customer.id)) continue;
      seen.add(customer.id);
      merged.push(customer);
    }
  }

  return merged.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "tr"));
}

type MeasurementDraft = {
  customerId: string;
  customerName: string;
  phone: string;
  address: string;
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
};

type LocationState = {
  appointmentId?: string;
  customerId?: string | null;
  customerName?: string;
  phone?: string;
  address?: string;
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

const DEFAULT_CATALOG_PRODUCTS: ProductRow[] = PRODUCT_OPTIONS.map((item) => ({
  id: `default-${item.value}`,
  name: item.label,
  category: item.label,
  unit_price: item.defaultPrice,
  cost_price: null,
  is_active: true,
}));

const MEASUREMENT_DRAFT_KEY = "curtain_measurement_entry_draft_v1";

function ceil10(value: number) {
  return Math.ceil(Math.max(0, value) / 10) * 10;
}

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

function formatMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value);
}

function productLabel(type: ProductType) {
  return PRODUCT_OPTIONS.find((item) => item.value === type)?.label ?? "Ürün";
}

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProductType(value: string | null | undefined): ProductType {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("tr-TR");
  if (normalized === "tül") return "tul";
  if (normalized === "jaluzi") return "jalousie";
  if (normalized === "diğer" || normalized === "diger") return "diger";
  if (["stor", "zebra", "tul", "fon", "jalousie", "picasso"].includes(normalized)) return normalized as ProductType;
  return "diger";
}

function mergeProductRows(products: ProductRow[]) {
  const seen = new Set<string>();
  const merged: ProductRow[] = [];

  for (const product of [...products, ...DEFAULT_CATALOG_PRODUCTS]) {
    const key = (product.name || product.category || product.id).trim().toLocaleLowerCase("tr-TR");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(product);
  }

  return merged;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function readMeasurementDraft(): Partial<MeasurementDraft> {
  try {
    return JSON.parse(sessionStorage.getItem(MEASUREMENT_DRAFT_KEY) || "{}") as Partial<MeasurementDraft>;
  } catch {
    return {};
  }
}

export default function MeasurementEntry() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const draft = useRef(readMeasurementDraft());

  const [customerId, setCustomerId] = useState(state.customerId ?? draft.current.customerId ?? "");
  const [customerName, setCustomerName] = useState(state.customerName ?? draft.current.customerName ?? "");
  const [phone, setPhone] = useState(state.phone ?? draft.current.phone ?? "");
  const [address, setAddress] = useState(state.address ?? draft.current.address ?? "");
  const [roomName, setRoomName] = useState(draft.current.roomName ?? "");
  const [widthCm, setWidthCm] = useState(draft.current.widthCm ?? 100);
  const [heightCm, setHeightCm] = useState(draft.current.heightCm ?? 200);
  const [productType, setProductType] = useState<ProductType>(draft.current.productType ?? "stor");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<SupplierProductPriceRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [previousMeasurements, setPreviousMeasurements] = useState<PreviousMeasurementRow[]>([]);
  const [selectedProductName, setSelectedProductName] = useState(draft.current.selectedProductName ?? "");
  const [supplierId, setSupplierId] = useState(draft.current.supplierId ?? "");
  const [supplierCost, setSupplierCost] = useState(draft.current.supplierCost ?? 0);
  const [modelName, setModelName] = useState(draft.current.modelName ?? "");
  const [colorName, setColorName] = useState(draft.current.colorName ?? "");
  const [qty, setQty] = useState(draft.current.qty ?? 1);
  const [unitPrice, setUnitPrice] = useState(draft.current.unitPrice ?? 650);
  const [pile, setPile] = useState<"2" | "3">(draft.current.pile ?? "2");
  const [note, setNote] = useState(draft.current.note ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastMeasurementId, setLastMeasurementId] = useState<string | null>(null);

  const result = useMemo(
    () => calculate(productType, widthCm, heightCm, qty, unitPrice, pile),
    [heightCm, pile, productType, qty, unitPrice, widthCm],
  );

  const selectedProduct = useMemo(() => {
    return products.find((item) => normalizeText(item.name) === normalizeText(selectedProductName)) ?? null;
  }, [products, selectedProductName]);

  const supplierProductOptions = useMemo(() => {
    if (!supplierId) return products;

    const listed = supplierPrices.filter((price) => price.supplier_id === supplierId);
    if (listed.length === 0) return products;

    const byId = new Map(products.map((product) => [product.id, product]));
    return mergeProductRows(listed.map((price, index) => {
      const linkedProduct = price.product_id ? byId.get(price.product_id) : null;
      return {
        id: linkedProduct?.id ?? `supplier-${supplierId}-${price.product_name || index}`,
        name: linkedProduct?.name ?? price.product_name ?? "Ürün",
        category: linkedProduct?.category ?? price.product_category ?? price.product_name ?? null,
        unit_price: linkedProduct?.unit_price ?? null,
        cost_price: price.unit_cost,
        is_active: true,
      };
    }));
  }, [products, supplierId, supplierPrices]);

  const rawAreaM2 = useMemo(() => {
    return (Math.max(0, safeNumber(widthCm)) * Math.max(0, safeNumber(heightCm))) / 10000;
  }, [heightCm, widthCm]);

  const measuredAreaM2 = useMemo(() => rawAreaM2 * Math.max(1, safeNumber(qty, 1)), [qty, rawAreaM2]);
  const totalCost = useMemo(() => measuredAreaM2 * Math.max(0, safeNumber(supplierCost)), [measuredAreaM2, supplierCost]);
  const totalSale = useMemo(() => measuredAreaM2 * Math.max(0, safeNumber(unitPrice)), [measuredAreaM2, unitPrice]);
  const profit = useMemo(() => totalSale - totalCost, [totalCost, totalSale]);
  const profitRate = useMemo(() => totalSale > 0 ? (profit / totalSale) * 100 : 0, [profit, totalSale]);

  useEffect(() => {
    let alive = true;
    async function loadCatalogData() {
      try {
        const ctx = await getEffectiveTenantContext();
        const productsRes = await supabase
          .from("products")
          .select("id,name,category,unit_price,cost_price,is_active")
          .eq("company_id", ctx.company_id)
          .order("name", { ascending: true });

        if (productsRes.error && /cost_price/i.test(String(productsRes.error.message || ""))) {
          const fallback = await supabase
            .from("products")
            .select("id,name,category,unit_price,is_active")
            .eq("company_id", ctx.company_id)
            .order("name", { ascending: true });
          if (alive && !fallback.error) setProducts(mergeProductRows(((fallback.data ?? []) as ProductRow[]).filter((item) => item.is_active !== false)));
        } else if (alive && !productsRes.error) {
          setProducts(mergeProductRows(((productsRes.data ?? []) as ProductRow[]).filter((item) => item.is_active !== false)));
        } else if (alive) {
          setProducts(mergeProductRows([]));
        }

        const suppliersRes = await supabase
          .from("suppliers")
          .select("id,name")
          .eq("company_id", ctx.company_id)
          .order("name", { ascending: true });
        if (alive && !suppliersRes.error) setSuppliers((suppliersRes.data ?? []) as SupplierRow[]);

        const supplierPricesRes = await supabase
          .from("supplier_product_prices")
          .select("supplier_id,product_id,product_name,product_category,unit_cost")
          .eq("company_id", ctx.company_id);
        if (alive && !supplierPricesRes.error) setSupplierPrices((supplierPricesRes.data ?? []) as SupplierProductPriceRow[]);

        let customersRes: any = await supabase
          .from("customers")
          .select("id,name,phone,address")
          .eq("company_id", ctx.company_id)
          .order("name", { ascending: true })
          .limit(1000);

        if (customersRes.error && /address/i.test(String(customersRes.error.message || ""))) {
          customersRes = await supabase
            .from("customers")
            .select("id,name,phone")
            .eq("company_id", ctx.company_id)
            .order("name", { ascending: true })
            .limit(1000);
        }

        let nextCustomers = customersRes.error ? [] : ((customersRes.data ?? []) as CustomerRow[]);

        if (nextCustomers.length === 0) {
          const wideCustomersRes = await supabase
            .from("customers")
            .select("*")
            .eq("company_id", ctx.company_id)
            .order("created_at", { ascending: false })
            .limit(1000);

          if (!wideCustomersRes.error) nextCustomers = (wideCustomersRes.data ?? []) as CustomerRow[];
        }

        if (nextCustomers.length === 0) {
          const [appointmentCustomersRes, orderCustomersRes] = await Promise.all([
            supabase
              .from("appointments")
              .select("customer:customers(id,name,phone,address)")
              .eq("company_id", ctx.company_id)
              .not("customer_id", "is", null)
              .order("created_at", { ascending: false })
              .limit(1000),
            supabase
              .from("orders")
              .select("customer:customers(id,name,phone,address)")
              .eq("company_id", ctx.company_id)
              .not("customer_id", "is", null)
              .order("created_at", { ascending: false })
              .limit(1000),
          ]);

          const appointmentCustomers = appointmentCustomersRes.error
            ? []
            : (appointmentCustomersRes.data ?? []).map((row: any) => readRelatedCustomer(row.customer)).filter(Boolean) as CustomerRow[];
          const orderCustomers = orderCustomersRes.error
            ? []
            : (orderCustomersRes.data ?? []).map((row: any) => readRelatedCustomer(row.customer)).filter(Boolean) as CustomerRow[];

          nextCustomers = mergeCustomerRows(appointmentCustomers, orderCustomers);
        }

        if (alive) setCustomers(mergeCustomerRows(nextCustomers));
      } catch {
        if (!alive) return;
        setProducts([]);
        setSuppliers([]);
        setSupplierPrices([]);
        setCustomers([]);
      }
    }

    void loadCatalogData();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const payload: MeasurementDraft = {
      customerId,
      customerName,
      phone,
      address,
      roomName,
      widthCm,
      heightCm,
      productType,
      selectedProductName,
      supplierId,
      supplierCost,
      modelName,
      colorName,
      qty,
      unitPrice,
      pile,
      note,
    };
    sessionStorage.setItem(MEASUREMENT_DRAFT_KEY, JSON.stringify(payload));
  }, [address, colorName, customerId, customerName, heightCm, modelName, note, phone, pile, productType, qty, roomName, selectedProductName, supplierCost, supplierId, unitPrice, widthCm]);

  useEffect(() => {
    let alive = true;
    async function loadPreviousMeasurements() {
      if (!customerId) {
        setPreviousMeasurements([]);
        return;
      }
      const ctx = await getEffectiveTenantContext().catch(() => null);
      if (!ctx) return;
      const { data, error } = await supabase
        .from("appointments")
        .select("id,start_at,address,room_name,width_cm,height_cm,product_type,model_name,color_name,quantity,unit_price,measurement_notes")
        .eq("company_id", ctx.company_id)
        .eq("customer_id", customerId)
        .eq("type", "measurement")
        .order("start_at", { ascending: false })
        .limit(10);
      if (!alive) return;
      setPreviousMeasurements(error ? [] : ((data ?? []) as PreviousMeasurementRow[]));
    }
    loadPreviousMeasurements();
    return () => { alive = false; };
  }, [customerId]);

  function onProductChange(next: ProductType) {
    setProductType(next);
    const option = PRODUCT_OPTIONS.find((item) => item.value === next);
    if (option) setUnitPrice(option.defaultPrice);
  }

  function supplierCostFor(product: ProductRow | null, nextSupplierId = supplierId) {
    if (!nextSupplierId || !product) return safeNumber(product?.cost_price);
    const normalizedProductName = normalizeText(product.name || product.category);
    const normalizedCategory = normalizeText(product.category);
    const hit = supplierPrices.find((price) => {
      if (price.supplier_id !== nextSupplierId) return false;
      if (product.id && price.product_id === product.id) return true;
      return normalizeText(price.product_name) === normalizedProductName || normalizeText(price.product_category) === normalizedCategory;
    });
    return safeNumber(hit?.unit_cost, safeNumber(product.cost_price));
  }

  function supplierPriceForProduct(product: ProductRow | null) {
    if (!product) return null;
    const normalizedProductName = normalizeText(product.name || product.category);
    const normalizedCategory = normalizeText(product.category);
    return supplierPrices.find((price) => {
      if (product.id && price.product_id === product.id) return true;
      return normalizeText(price.product_name) === normalizedProductName || normalizeText(price.product_category) === normalizedCategory;
    }) ?? null;
  }

  function applyCustomer(customer: CustomerRow) {
    setCustomerId(customer.id);
    setCustomerName(customer.name ?? "");
    setPhone(customer.phone ?? "");
    setAddress(customer.address ?? "");
  }

  function onExistingCustomerSelect(value: string) {
    if (!value) {
      setCustomerId("");
      return;
    }

    const hit = customers.find((customer) => customer.id === value);
    if (hit) applyCustomer(hit);
  }

  function applyPreviousMeasurement(measurement: PreviousMeasurementRow) {
    if (measurement.address) setAddress(measurement.address);
    if (measurement.room_name) setRoomName(measurement.room_name);
    if (measurement.width_cm) setWidthCm(Number(measurement.width_cm));
    if (measurement.height_cm) setHeightCm(Number(measurement.height_cm));
    if (measurement.product_type) setProductType(normalizeProductType(measurement.product_type));
    if (measurement.model_name) setModelName(measurement.model_name);
    if (measurement.color_name) setColorName(measurement.color_name);
    if (measurement.quantity) setQty(Number(measurement.quantity));
    if (measurement.unit_price) setUnitPrice(Number(measurement.unit_price));
    if (measurement.measurement_notes) setNote(measurement.measurement_notes);
  }

  function onCatalogProductNameChange(name: string) {
    setSelectedProductName(name);
    const hit = supplierProductOptions.find((item) => normalizeText(item.name) === normalizeText(name));
    if (!hit) return;
    const nextType = normalizeProductType(hit.category);
    const linkedSupplierPrice = supplierPriceForProduct(hit);
    const nextSupplierId = supplierId || linkedSupplierPrice?.supplier_id || "";
    setProductType(nextType);
    setUnitPrice(safeNumber(hit.unit_price, PRODUCT_OPTIONS.find((item) => item.value === nextType)?.defaultPrice ?? unitPrice));
    if (nextSupplierId && nextSupplierId !== supplierId) setSupplierId(nextSupplierId);
    setSupplierCost(safeNumber(linkedSupplierPrice?.unit_cost, supplierCostFor(hit, nextSupplierId)));
    if (!modelName.trim()) setModelName(hit.name ?? "");
  }

  function onCatalogProductSelect(value: string) {
    if (!value) {
      setSelectedProductName("");
      return;
    }

    const hit = supplierProductOptions.find((item) => item.id === value);
    if (hit) onCatalogProductNameChange(hit.name || hit.category || "");
  }

  function onSupplierSelect(value: string) {
    setSupplierId(value);
    const selected = selectedProduct ?? supplierProductOptions.find((item) => normalizeText(item.name) === normalizeText(selectedProductName)) ?? null;
    const nextCost = supplierCostFor(selected, value);
    if (nextCost > 0) setSupplierCost(nextCost);
    if (value && selectedProductName) {
      const existsForSupplier = supplierPrices.some((price) =>
        price.supplier_id === value &&
        ((selected?.id && price.product_id === selected.id) || normalizeText(price.product_name) === normalizeText(selectedProductName))
      );
      if (!existsForSupplier) setSelectedProductName("");
    }
  }

  function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPhoto(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : "");
  }

  async function uploadPhoto(companyId: string) {
    if (!photo) return { url: null as string | null, warning: "" };
    const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${companyId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("measurement-photos").upload(path, photo, { upsert: false });
    if (uploadError) return { url: null, warning: `Fotoğraf kaydı atlandı: ${uploadError.message}` };
    const { data } = supabase.storage.from("measurement-photos").getPublicUrl(path);
    return { url: data.publicUrl, warning: "" };
  }

  async function createCustomerIfNeeded(companyId: string) {
    if (customerId) return customerId;
    if (!customerName.trim()) throw new Error("Müşteri adı zorunlu.");

    const basePayload = {
      company_id: companyId,
      name: customerName.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
    };

    let { data, error: insertError } = await supabase.from("customers").insert(basePayload).select("id").single();
    if (insertError && String(insertError.message || "").includes("address")) {
      const retryPayload = {
        company_id: companyId,
        name: customerName.trim(),
        phone: phone.trim() || null,
      };
      const retry = await supabase.from("customers").insert(retryPayload).select("id").single();
      data = retry.data;
      insertError = retry.error;
    }

    if (insertError) throw insertError;
    if (!data?.id) throw new Error("Müşteri oluşturulamadı.");
    setCustomerId(data.id);
    return data.id as string;
  }

  function measurementNote(photoUrl: string | null) {
    return [
      `[ÖLÇÜ] ${roomName || "Alan"} - ${productLabel(productType)}`,
      `En/Boy: ${widthCm}x${heightCm} cm`,
      `Yuvarlanan: ${result.roundedWidth}x${result.roundedHeight} cm`,
      `Adet: ${qty}`,
      `Hesaplanan m²: ${measuredAreaM2.toFixed(2)}`,
      `Maliyet fiyatı: ${formatMoney(supplierCost)} / m²`,
      `Satış fiyatı: ${formatMoney(unitPrice)} / m²`,
      `Toplam maliyet: ${formatMoney(totalCost)}`,
      `Toplam satış: ${formatMoney(totalSale)}`,
      `Kar: ${formatMoney(profit)}`,
      `Kar oranı: %${profitRate.toFixed(2)}`,
      `m²: ${result.areaM2.toFixed(2)}`,
      `Birim fiyat: ${formatMoney(unitPrice)}`,
      selectedProductName ? `Ürün: ${selectedProductName}` : null,
      supplierId ? `Tedarikçi: ${suppliers.find((item) => item.id === supplierId)?.name ?? supplierId}` : null,
      supplierCost > 0 ? `Tedarikçi maliyeti: ${formatMoney(supplierCost)}` : null,
      `Tahmini toplam: ${formatMoney(result.total)}`,
      modelName ? `Model: ${modelName}` : null,
      colorName ? `Renk/Kod: ${colorName}` : null,
      note ? `Not: ${note}` : null,
      photoUrl ? `Fotoğraf: ${photoUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function saveMeasurement() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const ctx = await getEffectiveTenantContext();
      if (ctx.readOnly) throw new Error("Firma lisansı aktif değil veya sadece okuma modunda. Yeni ölçü kaydı oluşturulamaz.");

      const cid = await createCustomerIfNeeded(ctx.company_id);
      const uploaded = await uploadPhoto(ctx.company_id);
      const notes = measurementNote(uploaded.url);
      const now = new Date().toISOString();

      const richPayload: Record<string, any> = {
        company_id: ctx.company_id,
        customer_id: cid,
        type: "measurement",
        title: `${productLabel(productType)} ölçüsü`,
        address: address.trim() || null,
        start_at: now,
        scheduled_at: now,
        status: "done",
        done: true,
        done_at: now,
        assigned_to: ctx.user.id,
        room_name: roomName.trim() || null,
        width_cm: widthCm,
        height_cm: heightCm,
        rounded_width_cm: result.roundedWidth,
        rounded_height_cm: result.roundedHeight,
        product_type: productType,
        model_name: modelName.trim() || null,
        color_name: colorName.trim() || null,
        quantity: qty,
        unit_price: unitPrice,
        estimated_area_m2: result.areaM2,
        estimated_total: result.total,
        measurement_notes: notes,
        measurement_photo_url: uploaded.url,
        note: notes,
      };

      let { data, error: insertError } = await supabase.from("appointments").insert(richPayload).select("id").single();

      if (insertError) {
        const fallbackPayload = {
          company_id: ctx.company_id,
          customer_id: cid,
          type: "measurement",
          title: `${productLabel(productType)} ölçüsü`,
          address: address.trim() || null,
          start_at: now,
          scheduled_at: now,
          status: "done",
          done: true,
          done_at: now,
          assigned_to: ctx.user.id,
          note: notes,
        };
        const retry = await supabase.from("appointments").insert(fallbackPayload).select("id").single();
        data = retry.data;
        insertError = retry.error;
      }

      if (insertError) throw insertError;

      setLastMeasurementId(data?.id ?? null);
      sessionStorage.removeItem(MEASUREMENT_DRAFT_KEY);
      setSuccess(uploaded.warning || "Ölçü kaydı oluşturuldu.");
      if (state.appointmentId) {
        await supabase
          .from("appointments")
          .update({ status: "done", done: true, done_at: now })
          .eq("id", state.appointmentId)
          .eq("company_id", ctx.company_id);
      }
    } catch (err: any) {
      setError(err?.message ?? "Ölçü kaydı oluşturulamadı.");
    } finally {
      setSaving(false);
    }
  }

  function convertToOrder() {
    navigate("/orders/new", {
      state: {
        fromAppointment: true,
        measurementId: lastMeasurementId,
        customerId,
        customerName,
        phone,
        address,
        measurementNotes: measurementNote(null),
        selectedProductType: productType,
        selectedCatalogPrice: unitPrice,
        selectedProductName,
        selectedSupplierId: supplierId,
        selectedSupplierCost: supplierCost,
        measurementAreaM2: measuredAreaM2,
        totalCost,
        totalSale,
        profit,
        profitRate,
        selectedModelName: modelName,
        selectedColorName: colorName,
        widthCm,
        heightCm,
        qty,
      },
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <button onClick={() => navigate(-1)} className="inline-flex w-fit min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
        <ArrowLeft className="h-4 w-4" />
        Geri
      </button>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-black text-primary-700 dark:bg-primary-950 dark:text-primary-300">
              <Ruler className="h-4 w-4" />
              Saha ölçü akışı
            </p>
            <h1 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">Ölçü Al</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ölçüyü kaydedin, tahmini fiyatı hesaplayın ve gerektiğinde teklife dönüştürün.</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-950">
            <div className="font-black text-slate-950 dark:text-white">{formatMoney(totalSale)}</div>
            <div className="text-slate-500">{result.areaM2.toFixed(2)} m² / {result.roundedWidth}x{result.roundedHeight} cm</div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div> : null}

      <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Müşteri adı</span>
              <select value={customerId} onChange={(event) => onExistingCustomerSelect(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-primary-200 bg-primary-50 px-4 text-sm font-black text-slate-900 outline-none focus:border-primary-500 dark:border-primary-900 dark:bg-primary-950/30 dark:text-white">
                <option value="">Mevcut müşteri seç</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {[item.name, item.phone, item.address].filter(Boolean).join(" - ")}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs font-bold text-slate-500">
                {customers.length === 0 ? "Kayıtlı müşteri bulunamadı; yeni müşteri yazabilirsiniz." : customerId ? "Mevcut müşteri seçildi; telefon ve adres otomatik dolduruldu." : "Üstten mevcut müşteriyi seçin veya yeni müşteri adı yazın."}
              </div>
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Adres / konum notu</span>
              <input value={address} onChange={(event) => setAddress(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="Mahalle, sokak, bina veya konum açıklaması" />
            </label>
            {customerId && previousMeasurements.length > 0 ? (
              <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Önceki Ölçüler</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {previousMeasurements.map((measurement) => (
                    <button key={measurement.id} type="button" onClick={() => applyPreviousMeasurement(measurement)} className="rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-bold hover:border-primary-300 dark:border-slate-800 dark:bg-slate-900">
                      <div className="text-slate-900 dark:text-white">{measurement.start_at ? new Date(measurement.start_at).toLocaleDateString("tr-TR") : "Tarihsiz"} - {measurement.room_name || "Alan"}</div>
                      <div className="mt-1 text-slate-500">{measurement.width_cm || "-"} x {measurement.height_cm || "-"} cm / {measurement.product_type || "Ürün"}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Telefon</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="05xx..." />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Oda / alan adı</span>
              <input value={roomName} onChange={(event) => setRoomName(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="Salon, mutfak..." />
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Ürün / model seç</span>
              <select value={supplierProductOptions.find((item) => normalizeText(item.name) === normalizeText(selectedProductName))?.id ?? ""} onChange={(event) => onCatalogProductSelect(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-primary-200 bg-primary-50 px-4 text-sm font-black text-slate-900 outline-none focus:border-primary-500 dark:border-primary-900 dark:bg-primary-950/30 dark:text-white">
                <option value="">Ürün/model seç</option>
                {supplierProductOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {[item.name, productLabel(normalizeProductType(item.category)), item.cost_price ? `Maliyet ${formatMoney(Number(item.cost_price))}` : null].filter(Boolean).join(" - ")}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs font-bold text-slate-500">
                {supplierId ? "Seçilen tedarikçiye ait ürünler listelenir." : "Önce tedarikçi seçerseniz o tedarikçinin ürünleri listelenir."}
              </div>
            </label>

            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">En cm</span>
              <input type="number" min={1} value={widthCm} onChange={(event) => setWidthCm(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Boy cm</span>
              <input type="number" min={1} value={heightCm} onChange={(event) => setHeightCm(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Ürün tipi</span>
              <select value={productType} onChange={(event) => onProductChange(event.target.value as ProductType)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950">
                {PRODUCT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Adet</span>
              <input type="number" min={1} value={qty} onChange={(event) => setQty(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            {(productType === "tul" || productType === "fon") ? (
              <label>
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Pile</span>
                <select value={pile} onChange={(event) => setPile(event.target.value as "2" | "3")} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950">
                  <option value="2">1'e 2</option>
                  <option value="3">1'e 3</option>
                </select>
              </label>
            ) : null}
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Model</span>
              <input value={modelName} onChange={(event) => setModelName(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="Model/kartela adı" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Renk / kod</span>
              <input value={colorName} onChange={(event) => setColorName(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="Renk veya ürün kodu" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Satış fiyatı / m²</span>
              <input type="number" min={0} value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Tedarikçi</span>
              <select value={supplierId} onChange={(event) => onSupplierSelect(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950">
                <option value="">Seçilmedi</option>
                {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name || "Tedarikçi"}</option>)}
              </select>
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Tedarikçi maliyeti</span>
              <input type="number" min={0} value={supplierCost} onChange={(event) => setSupplierCost(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Fotoğraf ekle</span>
              <span className="mt-2 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                <Camera className="h-4 w-4" />
                Kamera / Galeri
                <input type="file" accept="image/*" capture="environment" onChange={onPhotoChange} className="hidden" />
              </span>
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Not</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="Montaj detayı, müşteri talebi, özel ölçü notu..." />
            </label>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <div className="flex items-center gap-2 text-sm font-black text-emerald-900 dark:text-emerald-100">
              <Calculator className="h-5 w-5" />
              Maliyet / Satış Özeti
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt>M²</dt><dd className="font-black">{measuredAreaM2.toFixed(2)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Toplam Maliyet</dt><dd className="font-black">{formatMoney(totalCost)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Toplam Satış</dt><dd className="font-black">{formatMoney(totalSale)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Kar</dt><dd className={`font-black ${profit >= 0 ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-300"}`}>{formatMoney(profit)}</dd></div>
              <div className="flex justify-between gap-4 border-t border-emerald-200 pt-3 dark:border-emerald-900"><dt>Kar Oranı</dt><dd className="font-black">%{profitRate.toFixed(2)}</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
              <Calculator className="h-5 w-5 text-primary-600" />
              Tahmini fiyat
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt>Yuvarlanan en</dt><dd className="font-bold">{result.roundedWidth} cm</dd></div>
              <div className="flex justify-between gap-4"><dt>Yuvarlanan boy</dt><dd className="font-bold">{result.roundedHeight} cm</dd></div>
              <div className="flex justify-between gap-4"><dt>m²</dt><dd className="font-bold">{result.areaM2.toFixed(2)}</dd></div>
              <div className="flex justify-between gap-4 border-t border-slate-100 pt-3 text-base dark:border-slate-800"><dt>Toplam</dt><dd className="font-black">{formatMoney(result.total)}</dd></div>
            </dl>
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Stor perde için minimum 100x200 cm uygulanır. Tüm ölçüler 10 cm yukarı yuvarlanır.</p>
          </div>

          {photoPreview ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <img src={photoPreview} alt="Ölçü fotoğrafı" className="aspect-[4/3] w-full rounded-xl object-cover" />
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              <span><ImagePlus className="mx-auto mb-2 h-7 w-7" />Fotoğraf eklendiğinde burada görünür.</span>
            </div>
          )}

          <button
            onClick={() => navigate("/visual-previews", {
              state: {
                appointmentId: state.appointmentId,
                customerId,
                customerName,
                phone,
                address,
                selectedProductType: productType,
                selectedModelName: modelName,
                selectedColorName: colorName,
                selectedCatalogPrice: unitPrice,
                widthCm,
                heightCm,
                qty,
                photoFile: photo,
                measurementNotes: measurementNote(null),
              },
            })}
            disabled={!customerId && !customerName.trim()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-primary-200 px-5 text-sm font-black text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-900 dark:text-primary-300"
          >
            <ImagePlus className="h-5 w-5" />
            Karteladan Önizleme Yap
          </button>

          <button onClick={saveMeasurement} disabled={saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60">
            <Save className="h-5 w-5" />
            {saving ? "Kaydediliyor..." : "Ölçüyü Kaydet"}
          </button>
          <button onClick={convertToOrder} disabled={!customerId && !customerName.trim()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-primary-200 px-5 text-sm font-black text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-900 dark:text-primary-300">
            <FilePlus2 className="h-5 w-5" />
            Teklife / Siparişe Dönüştür
          </button>
          {!customerId ? (
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950">
              <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
              Yeni müşteri yazarsanız kayıt sırasında otomatik müşteri kartı oluşturulur.
            </p>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
