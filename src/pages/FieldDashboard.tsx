import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Camera,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  ImagePlus,
  Map,
  MapPin,
  MessageSquareWarning,
  NotebookPen,
  Phone,
  RefreshCcw,
  Ruler,
  ShoppingCart,
  UserRound,
} from "lucide-react";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { roleLabel } from "../auth/roles";

type TaskRow = {
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
  customer: { id?: string | null; name: string | null; phone: string | null; address?: string | null } | { id?: string | null; name: string | null; phone: string | null; address?: string | null }[] | null;
};

function pickCustomer(customer: TaskRow["customer"]) {
  return Array.isArray(customer) ? customer[0] ?? null : customer;
}

function isFieldRole(role: string) {
  return role === "installer" || role === "measurement" || role === "personnel";
}

function fmtTime(iso?: string | null) {
  if (!iso) return "Saat yok";
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function statusText(status?: string | null) {
  const value = String(status ?? "planned").toLowerCase();
  if (value === "onway") return "Yolda";
  if (value === "done") return "Tamamlandı";
  if (value === "postponed") return "Ertelendi";
  if (value === "cancelled" || value === "canceled") return "İptal";
  return "Planlandı";
}

function mapUrl(destination: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
}

function fieldRouteFilter(row: TaskRow, targetUserId: string) {
  return row.assigned_to === targetUserId || row.assigned_user_id === targetUserId;
}

export default function FieldDashboard() {
  const navigate = useNavigate();
  const { effectiveRole, realRole, viewingUserId } = useRole();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("tr-TR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      }),
    [],
  );

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ctx = await getEffectiveTenantContext();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      let { data, error: queryError } = await supabase
        .from("appointments")
        .select("id,type,title,address,start_at,scheduled_at,status,note,assigned_to,assigned_user_id,customer:customers(id,name,phone,address)")
        .eq("company_id", ctx.company_id)
        .in("status", ["planned", "postponed", "onway"])
        .or(`and(start_at.gte.${start.toISOString()},start_at.lt.${end.toISOString()}),and(scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()})`);

      if (queryError && String(queryError.message || "").includes("assigned_user_id")) {
        const retry = await supabase
          .from("appointments")
          .select("id,type,title,address,start_at,scheduled_at,status,note,assigned_to,customer:customers(id,name,phone,address)")
          .eq("company_id", ctx.company_id)
          .in("status", ["planned", "postponed", "onway"])
          .or(`and(start_at.gte.${start.toISOString()},start_at.lt.${end.toISOString()}),and(scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()})`);
        data = retry.data as any;
        queryError = retry.error;
      }

      if (queryError) throw queryError;

      const targetUserId = realRole === "super_admin" && viewingUserId ? viewingUserId : ctx.user.id;
      const scoped = isFieldRole(effectiveRole) ? ((data ?? []) as TaskRow[]).filter((row) => fieldRouteFilter(row, targetUserId)) : ((data ?? []) as TaskRow[]);
      scoped.sort((a, b) => new Date(a.start_at ?? a.scheduled_at ?? 0).getTime() - new Date(b.start_at ?? b.scheduled_at ?? 0).getTime());
      setTasks(scoped);
    } catch (err: any) {
      setError(err?.message ?? "Saha paneli yüklenemedi.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveRole, realRole, viewingUserId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function updateTask(task: TaskRow, patch: Record<string, any>) {
    setSavingId(task.id);
    try {
      const ctx = await getEffectiveTenantContext();
      if (ctx.readOnly) {
        alert("Firma lisansı aktif değil veya sadece okuma modunda. Yeni işlem yapılamaz.");
        return;
      }

      const { error: updateError } = await supabase
        .from("appointments")
        .update(patch)
        .eq("id", task.id)
        .eq("company_id", ctx.company_id);

      if (updateError) throw updateError;

      if (patch.status === "done") {
        setTasks((prev) => prev.filter((item) => item.id !== task.id));
      } else {
        setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, ...patch } : item)));
      }
    } catch (err: any) {
      alert(err?.message ?? "İşlem kaydedilemedi.");
    } finally {
      setSavingId(null);
    }
  }

  async function addNote(task: TaskRow) {
    const text = window.prompt("Bu görev için not yazın:", task.note ?? "");
    if (text === null) return;
    await updateTask(task, { note: text.trim() || null });
  }

  async function reportIssue(task: TaskRow) {
    const text = window.prompt("Sorunu kısaca yazın:");
    if (text === null) return;
    const nextNote = [task.note, `Sorun: ${text.trim()}`].filter(Boolean).join("\n");
    await updateTask(task, { status: "postponed", note: nextNote });
  }

  const quickActions = [
    { label: "Bugünün Rotası", desc: "Sıralı görevler ve harita", icon: Map, to: "/route/today" },
    { label: "Ölçü Al", desc: "Mobil ölçü ve tahmini fiyat", icon: Ruler, to: "/measurements/new" },
    { label: "Sipariş / Teklif Oluştur", desc: "Saha ölçüsünden teklif", icon: ShoppingCart, to: "/orders/new" },
    { label: "Kartela Önizleme", desc: "Fotoğrafa ürün bindirme", icon: ImagePlus, to: "/visual-previews" },
    { label: "Müşterilerim", desc: "Arama, telefon, adres", icon: UserRound, to: "/field/customers" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">{todayLabel}</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Saha Personeli Paneli</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {roleLabel(effectiveRole)} için görev, ölçü, kartela ve müşteri akışı.
          </p>
        </div>
        <button
          onClick={loadTasks}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCcw className="h-4 w-4" />
          Yenile
        </button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {quickActions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="flex min-h-32 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <action.icon className="h-7 w-7 text-primary-600" />
            <span>
              <span className="block text-base font-black text-slate-950 dark:text-white">{action.label}</span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{action.desc}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Bugünkü Görevlerim</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Ölçü, montaj, konum, not ve durum işlemleri.</p>
          </div>
          <ClipboardList className="h-6 w-6 text-slate-400" />
        </div>

        {error ? <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Görevler yükleniyor...</div>
        ) : tasks.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Bugün randevu yok. Yeni ölçü almak için Ölçü Al ekranını kullanabilirsiniz.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {tasks.map((task, index) => {
              const customer = pickCustomer(task.customer);
              const when = task.start_at ?? task.scheduled_at;
              const destination = task.address || customer?.address || task.note || "";
              const phone = customer?.phone?.replace(/\s+/g, "") || "";
              return (
                <article key={task.id} className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">#{index + 1} / {statusText(task.status)}</p>
                    <h3 className="mt-1 truncate text-xl font-black text-slate-950 dark:text-white">
                      {fmtTime(when)} - {customer?.name || task.title || "Müşteri bilgisi yok"}
                    </h3>
                    <div className="mt-2 grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                      <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4" /> {customer?.phone || "Telefon yok"}</span>
                      <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" /> {destination || "Adres/konum yok"}</span>
                    </div>
                    {task.note ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{task.note}</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:max-w-sm lg:justify-end">
                    <button
                      onClick={() => navigate("/measurements/new", { state: { appointmentId: task.id, customerId: customer?.id ?? null, customerName: customer?.name ?? "", phone: customer?.phone ?? "", address: destination } })}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700"
                    >
                      <Ruler className="h-4 w-4" />
                      Ölçü Al
                    </button>
                    <button
                      onClick={() => navigate("/visual-previews", { state: { appointmentId: task.id, customerId: customer?.id ?? null } })}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <Camera className="h-4 w-4" />
                      Fotoğraf / Kartela
                    </button>
                    {phone ? (
                      <a href={`tel:${phone}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300">
                        <Phone className="h-4 w-4" />
                        Ara
                      </a>
                    ) : null}
                    {destination ? (
                      <a href={mapUrl(destination)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        <MapPin className="h-4 w-4" />
                        Konum
                      </a>
                    ) : null}
                    <button onClick={() => addNote(task)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <NotebookPen className="h-4 w-4" />
                      Not Ekle
                    </button>
                    <button onClick={() => navigate("/orders/new", { state: { appointmentId: task.id, customerId: customer?.id ?? null } })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <FilePlus2 className="h-4 w-4" />
                      Teklif
                    </button>
                    <button disabled={savingId === task.id} onClick={() => updateTask(task, { status: "done", done: true, done_at: new Date().toISOString() })} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                      <CheckCircle2 className="h-4 w-4" />
                      Tamamlandı
                    </button>
                    <button disabled={savingId === task.id} onClick={() => updateTask(task, { status: "postponed", done: false, done_at: null })} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">
                      Ertelendi
                    </button>
                    <button disabled={savingId === task.id} onClick={() => reportIssue(task)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
                      <MessageSquareWarning className="h-4 w-4" />
                      Sorun Bildir
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
