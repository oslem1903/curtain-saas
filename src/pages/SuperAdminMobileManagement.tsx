import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bell,
  Building2,
  CheckCircle2,
  Gauge,
  Loader2,
  MonitorSmartphone,
  Rocket,
  Send,
  Smartphone,
  TestTube2,
  UploadCloud,
  X,
} from "lucide-react";

import { supabase } from "../supabaseClient";

type Props = {
  section?: "overview" | "versions" | "publish" | "forced" | "company" | "devices" | "push";
};

type CompanyRow = {
  id: string;
  name: string | null;
  plan_status?: string | null;
  subscription_plan?: string | null;
};

type DeviceRow = {
  id: string;
  company_id: string | null;
  user_id: string | null;
  app_version: string | null;
  platform: string | null;
  last_seen_at: string | null;
};

type UpdateRow = {
  id: string;
  version: string;
  title: string;
  description: string | null;
  update_type: "general" | "bugfix" | "feature" | "security";
  target_type: "all_companies" | "selected_companies";
  target_company_ids: string[] | null;
  status: "draft" | "published" | "archived";
  force_update: boolean | null;
  forced_update: boolean | null;
  download_url?: string | null;
  windows_download_url?: string | null;
  android_download_url?: string | null;
  published_at: string | null;
  release_date: string | null;
  created_at: string;
};

type ErrorRow = {
  company_id: string | null;
  app_version: string | null;
  message: string | null;
  error_message?: string | null;
  created_at: string;
};

const CURRENT_VERSION = String(import.meta.env.VITE_APP_VERSION || "0.0.0").replace(/^v/i, "");

const sectionCopy = {
  overview: {
    title: "Mobil Uygulama Yönetimi",
    subtitle: "Müşteri uygulama sürümleri, cihazlar, güncelleme yayınları ve kritik hatalar tek merkezden yönetilir.",
  },
  versions: {
    title: "Mobil Sürümler",
    subtitle: "Firmaların hangi sürümü kullandığını ve güncelleme risklerini takip edin.",
  },
  publish: {
    title: "Güncelleme Yayınla",
    subtitle: "Genel, firma bazlı veya zorunlu güncelleme duyurusunu müşterilere yayınlayın.",
  },
  forced: {
    title: "Zorunlu Güncellemeler",
    subtitle: "Eski sürüm kullanan müşterileri güncellemeden uygulamaya devam ettirmeyin.",
  },
  company: {
    title: "Firma Bazlı Güncelleme",
    subtitle: "Sadece seçilen müşteri firmalara özel sürüm veya patch yayınlayın.",
  },
  devices: {
    title: "Cihaz Takibi",
    subtitle: "Aktif cihazları, firma dağılımını ve son görülme zamanını izleyin.",
  },
  push: {
    title: "Push Bildirimler",
    subtitle: "Güncelleme bildirimi, bakım duyurusu ve kritik uyarıları kullanıcılara ulaştırın.",
  },
} as const;

function parseVersion(value?: string | null) {
  return String(value || "0.0.0")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number(part.replace(/\D+/g, "")) || 0);
}

