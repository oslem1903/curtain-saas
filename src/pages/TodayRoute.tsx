import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, CheckCircle2, Clipboard, FilePlus2, MapPin, Navigation, NotebookPen, Phone, RefreshCcw, Ruler, Route, Undo2 } from "lucide-react";

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
  customer: { id?: string | null; name: string | null; phone: string | null } | { id?: string | null; name: string | null; phone: string | null }[] | null;
};

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

function staffRoleLabel(role?: string | null) {
  if (role === "admin") return "Yönetici";
  if (role === "accountant") return "Muhasebe";
  if (role === "measurement") return "Saha Personeli";
  if (role === "installer" || role === "personnel") return "Saha Personeli";
  return "Personel";
}

export default function TodayRoute() {
  const nav = useNavigate();
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
        .select("id,type,title,address,start_at,scheduled_at,status,note,assigned_to,assigned_user_id,assigned_role,customer:customers(id,name,phone)")
        .eq("company_id", ctx.company_id)
        .in("status", ["planned", "postponed", "onway"])
        .or(`and(start_at.gte.${dayStartISO},start_at.lt.${dayEndISO}),and(scheduled_at.gte.${dayStartISO},scheduled_at.lt.${dayEndISO})`);

      if (error && String(error.message || "").toLowerCase().includes("assigned_user_id")) {
        const retry = await supabase
          .from("appointments")
          .select("id,type,title,address,start_at,scheduled_at,status,note,assigned_to,customer:customers(id,name,phone)")
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

  async function markDone(id: string) {
    if (!confirm("Bu randevu tamamlandı olarak işaretlensin mi?")) return;
    await updateStatus(id, "done", true);
  }

  async function updateStatus(id: string, status: "onway" | "planned" | "postponed" | "done", removeWhenDone = false) {
    setMarkingId(id);
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
        .eq("id", id)
        .eq("company_id", ctx.company_id);

      if (isFieldRole(currentRole)) {
        const targetUserId = realRole === "super_admin" && viewingUserId ? viewingUserId : ctx.user.id;
        query = query.or(`assigned_to.eq.${targetUserId},assigned_user_id.eq.${targetUserId}`);
      }

      const { error } = await query;
      if (error) throw error;

      setRows((prev) => (removeWhenDone ? prev.filter((row) => row.id !== id) : prev.map((row) => (row.id === id ? { ...row, status } : row))));
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
    const stops = rows.map((r) => (r.address ?? r.note ?? "").trim()).filter(Boolean);
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-950 dark:text-white">Bugünün Rotası</h1>
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

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Rota yükleniyor...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          {isFieldRole(currentRole) ? "Bugün için atanmış randevunuz yok." : "Bugün için planlı randevu yok."}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, idx) => {
            const when = r.start_at ?? r.scheduled_at;
            const customer = pickCustomer(r.customer);
            const phone = toTRPhone(customer?.phone);
            const assignedId = r.assigned_to || r.assigned_user_id || null;
            const assigned = assignedId ? staffMap[assignedId] : null;
            const destination = r.address ?? r.note ?? "";
            const yolaMsg = `Merhaba ${customer?.name ?? ""}, Ölçü/randevu için yola çıktım. Yaklaşık varış: ${fmtTime(when)}`;

            return (
              <article key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-500">#{idx + 1} / {typeLabel(r.type)} / {statusLabel(r.status)}</div>
                    <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{fmtTime(when)} - {customer?.name ?? r.title ?? "Müşteri bilgisi yok"}</div>
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{destination || "Adres/konum yok"}</div>
                    {!isFieldRole(currentRole) ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Atanan personel: <span className="font-semibold text-slate-700 dark:text-slate-200">{assigned ? `${assigned.full_name} (${staffRoleLabel(assigned.role)})` : "Seçilmedi"}</span>
                      </div>
                    ) : null}
                    {r.note ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.note}</div> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:max-w-sm lg:justify-end">
                    {phone ? (
                      <button onClick={() => openWhatsApp(phone, yolaMsg)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700">
                        <Navigation className="h-4 w-4" />
                        Yola çıktım
                      </button>
                    ) : null}
                    {customer?.phone ? (
                      <a href={`tel:${customer.phone.replace(/\s+/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">
                        <Phone className="h-4 w-4" />
                        Ara
                      </a>
                    ) : null}
                    {destination ? (
                      <button onClick={() => openMaps(destination)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        <MapPin className="h-4 w-4" />
                        Konum
                      </button>
                    ) : null}
                    {destination ? (
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(destination);
                          alert("Konum kopyalandı.");
                        }}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <Clipboard className="h-4 w-4" />
                        Kopyala
                      </button>
                    ) : null}
                    <button onClick={() => nav(`/appointments/${r.id}`)} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      Detay
                    </button>
                    <button onClick={() => nav("/measurements/new", { state: { appointmentId: r.id, customerId: customer?.id ?? null, customerName: customer?.name ?? "", phone: customer?.phone ?? "", address: destination } })} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700">
                      <Ruler className="h-4 w-4" />
                      Ölçü Al
                    </button>
                    <button onClick={() => nav("/visual-previews", { state: { appointmentId: r.id, customerId: customer?.id ?? null } })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <Camera className="h-4 w-4" />
                      Kartela
                    </button>
                    <button onClick={() => nav("/orders/new", { state: { fromAppointment: true, appointmentId: r.id, customerId: customer?.id ?? null, customerName: customer?.name ?? "", phone: customer?.phone ?? "", address: destination } })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <FilePlus2 className="h-4 w-4" />
                      Teklif
                    </button>
                    <button onClick={() => addNote(r)} disabled={markingId === r.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800">
                      <NotebookPen className="h-4 w-4" />
                      Not
                    </button>
                    {r.status !== "onway" ? (
                      <button onClick={() => updateStatus(r.id, "onway")} disabled={markingId === r.id} className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                        Yolda
                      </button>
                    ) : (
                      <button onClick={() => updateStatus(r.id, "planned")} disabled={markingId === r.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">
                        <Undo2 className="h-4 w-4" />
                        Planlıya Al
                      </button>
                    )}
                    <button onClick={() => updateStatus(r.id, "postponed")} disabled={markingId === r.id} className="inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">
                      Ertelendi
                    </button>
                    <button onClick={() => reportIssue(r)} disabled={markingId === r.id} className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
                      Sorun Bildir
                    </button>
                    <button onClick={() => markDone(r.id)} disabled={markingId === r.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                      <CheckCircle2 className="h-4 w-4" />
                      Tamamlandı
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
