import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, UserCog, Wallet, X, Printer, FileSpreadsheet, Download, Briefcase, CalendarCheck, Phone, CheckCircle2, TrendingUp, Users, HandCoins, Plus } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { createFinanceService } from "../services/finance";
import { ManualEarningModal } from "../components/ManualEarningModal";

const financeService = createFinanceService();

type Employee = {
    id: string;
    user_id: string | null;
    full_name: string | null;
    target_role: string | null;
    // Aynı isimli kopya kayıtların tüm kimlikleri (iş eşleştirme için)
    allIds: string[];
};

type Job = {
    id: string;
    assigned_staff_id: string | null;
    status: string | null;
    scheduled_date: string | null;
    updated_at: string | null;
    customer_name: string | null;
    address: string | null;
    product_type: string | null;
    room: string | null;
    width: number | null;
    height: number | null;
    area_m2: number | null;
    qty: number | null;
    price_type: string | null;
    unit_rate: number | null;
    installer_fee: number | null;
    total_amount: number | null;
    notes: string | null;
};

type InstallerTx = {
    id: string;
    installer_id: string;
    transaction_date: string;
    transaction_type: string;
    amount: number;
    description: string | null;
    payment_method: string | null;
    period_start: string | null;
    period_end: string | null;
    expense_id: string | null;
};

type InstallerEarning = {
    id: string;
    installer_id: string;
    installation_job_id: string | null;
    order_id: string | null;
    earning_type: string;
    total_earning: number;
    job_completed_date: string | null;
    created_at: string;
    metadata: { description?: string | null } | null;
};

function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
}

function formatDate(iso?: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("tr-TR");
}

const PRODUCT_LABELS: Record<string, string> = {
    stor: "Stor", zebra: "Zebra", tul: "Tül", fon: "Fon", jaluzi: "Jaluzi", plise: "Plise",
};

function productLabel(t?: string | null) {
    return PRODUCT_LABELS[String(t || "").toLowerCase()] || t || "Ürün";
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    waiting:    { label: "Bekliyor",          cls: "bg-slate-100 text-slate-600" },
    planned:    { label: "Tarih Planlandı",   cls: "bg-blue-100 text-blue-700" },
    assigned:   { label: "Montajcıya Atandı", cls: "bg-blue-100 text-blue-700" },
    onway:      { label: "Yolda",             cls: "bg-amber-100 text-amber-700" },
    installing: { label: "Montaj Yapılıyor",  cls: "bg-amber-100 text-amber-700" },
    in_progress:{ label: "Devam Ediyor",      cls: "bg-amber-100 text-amber-700" },
    scheduled:  { label: "Planlandı",         cls: "bg-blue-100 text-blue-700" },
    issue:      { label: "Sorunlu",           cls: "bg-red-100 text-red-700" },
    completed:  { label: "Tamamlandı",        cls: "bg-emerald-100 text-emerald-700" },
};

function jobArea(job: Job) {
    if (job.area_m2 != null && job.area_m2 > 0) return Number(job.area_m2);
    const w = Number(job.width ?? 0), h = Number(job.height ?? 0);
    return w > 0 && h > 0 ? Math.round((w * h / 10000) * 10000) / 10000 : 0;
}

