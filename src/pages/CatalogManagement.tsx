import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, ImagePlus, Layers, Save, Trash2, Upload, ArrowLeft, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type ProductType = "plicell" | "stor" | "zebra" | "tul" | "fon" | "jalousie" | "dikey_tul" | "dikey_stor" | "cam_balkon" | "diger";

type CatalogSeries = {
    id: string;
    company_id: string | null;
    product_type: ProductType | null;
    code?: string | null;
    series_code?: string | null;
    model_name: string | null;
    is_active: boolean | null;
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
};

const PRODUCT_TYPES: Array<{ value: ProductType; label: string }> = [
    { value: "stor", label: "Stor" },
    { value: "zebra", label: "Zebra" },
    { value: "plicell", label: "Plicell" },
    { value: "tul", label: "Tül" },
    { value: "fon", label: "Fon" },
    { value: "dikey_tul", label: "Dikey Tül" },
    { value: "dikey_stor", label: "Dikey Stor" },
    { value: "jalousie", label: "Jaluzi" },
    { value: "cam_balkon", label: "Cam Balkon" },
    { value: "diger", label: "Diğer" },
];

const SERIES_SELECT = "id, company_id, product_type, code, series_code, model_name, is_active";
const VARIANT_SELECT = "id, company_id, series_id, variant_code, color_name, variant_image_url, texture_image_url, price_per_m2, is_active";
const TEMPLATE_COLUMNS = ["product_type", "code", "model_name", "variant_code", "color_name", "price_per_m2", "image_filename"];
const TEMPLATE_ROWS = [
    TEMPLATE_COLUMNS,
    ["stor", "RS 3000", "Panama Stor", "V1", "Krem", 950, "RS3000-V1.jpg"],
    ["stor", "RS 3000", "Panama Stor", "V2", "Gri", 950, "RS3000-V2.jpg"],
    ["zebra", "ZR 140", "Modern Zebra", "EKR-05", "Ekru Zebra", 850, "ZR140-EKR05.jpg"],
];
const PLACEHOLDER_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22400%22%20height%3D%22300%22%20viewBox%3D%220%200%20400%20300%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23e5e7eb%22/%3E%3Cpath%20d%3D%22M0%2040h400M0%2080h400M0%20120h400M0%20160h400M0%20200h400M0%20240h400%22%20stroke%3D%22%23cbd5e1%22%20stroke-width%3D%224%22/%3E%3Ctext%20x%3D%22200%22%20y%3D%22155%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%22%20font-size%3D%2226%22%20font-weight%3D%22700%22%20fill%3D%22%2364758b%22%3EKartela%20Gorseli%3C/text%3E%3C/svg%3E";

const emptySeries = {
    product_type: "stor" as ProductType,
    code: "",
    model_name: "",
    is_active: true,
};

const emptyVariant = {
    series_id: "",
    variant_code: "",
    color_name: "",
    variant_image_url: "",
    price_per_m2: 0,
    is_active: true,
};

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function formatTL(value: number | null | undefined) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(safeNumber(value));
}

function fileExt(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext && ext.length <= 5 ? ext : "jpg";
}

function isSchemaError(error: unknown) {
    const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLocaleLowerCase("tr-TR");
    return message.includes("column") || message.includes("schema cache") || message.includes("could not find");
}

function friendlyCatalogError(error: unknown) {
    const message = String((error as { message?: string } | null)?.message ?? error ?? "");
    const lower = message.toLocaleLowerCase("tr-TR");
    if (lower.includes("row-level security") || lower.includes("rls") || lower.includes("violates row-level security")) {
        return "Kartela yazma izni Supabase RLS tarafinda kapali. Supabase SQL Editor'da supabase_catalog_rls_write_hotfix.sql dosyasini calistirin.";
    }
    return message;
}

function productLabel(value: string | null | undefined) {
    return PRODUCT_TYPES.find((item) => item.value === value)?.label ?? "Diğer";
}

function seriesCode(row: CatalogSeries | null | undefined) {
    return row?.code || row?.series_code || "";
}

function variantImage(row: CatalogVariant | null | undefined) {
    return row?.variant_image_url || row?.texture_image_url || "";
}

