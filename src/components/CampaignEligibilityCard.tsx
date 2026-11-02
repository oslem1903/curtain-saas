import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

type Status = {
  eval: { applied: boolean; reason: string };
  has_yearly_purchase: boolean;
  override: { allow: boolean; note: string | null } | null;
};

const REASONS: Record<string, string> = {
  ok: "Kampanyaya uygun",
  no_campaign: "Kampanya şu an kapalı",
  sold_out: "Kontenjan dolu",
  already_purchased_yearly: "Daha önce yıllık satın almış / elle ücretli lisans verilmiş sayılıyor",
  not_yearly: "—",
};

/** Super admin: firmanin lansman kampanyasina uygunlugu ve istisna (hediye / ucretli yillik) kontrolu. */
export default function CampaignEligibilityCard({ companyId }: { companyId: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc("billing_campaign_company_status", { p_company_id: companyId }).then(({ data, error }) => {
      if (alive) setSt(error ? null : (data as Status));
    });
    return () => { alive = false; };
  }, [companyId, tick]);

  if (!st) return null;

  async function setOverride(allow: boolean | null) {
    const note = allow === null ? "" : window.prompt(allow ? "Hediye/ücretsiz erişim — not (zorunlu):" : "Elle verilmiş ücretli yıllık lisans — not (zorunlu):");
    if (allow !== null && !note?.trim()) return;
    setBusy(true);
    await supabase.rpc("billing_campaign_set_override", { p_company_id: companyId, p_allow: allow, p_note: note ?? null });
    setBusy(false);
    setTick((t) => t + 1);
  }

  const btn = "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100";
  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-sm font-black text-slate-900 dark:text-white">Lansman kampanyası uygunluğu</div>
      <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        {REASONS[st.eval.reason] ?? st.eval.reason}
        {st.override ? ` · istisna: ${st.override.allow ? "hediye/ücretsiz (uygun)" : "ücretli yıllık (uygun değil)"}${st.override.note ? ` — ${st.override.note}` : ""}` : ""}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={() => void setOverride(true)}>Hediye/ücretsiz say</button>
        <button type="button" className={btn} disabled={busy} onClick={() => void setOverride(false)}>Ücretli yıllık say</button>
        {st.override ? <button type="button" className={btn} disabled={busy} onClick={() => void setOverride(null)}>İstisnayı kaldır</button> : null}
      </div>
    </div>
  );
}
