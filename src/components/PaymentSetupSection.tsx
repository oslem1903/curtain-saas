// ============================================================================
// PaymentSetupSection — tek vade / taksitli odeme plani TASLAGI icin ortak
// form gorunumu. Herhangi bir RPC cagirmaz, herhangi bir state'i kendi
// icinde tutmaz (tam controlled) — cagiran taraf (OrderDetail.tsx bugun,
// NewOrder.tsx/Quotes.tsx ileride) state'i ve gonderim/RPC mantigini kendi
// yonetir. Boylece "siparis zaten var" (OrderDetail) ve "siparis henuz
// olusturulmadi, taslak toplaniyor" (NewOrder/Quotes) senaryolarinin ikisinde
// de aynen kullanilabilir.
// ============================================================================
import { Trash2 } from "lucide-react";
import type { InstallmentDraftRow } from "../utils/installments";

export type PaymentSetupSectionProps = {
  remainingAmount: number;
  mode: "single" | "multi";
  onModeChange: (mode: "single" | "multi") => void;
  singleDueDate: string;
  onSingleDueDateChange: (value: string) => void;
  rows: InstallmentDraftRow[];
  onRowsChange: (rows: InstallmentDraftRow[]) => void;
  formatMoney: (n: number) => string;
  /** Cagiran taraf (or. NewOrder.tsx) kendi tek/coklu-taksit secicisini zaten
   * gosteriyorsa, bu bilesenin kendi ic mod toggle'ini tekrar gostermemek
   * icin true verilir. Varsayilan false — OrderDetail.tsx'in mevcut
   * davranisi degismez. */
  hideModeToggle?: boolean;
};

export default function PaymentSetupSection({
  remainingAmount,
  mode,
  onModeChange,
  singleDueDate,
  onSingleDueDateChange,
  rows,
  onRowsChange,
  formatMoney,
  hideModeToggle = false,
}: PaymentSetupSectionProps) {
  return (
    <div className="space-y-3">
      {hideModeToggle ? null : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onModeChange("single")}
            className={`rounded-xl px-4 py-2 text-xs font-black ${mode === "single" ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 dark:border-slate-700"}`}
          >
            Tek Vade
          </button>
          <button
            type="button"
            onClick={() => onModeChange("multi")}
            className={`rounded-xl px-4 py-2 text-xs font-black ${mode === "multi" ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 dark:border-slate-700"}`}
          >
            Taksitlendir
          </button>
        </div>
      )}

      {mode === "single" ? (
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">Vade Tarihi</label>
          <input
            type="date"
            value={singleDueDate}
            onChange={(e) => onSingleDueDateChange(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                type="number"
                min={0}
                placeholder={`${idx + 1}. taksit tutarı`}
                value={row.amount}
                onChange={(e) => onRowsChange(rows.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r)))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="date"
                value={row.dueDate}
                onChange={(e) => onRowsChange(rows.map((r, i) => (i === idx ? { ...r, dueDate: e.target.value } : r)))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={() => onRowsChange(rows.filter((_, i) => i !== idx))}
                disabled={rows.length <= 1}
                className="rounded-xl border border-slate-300 px-3 text-slate-500 disabled:opacity-40 dark:border-slate-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onRowsChange([...rows, { amount: "", dueDate: "" }])}
            className="text-xs font-black text-indigo-600 hover:underline"
          >
            + Taksit Ekle
          </button>
          <div className="text-xs font-bold text-slate-500">
            Toplam: {formatMoney(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))} / {formatMoney(remainingAmount)}
          </div>
        </div>
      )}
    </div>
  );
}