function normalizeFilename(value: string | null | undefined) {
    return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function normalizeProductType(value: unknown): ProductType | "" {
    const normalized = String(value ?? "").trim().toLocaleLowerCase("tr-TR")
        .replace("ü", "u")
        .replace("ı", "i")
        .replace("ş", "s")
        .replace("ğ", "g")
        .replace("ö", "o")
        .replace("ç", "c")
        .replace(/\s+/g, "_");
    return PRODUCT_TYPES.some((item) => item.value === normalized) ? normalized as ProductType : "";
}

async function getContext() {
    return getEffectiveTenantContext();
}

export default function CatalogManagement() {
    const nav = useNavigate();

    const [companyId, setCompanyId] = useState("");
    const [series, setSeries] = useState<CatalogSeries[]>([]);
    const [variants, setVariants] = useState<CatalogVariant[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState("");
    const [seriesForm, setSeriesForm] = useState(emptySeries);
    const [variantForm, setVariantForm] = useState(emptyVariant);
    const [editingSeriesId, setEditingSeriesId] = useState("");
    const [editingVariantId, setEditingVariantId] = useState("");
    const [variantFile, setVariantFile] = useState<File | null>(null);
    const [bulkImages, setBulkImages] = useState<File[]>([]);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const [search, setSearch] = useState("");

    async function loadData() {
        setLoading(true);
        setErr("");
        try {
            const ctx = await getContext();
            setCompanyId(ctx.company_id);
            let [seriesRes, variantRes] = await Promise.all([
                supabase.from("catalog_series").select(SERIES_SELECT).eq("company_id", ctx.company_id).order("code", { ascending: true }),
                supabase.from("catalog_variants").select(VARIANT_SELECT).eq("company_id", ctx.company_id).order("variant_code", { ascending: true }),
            ]);
            if (seriesRes.error && isSchemaError(seriesRes.error)) {
                seriesRes = await supabase
                    .from("catalog_series")
                    .select("id, company_id, product_type, series_code, model_name, is_active")
                    .eq("company_id", ctx.company_id)
                    .order("series_code", { ascending: true }) as typeof seriesRes;
            }
            if (variantRes.error && isSchemaError(variantRes.error)) {
                variantRes = await supabase
                    .from("catalog_variants")
                    .select("id, company_id, series_id, variant_code, variant_image_url, price_per_m2, is_active")
                    .eq("company_id", ctx.company_id)
                    .order("variant_code", { ascending: true }) as typeof variantRes;
            }
            if (seriesRes.error) throw seriesRes.error;
            if (variantRes.error) throw variantRes.error;
            const nextSeries = (seriesRes.data ?? []) as CatalogSeries[];
            setSeries(nextSeries);
            setVariants((variantRes.data ?? []) as CatalogVariant[]);
            if (nextSeries[0]?.id) setVariantForm((prev) => ({ ...prev, series_id: nextSeries[0].id }));
        } catch (e: any) {
            setErr(e?.message ?? "Kartela verileri yuklenemedi.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadData();
         
    }, []);

    const filteredSeries = useMemo(() => {
        const q = search.trim().toLocaleLowerCase("tr-TR");
        return series.filter((row) => {
            if (!q) return true;
            return [row.product_type, seriesCode(row), row.model_name].join(" ").toLocaleLowerCase("tr-TR").includes(q);
        });
    }, [series, search]);

    async function uploadImage(file: File) {
        const path = `${companyId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${fileExt(file)}`;
        const { error } = await supabase.storage.from("catalog-images").upload(path, file, {
            cacheControl: "3600",
            upsert: true,
            contentType: file.type || "image/jpeg",
        });
        if (error) {
            const embedded = await imageFileToDataUrl(file);
            setSuccess("Storage yukleme izni yoktu; gorsel kartela kaydina gomulu olarak eklendi.");
            return embedded;
        }
        const { data } = supabase.storage.from("catalog-images").getPublicUrl(path);
        return data.publicUrl;
    }

    async function imageFileToDataUrl(file: File) {
        const objectUrl = URL.createObjectURL(file);
        try {
            const image = new Image();
            image.src = objectUrl;
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error("Gorsel okunamadi."));
            });

            const maxSize = 1200;
            const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Gorsel islenemedi.");
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/jpeg", 0.82);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function resetSeriesForm() {
        setEditingSeriesId("");
        setSeriesForm(emptySeries);
    }

    function resetVariantForm() {
        setEditingVariantId("");
        setVariantFile(null);
        setVariantForm((prev) => ({ ...emptyVariant, series_id: prev.series_id || series[0]?.id || "" }));
    }

    function fillSeries(row: CatalogSeries) {
        setEditingSeriesId(row.id);
        setSeriesForm({
            product_type: row.product_type ?? "stor",
            code: seriesCode(row),
            model_name: row.model_name ?? "",
            is_active: row.is_active ?? true,
        });
        setVariantForm((prev) => ({ ...prev, series_id: row.id }));
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function fillVariant(row: CatalogVariant) {
        setEditingVariantId(row.id);
        setVariantFile(null);
        setVariantForm({
            series_id: row.series_id ?? "",
            variant_code: row.variant_code ?? "",
            color_name: row.color_name ?? "",
            variant_image_url: variantImage(row),
            price_per_m2: safeNumber(row.price_per_m2),
            is_active: row.is_active ?? true,
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function addVariantToSeries(row: CatalogSeries) {
        setEditingVariantId("");
        setVariantFile(null);
        setVariantForm({ ...emptyVariant, series_id: row.id });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function createSeriesFromCurrentForm() {
        if (!seriesForm.code.trim()) throw new Error("Kod/model secmek icin once Kod alanini doldurun.");
        if (!seriesForm.model_name.trim()) throw new Error("Kod/model secmek icin once Model alanini doldurun.");

        const code = seriesForm.code.trim();
        const existing = series.find((row) =>
            row.product_type === seriesForm.product_type &&
            seriesCode(row).trim().toLocaleLowerCase("tr-TR") === code.toLocaleLowerCase("tr-TR")
        );
        if (existing) return existing;

        const payload = {
            company_id: companyId,
            product_type: seriesForm.product_type,
            code,
            series_code: code,
            model_name: seriesForm.model_name.trim(),
            is_active: seriesForm.is_active,
        };

        let { data, error } = await supabase.from("catalog_series").insert([payload]).select(SERIES_SELECT).single();
        if (error && isSchemaError(error)) {
            const retry = await supabase
                .from("catalog_series")
                .insert([{
                    company_id: payload.company_id,
                    product_type: payload.product_type,
                    series_code: payload.series_code,
                    model_name: payload.model_name,
                    is_active: payload.is_active,
                }])
                .select("id, company_id, product_type, series_code, model_name, is_active")
                .single();
            data = retry.data as any;
            error = retry.error;
        }
        if (error) throw error;

        const created = data as CatalogSeries;
        setSeries((prev) => [...prev, created]);
        setVariantForm((prev) => ({ ...prev, series_id: created.id }));
        return created;
    }

    async function saveSeries() {
        setErr("");
        setSuccess("");
        if (!companyId) return setErr("Şirket bilgisi yuklenemedi.");
        if (!seriesForm.code.trim()) return setErr("Kod zorunlu.");
        if (!seriesForm.model_name.trim()) return setErr("Model adi zorunlu.");
        setSaving(true);
        try {
            const payload = {
                company_id: companyId,
                product_type: seriesForm.product_type,
                code: seriesForm.code.trim(),
                series_code: seriesForm.code.trim(),
                model_name: seriesForm.model_name.trim(),
                is_active: seriesForm.is_active,
            };
            if (editingSeriesId) {
                let { data, error } = await supabase.from("catalog_series").update(payload).eq("id", editingSeriesId).eq("company_id", companyId).select(SERIES_SELECT).single();
                if (error && isSchemaError(error)) {
                    const retry = await supabase
                        .from("catalog_series")
                        .update({
                            company_id: payload.company_id,
                            product_type: payload.product_type,
                            series_code: payload.series_code,
                            model_name: payload.model_name,
                            is_active: payload.is_active,
                        })
                        .eq("id", editingSeriesId)
                        .eq("company_id", companyId)
                        .select("id, company_id, product_type, series_code, model_name, is_active")
                        .single();
                    data = retry.data as any;
                    error = retry.error;
                }
                if (error) throw error;
                setSeries((prev) => prev.map((item) => item.id === editingSeriesId ? data as CatalogSeries : item));
                setSuccess("Kod/model guncellendi.");
            } else {
                let { data, error } = await supabase.from("catalog_series").insert([payload]).select(SERIES_SELECT).single();
                if (error && isSchemaError(error)) {
                    const retry = await supabase
                        .from("catalog_series")
                        .insert([{
                            company_id: payload.company_id,
                            product_type: payload.product_type,
                            series_code: payload.series_code,
                            model_name: payload.model_name,
                            is_active: payload.is_active,
                        }])
                        .select("id, company_id, product_type, series_code, model_name, is_active")
                        .single();
                    data = retry.data as any;
                    error = retry.error;
                }
                if (error) throw error;
                setSeries((prev) => [...prev, data as CatalogSeries]);
                setVariantForm((prev) => ({ ...prev, series_id: (data as CatalogSeries).id }));
                setSuccess("Kod/model eklendi. Simdi renk/varyant ekleyebilirsiniz.");
            }
            resetSeriesForm();
        } catch (e: any) {
            setErr(friendlyCatalogError(e) || "Kod/model kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    async function saveVariant() {
        setErr("");
        setSuccess("");
        if (!companyId) return setErr("Şirket bilgisi yuklenemedi.");
        if (!variantForm.variant_code.trim()) return setErr("Renk/varyant kodu zorunlu.");
        setSaving(true);
        try {
            const targetSeries = variantForm.series_id
                ? series.find((row) => row.id === variantForm.series_id) ?? null
                : await createSeriesFromCurrentForm();
            if (!targetSeries?.id) throw new Error("Kod/model secilemedi veya olusturulamadi.");

            const imageUrl = variantFile ? await uploadImage(variantFile) : variantForm.variant_image_url.trim() || PLACEHOLDER_IMAGE;
            const payload = {
                company_id: companyId,
                series_id: targetSeries.id,
                variant_code: variantForm.variant_code.trim(),
                color_name: variantForm.color_name.trim() || null,
                variant_image_url: imageUrl || null,
                texture_image_url: imageUrl || null,
                price_per_m2: safeNumber(variantForm.price_per_m2),
                is_active: variantForm.is_active,
            };
            if (editingVariantId) {
                let { data, error } = await supabase.from("catalog_variants").update(payload).eq("id", editingVariantId).eq("company_id", companyId).select(VARIANT_SELECT).single();
                if (error && isSchemaError(error)) {
                    const retry = await supabase
                        .from("catalog_variants")
                        .update({
                            company_id: payload.company_id,
                            series_id: payload.series_id,
                            variant_code: payload.variant_code,
                            variant_image_url: payload.variant_image_url,
                            price_per_m2: payload.price_per_m2,
                            is_active: payload.is_active,
                        })
                        .eq("id", editingVariantId)
                        .eq("company_id", companyId)
                        .select("id, company_id, series_id, variant_code, variant_image_url, price_per_m2, is_active")
                        .single();
                    data = retry.data as any;
                    error = retry.error;
                }
                if (error) throw error;
                setVariants((prev) => prev.map((item) => item.id === editingVariantId ? data as CatalogVariant : item));
                setSuccess("Renk/varyant guncellendi.");
            } else {
                let { data, error } = await supabase.from("catalog_variants").insert([payload]).select(VARIANT_SELECT).single();
                if (error && isSchemaError(error)) {
                    const retry = await supabase
                        .from("catalog_variants")
                        .insert([{
                            company_id: payload.company_id,
                            series_id: payload.series_id,
                            variant_code: payload.variant_code,
                            variant_image_url: payload.variant_image_url,
                            price_per_m2: payload.price_per_m2,
                            is_active: payload.is_active,
                        }])
                        .select("id, company_id, series_id, variant_code, variant_image_url, price_per_m2, is_active")
                        .single();
                    data = retry.data as any;
                    error = retry.error;
                }
                if (error) throw error;
                setVariants((prev) => [...prev, data as CatalogVariant]);
                setSuccess(variantForm.series_id ? "Renk/varyant eklendi." : "Kod/model olusturuldu ve renk/varyant eklendi.");
            }
            resetVariantForm();
        } catch (e: any) {
            setErr(friendlyCatalogError(e) || "Renk/varyant kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    function downloadTemplate() {
        setErr("");
        try {
            const ws = XLSX.utils.aoa_to_sheet(TEMPLATE_ROWS);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "kartela_import");
            const output = XLSX.write(wb, { bookType: "xlsx", type: "array" });
            const blob = new Blob([output], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "kartela-import-sablonu.xlsx";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setErr("Sablon olusturulamadi: " + (e?.message ?? "Bilinmeyen hata"));
            console.error("Download error:", e);
        }
    }

    function downloadCsvTemplate() {
        setErr("");
        try {
            const csv = TEMPLATE_ROWS
                .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
                .join("\n");
            const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "kartela-import-sablonu.csv";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setErr("CSV sablonu olusturulamadi: " + (e?.message ?? "Bilinmeyen hata"));
            console.error("CSV download error:", e);
        }
    }

    async function readImportRows(file: File) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    }

    async function importCatalogRows() {
        setErr("");
        setSuccess("");
        setImportErrors([]);
        if (!companyId) return setErr("Şirket bilgisi yuklenemedi.");
        if (!importFile) return setErr("Excel/CSV dosyasi secin.");
        setImporting(true);
        try {
            const rawRows = await readImportRows(importFile);
            const errors: string[] = [];
            const imageMap = new Map<string, File>();
            bulkImages.forEach((file) => imageMap.set(normalizeFilename(file.name), file));
            const seriesMap = new Map<string, CatalogSeries>();
            series.forEach((row) => seriesMap.set(`${row.product_type}|${seriesCode(row).toLocaleLowerCase("tr-TR")}`, row));
            const uploadedImageMap = new Map<string, string>();
            const createdSeries: CatalogSeries[] = [];
            const createdVariants: CatalogVariant[] = [];

            for (let i = 0; i < rawRows.length; i += 1) {
                const rowNumber = i + 2;
                const raw = rawRows[i];
                const product_type = normalizeProductType(raw.product_type);
                const code = String(raw.code ?? "").trim();
                const model_name = String(raw.model_name ?? "").trim();
                const variant_code = String(raw.variant_code ?? "").trim();
                const color_name = String(raw.color_name ?? "").trim();
                const price_per_m2 = safeNumber(raw.price_per_m2);
                const image_filename = String(raw.image_filename ?? "").trim();

                if (!product_type) {
                    errors.push(`Satir ${rowNumber}: product_type gecersiz.`);
                    continue;
                }
                if (!code) {
                    errors.push(`Satir ${rowNumber}: code zorunlu.`);
                    continue;
                }
                if (!model_name) {
                    errors.push(`Satir ${rowNumber}: model_name zorunlu.`);
                    continue;
                }
                if (!variant_code) {
                    errors.push(`Satir ${rowNumber}: variant_code zorunlu.`);
                    continue;
                }

                const seriesKey = `${product_type}|${code.toLocaleLowerCase("tr-TR")}`;
                let currentSeries = seriesMap.get(seriesKey);
                if (!currentSeries) {
                    const { data, error } = await supabase.from("catalog_series").insert([{
                        company_id: companyId,
                        product_type,
                        code,
                        series_code: code,
                        model_name,
                        is_active: true,
                    }]).select(SERIES_SELECT).single();
                    if (error) {
                        errors.push(`Satir ${rowNumber}: seri olusturulamadi - ${error.message}`);
                        continue;
                    }
                    currentSeries = data as CatalogSeries;
                    seriesMap.set(seriesKey, currentSeries);
                    createdSeries.push(currentSeries);
                }

                let imageUrl = PLACEHOLDER_IMAGE;
                if (image_filename) {
                    const imageFile = imageMap.get(normalizeFilename(image_filename));
                    if (imageFile) {
                        if (uploadedImageMap.has(normalizeFilename(image_filename))) {
                            imageUrl = uploadedImageMap.get(normalizeFilename(image_filename)) || PLACEHOLDER_IMAGE;
                        } else {
                            try {
                                imageUrl = await uploadImage(imageFile);
                                uploadedImageMap.set(normalizeFilename(image_filename), imageUrl);
                            } catch (uploadError: any) {
                                errors.push(`Satir ${rowNumber}: ${image_filename} yuklenemedi - ${uploadError?.message ?? "bilinmeyen hata"}. Placeholder kullanildi.`);
                            }
                        }
                    } else {
                        errors.push(`Satir ${rowNumber}: ${image_filename} bulunamadi. Placeholder kullanildi.`);
                    }
                } else {
                    errors.push(`Satir ${rowNumber}: image_filename bos. Placeholder kullanildi.`);
                }

                const { data, error } = await supabase.from("catalog_variants").insert([{
                    company_id: companyId,
                    series_id: currentSeries.id,
                    variant_code,
                    color_name: color_name || null,
                    variant_image_url: imageUrl,
                    texture_image_url: imageUrl,
                    price_per_m2,
                    is_active: true,
                }]).select(VARIANT_SELECT).single();
                if (error) {
                    errors.push(`Satir ${rowNumber}: varyant olusturulamadi - ${error.message}`);
                    continue;
                }
                createdVariants.push(data as CatalogVariant);
            }

            setSeries((prev) => [...prev, ...createdSeries]);
            setVariants((prev) => [...prev, ...createdVariants]);
            setImportErrors(errors);
            setSuccess(`${createdSeries.length} kod/model, ${createdVariants.length} varyant import edildi.`);
        } catch (e: any) {
            setErr(e?.message ?? "Import tamamlanamadi.");
        } finally {
            setImporting(false);
        }
    }

    async function toggleSeries(row: CatalogSeries) {
        const next = !(row.is_active ?? true);
        const { data, error } = await supabase.from("catalog_series").update({ is_active: next }).eq("id", row.id).eq("company_id", companyId).select(SERIES_SELECT).single();
        if (error) return setErr(error.message);
        setSeries((prev) => prev.map((item) => item.id === row.id ? data as CatalogSeries : item));
    }

    async function toggleVariant(row: CatalogVariant) {
        const next = !(row.is_active ?? true);
        const { data, error } = await supabase.from("catalog_variants").update({ is_active: next }).eq("id", row.id).eq("company_id", companyId).select(VARIANT_SELECT).single();
        if (error) return setErr(error.message);
        setVariants((prev) => prev.map((item) => item.id === row.id ? data as CatalogVariant : item));
    }

    async function deleteSeries(row: CatalogSeries) {
        if (!window.confirm("Bu kod/model silinsin mi? Alt varyantlar da silinebilir.")) return;
        const { error } = await supabase.from("catalog_series").delete().eq("id", row.id).eq("company_id", companyId);
        if (error) return setErr(error.message);
        setSeries((prev) => prev.filter((item) => item.id !== row.id));
        setVariants((prev) => prev.filter((item) => item.series_id !== row.id));
    }

    async function deleteVariant(row: CatalogVariant) {
        if (!window.confirm("Bu renk/varyant silinsin mi?")) return;
        const { error } = await supabase.from("catalog_variants").delete().eq("id", row.id).eq("company_id", companyId);
        if (error) return setErr(error.message);
        setVariants((prev) => prev.filter((item) => item.id !== row.id));
    }

    return (
        <div className="mx-auto max-w-6xl space-y-5 pb-24">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => nav(-1)}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 transition shadow-sm"
                        title="Geri Git"
                    >
                        <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold">Kartela Yönetimi</h1>
                        <p className="mt-1 text-slate-500">Basit kartela: perde tipi, kod/model, renk/varyant, görsel ve fiyat.</p>
                    </div>
                </div>

                <button
                    onClick={loadData}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition font-medium"
                >
                    <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                    Yenile
                </button>
            </div>

            {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{err}</div> : null}
            {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{success}</div> : null}
            {importErrors.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                    <div className="font-bold">Import raporu</div>
                    <div className="mt-2 max-h-36 space-y-1 overflow-auto text-sm">
                        {importErrors.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
                    </div>
                </div>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                            <FileSpreadsheet className="h-5 w-5 text-primary-600" />
                            Toplu Kartela Yukleme
                        </div>
                        <p className="mt-1 text-sm text-slate-500">Excel/CSV listesindeki aynı kodlar seri olur, satirlar varyant olarak eklenir.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:min-w-[360px]">
                        <button type="button" onClick={downloadTemplate} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                            <Download className="h-4 w-4" /> Örnek Excel indir
                        </button>
                        <button type="button" onClick={downloadCsvTemplate} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                            <Download className="h-4 w-4" /> Örnek CSV indir
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-sm dark:border-slate-700">
                        <FileSpreadsheet className="mx-auto h-7 w-7 text-slate-400" />
                        <div className="mt-1 font-semibold">{importFile ? importFile.name : "Excel/CSV import dosyasi"}</div>
                        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
                    </label>
                    <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-sm dark:border-slate-700">
                        <ImagePlus className="mx-auto h-7 w-7 text-slate-400" />
                        <div className="mt-1 font-semibold">{bulkImages.length ? `${bulkImages.length} gorsel secildi` : "Toplu gorsel yukle"}</div>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setBulkImages(Array.from(e.target.files ?? []))} />
                    </label>
                    <button type="button" onClick={importCatalogRows} disabled={importing || loading || !importFile} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">
                        <Upload className="h-5 w-5" /> {importing ? "Import ediliyor..." : "Excel import"}
                    </button>
                </div>
                <div className="mt-3 text-xs text-slate-500">Kolonlar: product_type, code, model_name, variant_code, color_name, price_per_m2, image_filename. Gorsel eslesmesi image_filename ile secilen dosya adina gore yapilir.</div>
            </section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-4">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <Layers className="h-5 w-5 text-primary-600" />
                        {editingSeriesId ? "Kod/Model Duzenle" : "Kod/Model Ekle"}
                    </div>
                    <select value={seriesForm.product_type} onChange={(e) => setSeriesForm((p) => ({ ...p, product_type: e.target.value as ProductType }))} className="w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                        {PRODUCT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>
                    <input value={seriesForm.code} onChange={(e) => setSeriesForm((p) => ({ ...p, code: e.target.value }))} placeholder="Kod: RS 3000" className="w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" />
                    <input value={seriesForm.model_name} onChange={(e) => setSeriesForm((p) => ({ ...p, model_name: e.target.value }))} placeholder="Model: Panama Stor" className="w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" />
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={seriesForm.is_active} onChange={(e) => setSeriesForm((p) => ({ ...p, is_active: e.target.checked }))} />
                        Aktif
                    </label>
                    <div className="flex gap-3">
                        <button onClick={saveSeries} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
                            <Save className="h-4 w-4" /> Kaydet
                        </button>
                        <button onClick={resetSeriesForm} className="rounded-lg border border-slate-200 px-4 py-2 dark:border-slate-700">Temizle</button>
                    </div>

                    <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                        <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
                            <ImagePlus className="h-5 w-5 text-primary-600" />
                            {editingVariantId ? "Renk/Varyant Duzenle" : "Renk/Varyant Ekle"}
                        </div>
                        <select value={variantForm.series_id} onChange={(e) => setVariantForm((p) => ({ ...p, series_id: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                            <option value="">Kod/model sec</option>
                            {series.map((row) => <option key={row.id} value={row.id}>{seriesCode(row)} {row.model_name}</option>)}
                        </select>
                        <input value={variantForm.variant_code} onChange={(e) => setVariantForm((p) => ({ ...p, variant_code: e.target.value }))} placeholder="Renk/varyant: V2" className="mt-3 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" />
                        <input value={variantForm.color_name} onChange={(e) => setVariantForm((p) => ({ ...p, color_name: e.target.value }))} placeholder="Renk adi: Krem" className="mt-3 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" />
                        <input type="number" min={0} value={variantForm.price_per_m2} onChange={(e) => setVariantForm((p) => ({ ...p, price_per_m2: safeNumber(e.target.value) }))} placeholder="m2 fiyati" className="mt-3 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" />
                        <label className="mt-3 block cursor-pointer rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-sm dark:border-slate-700">
                            <Upload className="mx-auto h-7 w-7 text-slate-400" />
                            <div className="mt-1 font-semibold">{variantFile ? variantFile.name : variantForm.variant_image_url ? "Yeni gorsel sec veya mevcutla devam et" : "Varyant gorseli/dokusu"}</div>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => setVariantFile(e.target.files?.[0] ?? null)} />
                        </label>
                        {variantForm.variant_image_url ? <img src={variantForm.variant_image_url} alt="" className="mt-3 h-24 w-full rounded-xl border border-slate-200 object-cover dark:border-slate-800" /> : null}
                        <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium">
                            <input type="checkbox" checked={variantForm.is_active} onChange={(e) => setVariantForm((p) => ({ ...p, is_active: e.target.checked }))} />
                            Aktif
                        </label>
                        <div className="mt-3 flex gap-3">
                            <button onClick={saveVariant} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
                                <Save className="h-4 w-4" /> Kaydet
                            </button>
                            <button onClick={resetVariantForm} className="rounded-lg border border-slate-200 px-4 py-2 dark:border-slate-700">Temizle</button>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-8">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-semibold">Kod/Model ve Varyantlar</h2>
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ara..." className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800" />
                    </div>
                    {loading ? <div className="text-sm text-slate-500">Yukleniyor...</div> : filteredSeries.length === 0 ? <div className="text-sm text-slate-500">Kartela bulunamadi.</div> : (
                        <div className="space-y-4">
                            {filteredSeries.map((row) => {
                                const rowVariants = variants.filter((variant) => variant.series_id === row.id);
                                return (
                                    <div key={row.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div>
                                                <div className="text-xs text-slate-500">{productLabel(row.product_type)}</div>
                                                <div className="text-lg font-black">{seriesCode(row)} {row.model_name}</div>
                                                <div className={`mt-1 w-fit rounded-full px-2 py-1 text-xs ${row.is_active ?? true ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{row.is_active ?? true ? "Aktif" : "Pasif"}</div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button onClick={() => addVariantToSeries(row)} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Varyant ekle</button>
                                                <button onClick={() => fillSeries(row)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">Duzenle</button>
                                                <button onClick={() => toggleSeries(row)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">{row.is_active ?? true ? "Pasif" : "Aktif"}</button>
                                                <button onClick={() => deleteSeries(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600"><Trash2 className="h-4 w-4" /> Sil</button>
                                            </div>
                                        </div>
                                        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                                            {rowVariants.length === 0 ? <div className="col-span-full rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800/50">Bu kod/model için renk/varyant yok.</div> : rowVariants.map((variant) => (
                                                <div key={variant.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                                                    <div className="h-28 bg-slate-100 dark:bg-slate-800">
                                                        {variantImage(variant) ? <img src={variantImage(variant)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><ImagePlus className="h-7 w-7 text-slate-400" /></div>}
                                                    </div>
                                                    <div className="p-3 text-sm">
                                                        <div className="font-black">{variant.variant_code}</div>
                                                        {variant.color_name ? <div className="mt-1 text-xs text-slate-500">{variant.color_name}</div> : null}
                                                        <div className="mt-1 font-bold text-primary-600">{formatTL(variant.price_per_m2)}</div>
                                                        <div className={`mt-2 w-fit rounded-full px-2 py-1 text-xs ${variant.is_active ?? true ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{variant.is_active ?? true ? "Aktif" : "Pasif"}</div>
                                                        <div className="mt-3 flex flex-wrap gap-1">
                                                            <button onClick={() => fillVariant(variant)} className="rounded border px-2 py-1 text-xs">Duzenle</button>
                                                            <button onClick={() => toggleVariant(variant)} className="rounded border px-2 py-1 text-xs">{variant.is_active ?? true ? "Pasif" : "Aktif"}</button>
                                                            <button onClick={() => deleteVariant(variant)} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-600">Sil</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
