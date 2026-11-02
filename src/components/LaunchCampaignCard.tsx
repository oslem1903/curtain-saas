import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

type CampaignStatus = {
  code: string;
  is_enabled: boolean;
  discount_percent: number;
  max_slots: number;
  consumed: number;
  reserved_active: number;
};

/** Super admin: lansman kampanyasini ac/kapat. Kapatinca yeni indirimli odeme baslatilmaz; baslatilmis odemeler sabit tutarla tamamlanir. */
export default function LaunchCampaignCard() {
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("billing_campaign_admin_status", { p_code: null });
    // Migration 039 uygulanmamissa kart hic gosterilmez.
    setStatus(e ? null : ((data as CampaignStatus | null) ?? null));
  }, []);

  useEffect(() => {
    let alive = true;
    void supabase.rpc("billing_campaign_admin_status", { p_code: null }).then(({ data, error: e }) => {
      if (alive) setStatus(e ? null : ((data as CampaignStatus | null) ?? null));
    });
    return () => { alive = false; };
  }, []);

  if (!status) return null;

  async function toggle() {
    if (!status || busy) return;
    const next = !status.is_enabled;
    if (!window.confirm(next ? "Kampanya açılsın mı? Yeni yıllık ödemeler indirimli başlar." : "Kampanya kapatılsın mı? Yeni yıllık ödemeler normal fiyatla başlar.")) return;
    setBusy(true);
    setError("");
    const { error: e } = await supabase.rpc("billing_campaign_set_enabled", { p_code: status.code, p_enabled: next });
    if (e) setError("İşlem yapılamadı.");
    await load();
    setBusy(false);
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900 dark:text-white">Lansman kampanyası · yıllık paket %{status.discount_percent}</div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {status.is_enabled ? "Açık" : "Kapalı"} · kesinleşen {status.consumed}/{status.max_slots} · bekleyen rezervasyon {status.reserved_active}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {status.is_enabled ? "Kampanyayı kapat" : "Kampanyayı aç"}
        </button>
      </div>
      {error ? <div role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</div> : null}
    </div>
  );
}
