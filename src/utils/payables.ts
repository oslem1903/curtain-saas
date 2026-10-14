/**
 * Tedarikçi / montajcı borçları için açık kalem hesabı (mevcut cari kayıtlardan; ikinci borç tablosu YOK).
 * Ödemeler en eski borca (vade/tarih sırasıyla) FIFO dağıtılır; fazla ödeme (avans) borç sayılmaz.
 */
export type DebtItem = {
    key: string;
    amount: number;
    sortDate: string | null; // vade yoksa kayıt tarihi
};

export type OpenDebt = DebtItem & { paid: number; remaining: number };

export function allocateFifo(items: DebtItem[], totalPaid: number): { open: OpenDebt[]; advance: number } {
    let pool = Math.max(0, Number.isFinite(totalPaid) ? totalPaid : 0);
    const sorted = [...items]
        .filter((i) => Number.isFinite(i.amount) && i.amount > 0)
        .sort((a, b) => (a.sortDate ?? "9999").localeCompare(b.sortDate ?? "9999"));
    const open: OpenDebt[] = [];
    for (const item of sorted) {
        const paid = Math.min(item.amount, pool);
        pool = Math.round((pool - paid) * 100) / 100;
        const remaining = Math.round((item.amount - paid) * 100) / 100;
        if (remaining > 0.009) open.push({ ...item, paid, remaining });
    }
    return { open, advance: pool };
}