export default function InstallerLedger({ hideTitle }: { hideTitle?: boolean }) {
    const [companyId, setCompanyId] = useState("");
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [txs, setTxs] = useState<InstallerTx[]>([]);
    const [earnings, setEarnings] = useState<InstallerEarning[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [needsMigration, setNeedsMigration] = useState(false);
    const [addEarningModalId, setAddEarningModalId] = useState<string | null>(null);

    const [openBalanceId, setOpenBalanceId] = useState<string | null>(null);
    const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
    const [payModalId, setPayModalId] = useState<string | null>(null);
    const [payAmount, setPayAmount] = useState("");
    const [payMethod, setPayMethod] = useState("nakit");
    const [payNote, setPayNote] = useState("");
    const [payStart, setPayStart] = useState("");
    const [payEnd, setPayEnd] = useState("");
    const [saving, setSaving] = useState(false);
    const [rowSavingId, setRowSavingId] = useState<string | null>(null);
    // Satır düzenleme taslakları: jobId -> {price_type, unit_rate, installer_fee}
    const [drafts, setDrafts] = useState<Record<string, { price_type: string; unit_rate: string; installer_fee: string }>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setErr("");
        try {
            const ctx = await getEffectiveTenantContext();
            setCompanyId(ctx.company_id);

            const { data: emps } = await supabase
                .from("employees")
                .select("id, user_id, full_name, target_role")
                .eq("company_id", ctx.company_id)
                .eq("is_active", true)
                .order("full_name");

            // Aynı isimli kayıtları tekilleştir; tüm kimlikleri grupla
            // (duplicate kayıtların işleri/ödemeleri tek kartta toplanır)
            const grouped = new Map<string, Employee>();
            ((emps ?? []) as any[]).forEach((e) => {
                const name = (e.full_name || "İsimsiz").trim();
                const key = name.toLocaleLowerCase("tr-TR");
                const ids = [e.id, e.user_id].filter(Boolean) as string[];
                const existing = grouped.get(key);
                if (existing) {
                    existing.allIds = Array.from(new Set([...existing.allIds, ...ids]));
                } else {
                    grouped.set(key, { id: e.id, user_id: e.user_id, full_name: name, target_role: e.target_role, allIds: ids });
                }
            });
            setEmployees(Array.from(grouped.values()));

            const jobsRes = await supabase
                .from("installation_jobs")
                .select("id, assigned_staff_id, status, scheduled_date, updated_at, customer_name, address, product_type, room, width, height, area_m2, qty, price_type, unit_rate, installer_fee, total_amount, notes")
                .eq("company_id", ctx.company_id)
                .order("updated_at", { ascending: false });
            let jobRows = jobsRes.data;
            const jobErr = jobsRes.error;
            if (jobErr) {
                // Hakediş kolonları henüz yok — çekirdek kolonlarla dene
                const fb = await supabase
                    .from("installation_jobs")
                    .select("id, assigned_staff_id, status, scheduled_date, customer_name, address, product_type, room, width, height, total_amount, notes")
                    .eq("company_id", ctx.company_id)
                    .order("scheduled_date", { ascending: false });
                if (fb.error) throw fb.error;
                jobRows = (fb.data ?? []).map((r: any) => ({ ...r, area_m2: null, qty: 1, price_type: "manuel", unit_rate: 0, installer_fee: 0 }));
                setNeedsMigration(true);
            }
            setJobs((jobRows ?? []) as Job[]);

            // Hesap-sahibi montajcıları da dahil et: employees tablosunda OLMAYAN ama bir işe
            // atanmış assigned_staff_id'ler (ör. solo perdeci = Yönetici, kendini montajcı atar).
            // Böylece kendi montaj hakedişini bu ekranda görür. SALT OKUMA — kayıt oluşturmaz.
            const knownIds = new Set<string>();
            grouped.forEach((e) => e.allIds.forEach((idv) => knownIds.add(idv)));
            const assignedIds = Array.from(
                new Set(((jobRows ?? []) as any[]).map((j) => j.assigned_staff_id).filter(Boolean)),
            ) as string[];
            const missingIds = assignedIds.filter((idv) => !knownIds.has(idv));
            if (missingIds.length > 0) {
                const { data: profs } = await supabase
                    .from("profiles")
                    .select("user_id, full_name")
                    .in("user_id", missingIds);
                const nameById = new Map(((profs ?? []) as any[]).map((p) => [p.user_id, (p.full_name || "").trim()]));
                missingIds.forEach((idv) => {
                    const nm = nameById.get(idv) || "Montajcı (hesap)";
                    const key = nm.toLocaleLowerCase("tr-TR");
                    const existing = grouped.get(key);
                    if (existing) {
                        existing.allIds = Array.from(new Set([...existing.allIds, idv]));
                    } else {
                        grouped.set(key, { id: idv, user_id: idv, full_name: nm, target_role: "installer", allIds: [idv] });
                    }
                });
                setEmployees(Array.from(grouped.values()));
            }

            const txRes = await supabase
                .from("installer_transactions")
                .select("*")
                .eq("company_id", ctx.company_id)
                .order("transaction_date", { ascending: false });
            if (txRes.error) {
                setTxs([]);
                setNeedsMigration(true);
            } else {
                setTxs((txRes.data ?? []) as InstallerTx[]);
            }

            // Load manual earnings (earning_type='manual' AND installation_job_id IS NULL)
            const earningsRes = await supabase
                .from("installer_earnings")
                .select("id, installer_id, installation_job_id, order_id, earning_type, total_earning, job_completed_date, created_at, metadata")
                .eq("company_id", ctx.company_id)
                .eq("earning_type", "manual")
                .is("installation_job_id", null)
                .order("created_at", { ascending: false });
            if (earningsRes.error) {
                setEarnings([]);
            } else {
                setEarnings((earningsRes.data ?? []) as InstallerEarning[]);
            }
        } catch (e: any) {
            setErr(e?.message ?? "Montajcı cari verileri yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // Montajcının işleri: assigned_staff_id, gruptaki herhangi bir kimlik olabilir
    // (employee.id, user_id veya birleştirilmiş kopya kayıtların kimlikleri)
    const jobsForInstaller = useCallback((emp: Employee) =>
        jobs.filter((j) => j.assigned_staff_id && emp.allIds.includes(j.assigned_staff_id)),
    [jobs]);

    // Muhasebe kuralları:
    //   Hakediş  = yalnızca TAMAMLANAN işlerin montaj bedelleri toplamı
    //   Ödenen   = ödemeler − iptaller
    //   Kalan    = max(Hakediş − Ödenen, 0)
    //   Avans    = max(Ödenen − Hakediş, 0)  → fazla ödeme borç değil avanstır
    const ledger = useMemo(() => {
        const map: Record<string, { earned: number; paid: number; remaining: number; advance: number; assignedCount: number; completedCount: number }> = {};
        employees.forEach((emp) => {
            const empJobs = jobsForInstaller(emp);
            const completedJobs = empJobs.filter((j) => j.status === "completed");

            // Automatic earned (from completed jobs)
            const automaticEarned = completedJobs.reduce((a, j) => a + Number(j.installer_fee ?? 0), 0);

            // Manual earned (from manual earnings entries)
            const manualEarned = earnings
                .filter(e => e.installer_id === emp.id && e.earning_type === 'manual' && e.installation_job_id === null)
                .reduce((a, e) => a + Number(e.total_earning ?? 0), 0);

            // Total earned (automatic + manual)
            const earned = automaticEarned + manualEarned;

            const empTxs = txs.filter((t) => emp.allIds.includes(t.installer_id));

            // Paid (exclude 'earning' type transactions)
            const paid = empTxs
                .filter(t => t.transaction_type !== 'earning')
                .reduce((a, t) => a + (t.transaction_type === "payment" ? Number(t.amount) : -Number(t.amount)), 0);

            map[emp.id] = {
                earned,
                paid,
                remaining: Math.max(Math.round((earned - paid) * 100) / 100, 0),
                advance: Math.max(Math.round((paid - earned) * 100) / 100, 0),
                assignedCount: empJobs.length,
                completedCount: completedJobs.length,
            };
        });
        return map;
    }, [employees, jobsForInstaller, txs, earnings]);

    function handleExportExcel(emp: Employee, lines: any[]) {
        if (lines.length === 0) return;

        const headers = ["Tarih", "Açıklama", "Borç (+)", "Ödeme (-)", "Bakiye"];
        const rows = lines.map((l) => [
            l.date ? formatDate(l.date) : "—",
            l.desc || "",
            l.debit > 0 ? l.debit.toFixed(2) : "0.00",
            l.credit > 0 ? l.credit.toFixed(2) : "0.00",
            l.balance.toFixed(2)
        ]);

        const content = [headers, ...rows].map((row) => row.join(";")).join("\n");
        const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `montajci_${(emp.full_name || "isimsiz").toLowerCase().replace(/\s+/g, "_")}_cari_ekstre_${new Date().toISOString().slice(0, 10)}.csv`);
        link.click();
    }

    function handleExportPDF(emp: Employee, lines: any[], balanceSummary: any) {
        if (lines.length === 0) return;

        const rows = lines
            .map(
                (l) => `
                    <tr>
                        <td>${l.date ? formatDate(l.date) : "—"}</td>
                        <td>${l.desc || ""}</td>
                        <td style="text-align: right; color: #dc2626;">${l.debit > 0 ? `+ ${formatTL(l.debit)}` : "—"}</td>
                        <td style="text-align: right; color: #16a34a;">${l.credit > 0 ? `− ${formatTL(l.credit)}` : "—"}</td>
                        <td style="text-align: right; font-weight: bold; color: ${l.balance > 0 ? "#b91c1c" : l.balance < 0 ? "#1d4ed8" : "#15803d"};">
                            ${formatTL(l.balance)}${l.balance < 0 ? " (Avans)" : ""}
                        </td>
                    </tr>`,
            )
            .join("");

        const printWindow = window.open("", "_blank", "width=1200,height=800");
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
                <head>
                    <title>Montajcı Cari Ekstresi - ${emp.full_name}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; background: #fff; }
                        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #cbd5e1; padding-bottom: 20px; margin-bottom: 30px; }
                        .title h1 { margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; }
                        .title p { margin: 5px 0 0 0; font-size: 14px; color: #64748b; }
                        .details { font-size: 14px; line-height: 1.6; }
                        .summary-grid { display: grid; grid-template-cols: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
                        .summary-card { padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; }
                        .summary-card .label { font-size: 11px; text-transform: uppercase; font-weight: bold; color: #64748b; }
                        .summary-card .val { font-size: 18px; font-weight: 800; margin-top: 5px; color: #0f172a; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { padding: 12px 10px; border-bottom: 1px solid #cbd5e1; font-size: 12px; text-align: left; }
                        th { background: #f1f5f9; font-weight: bold; color: #475569; border-top: 1px solid #cbd5e1; }
                        .text-right { text-align: right; }
                        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="title">
                            <h1>MONTAJCI CARİ EKSTRESİ</h1>
                            <p>${emp.full_name}</p>
                        </div>
                        <div class="details">
                            <div><strong>Tarih:</strong> ${new Date().toLocaleDateString("tr-TR")}</div>
                            <div><strong>Personel Tipi:</strong> Montaj Personeli</div>
                        </div>
                    </div>

                    <div class="summary-grid">
                        <div class="summary-card">
                            <div class="label">Toplam Hakediş</div>
                            <div class="val">${formatTL(balanceSummary.earned)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Toplam Ödenen</div>
                            <div class="val" style="color: #16a34a;">${formatTL(balanceSummary.paid)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Kalan Borç</div>
                            <div class="val" style="color: ${balanceSummary.remaining > 0 ? "#dc2626" : "#16a34a"};">${formatTL(balanceSummary.remaining)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Avans</div>
                            <div class="val" style="color: #2563eb;">${formatTL(balanceSummary.advance)}</div>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th style="width: 100px;">Tarih</th>
                                <th>Açıklama</th>
                                <th style="text-align: right; width: 120px;">Borç (+)</th>
                                <th style="text-align: right; width: 120px;">Ödeme (−)</th>
                                <th style="text-align: right; width: 120px;">Bakiye</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>

                    <div class="footer">
                        Bu döküm sistem tarafından otomatik oluşturulmuştur. © PerdePRO
                    </div>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 500);
    }

    function draftFor(job: Job) {
        // Eski "sabit" kayıtlar manuel olarak gösterilir (geriye dönük uyum)
        const rawType = job.price_type || "manuel";
        return drafts[job.id] ?? {
            price_type: rawType === "sabit" ? "manuel" : rawType,
            unit_rate: String(job.unit_rate ?? 0),
            installer_fee: String(job.installer_fee ?? 0),
        };
    }

    function updateDraft(job: Job, patch: Partial<{ price_type: string; unit_rate: string; installer_fee: string }>) {
        const current = draftFor(job);
        const next = { ...current, ...patch };
        // m2 / adet tipinde tutar otomatik hesaplanır; sabit/manuel'de elle girilir
        const rate = Number(next.unit_rate || 0);
        if (patch.price_type === "m2" || (next.price_type === "m2" && patch.unit_rate !== undefined)) {
            next.installer_fee = String(Math.round(jobArea(job) * rate * 100) / 100);
        } else if (patch.price_type === "adet" || (next.price_type === "adet" && patch.unit_rate !== undefined)) {
            next.installer_fee = String(Math.round(Math.max(1, Number(job.qty ?? 1)) * rate * 100) / 100);
        }
        setDrafts((prev) => ({ ...prev, [job.id]: next }));
    }

    async function saveJobFee(job: Job) {
        const d = draftFor(job);
        setRowSavingId(job.id);
        try {
            const { error } = await supabase.from("installation_jobs").update({
                price_type: d.price_type,
                unit_rate: Number(d.unit_rate || 0),
                installer_fee: Number(d.installer_fee || 0),
            }).eq("id", job.id).eq("company_id", companyId);
            if (error) throw error;
            setJobs((prev) => prev.map((j) => j.id === job.id
                ? { ...j, price_type: d.price_type, unit_rate: Number(d.unit_rate || 0), installer_fee: Number(d.installer_fee || 0) }
                : j));
            setDrafts((prev) => { const n = { ...prev }; delete n[job.id]; return n; });
        } catch {
            setErr("Hakediş tutarı kaydedilemedi. Migration dosyasını çalıştırdığınızdan emin olun.");
        } finally {
            setRowSavingId(null);
        }
    }

    async function handlePay(emp: Employee) {
        const amount = Number(payAmount);
        if (!amount || amount <= 0) { alert("Geçerli bir tutar girin."); return; }
        const bal = ledger[emp.id] ?? { earned: 0, paid: 0, remaining: 0, advance: 0, assignedCount: 0, completedCount: 0 };
        // Kalan borçtan fazla ödeme engellenmez — fark AVANS olarak izlenir
        if (amount > bal.remaining + 0.01) {
            const advanceAmount = Math.round((amount - bal.remaining) * 100) / 100;
            const ok = window.confirm(
                bal.remaining > 0
                    ? `Kalan borç ${formatTL(bal.remaining)}. Fazla ödenen ${formatTL(advanceAmount)} avans olarak kaydedilecek. Devam edilsin mi?`
                    : `Bu montajcının kalan borcu yok. ${formatTL(amount)} avans olarak kaydedilecek. Devam edilsin mi?`
            );
            if (!ok) return;
        }
        setSaving(true);
        try {
            const empJobs = jobsForInstaller(emp).filter((j) => j.status === "completed");
            const periodLabel = payStart && payEnd ? `${formatDate(payStart)} - ${formatDate(payEnd)}` : formatDate(new Date().toISOString());
            const desc = `${emp.full_name || "Montajcı"} ödemesi (${periodLabel}, ${empJobs.length} iş)${payNote ? ` - ${payNote}` : ""}`;

            const result = await financeService.installerPayments.recordPayment({
                companyId,
                installerId: emp.id,
                amount,
                method: payMethod,
                periodStart: payStart || null,
                periodEnd: payEnd || null,
                note: desc,
                idempotencyKey: crypto.randomUUID(),
            });
            if (result.status === "error") throw result.error;

            setPayModalId(null);
            setPayAmount(""); setPayNote(""); setPayStart(""); setPayEnd("");
            await load();
        } catch (e: any) {
            const msg = String(e?.message || "");
            setErr(msg.includes("installer_record_payment")
                ? "Montajcı ödeme servisi bulunamadı. supabase_installer_payment_finance_rpc.sql dosyasını SQL Editor'da çalıştırın."
                : "Ödeme kaydedilemedi. Lütfen tekrar deneyin.");
        } finally {
            setSaving(false);
        }
    }

    async function handleAddEarning(emp: Employee, amount: number, date: string, description: string) {
        setSaving(true);
        try {
            const result = await financeService.installerPayments.addManualEarning({
                companyId,
                installerId: emp.id,
                amount,
                earningDate: date,
                description,
                idempotencyKey: crypto.randomUUID(),
            });
            if (result.status === "error") throw result.error;

            setAddEarningModalId(null);
            await load();
        } catch (e: any) {
            throw e?.message || "Hakediş kaydedilemedi. Lütfen tekrar deneyin.";
        } finally {
            setSaving(false);
        }
    }

    async function cancelPayment(tx: InstallerTx) {
        if (!window.confirm(`${formatTL(Number(tx.amount))} tutarındaki ödeme iptal edilsin mi? Bağlı gider kaydı silinmez; yerine ters (iptal) kaydı oluşturulur.`)) return;
        setSaving(true);
        try {
            const result = await financeService.installerPayments.cancelPayment({
                companyId,
                transactionId: tx.id,
                idempotencyKey: crypto.randomUUID(),
            });
            if (result.status === "error") throw result.error;
            await load();
        } catch {
            setErr("Ödeme iptal edilemedi. Lütfen tekrar deneyin.");
        } finally {
            setSaving(false);
        }
    }

    const installers = employees; // tüm aktif personel; işi olanlar üstte
    const sortedInstallers = useMemo(() =>
        [...installers].sort((a, b) => (jobsForInstaller(b).length - jobsForInstaller(a).length)),
    [installers, jobsForInstaller]);

    const summaryData = useMemo(() => {
        let totalDebt = 0;
        let totalPaidThisMonth = 0;
        let pendingJobsCount = 0;
        let completedJobsThisMonth = 0;
        let earnedThisMonth = 0;

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        sortedInstallers.forEach(emp => {
            const bal = ledger[emp.id];
            if (bal) totalDebt += bal.remaining;
            
            const empJobs = jobsForInstaller(emp);
            pendingJobsCount += empJobs.filter(j => j.status !== "completed" && j.status !== "cancelled" && j.status !== "canceled").length;
            
            // "Bu Ay Tamamlanan" = bu ay içinde status=completed olan işler
            // updated_at varsa kullan (gerçek tamamlanma zamanı); yoksa scheduled_date'e düş
            const completedThisMonth = empJobs.filter(j => {
                if (j.status !== "completed") return false;
                const dateKey = j.updated_at || j.scheduled_date || "";
                return dateKey >= startOfMonth;
            });
            completedJobsThisMonth += completedThisMonth.length;
            earnedThisMonth += completedThisMonth.reduce((acc, j) => acc + Number(j.installer_fee ?? 0), 0);
        });

        txs.forEach(t => {
            if (t.transaction_type === "payment" && t.transaction_date >= startOfMonth) {
                totalPaidThisMonth += Number(t.amount);
            } else if (t.transaction_type === "cancel" && t.transaction_date >= startOfMonth) {
                totalPaidThisMonth -= Number(t.amount);
            }
        });

        return { 
            totalDebt, 
            totalPaidThisMonth, 
            activeInstallers: sortedInstallers.length, 
            pendingJobsCount,
            completedJobsThisMonth,
            earnedThisMonth
        };
    }, [sortedInstallers, ledger, jobsForInstaller, txs]);

    if (loading) return <div className="p-10 text-center text-sm text-slate-500">Montajcı cari yükleniyor...</div>;

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 pb-24">
            {!hideTitle && (
                <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-primary-100 p-3 text-primary-600 dark:bg-primary-900/30">
                        <UserCog className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Montajcı Cari</h1>
                        <p className="text-sm text-slate-500">Montajcı hakedişlerini görün, ödeme yapın, cari bakiyeyi takip edin.</p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                        <TrendingUp className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Top. Borç</span>
                    </div>
                    <div className="text-xl lg:text-2xl font-black text-slate-900 dark:text-white">{formatTL(summaryData.totalDebt)}</div>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-900/30 dark:bg-emerald-950/20 flex flex-col justify-between">
                    <div className="flex items-center gap-2 text-emerald-600 mb-2">
                        <HandCoins className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Ay Ödenen</span>
                    </div>
                    <div className="text-xl lg:text-2xl font-black text-emerald-700 dark:text-emerald-400">{formatTL(summaryData.totalPaidThisMonth)}</div>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 shadow-sm dark:border-indigo-900/30 dark:bg-indigo-950/20 flex flex-col justify-between">
                    <div className="flex items-center gap-2 text-indigo-600 mb-2">
                        <Wallet className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Ay Hakediş</span>
                    </div>
                    <div className="text-xl lg:text-2xl font-black text-indigo-700 dark:text-indigo-400">{formatTL(summaryData.earnedThisMonth)}</div>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 shadow-sm dark:border-blue-900/30 dark:bg-blue-950/20 flex flex-col justify-between">
                    <div className="flex items-center gap-2 text-blue-600 mb-2">
                        <Users className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Montajcı</span>
                    </div>
                    <div className="text-xl lg:text-2xl font-black text-blue-700 dark:text-blue-400">{summaryData.activeInstallers} Kişi</div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/20 flex flex-col justify-between">
                    <div className="flex items-center gap-2 text-amber-600 mb-2">
                        <Briefcase className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Bekleyen</span>
                    </div>
                    <div className="text-xl lg:text-2xl font-black text-amber-700 dark:text-amber-400">{summaryData.pendingJobsCount} İş</div>
                </div>
                <div className="rounded-2xl border border-teal-100 bg-teal-50/50 p-4 shadow-sm dark:border-teal-900/30 dark:bg-teal-950/20 flex flex-col justify-between">
                    <div className="flex items-center gap-2 text-teal-600 mb-2">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Tamamlanan</span>
                    </div>
                    <div className="text-xl lg:text-2xl font-black text-teal-700 dark:text-teal-400">{summaryData.completedJobsThisMonth} İş</div>
                </div>
            </div>

            {needsMigration && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Hakediş alanları için <b>supabase_installer_ledger.sql</b> migration dosyasını SQL Editor'da çalıştırın.
                </div>
            )}
            {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

            {sortedInstallers.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    Aktif personel bulunamadı.
                </div>
            ) : (
                sortedInstallers.map((emp) => {
                    const bal = ledger[emp.id] ?? { earned: 0, paid: 0, remaining: 0, advance: 0, assignedCount: 0, completedCount: 0 };
                    const remaining = bal.remaining;
                    const empJobs = jobsForInstaller(emp);
                    const empTxs = txs.filter((t) => emp.allIds.includes(t.installer_id));
                    const isOpen = openBalanceId === emp.id;

                    return (
                        <div key={emp.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                            {/* Montajcı kartı - Modern Tasarım */}
                            <div className="flex flex-col md:flex-row md:items-stretch border-b border-slate-100 dark:border-slate-800">
                                {/* Sol Bölüm: İsim & Telefon & Son Ödeme */}
                                <div className="flex-1 p-5 md:border-r border-slate-100 dark:border-slate-800 flex flex-col justify-center bg-white dark:bg-slate-900">
                                    <div className="font-black text-xl text-slate-900 dark:text-white mb-2">
                                        {emp.full_name || "İsimsiz"}
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                            <Phone className="h-4 w-4 text-slate-400" /> Kayıtlı Değil
                                        </div>
                                        <div className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                            <CalendarCheck className="h-4 w-4 text-slate-400" /> Son Öd: {(() => {
                                                const lastPay = empTxs.find(t => t.transaction_type === "payment");
                                                return lastPay ? formatDate(lastPay.transaction_date) : "Yok";
                                            })()}
                                        </div>
                                    </div>
                                </div>

                                {/* Orta Bölüm: Dev Kalan Bakiye */}
                                <div className="flex-1 p-5 md:border-r border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-950/30">
                                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Kalan Bakiye</div>
                                    <div className={`text-4xl lg:text-5xl font-black ${
                                        remaining === 0 ? "text-emerald-500" :
                                        remaining < 5000 ? "text-amber-500" : "text-red-500"
                                    }`}>
                                        {formatTL(remaining)}
                                    </div>
                                    {bal.advance > 0 && (
                                        <div className="text-sm font-bold text-blue-500 mt-2 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full">
                                            + {formatTL(bal.advance)} Avans
                                        </div>
                                    )}
                                </div>

                                {/* Sağ Bölüm: İstatistikler */}
                                <div className="flex-1 p-5 grid grid-cols-2 gap-y-4 gap-x-2 bg-white dark:bg-slate-900 text-center items-center">
                                    {(() => {
                                        const now = new Date();
                                        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                                        // updated_at = gerçek tamamlanma tarihi (varsa); yoksa scheduled_date
                                        const completedThisMonth = empJobs.filter(j => {
                                            if (j.status !== "completed") return false;
                                            const dk = j.updated_at || j.scheduled_date || "";
                                            return dk >= startOfMonth;
                                        });
                                        const m2ThisMonth = completedThisMonth.reduce((acc, j) => acc + jobArea(j), 0);
                                        const pendingCount = empJobs.filter(j => j.status !== "completed" && j.status !== "cancelled" && j.status !== "canceled").length;
                                        return (
                                            <>
                                                <div className="flex flex-col items-center justify-center">
                                                    <div className="text-[10px] font-bold uppercase text-slate-400">Top. Hakediş</div>
                                                    <div className="text-sm font-black text-slate-700 dark:text-slate-200">{formatTL(bal.earned)}</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center">
                                                    <div className="text-[10px] font-bold uppercase text-slate-400">Top. Ödenen</div>
                                                    <div className="text-sm font-black text-emerald-600">{formatTL(bal.paid)}</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center">
                                                    <div className="text-[10px] font-bold uppercase text-slate-400">Bu Ay Tamam.</div>
                                                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{completedThisMonth.length} İş</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center">
                                                    <div className="text-[10px] font-bold uppercase text-slate-400">Bu Ay m²</div>
                                                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{m2ThisMonth.toFixed(1)} m²</div>
                                                </div>
                                                <div className="col-span-2 flex flex-col items-center justify-center pt-2 border-t border-slate-100 dark:border-slate-800">
                                                    <div className="text-[10px] font-bold uppercase text-slate-400">Bekleyen İş</div>
                                                    <div className="text-sm font-black text-amber-600">{pendingCount} Adet</div>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>

                                {/* En Sağ Bölüm: Butonlar */}
                                <div className="p-5 flex flex-row md:flex-col items-center justify-center gap-3 md:border-l border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 min-w-[160px]">
                                    <button
                                        type="button"
                                        onClick={() => { setPayModalId(emp.id); setPayAmount(remaining > 0 ? String(remaining) : ""); }}
                                        className="w-full flex-1 md:flex-none inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 md:py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 transition"
                                    >
                                        <Wallet className="h-4 w-4" /> Ödeme Yap
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAddEarningModalId(emp.id)}
                                        className="w-full flex-1 md:flex-none inline-flex items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 py-3 md:py-3 text-sm font-black text-amber-700 border border-amber-200 shadow-sm hover:bg-amber-100 transition dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-500"
                                    >
                                        <Plus className="h-4 w-4" /> Hakediş Ekle
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOpenBalanceId(isOpen ? null : emp.id)}
                                        className={`w-full flex-1 md:flex-none inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 md:py-3 text-sm font-bold shadow-sm transition ${
                                            isOpen ? "bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                        }`}
                                    >
                                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                        Detay & Ekstre
                                    </button>
                                </div>
                            </div>

                            {/* Bakiye Gör paneli (Detay & Ekstre - Muhasebe Mantığı) */}
                            {isOpen && (
                                <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/20 p-4 md:p-6 space-y-6">
                                    {/* Bekleyen İşler (varsa) */}
                                    {(() => {
                                        const pendingJobs = empJobs.filter(j => j.status !== "completed" && j.status !== "cancelled" && j.status !== "canceled");
                                        if (pendingJobs.length === 0) return null;
                                        return (
                                            <div>
                                                <h4 className="mb-3 text-sm font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                                                    <Briefcase className="h-4 w-4" /> Bekleyen / Devam Eden İşler ({pendingJobs.length})
                                                </h4>
                                                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-100 dark:border-amber-900/50">
                                                            <tr>
                                                                <th className="px-3 py-2 text-left text-[11px] font-black uppercase text-amber-800 dark:text-amber-500">Tarih</th>
                                                                <th className="px-3 py-2 text-left text-[11px] font-black uppercase text-amber-800 dark:text-amber-500">Müşteri / Adres</th>
                                                                <th className="px-3 py-2 text-left text-[11px] font-black uppercase text-amber-800 dark:text-amber-500">Ürün</th>
                                                                <th className="px-3 py-2 text-right text-[11px] font-black uppercase text-amber-800 dark:text-amber-500">Durum</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                                            {pendingJobs.map(job => {
                                                                const st = STATUS_LABELS[String(job.status || "waiting")] ?? STATUS_LABELS.waiting;
                                                                return (
                                                                    <tr key={job.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{formatDate(job.scheduled_date)}</td>
                                                                        <td className="px-3 py-2">
                                                                            <div className="font-bold text-slate-800 dark:text-slate-200">{job.customer_name || "—"}</div>
                                                                            <div className="text-xs text-slate-400 max-w-[200px] truncate">{job.address || ""}</div>
                                                                        </td>
                                                                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{productLabel(job.product_type)}{job.room ? ` (${job.room})` : ""}</td>
                                                                        <td className="px-3 py-2 text-right">
                                                                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${st.cls}`}>{st.label}</span>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Birleşik Ekstre (Ledger) */}
                                    {(() => {
                                        type LedgerLine = { id: string; date: string; desc: string; debit: number; credit: number; type: "job"|"payment"|"cancel"|"earning"; raw: any; };
                                        const lines: LedgerLine[] = [];
                                        
                                        empJobs.filter((j) => j.status === "completed").forEach((j) => {
                                            lines.push({
                                                id: j.id,
                                                date: j.scheduled_date || "",
                                                desc: `Hakediş: ${j.customer_name || "Müşteri"} — ${productLabel(j.product_type)}`,
                                                debit: Number(j.installer_fee ?? 0),
                                                credit: 0,
                                                type: "job",
                                                raw: j
                                            });
                                        });

                                        // 'earning' tipi hareketler manuel hakedişin denetim aynasıdır;
                                        // ekstre satırı olarak aşağıda installer_earnings'ten (kanonik
                                        // kaynak) eklenir — burada çift satır olmasın diye hariç tutulur.
                                        empTxs
                                            .filter((t) => t.transaction_type !== "earning")
                                            .forEach((t) => {
                                                const amt = Number(t.amount ?? 0);
                                                lines.push({
                                                    id: t.id,
                                                    date: t.transaction_date?.slice(0, 10) || "",
                                                    desc: t.description || (t.transaction_type === "cancel" ? "Ödeme İptali" : "Ödeme"),
                                                    debit: t.transaction_type === "cancel" ? amt : 0,
                                                    credit: t.transaction_type === "payment" ? amt : 0,
                                                    type: t.transaction_type as "payment"|"cancel",
                                                    raw: t,
                                                });
                                            });

                                        // Manuel hakediş satırları (installer_earnings: earning_type='manual',
                                        // installation_job_id IS NULL). Her satır kendi tutarını Borç (+) olarak
                                        // gösterir ve running balance'a kronolojik olarak katkı verir.
                                        earnings
                                            .filter((e) => emp.allIds.includes(e.installer_id) && e.earning_type === "manual" && e.installation_job_id === null)
                                            .forEach((e) => {
                                                lines.push({
                                                    id: e.id,
                                                    date: (e.job_completed_date || e.created_at)?.slice(0, 10) || "",
                                                    desc: e.metadata?.description ? `Manuel Hakediş: ${e.metadata.description}` : "Manuel Hakediş",
                                                    debit: Number(e.total_earning ?? 0),
                                                    credit: 0,
                                                    type: "earning",
                                                    raw: e,
                                                });
                                            });

                                        if (lines.length === 0) {
                                            return <div className="text-sm text-slate-500 text-center py-6">Henüz hakediş veya ödeme hareketi yok.</div>;
                                        }

                                        lines.sort((a, b) => a.date.localeCompare(b.date) || ((a.type === "job" || a.type === "earning") ? -1 : 1));
                                        
                                        let running = 0;
                                        const withBalance = lines.map((l) => {
                                            running = Math.round((running + l.debit - l.credit) * 100) / 100;
                                            return { ...l, balance: running };
                                        });

                                        return (
                                            <div>
                                                <div className="flex items-center justify-between mb-3 relative">
                                                    <h4 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                                                        <FileSpreadsheet className="h-5 w-5 text-primary-500" /> Hareket Geçmişi & Ekstre
                                                    </h4>
                                                    <div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveDropdownId(activeDropdownId === emp.id ? null : emp.id)}
                                                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition"
                                                        >
                                                            <Download className="h-4 w-4" />
                                                            Döküm Al
                                                            <ChevronDown className="h-3 w-3" />
                                                        </button>
                                                        {activeDropdownId === emp.id && (
                                                            <>
                                                                <div
                                                                    className="fixed inset-0 z-10"
                                                                    onClick={() => setActiveDropdownId(null)}
                                                                />
                                                                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-100 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900 z-20 animate-in fade-in zoom-in-95 duration-100">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setActiveDropdownId(null);
                                                                            handleExportPDF(emp, withBalance, bal);
                                                                        }}
                                                                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                                                                    >
                                                                        <Printer className="h-4 w-4 text-slate-400" />
                                                                        PDF Olarak İndir
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setActiveDropdownId(null);
                                                                            handleExportExcel(emp, withBalance);
                                                                        }}
                                                                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                                                                    >
                                                                        <FileSpreadsheet className="h-4 w-4 text-slate-400" />
                                                                        Excel Olarak İndir
                                                                    </button>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                                                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wider text-slate-500">Tarih</th>
                                                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wider text-slate-500">İşlem / Açıklama</th>
                                                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wider text-slate-500">Detay (m² / Fiyat)</th>
                                                                    <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-wider text-slate-500">Borç (+) (Hakediş)</th>
                                                                    <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-wider text-slate-500">Alacak (−) (Ödeme)</th>
                                                                    <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-wider text-slate-500">Bakiye</th>
                                                                    <th className="px-4 py-3 w-10"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                                                {withBalance.map((l) => {
                                                                    const isJob = l.type === "job";
                                                                    const isPayment = l.type === "payment";
                                                                    const isCancel = l.type === "cancel";
                                                                    const isEarning = l.type === "earning";
                                                                    const d = isJob ? draftFor(l.raw) : null;
                                                                    const isAuto = isJob && d && (d.price_type === "m2" || d.price_type === "adet");
                                                                    const dirty = isJob && d && Boolean(drafts[l.raw.id]);
                                                                    
                                                                    return (
                                                                        <tr key={l.id + l.type} className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${isCancel ? 'bg-red-50/30 dark:bg-red-900/10' : isPayment ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : ''}`}>
                                                                            <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">{l.date ? formatDate(l.date) : "—"}</td>
                                                                            <td className="px-4 py-3">
                                                                                <div className={`font-bold ${isPayment ? 'text-emerald-700 dark:text-emerald-400' : isCancel ? 'text-red-700 dark:text-red-400' : isEarning ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                                                                    {isPayment ? "Ödeme Yapıldı" : isCancel ? "Ödeme İptali" : isEarning ? "Manuel Hakediş" : "Montaj Tamamlandı"}
                                                                                </div>
                                                                                <div className="text-xs text-slate-500 mt-0.5 max-w-[280px] truncate" title={l.desc}>
                                                                                    {l.desc}
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-3">
                                                                                {isJob ? (
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-xs text-slate-500 w-16">
                                                                                            {jobArea(l.raw) > 0 ? `${jobArea(l.raw).toFixed(2)} m²` : "—"}
                                                                                        </span>
                                                                                        <select
                                                                                            value={d!.price_type}
                                                                                            onChange={(e) => updateDraft(l.raw, { price_type: e.target.value })}
                                                                                            className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-bold dark:border-slate-700 dark:bg-slate-900"
                                                                                        >
                                                                                            <option value="manuel">Manuel</option>
                                                                                            <option value="m2">m² bazlı</option>
                                                                                            <option value="adet">Adet bazlı</option>
                                                                                        </select>
                                                                                        <input
                                                                                            type="number"
                                                                                            value={d!.unit_rate}
                                                                                            disabled={!isAuto}
                                                                                            onChange={(e) => updateDraft(l.raw, { unit_rate: e.target.value })}
                                                                                            className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 text-right text-[10px] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
                                                                                            placeholder="Birim"
                                                                                        />
                                                                                    </div>
                                                                                ) : (
                                                                                    <span className="text-xs text-slate-400">—</span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right">
                                                                                {isJob ? (
                                                                                    <div className="flex flex-col items-end gap-1">
                                                                                        <input
                                                                                            type="number"
                                                                                            value={d!.installer_fee}
                                                                                            disabled={isAuto ?? false}
                                                                                            onChange={(e) => updateDraft(l.raw, { installer_fee: e.target.value })}
                                                                                            className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm font-black text-red-600 focus:border-red-400 focus:ring-1 focus:ring-red-400 disabled:opacity-80 dark:border-slate-700 dark:bg-slate-900"
                                                                                        />
                                                                                        {dirty && (
                                                                                            <button
                                                                                                type="button"
                                                                                                disabled={rowSavingId === l.raw.id}
                                                                                                onClick={() => void saveJobFee(l.raw)}
                                                                                                className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-red-700 disabled:opacity-50"
                                                                                            >
                                                                                                {rowSavingId === l.raw.id ? "..." : "Kaydet"}
                                                                                            </button>
                                                                                        )}
                                                                                    </div>
                                                                                ) : isCancel ? (
                                                                                    <span className="font-bold text-red-600">+ {formatTL(l.debit)}</span>
                                                                                ) : isEarning ? (
                                                                                    <span className="font-black text-amber-600 dark:text-amber-400">+ {formatTL(l.debit)}</span>
                                                                                ) : (
                                                                                    <span className="text-slate-300">—</span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right">
                                                                                {isPayment ? (
                                                                                    <span className="font-bold text-emerald-600">− {formatTL(l.credit)}</span>
                                                                                ) : (
                                                                                    <span className="text-slate-300">—</span>
                                                                                )}
                                                                            </td>
                                                                            <td className={`px-4 py-3 text-right font-black whitespace-nowrap ${l.balance > 0 ? "text-red-600 dark:text-red-400" : l.balance < 0 ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                                                {formatTL(l.balance)}{l.balance < 0 ? " (Avans)" : ""}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right">
                                                                                {isPayment && (
                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={saving}
                                                                                        onClick={() => void cancelPayment(l.raw)}
                                                                                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 disabled:opacity-50 transition"
                                                                                        title="Ödemeyi İptal Et"
                                                                                    >
                                                                                        <X className="h-4 w-4" />
                                                                                    </button>
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                            <tfoot className="bg-slate-50 dark:bg-slate-800 border-t-2 border-slate-200 dark:border-slate-700">
                                                                <tr>
                                                                    <td colSpan={3} className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">
                                                                        Genel Toplamlar:
                                                                    </td>
                                                                    <td className="px-4 py-3 text-right text-sm font-black text-red-600">{formatTL(bal.earned)}</td>
                                                                    <td className="px-4 py-3 text-right text-sm font-black text-emerald-600">{formatTL(bal.paid)}</td>
                                                                    <td className="px-4 py-3 text-right text-sm font-black whitespace-nowrap">
                                                                        <span className={remaining > 0 ? "text-red-600" : "text-emerald-600"}>{formatTL(remaining)}</span>
                                                                    </td>
                                                                    <td></td>
                                                                </tr>
                                                            </tfoot>
                                                        </table>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Ödeme Yap modalı */}
                            {payModalId === emp.id && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                                    <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-black text-slate-900 dark:text-white">{emp.full_name} — Ödeme Yap</h3>
                                            <button onClick={() => setPayModalId(null)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700">✕</button>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center dark:border-slate-700 dark:bg-slate-800/50">
                                            <div>
                                                <div className="text-[10px] font-bold uppercase text-slate-500">Hakediş</div>
                                                <div className="text-sm font-black text-slate-700 dark:text-slate-300">{formatTL(bal.earned)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-bold uppercase text-emerald-600">Ödenen</div>
                                                <div className="text-sm font-black text-emerald-700">{formatTL(bal.paid)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-bold uppercase text-blue-600">Avans</div>
                                                <div className="text-sm font-black text-blue-700">{formatTL(bal.advance)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-bold uppercase text-red-600">Kalan Borç</div>
                                                <div className="text-sm font-black text-red-700">{formatTL(remaining)}</div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="mb-1 block text-xs font-bold text-slate-500">Dönem Başı (ops.)</label>
                                                <input type="date" value={payStart} onChange={(e) => setPayStart(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-bold text-slate-500">Dönem Sonu (ops.)</label>
                                                <input type="date" value={payEnd} onChange={(e) => setPayEnd(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-bold text-slate-500">Tutar (₺)</label>
                                                <input type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-bold text-slate-500">Yöntem</label>
                                                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                                                    <option value="nakit">Nakit</option>
                                                    <option value="eft">EFT</option>
                                                    <option value="havale">Havale</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-slate-500">Not</label>
                                            <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="İsteğe bağlı" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                                        </div>
                                        {Number(payAmount) > 0 && (() => {
                                            const after = Math.round((remaining - Number(payAmount)) * 100) / 100;
                                            return after >= 0 ? (
                                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                                                    Ödeme sonrası kalan borç: {formatTL(after)}
                                                </div>
                                            ) : (
                                                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
                                                    Kalan borç 0 — {formatTL(Math.abs(after) + bal.advance)} avans oluşacak
                                                </div>
                                            );
                                        })()}
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => void handlePay(emp)}
                                            className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                                        >
                                            {saving ? "Kaydediliyor..." : "Ödemeyi Kaydet"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Hakediş Ekle Modal */}
                            {addEarningModalId === emp.id && (
                                <ManualEarningModal
                                    employee={emp}
                                    onSave={(amount, date, description) => handleAddEarning(emp, amount, date, description)}
                                    onCancel={() => setAddEarningModalId(null)}
                                />
                            )}
                        </div>
                    );
                })
            )}

            {/* Son Ödemeler Tablosu */}
            {txs.length > 0 && (
                <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">Sistemdeki Son Ödemeler</h2>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase text-slate-500">Tarih</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase text-slate-500">Montajcı</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase text-slate-500">Açıklama</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-black uppercase text-slate-500">Yöntem</th>
                                    <th className="px-4 py-3 text-right text-[11px] font-black uppercase text-slate-500">Tutar</th>
                                </tr>
                            </thead>
                            <tbody>
                                {txs.slice(0, 10).map((tx, idx) => {
                                    const emp = employees.find(e => e.allIds.includes(tx.installer_id));
                                    return (
                                        <tr key={tx.id} className={`border-b border-slate-50 dark:border-slate-800 ${idx % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-slate-950/30"} hover:bg-slate-50 dark:hover:bg-slate-800 transition`}>
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                                                {formatDate(tx.transaction_date)}
                                            </td>
                                            <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-200">
                                                {emp?.full_name || "İsimsiz"}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                {tx.description || (tx.transaction_type === "cancel" ? "İptal" : "Ödeme")}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300 capitalize">
                                                {tx.payment_method || "—"}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-black whitespace-nowrap ${tx.transaction_type === "cancel" ? "text-red-600" : "text-emerald-600"}`}>
                                                {tx.transaction_type === "cancel" ? "+" : "−"} {formatTL(Number(tx.amount))}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
