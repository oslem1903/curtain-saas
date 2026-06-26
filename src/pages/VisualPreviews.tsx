import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  Eye,
  Maximize2,
  RefreshCw,
  Save,
  ShoppingCart,
  Upload,
  X,
} from "lucide-react";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type ProductType = "stor" | "zebra" | "tul" | "fon" | "jalousie";

type CatalogSeries = {
  id: string;
  company_id: string | null;
  product_type: ProductType | null;
  code?: string | null;
  series_code?: string | null;
  model_name: string | null;
  is_active: boolean | null;
  isFallback?: boolean;
};

type CatalogVariant = {
  id: string;
  company_id: string | null;
  series_id: string | null;
  variant_code: string | null;
  color_name?: string | null;
  variant_image_url?: string | null;
  texture_image_url?: string | null;
  price_per_m2: number | null;
  is_active: boolean | null;
  colorHex?: string;
  isFallback?: boolean;
};

type AppointmentOption = {
  id: string;
  customer_id: string | null;
  address: string | null;
  start_at: string | null;
  customer?: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
};

type CustomerOption = {
  id: string;
  name: string | null;
  phone: string | null;
};

type AreaPoint = {
  x: number;
  y: number;
};

const PRODUCT_TYPES: Array<{ value: ProductType; label: string }> = [
  { value: "stor", label: "Stor" },
  { value: "zebra", label: "Zebra" },
  { value: "tul", label: "Tül" },
  { value: "fon", label: "Fon" },
  { value: "jalousie", label: "Jaluzi" },
];

function normalizePreviewProductType(value?: string | null): ProductType {
  return PRODUCT_TYPES.some((item) => item.value === value) ? value as ProductType : "stor";
}

const FALLBACK_SERIES: CatalogSeries[] = [
  { id: "preset-stor-rs2000", company_id: null, product_type: "stor", series_code: "RS 2000", model_name: "Sedefli Stor", is_active: true, isFallback: true },
  { id: "preset-zebra-zr140", company_id: null, product_type: "zebra", series_code: "ZR 140", model_name: "Modern Zebra", is_active: true, isFallback: true },
  { id: "preset-tul-tl700", company_id: null, product_type: "tul", series_code: "TL 700", model_name: "İnce Tül", is_active: true, isFallback: true },
  { id: "preset-fon-fn330", company_id: null, product_type: "fon", series_code: "FN 330", model_name: "Fon Perde", is_active: true, isFallback: true },
  { id: "preset-jalousie-jl90", company_id: null, product_type: "jalousie", series_code: "JL 90", model_name: "Alüminyum Jaluzi", is_active: true, isFallback: true },
];

const FALLBACK_VARIANTS: CatalogVariant[] = [
  { id: "preset-stor-rs2000-sedef", company_id: null, series_id: "preset-stor-rs2000", variant_code: "SDF-01", color_name: "Sedef Beyaz", colorHex: "#f7f3e8", price_per_m2: 650, is_active: true, isFallback: true },
  { id: "preset-stor-rs2000-kum", company_id: null, series_id: "preset-stor-rs2000", variant_code: "KUM-12", color_name: "Kum Beji", colorHex: "#c7b28a", price_per_m2: 690, is_active: true, isFallback: true },
  { id: "preset-stor-rs2000-antrasit", company_id: null, series_id: "preset-stor-rs2000", variant_code: "ANT-30", color_name: "Antrasit", colorHex: "#4b5563", price_per_m2: 720, is_active: true, isFallback: true },
  { id: "preset-zebra-zr140-ekru", company_id: null, series_id: "preset-zebra-zr140", variant_code: "EKR-05", color_name: "Ekru Zebra", colorHex: "#eee3cf", price_per_m2: 850, is_active: true, isFallback: true },
  { id: "preset-zebra-zr140-gri", company_id: null, series_id: "preset-zebra-zr140", variant_code: "GRI-18", color_name: "Gri Zebra", colorHex: "#9ca3af", price_per_m2: 890, is_active: true, isFallback: true },
  { id: "preset-tul-tl700-beyaz", company_id: null, series_id: "preset-tul-tl700", variant_code: "BYZ-01", color_name: "Kırık Beyaz", colorHex: "#ffffff", price_per_m2: 420, is_active: true, isFallback: true },
  { id: "preset-tul-tl700-gumus", company_id: null, series_id: "preset-tul-tl700", variant_code: "GMS-10", color_name: "Gümüş Tül", colorHex: "#d1d5db", price_per_m2: 460, is_active: true, isFallback: true },
  { id: "preset-fon-fn330-lacivert", company_id: null, series_id: "preset-fon-fn330", variant_code: "LCV-22", color_name: "Lacivert Fon", colorHex: "#1e3a5f", price_per_m2: 520, is_active: true, isFallback: true },
  { id: "preset-fon-fn330-yesil", company_id: null, series_id: "preset-fon-fn330", variant_code: "YSL-17", color_name: "Zeytin Yeşili", colorHex: "#6b7f4b", price_per_m2: 540, is_active: true, isFallback: true },
  { id: "preset-jalousie-jl90-gumus", company_id: null, series_id: "preset-jalousie-jl90", variant_code: "ALM-01", color_name: "Mat Gümüş", colorHex: "#cbd5e1", price_per_m2: 950, is_active: true, isFallback: true },
  { id: "preset-jalousie-jl90-siyah", company_id: null, series_id: "preset-jalousie-jl90", variant_code: "SYH-09", color_name: "Siyah", colorHex: "#1f2937", price_per_m2: 990, is_active: true, isFallback: true },
];

