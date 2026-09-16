/**
 * supplier_product_prices tablosu iki farklı şemada olabiliyor:
 *   - Yeni şema : product_name / product_category / unit_cost / currency / note / product_id
 *   - Eski şema : product_type / unit_price
 * Bu yardımcılar yazma işlemlerini çalışan şemaya göre uyarlar.
 */

type WriteError = { code?: string; message: string } | null;
type WriteResult = { error: WriteError };

/** Eksik kolon hatasında yeni ad -> eski ad eşlemesi. */
const COLUMN_ALIASES: Record<string, string> = {
  product_name: "product_type",
  unit_cost: "unit_price",
};

/** Şemada yoksa sessizce atılabilecek kolonlar. */
const OPTIONAL_COLUMNS = ["product_id", "product_category", "currency", "note"];

const MISSING_COLUMN_CODES = ["PGRST204", "42703"];

function isMissingColumnError(error: WriteError): boolean {
  if (!error) return false;
  if (MISSING_COLUMN_CODES.includes(error.code || "")) return true;
  return /could not find the .* column|does not exist/i.test(String(error.message || ""));
}

function findMissingColumn(message: string, keys: string[]): string | undefined {
  return keys.find((key) => new RegExp(`\\b${key}\\b`).test(message));
}

/**
 * Payload'ı yazmayı dener; "kolon bulunamadı" hatasında kolonu eski adıyla
 * değiştirir ya da opsiyonel kolonu düşürüp yeniden dener.
 */
export async function saveSupplierPrice<
  T extends Record<string, any>,
  R extends WriteResult
>(payload: T, write: (value: Record<string, any>) => PromiseLike<R>): Promise<R> {
  const compatible: Record<string, any> = { ...payload };

  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await write({ ...compatible });
    const error = result.error;
    if (!isMissingColumnError(error)) return result;

    const message = String(error?.message || "");
    const missing = findMissingColumn(message, Object.keys(compatible));
    if (!missing) return result;

    if (OPTIONAL_COLUMNS.includes(missing)) {
      delete compatible[missing];
      continue;
    }

    const alias = COLUMN_ALIASES[missing];
    if (!alias || alias in compatible) return result;

    compatible[alias] = compatible[missing];
    delete compatible[missing];
    // Eski şemada kategori ayrı kolon değil; product_type alanı kategoriyi de taşır.
    if (missing === "product_name") delete compatible.product_category;
  }

  return await write({ ...compatible });
}

let cachedNameColumn: "product_name" | "product_type" | null = null;

/**
 * Ürün adının hangi kolonda tutulduğunu (bir kez) tespit eder.
 * probe: verilen kolon adıyla küçük bir select çalıştırmalı.
 */
export async function resolveSupplierPriceNameColumn(
  probe: (column: string) => PromiseLike<WriteResult>
): Promise<"product_name" | "product_type"> {
  if (cachedNameColumn) return cachedNameColumn;
  try {
    const res = await probe("product_name");
    cachedNameColumn = isMissingColumnError(res.error) ? "product_type" : "product_name";
  } catch {
    cachedNameColumn = "product_name";
  }
  return cachedNameColumn;
}

/** Şema değiştiğinde (migration sonrası) önbelleği sıfırlamak için. */
export function resetSupplierPriceSchemaCache() {
  cachedNameColumn = null;
}