function compareVersion(a: string, b: string) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export default function SuperAdminMobileManagement({ section = "overview" }: Props) {
  const copy = sectionCopy[section];
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPublish, setShowPublish] = useState(section === "publish");
  const [form, setForm] = useState({
    version: "",
    title: "",
    description: "",
    update_type: "general" as UpdateRow["update_type"],
    target_type: "all_companies" as UpdateRow["target_type"],
    force_update: false,
    target_company_ids: [] as string[],
    windows_download_url: "",
    android_download_url: "",
  });

  useEffect(() => {
    setShowPublish(section === "publish");
  }, [section]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setNotice("");
    try {
      const [companyRes, updateRes, errorRes, deviceRes] = await Promise.all([
        supabase.from("companies").select("id,name,plan_status,subscription_plan").order("created_at", { ascending: false }),
        supabase.from("app_updates").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("error_logs").select("company_id,app_version,message,error_message,created_at").order("created_at", { ascending: false }).limit(200),
        supabase.from("app_devices").select("id,company_id,user_id,app_version,platform,last_seen_at").order("last_seen_at", { ascending: false }).limit(1000),
      ]);

      if (companyRes.error) throw companyRes.error;
      if (updateRes.error) throw updateRes.error;
      if (errorRes.error) throw errorRes.error;

      setCompanies((companyRes.data ?? []) as CompanyRow[]);
      setUpdates((updateRes.data ?? []) as UpdateRow[]);
      setErrors(((errorRes.data ?? []) as ErrorRow[]).map((row) => ({
        ...row,
        message: row.message || row.error_message || "Hata bildirimi",
      })));

      if (deviceRes.error) {
        setDevices([]);
        setNotice("Cihaz takip tablosu kurulmamış. app_devices SQL kurulunca bu ekran otomatik gerçek cihaz verisiyle dolar.");
      } else {
        setDevices((deviceRes.data ?? []) as DeviceRow[]);
      }
    } catch (e: any) {
      setNotice(e?.message || "Mobil yönetim verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  const latestPublished = useMemo(() => {
    return updates
      .filter((u) => u.status === "published")
      .sort((a, b) => compareVersion(b.version, a.version) || new Date(b.published_at || b.created_at).getTime() - new Date(a.published_at || a.created_at).getTime())[0] ?? null;
  }, [updates]);

  const targetVersion = latestPublished?.version || CURRENT_VERSION;
  const activeSince = Date.now() - 24 * 60 * 60 * 1000;
  const activeDevices = devices.filter((d) => d.last_seen_at && new Date(d.last_seen_at).getTime() >= activeSince);
  const outdatedCompanies = uniq(
    devices
      .filter((d) => d.company_id && compareVersion(d.app_version || "0.0.0", targetVersion) < 0)
      .map((d) => d.company_id as string),
  );

  const readRows = useMemo(() => {
    return companies.map((company) => {
      const companyDevices = devices.filter((d) => d.company_id === company.id);
      const versions = companyDevices.map((d) => d.app_version || "0.0.0").sort(compareVersion);
      const version = versions[versions.length - 1] || "-";
      const lastSeen = companyDevices.map((d) => d.last_seen_at).filter(Boolean).sort().pop() || null;
      const companyErrors = errors.filter((e) => e.company_id === company.id);
      const hasCriticalErrors = companyErrors.length >= 5;
      const status = companyDevices.length === 0
        ? "Cihaz yok"
        : hasCriticalErrors
          ? "Kritik"
          : compareVersion(version, targetVersion) < 0
            ? "Eski sürüm"
            : "Güncel";
      return {
        company,
        version,
        devices: companyDevices.length,
        active: companyDevices.filter((d) => d.last_seen_at && new Date(d.last_seen_at).getTime() >= activeSince).length,
        lastSeen,
        status,
        errors: companyErrors.length,
      };
    });
  }, [activeSince, companies, devices, errors, targetVersion]);

  const criticalVersions = useMemo(() => {
    const grouped = new Map<string, ErrorRow[]>();
    errors.forEach((error) => {
      const version = error.app_version || "bilinmiyor";
      grouped.set(version, [...(grouped.get(version) ?? []), error]);
    });
    return Array.from(grouped.entries())
      .map(([version, rows]) => ({ version, errors: rows.length, impact: rows[0]?.message || "Hata bildirimi", action: rows.length >= 5 ? "Acil patch önerilir" : "İzleniyor" }))
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 4);
  }, [errors]);

  const updateSuccess = latestPublished
    ? Math.round(((companies.length - outdatedCompanies.length) / Math.max(companies.length, 1)) * 100)
    : 0;

  const stats = [
    { label: "Eski sürüm kullanan firma", value: String(outdatedCompanies.length), note: `${companies.length} firma içinde`, icon: AlertTriangle, tone: "text-amber-600 bg-amber-50" },
    { label: "Aktif cihaz", value: String(activeDevices.length), note: `Toplam ${devices.length} kayıtlı cihaz`, icon: Smartphone, tone: "text-blue-600 bg-blue-50" },
    { label: "Son yayınlanan sürüm", value: latestPublished ? `v${latestPublished.version}` : `v${CURRENT_VERSION}`, note: latestPublished ? `Yayın: ${formatDate(latestPublished.published_at || latestPublished.release_date)}` : "Henüz yayın kaydı yok", icon: Rocket, tone: "text-emerald-600 bg-emerald-50" },
    { label: "Güncelleme başarı oranı", value: `%${updateSuccess}`, note: "Firma bazlı hesaplanır", icon: Gauge, tone: "text-indigo-600 bg-indigo-50" },
  ];

  const updateTypes = [
    { title: "Genel Güncelleme", text: "Tüm müşteri firmalara yayın kaydı ve bildirim gönderir.", icon: UploadCloud, action: () => openPublish("all_companies", false) },
    { title: "Firma Bazlı Güncelleme", text: "Sadece seçilen müşteri firmalara bildirim gider.", icon: Building2, action: () => openPublish("selected_companies", false) },
    { title: "Beta Test", text: "Seçili test müşterilerine kontrollü yayın yapar.", icon: TestTube2, action: () => openPublish("selected_companies", false) },
    { title: "Zorunlu Güncelleme", text: "Eski sürüm kullanıcılarına kapatılamayan güncelleme uyarısı gösterir.", icon: Ban, action: () => openPublish("all_companies", true) },
  ];

  function openPublish(targetType: UpdateRow["target_type"] = "all_companies", forced = false) {
    setForm({
      version: nextVersion(targetVersion),
      title: forced ? "Zorunlu güncelleme" : "Yeni sürüm yayında",
      description: "",
      update_type: forced ? "security" : "general",
      target_type: targetType,
      force_update: forced,
      target_company_ids: targetType === "selected_companies" ? companies.slice(0, 1).map((c) => c.id) : [],
      windows_download_url: "",
      android_download_url: "",
    });
    setShowPublish(true);
  }

  function nextVersion(version: string) {
    const parts = parseVersion(version);
    while (parts.length < 3) parts.push(0);
    parts[2] += 1;
    return parts.slice(0, 3).join(".");
  }

  async function publishUpdate() {
    if (!form.version.trim() || !form.title.trim()) {
      setNotice("Sürüm ve başlık zorunludur.");
      return;
    }
    if (form.target_type === "selected_companies" && form.target_company_ids.length === 0) {
      setNotice("Firma bazlı yayın için en az bir firma seçin.");
      return;
    }

    if (!form.windows_download_url.trim() && !form.android_download_url.trim()) {
      setNotice("Otomatik guncelleme icin Windows veya Android indirme linki girin.");
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const payload = {
        version: form.version.trim().replace(/^v/i, ""),
        title: form.title.trim(),
        description: form.description.trim() || null,
        update_type: form.update_type,
        target_type: form.target_type,
        target_company_ids: form.target_type === "selected_companies" ? form.target_company_ids : [],
        download_url: form.windows_download_url.trim() || form.android_download_url.trim() || null,
        windows_download_url: form.windows_download_url.trim() || null,
        android_download_url: form.android_download_url.trim() || null,
        status: "published",
        force_update: form.force_update,
        forced_update: form.force_update,
        release_date: new Date().toISOString(),
        published_at: new Date().toISOString(),
        created_by: auth.user?.id,
      };

      const { data: saved, error } = await supabase.from("app_updates").insert([payload]).select("*").single();
      if (error) throw error;

      let memberQuery = supabase.from("company_members").select("company_id,user_id");
      if (payload.target_type === "selected_companies") {
        memberQuery = memberQuery.in("company_id", payload.target_company_ids);
      }
      const { data: members, error: memberError } = await memberQuery;
      if (memberError) throw memberError;

      const notifications = (members ?? []).map((member: any) => ({
        company_id: member.company_id,
        user_id: member.user_id,
        title: `Yeni güncelleme yayınlandı: v${payload.version}`,
        message: `${payload.title}${payload.description ? ` - ${payload.description}` : ""}`,
        type: "update",
        related_update_id: saved.id,
        is_read: false,
      }));

      if (notifications.length > 0) {
        const { error: notificationError } = await supabase.from("notifications").insert(notifications);
        if (notificationError) throw notificationError;
      }

      setShowPublish(false);
      setNotice(`v${payload.version} yayınlandı. ${notifications.length} kullanıcıya bildirim oluşturuldu.`);
      await loadData();
    } catch (e: any) {
      setNotice(e?.message || "Güncelleme yayınlanamadı.");
    } finally {
      setSaving(false);
    }
  }

  function toggleCompany(companyId: string) {
    setForm((prev) => ({
      ...prev,
      target_company_ids: prev.target_company_ids.includes(companyId)
        ? prev.target_company_ids.filter((id) => id !== companyId)
        : [...prev.target_company_ids, companyId],
    }));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-700">
            <MonitorSmartphone className="h-4 w-4" />
            SaaS Sahibi Kontrol Merkezi
          </div>
          <h1 className="mt-3 text-2xl font-black text-slate-900 dark:text-white sm:text-3xl">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.subtitle}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gauge className="h-5 w-5" />}
            Yenile
          </button>
          <button
            type="button"
            onClick={() => openPublish(section === "company" ? "selected_companies" : "all_companies", section === "forced")}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-900/10"
          >
            <UploadCloud className="h-5 w-5" />
            Yeni Sürüm Yayınla
          </button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
          {notice}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${item.tone}`}>
              <item.icon className="h-5 w-5" />
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{loading ? "..." : item.value}</div>
            <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{item.label}</div>
            <div className="mt-2 text-xs text-slate-500">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-5 dark:border-slate-800">
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Firma Sürüm Haritası</h2>
            <p className="text-sm text-slate-500">Gerçek firmalar, cihaz kayıtları, sürüm ve risk durumuna göre hesaplanır.</p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {readRows.length === 0 ? (
              <div className="p-5 text-sm font-semibold text-slate-500">Henüz firma kaydı yok.</div>
            ) : readRows.map((row) => (
              <div key={row.company.id} className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-center">
                <div>
                  <div className="font-black text-slate-900 dark:text-white">{row.company.name || "İsimsiz Firma"}</div>
                  <div className="text-xs text-slate-500">Son aktif: {formatTime(row.lastSeen)}</div>
                </div>
                <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{row.version === "-" ? "-" : `v${row.version}`}</div>
                <div className="text-sm text-slate-500">{row.devices} cihaz</div>
                <div className="text-sm text-slate-500">{row.active} aktif</div>
                <div className={`rounded-full px-3 py-1 text-xs font-black ${row.status === "Kritik" ? "bg-red-50 text-red-700" : row.status === "Güncel" ? "bg-emerald-50 text-emerald-700" : row.status === "Cihaz yok" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>
                  {row.status}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/40 dark:bg-red-900/10">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-red-600 p-3 text-white">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-900 dark:text-white">Kritik Hata Alarmı</h2>
              <p className="text-sm text-red-700 dark:text-red-200">Hata logları sürüme göre gruplanır.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {criticalVersions.length === 0 ? (
              <div className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500 shadow-sm dark:bg-slate-950">Kritik hata kaydı yok.</div>
            ) : criticalVersions.map((item) => (
              <div key={item.version} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-950">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-black text-slate-900 dark:text-white">v{item.version}</div>
                  <div className="text-xs font-black text-red-600">{item.errors} hata</div>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{item.impact}</div>
                <div className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{item.action}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {updateTypes.map((item) => (
          <button
            type="button"
            key={item.title}
            onClick={item.action}
            className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <item.icon className="h-6 w-6 text-slate-700 dark:text-slate-200" />
            <h3 className="mt-4 font-black text-slate-900 dark:text-white">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.text}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          <h3 className="mt-3 font-black text-slate-900 dark:text-white">Lisans Kontrolü</h3>
          <p className="mt-2 text-sm text-slate-500">Firma lisansı askıdaysa güncelleme bildirimi gider, ancak yeni işlem izinleri lisans kurallarına bağlı kalır.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <Bell className="h-6 w-6 text-blue-600" />
          <h3 className="mt-3 font-black text-slate-900 dark:text-white">Bildirim Kaydı</h3>
          <p className="mt-2 text-sm text-slate-500">Yayınlanan sürüm için hedef kullanıcılara notifications kaydı oluşturulur.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <Send className="h-6 w-6 text-indigo-600" />
          <h3 className="mt-3 font-black text-slate-900 dark:text-white">Uygulama İçi Güncelleme</h3>
          <p className="mt-2 text-sm text-slate-500">Müşteri uygulaması açıldığında yeni sürümü algılar ve gerekirse zorunlu uyarı gösterir.</p>
        </div>
      </div>

      {showPublish ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Yeni Sürüm Yayınla</h2>
                <p className="text-sm text-slate-500">Yayın kaydı oluşturulur ve hedef kullanıcılara bildirim gider.</p>
              </div>
              <button type="button" onClick={() => setShowPublish(false)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500">Sürüm</span>
                  <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500">Tür</span>
                  <select value={form.update_type} onChange={(e) => setForm({ ...form, update_type: e.target.value as UpdateRow["update_type"] })} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950">
                    <option value="general">Genel</option>
                    <option value="bugfix">Hata düzeltme</option>
                    <option value="feature">Yeni özellik</option>
                    <option value="security">Güvenlik</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">Başlık</span>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>

              <label className="block">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">Açıklama</span>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-sm font-black text-emerald-900">Otomatik guncelleme linkleri</div>
                <p className="mt-1 text-xs font-semibold leading-5 text-emerald-800">
                  Windows linki girilirse masaustu uygulama yeni surumu indirip kurulumu baslatir. Android linki APK indirme akisi icin kullanilir.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-700">Windows installer linki</span>
                    <input value={form.windows_download_url} onChange={(e) => setForm({ ...form, windows_download_url: e.target.value })} placeholder="https://.../Perde-Yonetim-SaaS-Setup.exe" className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-700">Android APK linki</span>
                    <input value={form.android_download_url} onChange={(e) => setForm({ ...form, android_download_url: e.target.value })} placeholder="https://.../app-release.apk" className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500" />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold">
                  <span>Tüm firmalar</span>
                  <input type="radio" checked={form.target_type === "all_companies"} onChange={() => setForm({ ...form, target_type: "all_companies", target_company_ids: [] })} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold">
                  <span>Seçili firmalar</span>
                  <input type="radio" checked={form.target_type === "selected_companies"} onChange={() => setForm({ ...form, target_type: "selected_companies" })} />
                </label>
              </div>

              {form.target_type === "selected_companies" ? (
                <div className="rounded-2xl border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Hedef firmalar</div>
                  <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                    {companies.map((company) => (
                      <label key={company.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold">
                        <input type="checkbox" checked={form.target_company_ids.includes(company.id)} onChange={() => toggleCompany(company.id)} />
                        <span className="min-w-0 truncate">{company.name || "İsimsiz Firma"}</span>
                      </label>
                    ))}
                    {companies.length === 0 ? <div className="text-sm text-slate-500">Firma yok.</div> : null}
                  </div>
                </div>
              ) : null}

              <label className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                <span>Zorunlu güncelleme olarak yayınla</span>
                <input type="checkbox" checked={form.force_update} onChange={(e) => setForm({ ...form, force_update: e.target.checked })} />
              </label>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowPublish(false)} className="rounded-2xl px-5 py-3 text-sm font-black text-slate-600 hover:bg-slate-100">İptal</button>
              <button type="button" onClick={publishUpdate} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Kaydet ve Yayınla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