const SERIES_SELECT = "id, company_id, product_type, code, series_code, model_name, is_active";
const VARIANT_SELECT = "id, company_id, series_id, variant_code, color_name, variant_image_url, texture_image_url, price_per_m2, is_active";

function safeNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatTL(value: number | null | undefined) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(safeNumber(value));
}

function seriesCode(row: CatalogSeries | null | undefined) {
  return row?.code || row?.series_code || "";
}

function variantTexture(row: CatalogVariant | null | undefined) {
  return row?.texture_image_url || row?.variant_image_url || "";
}

function customerOf(appt: AppointmentOption) {
  return Array.isArray(appt.customer) ? appt.customer[0] ?? null : appt.customer ?? null;
}

function extFromFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : "jpg";
}

function colorFromText(text: string) {
  const palette = ["#f7f3e8", "#c7b28a", "#9ca3af", "#64748b", "#8b5e34", "#7f1d1d", "#1e3a5f", "#6b7f4b"];
  let sum = 0;
  for (const char of text) sum += char.charCodeAt(0);
  return palette[sum % palette.length];
}

function fallbackVariantsForSeries(series: CatalogSeries | null, productType: ProductType) {
  const sourceSeriesId = FALLBACK_SERIES.find((item) => item.product_type === productType)?.id;
  return FALLBACK_VARIANTS
    .filter((item) => item.series_id === sourceSeriesId)
    .map((item) => ({
      ...item,
      id: `${series?.id || productType}-${item.id}`,
      series_id: series?.id || item.series_id,
    }));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function clipArea(ctx: CanvasRenderingContext2D, points: AreaPoint[], width: number, height: number) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = (point.x / 100) * width;
    const y = (point.y / 100) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
}

