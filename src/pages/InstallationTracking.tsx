import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "../hooks/usePersistedState";
import { CalendarClock, Check, CheckCircle2, ClipboardList, Filter, MapPin, Phone, RefreshCcw, Search, UserCheck, X, TrendingUp } from "lucide-react";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import FieldInfoGallery from "../components/FieldInfoGallery";
import { parseFieldInfo, hasFieldInfo, type FieldInfo } from "../utils/fieldInfo";
import { normalizeOrderStatus, ORDER_STATUS } from "../utils/order";

type InstallationStatus = "waiting" | "planned" | "assigned" | "onway" | "installing" | "issue" | "completed";

type JobRow = {
  id: string;
  company_id: string | null;
  order_id: string;
  customer_id: string | null;
  assigned_staff_id: string | null;
  status: InstallationStatus | string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  product_type: string | null;
  room: string | null;
  width: number | null;
  height: number | null;
  total_amount: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  field_info?: FieldInfo | null;
};

type StaffOption = {
  id: string;
  name: string;
  // Aynı kişinin diğer kimliği (employee.id veya user_id) — eşleştirme için
  altIds?: string[];
};

const STATUS_OPTIONS: Array<{ value: InstallationStatus; label: string; orderStatus?: string }> = [
  { value: "waiting", label: "Montaj Bekliyor", orderStatus: "montaja_hazir" },
  { value: "planned", label: "Montaj Tarihi Planlandı", orderStatus: "montaj_planlandi" },
  { value: "assigned", label: "Montajcıya Atandı", orderStatus: "montaj_planlandi" },
  { value: "onway", label: "Yolda", orderStatus: "montajda" },
  { value: "installing", label: "Montaj Yapılıyor", orderStatus: "montajda" },
  { value: "issue", label: "Eksik / Problem Var" },
  { value: "completed", label: "Montaj Tamamlandı", orderStatus: "montaj_tamamlandi" },
];

// Montaj takibi sekmeleri — mevcut installation_jobs verisinden türetilir (ekstra sorgu yok):
//   tamamlanan → job kanonik olarak COMPLETED (order.ts köprüsüyle, legacy değerler dahil)
//   atanan     → tamamlanmamış + montajcı atanmış
//   bekleyen   → tamamlanmamış + montajcı atanmamış
type InstallationTab = "bekleyen" | "atanan" | "tamamlanan";

function jobTab(row: { status?: string | null; assigned_staff_id?: string | null }): InstallationTab {
  if (normalizeOrderStatus(row.status) === ORDER_STATUS.COMPLETED) return "tamamlanan";
  return row.assigned_staff_id ? "atanan" : "bekleyen";
}

function isMissingInstallationTable(error: unknown) {
  const message = String((error as any)?.message ?? error ?? "");
  return /installation_jobs|schema cache|could not find|does not exist|relation .* does not exist/i.test(message);
}

function statusLabel(status?: string | null) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status ?? "-";
}

