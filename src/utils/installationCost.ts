/**
 * Montaj maliyeti — siparis kar analizi ve aylik rapor AYNI hesabi kullanir.
 *
 *  - Kendim yapiyorum (is_internal_installation / installation_mode="self"): 0, montajci borcu YOK.
 *  - Dis montajci + hakedis kaydi var: hakedis toplami maliyettir (odenmis/odenmemis fark etmez;
 *    montajciya yapilan odeme maliyet DEGIL, yalniz borcu dusurur).
 *  - Montajci secili ama hakedis henuz yok / secim yok: siparisteki elle girilen montaj tutari.
 * Ayni hakedis hicbir zaman iki kez sayilmaz: hakedis varsa elle tutar yok sayilir.
 */
export type InstallationCostSource = "self" | "earnings" | "manual";

export function computeInstallationCost(opts: {
    isInternal: boolean;
    earningsTotal: number;
    manualCost: number;
}): { cost: number; source: InstallationCostSource } {
    const n = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);
    if (opts.isInternal) return { cost: 0, source: "self" };
    const earnings = n(opts.earningsTotal);
    if (earnings > 0) return { cost: earnings, source: "earnings" };
    return { cost: n(opts.manualCost), source: "manual" };
}
