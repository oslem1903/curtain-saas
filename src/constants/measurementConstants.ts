// Measurement Entry Constants & Types
// Bu dosya Fast Refresh uyumluluğu için MeasurementEntry.tsx'den ayrıştırıldı.

export type ProductType = "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "diger";

export type ProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  unit_price: number | null;
  cost_price?: number | null;
  is_active: boolean | null;
};
export type SupplierRow = { id: string; name: string | null };
export type SupplierProductPriceRow = {
  supplier_id: string;
  product_id: string | null;
  product_name: string | null;
  product_category?: string | null;
  product_type?: string | null;
  unit_cost: number | null;
  unit_price?: number | null;
};
export type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  address?: string | null;
};

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
  pile: "2" | "3" | "S";
  note: string;
  photos: Array<{ id: string; url: string }>;
  fieldNotes: string;
  kumasGrubu?: string;
  mekanizma?: string;
  zincirYonu?: string;
  kasaTipi?: string;
  kasaRengi?: string;
  kornisTipi?: string;
};

export const PRODUCT_OPTIONS: Array<{ value: ProductType; label: string; defaultPrice: number }> = [
  { value: "stor", label: "Stor", defaultPrice: 650 },
  { value: "zebra", label: "Zebra", defaultPrice: 850 },
  { value: "tul", label: "Tül", defaultPrice: 420 },
  { value: "fon", label: "Fon", defaultPrice: 520 },
  { value: "jalousie", label: "Jaluzi", defaultPrice: 950 },
  { value: "picasso", label: "Picasso", defaultPrice: 950 },
  { value: "diger", label: "Diğer", defaultPrice: 500 },
];

export function ceil10(value: number) {
  return Math.ceil(Math.max(0, value) / 10) * 10;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(value);
}

export function productLabel(type: ProductType) {
  return PRODUCT_OPTIONS.find((item) => item.value === type)?.label ?? "Ürün";
}

export function calculate(
  productType: ProductType,
  widthCm: number,
  heightCm: number,
  qty: number,
  unitPrice: number,
  pile: "2" | "3" | "S"
) {
  if (productType === "tul" || productType === "fon") {
    // "S" (S pile) 1'e 3 perde gibi hesaplanir.
    const pileMultiplier = pile === "3" || pile === "S" ? 3 : 2;
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