function areaBounds(points: AreaPoint[], width: number, height: number) {
  const xs = points.map((point) => (point.x / 100) * width);
  const ys = points.map((point) => (point.y / 100) * height);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function drawFabricOverlay(
  ctx: CanvasRenderingContext2D,
  points: AreaPoint[],
  width: number,
  height: number,
  product: ProductType,
  colorHex: string,
  texture?: HTMLImageElement | null,
) {
  const rgb = hexToRgb(colorHex);
  const box = areaBounds(points, width, height);

  ctx.save();
  clipArea(ctx, points, width, height);

  const hasExactTexture = Boolean(texture && texture.complete && texture.naturalWidth > 0);
  const baseAlpha = hasExactTexture ? (product === "tul" ? 0.24 : 0.18) : product === "tul" ? 0.48 : product === "fon" ? 0.82 : 0.72;
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.fillRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);

  if (hasExactTexture && texture) {
    const pattern = ctx.createPattern(texture, "repeat");
    if (pattern) {
      ctx.globalAlpha = product === "tul" ? 0.74 : 0.92;
      ctx.fillStyle = pattern;
      ctx.fillRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
    }
  }

  ctx.globalAlpha = 1;
  if (product === "stor") {
    const gradient = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.height);
    gradient.addColorStop(0, `rgba(255,255,255,0.35)`);
    gradient.addColorStop(0.18, `rgba(${rgb.r},${rgb.g},${rgb.b},0.78)`);
    gradient.addColorStop(1, `rgba(${Math.max(0, rgb.r - 30)},${Math.max(0, rgb.g - 30)},${Math.max(0, rgb.b - 30)},0.86)`);
    ctx.fillStyle = gradient;
      if (!hasExactTexture) ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = "rgba(30, 41, 59, 0.72)";
    ctx.fillRect(box.x - 6, box.y - 9, box.width + 12, Math.max(7, box.height * 0.025));
    ctx.fillStyle = "rgba(15, 23, 42, 0.48)";
    ctx.fillRect(box.x + 8, box.y + box.height - 8, Math.max(12, box.width - 16), 7);
  }

  if (product === "zebra") {
    for (let y = box.y; y < box.y + box.height; y += Math.max(18, box.height / 12)) {
      ctx.fillStyle = `rgba(255,255,255,0.42)`;
      ctx.fillRect(box.x, y, box.width, Math.max(8, box.height / 38));
      ctx.fillStyle = `rgba(15,23,42,0.16)`;
      ctx.fillRect(box.x, y + Math.max(8, box.height / 38), box.width, 3);
    }
  }

  if (product === "tul" || product === "fon") {
    const foldCount = product === "tul" ? 12 : 8;
    for (let i = 0; i <= foldCount; i += 1) {
      const x = box.x + (box.width / foldCount) * i;
      const fold = ctx.createLinearGradient(x - 10, box.y, x + 10, box.y);
      fold.addColorStop(0, "rgba(255,255,255,0)");
      fold.addColorStop(0.5, product === "tul" ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.18)");
      fold.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = fold;
      ctx.fillRect(x - 10, box.y, 20, box.height);
    }
    ctx.fillStyle = product === "tul" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";
    ctx.fillRect(box.x, box.y, box.width, Math.max(5, box.height * 0.02));
  }

  if (product === "jalousie") {
    const slat = Math.max(12, box.height / 18);
    for (let y = box.y; y < box.y + box.height; y += slat) {
      const grad = ctx.createLinearGradient(box.x, y, box.x, y + slat);
      grad.addColorStop(0, "rgba(255,255,255,0.42)");
      grad.addColorStop(0.45, `rgba(${rgb.r},${rgb.g},${rgb.b},0.88)`);
      grad.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = grad;
      ctx.fillRect(box.x, y, box.width, slat * 0.78);
      ctx.fillStyle = "rgba(15,23,42,0.22)";
      ctx.fillRect(box.x, y + slat * 0.78, box.width, 2);
    }
  }

  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.58)";
  ctx.lineWidth = Math.max(2, width * 0.002);
  ctx.shadowColor = "rgba(15,23,42,0.35)";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = (point.x / 100) * width;
    const y = (point.y / 100) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawMountingDetails(
  ctx: CanvasRenderingContext2D,
  points: AreaPoint[],
  width: number,
  height: number,
  product: ProductType,
) {
  const px = points.map((point) => ({
    x: (point.x / 100) * width,
    y: (point.y / 100) * height,
  }));
  const railWidth = Math.max(6, width * 0.008);
  const bottomWidth = Math.max(4, width * 0.005);
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.28)";
  ctx.shadowBlur = Math.max(10, width * 0.01);
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = Math.max(2, width * 0.002);
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = (point.x / 100) * width;
    const y = (point.y / 100) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = product === "fon" ? "rgba(30,41,59,0.76)" : "rgba(248,250,252,0.9)";
  ctx.lineWidth = railWidth;
  ctx.beginPath();
  ctx.moveTo(px[0].x, px[0].y);
  ctx.lineTo(px[1].x, px[1].y);
  ctx.stroke();

  if (product === "stor" || product === "zebra") {
    ctx.strokeStyle = "rgba(15,23,42,0.46)";
    ctx.lineWidth = bottomWidth;
    ctx.beginPath();
    ctx.moveTo(px[3].x, px[3].y);
    ctx.lineTo(px[2].x, px[2].y);
    ctx.stroke();
  }

  if (product === "fon") {
    ctx.fillStyle = "rgba(15,23,42,0.58)";
    const ringCount = 12;
    for (let i = 0; i <= ringCount; i += 1) {
      const t = i / ringCount;
      const x = px[0].x + (px[1].x - px[0].x) * t;
      const y = px[0].y + (px[1].y - px[0].y) * t;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, width * 0.004), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export default function VisualPreviews() {
  const nav = useNavigate();
  const location = useLocation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const textureRef = useRef<HTMLImageElement | null>(null);
  const mediaFrameRef = useRef<HTMLDivElement | null>(null);

  const state = (location.state ?? {}) as {
    appointmentId?: string;
    customerId?: string;
    customerName?: string;
    phone?: string;
    address?: string;
    measurementNotes?: string;
    selectedProductType?: ProductType;
    selectedModelName?: string;
    selectedVariantCode?: string;
    selectedColorName?: string;
    selectedCatalogPrice?: number;
    widthCm?: number;
    heightCm?: number;
    qty?: number;
    photoFile?: File | null;
  };

  const [companyId, setCompanyId] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [variantLoading, setVariantLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [dbSeries, setDbSeries] = useState<CatalogSeries[]>([]);
  const [dbVariants, setDbVariants] = useState<CatalogVariant[]>([]);
  const [appointments, setAppointments] = useState<AppointmentOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [appointmentId, setAppointmentId] = useState(state.appointmentId ?? "");
  const [customerId, setCustomerId] = useState(state.customerId ?? "");
  const [productType, setProductType] = useState<ProductType>(normalizePreviewProductType(state.selectedProductType));
  const [seriesId, setSeriesId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(state.photoFile ?? null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [textureFile, setTextureFile] = useState<File | null>(null);
  const [capturedTextureUrl, setCapturedTextureUrl] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [savedPreviewId, setSavedPreviewId] = useState("");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [areaEditing, setAreaEditing] = useState(false);
  const [dragPoint, setDragPoint] = useState<number | null>(null);
  const [areaPoints, setAreaPoints] = useState<AreaPoint[]>([
    { x: 16, y: 14 },
    { x: 84, y: 14 },
    { x: 84, y: 86 },
    { x: 16, y: 86 },
  ]);

  useEffect(() => {
    let alive = true;
    async function loadData() {
      setLoading(true);
      setErr("");
      try {
        const ctx = await getEffectiveTenantContext();
        if (!alive) return;
        setCompanyId(ctx.company_id);
        setUserId(ctx.user.id);
        const [seriesRes, appointmentRes, customerRes] = await Promise.all([
          supabase.from("catalog_series").select(SERIES_SELECT).eq("company_id", ctx.company_id).eq("is_active", true).order("code"),
          supabase.from("appointments").select("id, customer_id, address, start_at, customer:customers(name, phone)").eq("company_id", ctx.company_id).eq("type", "measurement").order("start_at", { ascending: false }).limit(100),
          supabase.from("customers").select("id, name, phone").eq("company_id", ctx.company_id).order("name", { ascending: true }).limit(1000),
        ]);
        if (seriesRes.error) throw seriesRes.error;
        if (appointmentRes.error) throw appointmentRes.error;
        if (customerRes.error) throw customerRes.error;
        if (!alive) return;
        setDbSeries((seriesRes.data ?? []).filter((row: any) => PRODUCT_TYPES.some((item) => item.value === row.product_type)) as CatalogSeries[]);
        setAppointments((appointmentRes.data ?? []) as AppointmentOption[]);
        setCustomers((customerRes.data ?? []) as CustomerOption[]);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? "Veriler yüklenemedi.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void loadData();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!appointmentId) return;
    const appt = appointments.find((item) => item.id === appointmentId);
    if (appt?.customer_id) setCustomerId(appt.customer_id);
  }, [appointmentId, appointments]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile]);

  useEffect(() => {
    if (!textureFile) {
      setCapturedTextureUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(textureFile);
    setCapturedTextureUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [textureFile]);

  const seriesList = useMemo(() => {
    const hasDbForType = dbSeries.some((item) => item.product_type === productType);
    return hasDbForType ? dbSeries : FALLBACK_SERIES;
  }, [dbSeries, productType]);

  const productSeries = useMemo(() => seriesList.filter((item) => item.product_type === productType), [seriesList, productType]);
  const selectedSeries = useMemo(() => seriesList.find((item) => item.id === seriesId) ?? null, [seriesList, seriesId]);
  const variants = useMemo(() => {
    if (!seriesId) return [];
    return dbVariants.length > 0 ? dbVariants : fallbackVariantsForSeries(selectedSeries, productType);
  }, [dbVariants, productType, selectedSeries, seriesId]);
  const selectedVariant = useMemo(() => variants.find((item) => item.id === selectedVariantId) ?? null, [variants, selectedVariantId]);
  const selectedColor = selectedVariant?.colorHex || colorFromText(`${selectedVariant?.variant_code ?? ""}${selectedVariant?.color_name ?? ""}`);
  const selectedTextureUrl = variantTexture(selectedVariant);
  const effectiveTextureUrl = selectedTextureUrl || capturedTextureUrl;
  const hasExactTexture = Boolean(effectiveTextureUrl);
  const exactTextureSource = selectedTextureUrl ? "catalog" : capturedTextureUrl ? "captured" : "";

  useEffect(() => {
    const requestedModel = state.selectedModelName?.trim().toLocaleLowerCase("tr-TR");
    const firstSeries = requestedModel
      ? productSeries.find((item) => `${seriesCode(item)} ${item.model_name ?? ""}`.toLocaleLowerCase("tr-TR").includes(requestedModel))
      : productSeries[0];
    setSeriesId(firstSeries?.id ?? "");
    setSelectedVariantId("");
    setDbVariants([]);
    setPreviewRequested(false);
    setPreviewDataUrl("");
    setSavedPreviewId("");
    setTextureFile(null);
  }, [productSeries, state.selectedModelName]);

  useEffect(() => {
    let alive = true;
    async function loadVariants() {
      setDbVariants([]);
      setSelectedVariantId("");
      setPreviewRequested(false);
      setPreviewDataUrl("");
      setSavedPreviewId("");
      if (!companyId || !seriesId || seriesId.startsWith("preset-")) return;
      setVariantLoading(true);
      setErr("");
      try {
        let { data, error } = await supabase
          .from("catalog_variants")
          .select(VARIANT_SELECT)
          .eq("company_id", companyId)
          .eq("series_id", seriesId)
          .eq("is_active", true)
          .order("variant_code", { ascending: true });
        if (error && String(error.message || "").includes("color_name")) {
          const retry = await supabase
            .from("catalog_variants")
            .select("id, company_id, series_id, variant_code, variant_image_url, texture_image_url, price_per_m2, is_active")
            .eq("company_id", companyId)
            .eq("series_id", seriesId)
            .eq("is_active", true)
            .order("variant_code", { ascending: true });
          data = retry.data as any;
          error = retry.error;
        }
        if (error) throw error;
        if (alive) setDbVariants((data ?? []) as CatalogVariant[]);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? "Varyantlar yüklenemedi.");
      } finally {
        if (alive) setVariantLoading(false);
      }
    }
    void loadVariants();
    return () => {
      alive = false;
    };
  }, [companyId, seriesId]);

  useEffect(() => {
    if (variants.length > 0 && !selectedVariantId) {
      const requestedVariant = `${state.selectedVariantCode ?? ""} ${state.selectedColorName ?? ""}`.trim().toLocaleLowerCase("tr-TR");
      const firstVariant = requestedVariant
        ? variants.find((item) => `${item.variant_code ?? ""} ${item.color_name ?? ""}`.toLocaleLowerCase("tr-TR").includes(requestedVariant))
        : variants[0];
      setSelectedVariantId((firstVariant ?? variants[0]).id);
    }
  }, [selectedVariantId, state.selectedColorName, state.selectedVariantCode, variants]);

  useEffect(() => {
    if (photoUrl && selectedVariant && hasExactTexture) {
      setPreviewRequested(true);
      window.setTimeout(drawPreview, 0);
    } else {
      setPreviewDataUrl("");
      setSavedPreviewId("");
    }
  // drawPreview reads canvas/image refs and the currently selected memoized variant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUrl, selectedVariantId, selectedColor, areaPoints, productType, hasExactTexture]);

  function resetArea() {
    setAreaPoints([
      { x: 16, y: 14 },
      { x: 84, y: 14 },
      { x: 84, y: 86 },
      { x: 16, y: 86 },
    ]);
    setSavedPreviewId("");
  }

  function startAreaSelection() {
    if (!photoUrl) {
      setErr("Önce fotoğraf yükleyin.");
      return;
    }
    setErr("");
    setSavedPreviewId("");
    setAreaEditing(true);
  }

  function updatePointFromPointer(index: number, clientX: number, clientY: number) {
    const el = photoRef.current ?? mediaFrameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nextX = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const nextY = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    setAreaPoints((prev) => {
      const next = prev.map((point, pointIndex) => (
        pointIndex === index ? { x: Math.round(nextX * 10) / 10, y: Math.round(nextY * 10) / 10 } : point
      ));
      window.requestAnimationFrame(() => drawPreview(next));
      return next;
    });
    setSavedPreviewId("");
  }

  function drawPreview(pointsToDraw = areaPoints) {
    const canvas = canvasRef.current;
    const photo = photoRef.current;
    if (!canvas || !photo || !photoUrl || !selectedVariant) return;
    if (!photo.complete || photo.naturalWidth === 0) return;
    if (!effectiveTextureUrl) {
      setPreviewDataUrl("");
      return;
    }

    const rect = photo.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.round(rect.width || photo.clientWidth || photo.naturalWidth));
    const displayHeight = Math.max(1, Math.round(rect.height || photo.clientHeight || photo.naturalHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(displayWidth * dpr);
    const height = Math.round(displayHeight * dpr);
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(photo, 0, 0, width, height);
    const textureImage = textureRef.current;
    const hasRealTexture = Boolean(textureImage && textureImage.complete && textureImage.naturalWidth > 0);
    const realTexture = hasRealTexture ? textureImage as HTMLImageElement : null;
    if (!realTexture) return;

    drawFabricOverlay(ctx, pointsToDraw, width, height, productType, selectedColor, realTexture);
    drawMountingDetails(ctx, pointsToDraw, width, height, productType);
    try {
      setPreviewDataUrl(canvas.toDataURL("image/jpeg", 0.92));
    } catch {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(photo, 0, 0, width, height);
      setPreviewDataUrl("");
      setErr("Kartela gorseli tarayici tarafindan okunamadi. Kartela fotografini yeniden cekip yukleyin.");
    }
  }

  function handleMakePreview() {
    setErr("");
    if (!selectedSeries) return setErr("Kod/model seçin.");
    if (!selectedVariant) return setErr("Renk/kod seçin.");
    if (!photoFile) return setErr("Fotoğraf yükleyin.");
    if (!hasExactTexture) return setErr("Bu urunde gercek kartela/doku gorseli yok. Bu ekrandan kartela fotografi cekip yukleyin veya Katalog Yonetimi'nden varyant gorseli ekleyin.");
    setAreaEditing(false);
    setPreviewRequested(true);
    window.setTimeout(drawPreview, 0);
  }

  async function uploadBlob(path: string, blob: Blob) {
    const { error } = await supabase.storage.from("visual-previews").upload(path, blob, { cacheControl: "3600", upsert: true, contentType: blob.type || "image/jpeg" });
    if (error) throw error;
    const { data } = supabase.storage.from("visual-previews").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSavePreview() {
    setErr("");
    setSuccess("");
    if (!companyId) return setErr("Şirket bilgisi yüklenemedi.");
    if (!photoFile) return setErr("Fotoğraf yükleyin.");
    if (!selectedSeries) return setErr("Kod/model seçin.");
    if (!selectedVariant) return setErr("Renk/kod seçin.");
    if (!hasExactTexture) return setErr("Gercek kartela/doku gorseli olmayan urun icin müşteri onizlemesi kaydedilemez.");
    if (!previewDataUrl) return setErr("Önce önizleme yapın.");
    setSaving(true);
    try {
      const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const originalPath = `${companyId}/original-${stamp}.${extFromFile(photoFile)}`;
      const previewPath = `${companyId}/preview-${stamp}.jpg`;
      const previewBlob = await (await fetch(previewDataUrl)).blob();
      const [originalPhotoUrl, previewImageUrl, uploadedTextureUrl] = await Promise.all([
        uploadBlob(originalPath, photoFile),
        uploadBlob(previewPath, previewBlob),
        textureFile ? uploadBlob(`${companyId}/texture-${stamp}.${extFromFile(textureFile)}`, textureFile) : Promise.resolve(selectedTextureUrl),
      ]);
      const payload = {
        company_id: companyId,
        appointment_id: appointmentId || null,
        customer_id: customerId || null,
        original_photo_url: originalPhotoUrl,
        selected_catalog_variant_id: selectedVariant.isFallback ? null : selectedVariant.id,
        preview_image_url: previewImageUrl,
        product_type: selectedSeries.product_type,
        model_code: seriesCode(selectedSeries),
        variant_code: selectedVariant.variant_code,
        preview_texture_url: uploadedTextureUrl,
        note: `${seriesCode(selectedSeries)} ${selectedSeries.model_name || ""} ${selectedVariant.variant_code || ""}`.trim() || null,
        created_by: userId || null,
      };

      let { data, error } = await supabase.from("visual_previews").insert([payload]).select("id").single();
      if (error && /(selected_catalog_variant_id|preview_texture_url|model_code|variant_code|created_by)/i.test(error.message || "")) {
        const retry = await supabase.from("visual_previews").insert([{
          company_id: payload.company_id,
          appointment_id: payload.appointment_id,
          customer_id: payload.customer_id,
          original_photo_url: payload.original_photo_url,
          preview_image_url: payload.preview_image_url,
          product_type: payload.product_type,
          note: payload.note,
        }]).select("id").single();
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;
      if (!data?.id) throw new Error("Önizleme kaydı oluşturulamadı.");
      setSavedPreviewId(data.id as string);
      setSuccess("Önizleme kaydedildi.");
    } catch (e: any) {
      setErr(e?.message ?? "Önizleme kaydedilemedi. SQL migration ve visual-previews storage bucket kontrol edilmeli.");
    } finally {
      setSaving(false);
    }
  }

  function transferToOrder() {
    if (!savedPreviewId || !selectedSeries || !selectedVariant) return setErr("Siparişe aktarmadan önce önizlemeyi kaydedin.");
    const customer = customers.find((item) => item.id === customerId);
    const appt = appointments.find((item) => item.id === appointmentId);
    nav("/orders/new", {
      state: {
        fromAppointment: Boolean(appointmentId),
        appointmentId,
        customerId,
        customerName: customer?.name || state.customerName,
        phone: customer?.phone || state.phone,
        address: appt?.address || state.address,
        measurementNotes: state.measurementNotes,
        visualPreviewId: savedPreviewId,
        selectedCatalogVariantId: selectedVariant.isFallback ? null : selectedVariant.id,
        selectedCatalogName: `${seriesCode(selectedSeries)} ${selectedSeries.model_name || ""} ${selectedVariant.variant_code || ""}`.trim(),
        selectedProductType: selectedSeries.product_type,
        selectedSeriesCode: seriesCode(selectedSeries),
        selectedModelName: selectedSeries.model_name,
        selectedVariantCode: selectedVariant.variant_code,
        selectedColorName: selectedVariant.color_name,
        selectedTextureUrl: effectiveTextureUrl,
        selectedCatalogPrice: safeNumber(selectedVariant.price_per_m2),
        widthCm: state.widthCm,
        heightCm: state.heightCm,
        qty: state.qty,
      },
    });
  }

  const selectedTitle = selectedSeries && selectedVariant
    ? `${seriesCode(selectedSeries)} ${selectedSeries.model_name || ""} / ${selectedVariant.color_name || selectedVariant.variant_code || ""}`.trim()
    : "Kartela seçilmedi";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => nav(-1)} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
            <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">Kartela Önizleme</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Kartela ürününü müşteri fotoğrafındaki pencere/cam alanına uygulayın.</p>
          </div>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          Yenile
        </button>
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{err}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{success}</div> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Randevu
              <select value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
                <option value="">Randevusuz</option>
                {appointments.map((appt) => {
                  const customer = customerOf(appt);
                  const date = appt.start_at ? new Date(appt.start_at).toLocaleDateString("tr-TR") : "";
                  return <option key={appt.id} value={appt.id}>{customer?.name || "İsimsiz"} {date ? `- ${date}` : ""}</option>;
                })}
              </select>
            </label>
            <label className="text-sm font-medium">
              Müşteri
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
                <option value="">Müşteri seç</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || "İsimsiz"}</option>)}
              </select>
            </label>
          </div>

          <label className="text-sm font-medium">
            1. Ürün tipi
            <select value={productType} onChange={(e) => setProductType(e.target.value as ProductType)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              {PRODUCT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>

          <label className="text-sm font-medium">
            2. Kartela / model
            <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              {productSeries.map((item) => <option key={item.id} value={item.id}>{seriesCode(item)} {item.model_name}</option>)}
            </select>
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-black">3. Renk / kod</div>
              <div className="text-xs text-slate-500">{variants.length} seçenek</div>
            </div>
            {variantLoading ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/50">Renkler yükleniyor...</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {variants.map((variant) => {
                  const selected = variant.id === selectedVariantId;
                  const swatch = variant.colorHex || colorFromText(`${variant.variant_code ?? ""}${variant.color_name ?? ""}`);
                  return (
                    <button
                      type="button"
                      key={variant.id}
                      onClick={() => {
                        setSelectedVariantId(variant.id);
                        setTextureFile(null);
                        setPreviewDataUrl("");
                        setSavedPreviewId("");
                      }}
                      className={`overflow-hidden rounded-xl border bg-white text-left transition dark:bg-slate-900 ${selected ? "border-primary-500 ring-2 ring-primary-200" : "border-slate-200 dark:border-slate-800"}`}
                    >
                      <div className="relative h-24 bg-slate-100 dark:bg-slate-800">
                        {variantTexture(variant) ? (
                          <img src={variantTexture(variant)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${swatch}, #ffffff66)` }} />
                        )}
                        {selected ? <span className="absolute right-2 top-2 rounded-full bg-primary-600 p-1 text-white"><Check className="h-4 w-4" /></span> : null}
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-black">{variant.variant_code}</div>
                        <div className="text-xs text-slate-500">{variant.color_name || "Renk"}</div>
                        <div className="mt-1 text-xs font-semibold text-primary-600">{formatTL(variant.price_per_m2)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-primary-100 bg-primary-50 p-3 dark:border-primary-900 dark:bg-primary-900/20">
            <div className="text-sm font-black">Seçilen ürün</div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{selectedTitle}</div>
            <div className={`mt-2 rounded-lg px-3 py-2 text-xs font-bold ${hasExactTexture ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
              {hasExactTexture
                ? exactTextureSource === "catalog"
                  ? "%100 urun modu aktif: onizleme katalogdaki gercek varyant gorselinden uretilir."
                  : "%100 urun modu aktif: onizleme bu ekranda cekilen kartela fotografiyle uretilir."
                : "%100 onizleme icin kartela/doku fotografi gerekli. Asagidan kartela fotografi cekip yukleyin."}
            </div>
            <label className="mt-3 block">
              <span className="text-xs font-black text-slate-700 dark:text-slate-200">Kartela/doku fotoğrafı</span>
              <span className="mt-1 flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary-200 bg-white/70 p-3 dark:border-primary-800 dark:bg-slate-900/50">
                {effectiveTextureUrl ? (
                  <img src={effectiveTextureUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <Upload className="h-7 w-7 shrink-0 text-primary-500" />
                )}
                <span className="min-w-0 text-xs">
                  <span className="block font-bold">{textureFile ? textureFile.name : selectedTextureUrl ? "Katalog görseli kullanılıyor" : "Karteladan seçilen ürünün fotoğrafını çek"}</span>
                  <span className="mt-1 block text-slate-500">Önizleme bu gerçek doku ile hesaplanır.</span>
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    setTextureFile(e.target.files?.[0] ?? null);
                    setPreviewDataUrl("");
                    setSavedPreviewId("");
                  }}
                  disabled={saving || loading}
                />
              </span>
            </label>
            {!dbSeries.some((item) => item.product_type === productType) ? (
              <div className="mt-2 text-xs text-slate-500">Katalog verisi yoksa hazır MVP kartela seti kullanılır. Gerçek kartelalar eklendiğinde bu liste otomatik veritabanından gelir.</div>
            ) : null}
          </div>

          <label className="block">
            <span className="text-sm font-medium">4. Fotoğraf yükle</span>
            <span className="mt-1 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-700 dark:bg-slate-800/50">
              <Upload className="mb-2 h-8 w-8 text-slate-400" />
              <span className="text-sm font-semibold">{photoFile ? photoFile.name : "Balkon / pencere fotoğrafı"}</span>
              <span className="mt-1 text-xs text-slate-500">Kamera veya galeriden seç</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  setPhotoFile(e.target.files?.[0] ?? null);
                  setAreaEditing(Boolean(e.target.files?.[0]));
                  resetArea();
                  setPreviewRequested(false);
                  setPreviewDataUrl("");
                  setSavedPreviewId("");
                }}
                disabled={saving || loading}
              />
            </span>
          </label>

          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 text-sm font-black">5. Uygulama alanı</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={startAreaSelection} disabled={!photoUrl} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-50 dark:border-slate-700">
                Alanı Seç
              </button>
              <button type="button" onClick={resetArea} disabled={!photoUrl} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-50 dark:border-slate-700">
                Alanı Sıfırla
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <button type="button" onClick={handleMakePreview} disabled={!selectedVariant || !photoFile || !hasExactTexture} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 font-bold text-white disabled:opacity-50">
              <Eye className="h-5 w-5" /> Önizle
            </button>
            <button type="button" onClick={() => setPresentationOpen(true)} disabled={!previewDataUrl} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-bold disabled:opacity-50 dark:border-slate-700">
              <Maximize2 className="h-5 w-5" /> Göster
            </button>
            <button type="button" onClick={handleSavePreview} disabled={saving || !previewDataUrl} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-bold disabled:opacity-50 dark:border-slate-700">
              <Save className="h-5 w-5" /> Kaydet
            </button>
            <button type="button" onClick={transferToOrder} disabled={!savedPreviewId} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 font-bold text-white disabled:opacity-50">
              <ShoppingCart className="h-5 w-5" /> Teklif
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
          <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Eye className="h-5 w-5 text-primary-600" />
            Ürün Fotoğraf Önizlemesi
          </div>
          <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
            {!photoUrl ? (
              <div className="px-6 text-center text-sm text-slate-500">
                <Camera className="mx-auto mb-3 h-9 w-9 text-slate-400" />
                Fotoğraf yükleyince dört köşe alan seçimi ve ürün kaplaması burada çalışır.
              </div>
            ) : (
              <div
                ref={mediaFrameRef}
                className="relative inline-block max-w-full touch-none select-none"
                onPointerMove={(event) => {
                  if (dragPoint === null || !areaEditing) return;
                  updatePointFromPointer(dragPoint, event.clientX, event.clientY);
                }}
                onPointerUp={() => setDragPoint(null)}
                onPointerCancel={() => setDragPoint(null)}
                onPointerLeave={() => setDragPoint(null)}
              >
                <img
                  ref={photoRef}
                  src={photoUrl}
                  alt=""
                  className={`block max-h-[70vh] max-w-full rounded-xl object-contain ${previewRequested ? "opacity-0" : "opacity-100"}`}
                  onLoad={() => drawPreview()}
                />
                {effectiveTextureUrl ? <img ref={textureRef} src={effectiveTextureUrl} alt="" className="hidden" crossOrigin="anonymous" onLoad={() => drawPreview()} onError={() => setErr("Kartela gorseli yuklenemedi. Kartela fotografini yeniden cekip yukleyin.")} /> : null}
                <canvas ref={canvasRef} className={previewRequested ? "pointer-events-none absolute inset-0 h-full w-full rounded-xl object-contain" : "hidden"} />
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon points={areaPoints.map((point) => `${point.x},${point.y}`).join(" ")} fill={areaEditing ? "rgba(14,165,233,0.14)" : "rgba(255,255,255,0.08)"} stroke={areaEditing ? "rgba(14,165,233,0.95)" : "rgba(255,255,255,0.7)"} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
                </svg>
                {areaPoints.map((point, index) => (
                  <button
                    type="button"
                    key={index}
                    aria-label={`Köşe ${index + 1}`}
                    onPointerDown={(event) => {
                      if (!areaEditing) return;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDragPoint(index);
                      updatePointFromPointer(index, event.clientX, event.clientY);
                    }}
                    className={`absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg ${areaEditing ? "bg-primary-600" : "bg-slate-500"}`}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  />
                ))}
                {areaEditing ? <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">4 köşeyi sürükleyin</div> : null}
              </div>
            )}
          </div>
        </section>
      </div>

      {presentationOpen ? (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-4">
          <div className="mb-3 flex items-center justify-between text-white">
            <div>
              <div className="font-bold">Müşteri Önizleme</div>
              <div className="text-sm text-white/70">{selectedTitle}</div>
            </div>
            <button type="button" onClick={() => setPresentationOpen(false)} className="rounded-full bg-white/10 p-3">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {previewDataUrl ? <img src={previewDataUrl} alt="Müşteri önizleme" className="max-h-full max-w-full rounded-2xl object-contain" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
