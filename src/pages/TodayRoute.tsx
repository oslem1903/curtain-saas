import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, MapPin, Navigation, NotebookPen, Phone, RefreshCcw, Route } from "lucide-react";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";

type Row = {
  id: string;
  type: string | null;
  title: string | null;
  address: string | null;
  start_at: string | null;
  scheduled_at: string | null;
  status: string | null;
  note: string | null;
  assigned_to: string | null;
  assigned_user_id?: string | null;
  assigned_role?: string | null;
  order_id?: string | null;
  customer: { id?: string | null; name: string | null; phone: string | null } | { id?: string | null; name: string | null; phone: string | null }[] | null;
};

function jobArea(job: any) {
  let w = Number(job.width || 0);
  let h = Number(job.height || 0);
  if (w <= 0 || h <= 0) return 0;
  const minW = Number(job.min_width || 0);
  const minH = Number(job.min_height || 0);
  const minArea = Number(job.min_area || 0);

  if (minW > 0 && w < minW) w = minW;
  if (minH > 0 && h < minH) h = minH;

  let area = (w * h) / 10000;
  if (minArea > 0 && area < minArea) {
      area = minArea;
  }
  return area * Math.max(1, Number(job.qty ?? 1));
}

type StaffRow = {
  user_id: string;
  full_name: string | null;
  role: string | null;
};

function toTRPhone(raw?: string | null) {
  if (!raw) return "";
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = p.slice(1);
  if (p.length === 10 && p.startsWith("5")) p = "90" + p;
  if (!p.startsWith("90") && p.length > 0) p = "90" + p;
  return p;
}

function openWhatsApp(rawPhone: string, message: string) {
  const digits = toTRPhone(rawPhone);
  if (!digits) return;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}

