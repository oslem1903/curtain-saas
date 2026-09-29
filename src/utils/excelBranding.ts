// Excel çıktısı: şirket logosu + adı başlığı ile. SheetJS (xlsx) görsel gömemediği için
// exceljs kullanılır (yalnızca kullanıldığında yüklenir).

import { getCompanyBranding } from "./companyBranding";

export type BrandedSheetOptions = {
  filename: string;
  sheetName: string;
  /** Belge başlığı (örn. "Tedarikçi Cari Ekstresi"). */
  title: string;
  /** Başlık ile tablo arasındaki bilgi satırları: [etiket, değer]. */
  infoRows?: Array<[string, string | number]>;
  header: string[];
  rows: Array<Array<string | number>>;
  colWidths?: number[];
  /** Para biçimi uygulanacak (0 tabanlı) sütun indeksleri. */
  moneyColumns?: number[];
};

export async function downloadBrandedExcel(opts: BrandedSheetOptions): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const branding = await getCompanyBranding();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName.slice(0, 31));

  let row = 1;
  const hasLogo = Boolean(branding?.logoDataUrl);
  if (hasLogo && branding?.logoDataUrl) {
    const m = /^data:image\/(png|jpeg|jpg|gif);base64,/i.exec(branding.logoDataUrl);
    if (m) {
      const ext = m[1].toLowerCase() === "jpg" ? "jpeg" : (m[1].toLowerCase() as "png" | "jpeg" | "gif");
      const imageId = wb.addImage({ base64: branding.logoDataUrl, extension: ext });
      ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 72, height: 72 } });
    }
    ws.getRow(1).height = 54;
    ws.getRow(2).height = 22;
  }

  ws.getCell(1, hasLogo ? 2 : 1).value = branding?.name || "PerdePRO";
  ws.getCell(1, hasLogo ? 2 : 1).font = { bold: true, size: 16 };
  ws.getCell(1, hasLogo ? 2 : 1).alignment = { vertical: "middle" };
  row = 2;
  ws.getCell(row, hasLogo ? 2 : 1).value = opts.title;
  ws.getCell(row, hasLogo ? 2 : 1).font = { bold: true, size: 12 };
  row += 2;

  for (const [label, value] of opts.infoRows ?? []) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 2).value = value;
    row += 1;
  }
  if ((opts.infoRows ?? []).length > 0) row += 1;

  const headerRow = ws.getRow(row);
  opts.header.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });
  row += 1;

  const money = new Set(opts.moneyColumns ?? []);
  for (const r of opts.rows) {
    const xr = ws.getRow(row);
    r.forEach((v, i) => {
      const c = xr.getCell(i + 1);
      c.value = v;
      if (money.has(i) && typeof v === "number") c.numFmt = '#,##0.00 "₺"';
    });
    row += 1;
  }

  (opts.colWidths ?? []).forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = opts.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