function statusClass(status?: string | null) {
  if (status === "completed") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (status === "issue") return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
  if (status === "onway" || status === "installing") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  if (status === "planned" || status === "assigned") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function formatDate(date?: string | null, time?: string | null) {
  if (!date && !time) return "-";
  return [date ? new Date(`${date}T00:00:00`).toLocaleDateString("tr-TR") : null, time ? String(time).slice(0, 5) : null].filter(Boolean).join(" ");
}

function formatMoney(value?: number | null) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

type ModalType = "date" | "installer" | "status" | null;

export default function InstallationTracking() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [needsMigration, setNeedsMigration] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = usePersistedState("perdepro.installtracking.status", "all");
  const [dateFilter, setDateFilter] = usePersistedState("perdepro.installtracking.date", "all");
  const [installerFilter, setInstallerFilter] = usePersistedState("perdepro.installtracking.installer", "all");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Varsayılan açık: tamamlanan işler "Tüm durumlar" görünümünde gizlenmesin
  const [activeTab, setActiveTab] = useState<InstallationTab>("bekleyen");
  // Earnings summary for selected installer
  const [installerEarnings, setInstallerEarnings] = useState<any>(null);

  // Modal state
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalRow, setModalRow] = useState<JobRow | null>(null);
  const [modalDate, setModalDate] = useState("");
  const [modalTime, setModalTime] = useState("10:00");
  const [modalStaff, setModalStaff] = useState("");
  const [modalStatus, setModalStatus] = useState<InstallationStatus>("waiting");
  const [modalNote, setModalNote] = useState("");
  // Completion confirmation modal
  const [confirmCompleteRow, setConfirmCompleteRow] = useState<JobRow | null>(null);

  const loadInstallerEarnings = useCallback(async (installerId: string) => {
    try {
      const ctx = await getEffectiveTenantContext();

      // get_installer_cari_summary RPC'si ARTIK KULLANILMIYOR — bu RPC yalnızca
      // eski, kaldırılmış "earning/payment/adjustment" komisyon sistemine ait
      // tipleri tanıyordu ve installer_cancel_payment RPC'sinin ürettiği 'cancel'
      // (ödeme iptali) satırlarını hiç tanımıyordu; iptal edilen ödemeler bakiyeden
      // sessizce düşmüyordu. Aşağıdaki hesap InstallerLedger.tsx'teki formülle
      // BİREBİR AYNIDIR: Hakediş − (Ödeme − İptal) = Kalan.
      const [jobsRes, txRes] = await Promise.all([
        supabase
          .from("installation_jobs")
          .select("installer_fee, status")
          .eq("assigned_staff_id", installerId)
          .eq("company_id", ctx.company_id),
        supabase
          .from("installer_transactions")
          .select("transaction_type, amount")
          .eq("installer_id", installerId)
          .eq("company_id", ctx.company_id),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      if (txRes.error) throw txRes.error;

      const earned = (jobsRes.data ?? [])
        .filter((j) => j.status === "completed")
        .reduce((a, j) => a + Number(j.installer_fee ?? 0), 0);
      const paid = (txRes.data ?? []).reduce(
        (a, t) => a + (t.transaction_type === "payment" ? Number(t.amount) : -Number(t.amount)),
        0,
      );
      const remaining = Math.max(Math.round((earned - paid) * 100) / 100, 0);

      setInstallerEarnings({
        total_earnings: earned,
        total_paid: paid,
        balance: remaining,
        transaction_count: (txRes.data ?? []).length,
      });
    } catch (e) {
      console.error("Failed to load earnings:", e);
      setInstallerEarnings(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    setNeedsMigration(false);
    try {
      const ctx = await getEffectiveTenantContext();
      const { data, error } = await supabase
        .from("installation_jobs")
        .select("id,company_id,order_id,customer_id,assigned_staff_id,status,scheduled_date,scheduled_time,customer_name,phone,address,product_type,room,width,height,total_amount,notes,created_at,updated_at")
        .eq("company_id", ctx.company_id)
        .order("created_at", { ascending: false });

      if (error) {
        if (isMissingInstallationTable(error)) {
          setRows([]);
          setNeedsMigration(true);
          return;
        }
        throw error;
      }

      const jobRows = (data ?? []) as JobRow[];
      // Saha bilgilerini (kartela, foto, sesli/montaj notu) order_items.product_options'tan eşle (order_id ile).
      try {
        const orderIds = Array.from(new Set(jobRows.map((r) => r.order_id).filter(Boolean)));
        if (orderIds.length > 0) {
          const { data: itemRows } = await supabase
            .from("order_items")
            .select("order_id, product_options")
            .in("order_id", orderIds);
          const infoByOrder = new Map<string, FieldInfo>();
          (itemRows ?? []).forEach((row: any) => {
            if (!row?.order_id || infoByOrder.has(row.order_id)) return;
            const fi = parseFieldInfo(row.product_options);
            if (hasFieldInfo(fi)) infoByOrder.set(row.order_id, fi);
          });
          jobRows.forEach((r) => { if (r.order_id && infoByOrder.has(r.order_id)) r.field_info = infoByOrder.get(r.order_id) ?? null; });
        }
      } catch { /* order_items okunamazsa saha bilgisi atlanır, montaj listesi bozulmaz */ }
      setRows(jobRows);

      const { data: employees, error: empErr } = await supabase
        .from("employees")
        .select("id,user_id,full_name,target_role,is_active")
        .eq("company_id", ctx.company_id)
        .eq("is_active", true)
        .order("full_name");
      if (empErr) console.warn("Montajcı listesi yüklenemedi:", empErr.message);

      // İsme göre tekilleştir (aynı isimli kopya kayıtlar tek görünsün);
      // tüm kimlikleri (employee.id + user_id) eşleştirme için sakla
      const seen = new Map<string, StaffOption>();
      ((employees ?? []) as any[]).forEach((employee) => {
        const name = (employee.full_name || "İsimsiz").trim();
        const key = name.toLocaleLowerCase("tr-TR");
        const ids = [employee.user_id, employee.id].filter(Boolean) as string[];
        const existing = seen.get(key);
        if (existing) {
          existing.altIds = Array.from(new Set([...(existing.altIds ?? []), ...ids]));
        } else {
          seen.set(key, { id: employee.user_id || employee.id, name, altIds: ids });
        }
      });
      setStaff(Array.from(seen.values()));
    } catch (e: any) {
      setRows([]);
      setErr(e?.message ?? "Montaj takibi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Load earnings when installer filter changes
  useEffect(() => {
    if (installerFilter !== "all") {
      void loadInstallerEarnings(installerFilter);
    } else {
      setInstallerEarnings(null);
    }
  }, [installerFilter, loadInstallerEarnings]);

  // Sekme dışı temel filtreler (arama / durum / montajcı / tarih). Tamamlanma
  // durumu artık sekmelerle ayrıştırılır; mevcut filtreler aynen korunur.
  const baseFilteredRows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr-TR");
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndText = weekEnd.toISOString().slice(0, 10);

    return rows.filter((row) => {
      const haystack = [row.order_id, row.customer_name, row.phone, row.address, row.product_type, row.room, row.width, row.height, row.notes, row.status].join(" ").toLocaleLowerCase("tr-TR");
      const matchesSearch = !needle || haystack.includes(needle);
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      // Montajcı filtresi: aynı kişinin tüm kimlikleriyle (employee.id / user_id) eşleştir
      const matchesInstaller = installerFilter === "all" || (() => {
        if (row.assigned_staff_id === installerFilter) return true;
        const opt = staff.find((s) => s.id === installerFilter);
        return Boolean(opt && row.assigned_staff_id && (opt.altIds ?? []).includes(row.assigned_staff_id));
      })();
      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "today" && row.scheduled_date === today) ||
        (dateFilter === "week" && Boolean(row.scheduled_date && row.scheduled_date >= today && row.scheduled_date <= weekEndText)) ||
        (dateFilter === "unscheduled" && !row.scheduled_date);
      return matchesSearch && matchesStatus && matchesInstaller && matchesDate;
    });
  }, [dateFilter, installerFilter, q, rows, statusFilter, staff]);

  // Sekme rozet sayıları — temel filtrelerden geçen kayıtlardan türetilir (ekstra sorgu yok).
  const tabCounts = useMemo(() => {
    const counts: Record<InstallationTab, number> = { bekleyen: 0, atanan: 0, tamamlanan: 0 };
    for (const row of baseFilteredRows) counts[jobTab(row)] += 1;
    return counts;
  }, [baseFilteredRows]);

  const filteredRows = useMemo(
    () => baseFilteredRows.filter((row) => jobTab(row) === activeTab),
    [baseFilteredRows, activeTab],
  );

  async function updateJob(row: JobRow, patch: Partial<JobRow>, nextOrderStatus?: string) {
    setBusyId(row.id);
    try {
      const ctx = await getEffectiveTenantContext();
      if (ctx.readOnly) throw new Error("Firma lisansı aktif değil veya sadece okuma modunda.");

      // COMPLETION PATH: Use RPC for atomic earnings creation + status update
      if (patch.status === "completed") {
        const { data: rpcResult, error: rpcError } = await supabase.rpc(
          'update_installation_completion',
          {
            p_company_id: ctx.company_id,
            p_job_id: row.id,
            p_new_status: 'completed',
            p_order_id: row.order_id,
            p_order_new_status: nextOrderStatus || 'montaj_tamamlandi'
          }
        );

        if (rpcError) throw rpcError;
        if (!rpcResult?.success) {
          throw new Error(rpcResult?.error || 'Montaj tamamlanırken bilinmeyen hata oluştu');
        }

        // RPC handled: job status update + earnings creation + order status update (if applicable)
        // Update local state to reflect completion
        setRows((prev) => prev.map((item) =>
          item.id === row.id
            ? { ...item, status: 'completed', updated_at: new Date().toISOString() }
            : item
        ));
        return;
      }

      // OTHER STATUS PATHS: Direct table update (unchanged)
      const { error } = await supabase
        .from("installation_jobs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("company_id", ctx.company_id);
      if (error) throw error;

      if (nextOrderStatus) {
        await supabase.from("orders").update({ status: nextOrderStatus }).eq("id", row.order_id).eq("company_id", ctx.company_id);
      }

      setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, ...patch } : item));
    } catch (e: any) {
      const errorMsg = e?.message ?? "Montaj kaydı güncellenemedi.";
      alert(errorMsg);
      console.error("updateJob error:", e);
    } finally {
      setBusyId(null);
    }
  }

  function openDateModal(row: JobRow) {
    setModalRow(row);
    setModalDate(row.scheduled_date || new Date().toISOString().slice(0, 10));
    setModalTime(row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "10:00");
    setModalType("date");
  }

  function openInstallerModal(row: JobRow) {
    setModalRow(row);
    setModalStaff(row.assigned_staff_id || (staff[0]?.id ?? ""));
    setModalType("installer");
  }

  function openStatusModal(row: JobRow) {
    setModalRow(row);
    setModalStatus((row.status as InstallationStatus) || "waiting");
    setModalNote(row.notes || "");
    setModalType("status");
  }

  function closeModal() {
    setModalType(null);
    setModalRow(null);
  }

  async function submitDateModal() {
    if (!modalRow) return;
    await updateJob(modalRow, { scheduled_date: modalDate || null, scheduled_time: modalTime || null, status: "planned" }, "montaj_planlandi");
    closeModal();
  }

  async function submitInstallerModal() {
    if (!modalRow || !modalStaff) return;
    await updateJob(modalRow, { assigned_staff_id: modalStaff, status: "assigned" }, "montaj_planlandi");
    closeModal();
  }

  async function submitStatusModal() {
    if (!modalRow) return;
    const selected = STATUS_OPTIONS.find((item) => item.value === modalStatus);
    if (!selected) return;
    await updateJob(modalRow, {
      status: selected.value,
      notes: selected.value === "issue" && modalNote
        ? [modalRow.notes, `Problem: ${modalNote}`].filter(Boolean).join("\n")
        : modalRow.notes,
    }, selected.orderStatus);
    closeModal();
  }

  async function markCompleted(row: JobRow) {
    setConfirmCompleteRow(row);
  }

  function assignedName(row: JobRow) {
    if (!row.assigned_staff_id) return "Atanmadı";
    const hit = staff.find((item) =>
      item.id === row.assigned_staff_id || (item.altIds ?? []).includes(row.assigned_staff_id as string));
    return hit?.name || "Atanmadı";
  }

  function actionButtons(row: JobRow) {
    return (
      <div className="grid w-full grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
        <button type="button" onClick={() => navigate(`/orders/${row.order_id}`)} className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-black hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Detay</button>
        <button type="button" onClick={() => openDateModal(row)} disabled={busyId === row.id} className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-black hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800">Tarih Ata</button>
        <button
          type="button"
          onClick={() => {
            if (staff.length === 0) {
              alert("Kayıtlı montajcı bulunamadı. Sipariş detayındaki 'Yeni Montajcı Ekle' ile veya Montajcı Cari ekranından montajcı oluşturabilirsiniz.");
              return;
            }
            openInstallerModal(row);
          }}
          disabled={busyId === row.id}
          className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-black hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Montajcı Ata
        </button>
        <button type="button" onClick={() => openStatusModal(row)} disabled={busyId === row.id} className="min-h-10 rounded-xl bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60">Durum Güncelle</button>
        {row.status !== "completed" && (
          <button type="button" onClick={() => markCompleted(row)} disabled={busyId === row.id} className="col-span-2 min-h-10 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60 md:col-span-1">
            <Check className="inline h-3.5 w-3.5 mr-1" />Tamamlandı
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      {/* Montajı Tamamla Onay Modalı */}
      {confirmCompleteRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl dark:bg-slate-900 overflow-hidden">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Montajı Tamamla</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                <strong>{confirmCompleteRow.customer_name || "Bu sipariş"}</strong> montaj tamamlandı olarak işaretlensin mi?
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Onaylanınca sipariş ve montajcı kaydı senkron güncellenecek.
              </p>
            </div>
            <div className="flex gap-3 p-4">
              <button
                type="button"
                onClick={() => setConfirmCompleteRow(null)}
                disabled={busyId === confirmCompleteRow.id}
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={async () => {
                  const row = confirmCompleteRow;
                  setConfirmCompleteRow(null);
                  await updateJob(row, { status: "completed" }, "montaj_tamamlandi");
                }}
                disabled={busyId === confirmCompleteRow.id}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60 shadow-lg shadow-emerald-600/20"
              >
                {busyId === confirmCompleteRow.id ? "İşleniyor..." : "✅ Evet, Tamamla"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modaller */}
      {modalType === "date" && modalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black">Montaj Tarihi Ata</h2>
              <button onClick={closeModal}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Tarih</label>
                <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Saat</label>
                <input type="time" value={modalTime} onChange={(e) => setModalTime(e.target.value)} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-800" />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={closeModal} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">İptal</button>
              <button onClick={submitDateModal} disabled={!modalDate || busyId === modalRow.id} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60">Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {modalType === "installer" && modalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black">Montajcı Ata</h2>
              <button onClick={closeModal}><X className="h-5 w-5" /></button>
            </div>
            <select value={modalStaff} onChange={(e) => setModalStaff(e.target.value)} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-800">
              <option value="">Montajcı seçin</option>
              {staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <div className="mt-5 flex gap-3">
              <button onClick={closeModal} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">İptal</button>
              <button onClick={submitInstallerModal} disabled={!modalStaff || busyId === modalRow.id} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60">Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {modalType === "status" && modalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black">Durum Güncelle</h2>
              <button onClick={closeModal}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <select value={modalStatus} onChange={(e) => setModalStatus(e.target.value as InstallationStatus)} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-800">
                {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              {modalStatus === "issue" && (
                <textarea value={modalNote} onChange={(e) => setModalNote(e.target.value)} placeholder="Problem / eksik notu..." rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
              )}
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={closeModal} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">İptal</button>
              <button onClick={submitStatusModal} disabled={busyId === modalRow.id} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60">Kaydet</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-950 dark:text-white">Montaj Takibi</h1>
          <p className="text-sm text-slate-500">Montaja hazır siparişleri, tarihleri, montajcı atamalarını ve durumları takip edin.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <button type="button" onClick={load} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 sm:w-auto">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
      </div>

      {/* Sekmeler: Bekleyenler / Atananlar / Tamamlananlar — installation_jobs verisinden türetilir */}
      <div className="flex gap-1 self-start rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900/50">
        {([
          ["bekleyen", "Bekleyenler"],
          ["atanan", "Atananlar"],
          ["tamamlanan", "Tamamlananlar"],
        ] as Array<[InstallationTab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === key
                ? "bg-white text-primary-600 shadow-sm dark:bg-slate-800 dark:text-primary-400"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
              activeTab === key
                ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            }`}>{tabCounts[key]}</span>
          </button>
        ))}
      </div>

      {needsMigration ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
          Montaj Takibi tablosu Supabase'te bulunamadı. <span className="font-black">supabase_installation_workflow.sql</span> dosyasını Supabase SQL Editor'da çalıştırın.
        </div>
      ) : null}

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{err}</div> : null}

      {/* Earnings Summary Widget */}
      {installerEarnings && installerFilter !== "all" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-bold text-emerald-900 dark:text-emerald-100">Montajcı Hakediş</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">Toplam Hakediş</p>
                <p className="font-bold text-emerald-900 dark:text-emerald-100">
                  {new Intl.NumberFormat("tr-TR", {
                    style: "currency",
                    currency: "TRY",
                    minimumFractionDigits: 0,
                  }).format(installerEarnings.total_earnings ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">Toplam Ödeme</p>
                <p className="font-bold text-emerald-900 dark:text-emerald-100">
                  {new Intl.NumberFormat("tr-TR", {
                    style: "currency",
                    currency: "TRY",
                    minimumFractionDigits: 0,
                  }).format(installerEarnings.total_paid ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">Bakiye</p>
                <p className={`font-bold ${installerEarnings.balance >= 0 ? "text-emerald-900 dark:text-emerald-100" : "text-rose-900 dark:text-rose-100"}`}>
                  {new Intl.NumberFormat("tr-TR", {
                    style: "currency",
                    currency: "TRY",
                    minimumFractionDigits: 0,
                  }).format(installerEarnings.balance ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">İşlem Sayısı</p>
                <p className="font-bold text-emerald-900 dark:text-emerald-100">{installerEarnings.transaction_count ?? 0}</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate(`/installer/${installerFilter}/earnings`)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm font-semibold whitespace-nowrap"
          >
            Detaylar →
          </button>
        </div>
      )}

      <div className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_180px_220px]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950" placeholder="Müşteri, telefon, sipariş no, ürün ara" />
        </label>
        <label className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="min-h-11 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-bold outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950">
            <option value="all">Tüm durumlar</option>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950">
            <option value="all">Tüm tarihler</option>
            <option value="today">Bugün</option>
            <option value="week">Bu hafta</option>
            <option value="unscheduled">Tarihsiz</option>
          </select>
        </label>
        <label>
          <select value={installerFilter} onChange={(e) => setInstallerFilter(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950">
            <option value="all">Tüm montajcılar</option>
            {staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Montaj kayıtları yükleniyor...</div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Montaj takibinde kayıt bulunamadı.</div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-3">Sipariş / Müşteri</th>
                  <th className="px-4 py-3">Ürün / Ölçü</th>
                  <th className="px-4 py-3">Tarih / Montajcı</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-950 dark:text-white">#{row.order_id.slice(0, 8)} - {row.customer_name || "Müşteri"}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.phone || "-"}</div>
                      <div className="mt-1 max-w-[200px] truncate text-xs text-slate-500">{row.address || "Adres yok"}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatMoney(row.total_amount)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-bold">{row.product_type || "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.room || "-"} / {row.width || "-"}x{row.height || "-"} cm</div>
                      {row.field_info ? <FieldInfoGallery info={row.field_info} compact /> : null}
                      {row.notes ? <div className="mt-1 max-w-[180px] truncate text-xs text-slate-400" title={row.notes ?? ""}>{row.notes}</div> : null}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-xs font-bold"><CalendarClock className="h-4 w-4" /> {formatDate(row.scheduled_date, row.scheduled_time)}</div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><UserCheck className="h-4 w-4" /> {assignedName(row)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                    </td>
                    <td className="px-4 py-4">{actionButtons(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {filteredRows.map((row) => (
              <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-slate-950 dark:text-white">#{row.order_id.slice(0, 8)} - {row.customer_name || "Müşteri"}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatMoney(row.total_amount)}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <div className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0" /> {row.phone || "-"}</div>
                  <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> <span className="break-all">{row.address || "Adres yok"}</span></div>
                  <div className="flex gap-2"><ClipboardList className="mt-0.5 h-4 w-4 shrink-0" /> {row.product_type || "-"} / {row.room || "-"} / {row.width || "-"}x{row.height || "-"} cm</div>
                  {row.field_info ? <FieldInfoGallery info={row.field_info} /> : null}
                </div>
                {row.notes ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 line-clamp-3">{row.notes}</div> : null}
                <div className="mt-3 text-xs font-bold text-slate-500">{formatDate(row.scheduled_date, row.scheduled_time)} / {assignedName(row)}</div>
                <div className="mt-3">{actionButtons(row)}</div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