function openMaps(destination: string) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`, "_blank", "noopener,noreferrer");
}

function fmtTime(iso?: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function typeLabel(type?: string | null) {
  const value = String(type ?? "").toLowerCase();
  if (value === "installation") return "Montaj";
  if (value === "measurement") return "Ölçü";
  return "Randevu";
}

function statusLabel(status?: string | null) {
  const value = String(status ?? "planned").toLowerCase();
  if (value === "done") return "Tamamlandı";
  if (value === "cancelled" || value === "canceled") return "İptal";
  if (value === "postponed") return "Ertelendi";
  if (value === "onway") return "Yolda";
  return "Planlandı";
}

function pickCustomer(customer: Row["customer"]) {
  return Array.isArray(customer) ? customer[0] ?? null : customer;
}

function isFieldRole(role: string) {
  return role === "installer" || role === "measurement" || role === "personnel";
}

function isAssignedTo(row: Pick<Row, "assigned_to" | "assigned_user_id">, userId: string) {
  return row.assigned_user_id === userId || row.assigned_to === userId;
}

function yolaMesaji(type: string | null, customerName: string, time: string | null) {
  const tip = String(type ?? "").toLowerCase();
  const isim = customerName || "";
  const saat = fmtTime(time);
  if (tip === "measurement") {
    return `Merhaba ${isim}, ölçü randevusu için yola çıktım. Yaklaşık varış: ${saat}`;
  }
  if (tip === "installation") {
    return `Merhaba ${isim}, montaj randevusu için yola çıktım. Yaklaşık varış: ${saat}`;
  }
  return `Merhaba ${isim}, randevunuz için yola çıktım. Yaklaşık varış: ${saat}`;
}

function yolaMesaji(type: string | null, customerName: string, time: string | null) {
  const tip = String(type ?? "").toLowerCase();
  const isim = customerName || "";
  const saat = fmtTime(time);
  if (tip === "measurement") {
    return `Merhaba ${isim}, ölçü randevusu için yola çıktım. Yaklaşık varış: ${saat}`;
  }
  if (tip === "installation") {
    return `Merhaba ${isim}, montaj randevusu için yola çıktım. Yaklaşık varış: ${saat}`;
  }
  return `Merhaba ${isim}, randevunuz için yola çıktım. Yaklaşık varış: ${saat}`;
}

export default function TodayRoute() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const filterType = searchParams.get("type");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [markingId, setMarkingId] = useState<string | null>(null);
  const { effectiveRole: currentRole, viewingUserId, realRole } = useRole();
  const [staffMap, setStaffMap] = useState<Record<string, { full_name: string; role: string }>>({});

  const { dayStartISO, dayEndISO, todayLabel } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    return {
      dayStartISO: start.toISOString(),
      dayEndISO: end.toISOString(),
      todayLabel: now.toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "2-digit" }),
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");

    try {
      const ctx = await getEffectiveTenantContext();
      let { data, error } = await supabase
        .from("appointments")
        .select("id,type,title,address,start_at,scheduled_at,status,note,assigned_to,assigned_user_id,assigned_role,order_id,customer:customers(id,name,phone)")
        .eq("company_id", ctx.company_id)
        .in("status", ["planned", "postponed", "onway"])
        .or(`and(start_at.gte.${dayStartISO},start_at.lt.${dayEndISO}),and(scheduled_at.gte.${dayStartISO},scheduled_at.lt.${dayEndISO})`);

      if (error && String(error.message || "").toLowerCase().includes("assigned_user_id")) {
        const retry = await supabase
          .from("appointments")
          .select("id,type,title,address,start_at,scheduled_at,status,note,assigned_to,order_id,customer:customers(id,name,phone)")
          .eq("company_id", ctx.company_id)
          .in("status", ["planned", "postponed", "onway"])
          .or(`and(start_at.gte.${dayStartISO},start_at.lt.${dayEndISO}),and(scheduled_at.gte.${dayStartISO},scheduled_at.lt.${dayEndISO})`);
        data = retry.data as any;
        error = retry.error;
      }

      if (error) throw error;

      const targetUserId = realRole === "super_admin" && viewingUserId ? viewingUserId : ctx.user.id;
      const scopedData = isFieldRole(currentRole)
        ? ((data ?? []) as Row[]).filter((row) => isAssignedTo(row, targetUserId))
        : ((data ?? []) as Row[]);
      const list = scopedData.sort((a, b) => {
        const timeA = new Date(a.start_at ?? a.scheduled_at ?? 0).getTime();
        const timeB = new Date(b.start_at ?? b.scheduled_at ?? 0).getTime();
        return timeA - timeB;
      });

      setRows(list);

      const { data: employees } = await supabase
        .from("employees")
        .select("user_id, full_name, target_role, is_active")
        .eq("company_id", ctx.company_id);

      const employeeRows = (employees ?? []).filter((employee: any) => employee.is_active !== false && Boolean(employee.user_id));
      const { data: members } = await supabase.from("company_members").select("user_id").eq("company_id", ctx.company_id);
      const employeeIds = employeeRows.map((employee: any) => employee.user_id).filter(Boolean);
      const memberIds = (members ?? []).map((member) => member.user_id).filter(Boolean);
      const ids = Array.from(new Set(employeeIds.length > 0 ? employeeIds : memberIds));

      if (ids.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, role").in("user_id", ids);
        const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
        const nextMap: Record<string, { full_name: string; role: string }> = {};
        const staffRows = employeeRows.length > 0
          ? employeeRows.map((employee: any) => {
            const profile = profileById.get(employee.user_id);
            return {
              user_id: employee.user_id,
              full_name: employee.full_name || profile?.full_name || "İsimsiz",
              role: profile?.role || employee.target_role || "installer",
            };
          })
          : ((profiles ?? []) as StaffRow[]);

        for (const staff of staffRows) {
          nextMap[staff.user_id] = {
            full_name: staff.full_name || "İsimsiz",
            role: staff.role || "installer",
          };
        }
        setStaffMap(nextMap);
      } else {
        setStaffMap({});
      }
    } catch (e: any) {
      setErr(e?.message ?? "Rota yüklenemedi");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [currentRole, dayEndISO, dayStartISO, realRole, viewingUserId]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    async function subscribe() {
      try {
        const ctx = await getEffectiveTenantContext();
        if (!active) return;
        channel = supabase
          .channel(`today-route-live-${ctx.company_id}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `company_id=eq.${ctx.company_id}` }, () => load())
          .subscribe();
      } catch (e) {
        console.error("TodayRoute realtime error:", e);
      }
    }

    void subscribe();
    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayRows = useMemo(() => {
    if (!filterType) return rows;
    return rows.filter((r) => String(r.type ?? "").toLowerCase() === filterType.toLowerCase());
  }, [rows, filterType]);

  async function markDone(row: Row) {
    if (!confirm("Bu randevu tamamlandı olarak işaretlensin mi? (Varsa bağlı montaj işleri de tamamlanıp hakediş hesaplanacaktır.)")) return;
    await updateStatus(row, "done", true);
  }

  async function updateStatus(row: Row, status: "onway" | "planned" | "postponed" | "done", removeWhenDone = false) {
    setMarkingId(row.id);
    try {
      const ctx = await getEffectiveTenantContext();
      if (ctx.readOnly) throw new Error("Firma lisansı aktif değil veya sadece okuma modunda.");
      let query = supabase
        .from("appointments")
        .update({
          status,
          done: status === "done",
          done_at: status === "done" ? new Date().toISOString() : null,
        })
        .eq("id", row.id)
        .eq("company_id", ctx.company_id);

      if (isFieldRole(currentRole)) {
        const targetUserId = realRole === "super_admin" && viewingUserId ? viewingUserId : ctx.user.id;
        query = query.or(`assigned_to.eq.${targetUserId},assigned_user_id.eq.${targetUserId}`);
      }

      const { error } = await query;
      if (error) throw error;

      if (status === "done" && row.order_id && row.type === "installation") {
        const { data: jobs } = await supabase
          .from("installation_jobs")
          .select("*")
          .eq("order_id", row.order_id)
          .eq("company_id", ctx.company_id)
          .neq("status", "completed");

        if (jobs && jobs.length > 0) {
          for (const job of jobs) {
            let fee = Number(job.installer_fee || 0);
            const rate = Number(job.unit_rate || 0);
            if (fee === 0 && rate > 0) {
              if (job.price_type === "m2") {
                fee = Math.round(jobArea(job) * rate * 100) / 100;
              } else if (job.price_type === "adet") {
                const q = Math.max(1, Number(job.qty || 1));
                fee = Math.round(q * rate * 100) / 100;
              }
            }
            await supabase
              .from("installation_jobs")
              .update({
                status: "completed",
                completed_at: new Date().toISOString(),
                installer_fee: fee > 0 ? fee : null,
              })
              .eq("id", job.id);
          }
        }
      }

      setRows((prev) => (removeWhenDone ? prev.filter((r) => r.id !== row.id) : prev.map((r) => (r.id === row.id ? { ...r, status } : r))));
    } catch (e: any) {
      alert(e?.message ?? "Durum güncellenemedi.");
    } finally {
      setMarkingId(null);
    }
  }

  async function addNote(row: Row) {
    const text = prompt("Randevu notu:", row.note ?? "");
    if (text === null) return;
    setMarkingId(row.id);
    try {
      const ctx = await getEffectiveTenantContext();
      if (ctx.readOnly) throw new Error("Firma lisansı aktif değil veya sadece okuma modunda.");
      const { error } = await supabase
        .from("appointments")
        .update({ note: text.trim() || null })
        .eq("id", row.id)
        .eq("company_id", ctx.company_id);
      if (error) throw error;
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, note: text.trim() || null } : item)));
    } catch (e: any) {
      alert(e?.message ?? "Not kaydedilemedi.");
    } finally {
      setMarkingId(null);
    }
  }

  async function reportIssue(row: Row) {
    const text = prompt("Sorunu kısaca yazın:");
    if (text === null) return;
    const nextNote = [row.note, `Sorun: ${text.trim()}`].filter(Boolean).join("\n");
    setMarkingId(row.id);
    try {
      const ctx = await getEffectiveTenantContext();
      if (ctx.readOnly) throw new Error("Firma lisansı aktif değil veya sadece okuma modunda.");
      const { error } = await supabase
        .from("appointments")
        .update({ status: "postponed", note: nextNote })
        .eq("id", row.id)
        .eq("company_id", ctx.company_id);
      if (error) throw error;
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, status: "postponed", note: nextNote } : item)));
    } catch (e: any) {
      alert(e?.message ?? "Sorun kaydedilemedi.");
    } finally {
      setMarkingId(null);
    }
  }

  function openDayRoute() {
    const stops = displayRows.map((r) => (r.address ?? r.note ?? "").trim()).filter(Boolean);
    if (stops.length === 0) {
      alert("Rota için adres/konum bulunamadı.");
      return;
    }

    const maxWaypoints = 20;
    const first = stops[0];
    const rest = stops.slice(1);
    const destination = rest.length > 0 ? rest[Math.min(rest.length - 1, maxWaypoints)] : first;
    const waypoints = rest.length > 1 ? rest.slice(0, Math.min(rest.length - 1, maxWaypoints)).join("|") : "";
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}&travelmode=driving`;
    window.open(url, "_blank", "noopener,noreferrer");

    if (rest.length - 1 > maxWaypoints) {
      alert("Çok fazla durak var. İlk 20 durak rota yapıldı.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-950 dark:text-white">
            {filterType === "measurement"
              ? "Bugünün Ölçü Randevuları"
              : filterType === "installation"
              ? "Bugünün Montaj Randevuları"
              : "Bugünün Rotası"}
          </h1>
          <div className="text-sm text-slate-500">{todayLabel}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          {currentRole === "admin" ? (
            <button onClick={() => nav("/appointments/new")} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700">
              Yeni Randevu
            </button>
          ) : null}
          <button onClick={load} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <RefreshCcw className="h-4 w-4" />
            Yenile
          </button>
          <button onClick={openDayRoute} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800">
            <Route className="h-4 w-4" />
            Rotayı Başlat
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Bugünkü İş</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{displayRows.length}</div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-900/30 dark:bg-emerald-950/20 flex flex-col justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2">Tamamlanan</div>
            <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{displayRows.filter(r => r.status === "done").length}</div>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/20 flex flex-col justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-2">Bekleyen</div>
            <div className="text-2xl font-black text-amber-700 dark:text-amber-400">{displayRows.filter(r => r.status !== "done" && r.status !== "postponed" && r.status !== "cancelled").length}</div>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4 shadow-sm dark:border-rose-900/30 dark:bg-rose-950/20 flex flex-col justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-rose-600 mb-2">Ertelenen</div>
            <div className="text-2xl font-black text-rose-700 dark:text-rose-400">{displayRows.filter(r => r.status === "postponed").length}</div>
        </div>
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Rota yükleniyor...</div>
      ) : displayRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          {filterType === "measurement"
            ? "Bugün için planlı ölçü randevusu yok."
            : filterType === "installation"
            ? "Bugün için planlı montaj randevusu yok."
            : isFieldRole(currentRole)
            ? "Bugün için atanmış randevunuz yok."
            : "Bugün için planlı randevu yok."}
        </div>
      ) : (
        <div className="space-y-4">
          {displayRows.map((r, idx) => {
            const when = r.start_at ?? r.scheduled_at;
            const customer = pickCustomer(r.customer);
            const phone = toTRPhone(customer?.phone);
            const assignedId = r.assigned_to || r.assigned_user_id || null;
            const assigned = assignedId ? staffMap[assignedId] : null;
            const destination = r.address ?? r.note ?? "";
            return (
              <article key={r.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="p-5 flex flex-col lg:flex-row gap-5">
                  {/* Sol Kısım: Zaman & İsim */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                        r.status === "done" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                        r.status === "postponed" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                        r.status === "onway" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                        "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      }`}>
                        #{idx + 1} • {typeLabel(r.type)} • {statusLabel(r.status)}
                      </span>
                    </div>
                    <div className="text-2xl font-black text-slate-950 dark:text-white flex items-center gap-3">
                      <span className="text-primary-600 dark:text-primary-400">{fmtTime(when)}</span>
                      <span>{customer?.name ?? r.title ?? "İsimsiz Müşteri"}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                      <span className="max-w-xl">{destination || "Adres/konum yok"}</span>
                    </div>
                    {!isFieldRole(currentRole) ? (
                      <div className="mt-3 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 inline-block px-3 py-1.5 rounded-lg border border-slate-100 dark:border-slate-700">
                        Atanan: <span className="font-bold text-slate-700 dark:text-slate-200">{assigned ? `${assigned.full_name}` : "Seçilmedi"}</span>
                      </div>
                    ) : null}
                    {r.note ? (
                      <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3 text-sm text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300">
                        <span className="font-bold">Not:</span> {r.note}
                      </div>
                    ) : null}
                  </div>

                  {/* Sağ Kısım: Butonlar */}
                  <div className="flex flex-wrap items-center lg:items-start lg:justify-end gap-2 shrink-0">
                    {phone ? (
                      <button onClick={() => openWhatsApp(phone, yolaMesaji(r.type, customer?.name ?? "", when))} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-bold text-white hover:bg-blue-700 shadow-sm">
                        <Navigation className="h-4 w-4" /> Yola Çıktım
                      </button>
                    ) : null}
                    {customer?.phone ? (
                      <a href={`tel:${customer.phone.replace(/\s+/g, "")}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-700 shadow-sm">
                        <Phone className="h-4 w-4" /> Ara
                      </a>
                    ) : null}
                    {destination ? (
                      <button onClick={() => openMaps(destination)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 shadow-sm">
                        <MapPin className="h-4 w-4" /> Konum
                      </button>
                    ) : null}
                    <button onClick={() => nav(`/appointments/${r.id}`)} className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 shadow-sm">
                      Detay
                    </button>
                    <button onClick={() => addNote(r)} disabled={markingId === r.id} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800 shadow-sm">
                      <NotebookPen className="h-4 w-4" /> Not
                    </button>
                    <button onClick={() => updateStatus(r, "postponed")} disabled={markingId === r.id} className="inline-flex h-10 items-center rounded-xl bg-amber-500 px-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60 shadow-sm">
                      Ertelendi
                    </button>
                    <button onClick={() => reportIssue(r)} disabled={markingId === r.id} className="inline-flex h-10 items-center rounded-xl bg-red-600 px-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60 shadow-sm">
                      Sorun Bildir
                    </button>
                    <button onClick={() => markDone(r)} disabled={markingId === r.id} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 shadow-sm w-full lg:w-auto mt-2 lg:mt-0 lg:ml-auto">
                      <CheckCircle2 className="h-5 w-5" /> Tamamlandı
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}