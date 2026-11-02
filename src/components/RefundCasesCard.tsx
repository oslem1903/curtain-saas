import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

type RefundCase = {
  id: string;
  company_id: string;
  company_name: string | null;
  provider_ref: string;
  amount_minor: number;
  currency: string;
  reason: string;
  status: "open" | "refunded" | "dismissed";
  note: string | null;
  created_at: string;
  resolved_at: string | null;
};

const tl = (minor: number) => `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(minor / 100)} TL`;
const when = (iso: string) => new Date(iso).toLocaleString("tr-TR");

/**
 * Super admin: tahsil edilip lisansa donusmeyen (kampanya dolmus / daha once yararlanilmis) odemeler.
 * Iade PayTR magaza panelinden ELLE yapilir; burada referansla "iade edildi" olarak kapatilir (takip kaydi).
 */
export default function RefundCasesCard() {
  const [cases, setCases] = useState<RefundCase[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void supabase.rpc("billing_refund_cases_list", { p_status: null }).then(({ data, error: e }) => {
      if (alive) setCases(e ? null : ((data as RefundCase[] | null) ?? []));
    });
    return () => { alive = false; };
  }, [tick]);

  // Migration 039 uygulanmamissa kart gosterilmez.
  if (!cases) return null;
  const open = cases.filter((c) => c.status === "open");
  const closed = cases.filter((c) => c.status !== "open").slice(0, 5);
  if (open.length === 0 && closed.length === 0) return null;

  async function resolve(c: RefundCase, status: "refunded" | "dismissed") {
    const note = window.prompt(status === "refunded" ? "PayTR iade referansı / notu (zorunlu):" : "İade gerekmiyor — gerekçe (zorunlu):");
    if (!note || !note.trim()) return;
    setBusyId(c.id);
    setError("");
    const { error: e } = await supabase.rpc("billing_refund_case_resolve", { p_id: c.id, p_status: status, p_note: note.trim() });
    if (e) setError("Kayıt kapatılamadı.");
    setBusyId(null);
    setTick((t) => t + 1);
  }

  return (
    <div className={`mb-6 rounded-xl border-2 p-4 ${open.length ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"}`}>
      <div className={`text-sm font-black ${open.length ? "text-red-800 dark:text-red-200" : "text-slate-900 dark:text-white"}`}>
        {open.length ? `MANUEL İADE BEKLEYEN ÖDEMELER: ${open.length}` : "Manuel iade kayıtları (bekleyen yok)"}
      </div>
      {open.length ? (
        <p className="mt-1 text-xs font-semibold text-red-800 dark:text-red-200">
          Bu ödemeler tahsil edildi ama lisans AÇILMADI (kampanya kontenjanı dolmuş veya firma daha önce yararlanmış). PayTR mağaza panelinden
          referansla iade edin, sonra burada kapatın. Firma yöneticisi kendi ekranında iade bilgisini görür.
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {open.map((c) => (
          <li key={c.id} className="rounded-lg border border-red-200 bg-white p-3 text-sm dark:border-red-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-black text-slate-900 dark:text-white">{c.company_name ?? c.company_id} · {tl(c.amount_minor)}</div>
                <div className="text-xs text-slate-600 dark:text-slate-300">{when(c.created_at)} · PayTR ref: <span className="font-mono break-all">{c.provider_ref}</span></div>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busyId === c.id} onClick={() => void resolve(c, "refunded")}
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">İade edildi</button>
                <button type="button" disabled={busyId === c.id} onClick={() => void resolve(c, "dismissed")}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100">İade gerekmiyor</button>
              </div>
            </div>
          </li>
        ))}
        {closed.map((c) => (
          <li key={c.id} className="text-xs text-slate-600 dark:text-slate-300">
            {c.status === "refunded" ? "İade edildi" : "Kapatıldı"} · {c.company_name ?? c.company_id} · {tl(c.amount_minor)} · {c.note}
          </li>
        ))}
      </ul>
      {error ? <div role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</div> : null}
    </div>
  );
}
