import { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Truck,
  Calculator,
  Settings,
  Menu,
  X,
  Bell,
  CheckCircle2,
  Map as MapIcon,
  Package,
  FileText,
  UserCog,
  Calendar,
  CreditCard,
  ShieldAlert,
  Building2,
  Palette,
  LifeBuoy,
  Megaphone,
  MonitorSmartphone,
  Ruler,
  ImagePlus,
  FilePlus2
} from "lucide-react";


import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { clearDemoTenantContext, getEffectiveTenantContext, supabase, setAppReadOnlyMode } from "../supabaseClient";
import { canAccess, roleLabel, type RoleState } from "../auth/roles";
import { useRole } from "../context/RoleContext";
import { useAuth } from "../context/AuthContext";
import SupportModal from "../components/SupportModal";
import NotificationBell from "../components/NotificationBell";
import AppUpdateNotifier from "../components/AppUpdateNotifier";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const NavItem = ({
  to,
  icon: Icon,
  label,
  onClick,
}: {
  to: string;
  icon: any;
  label: string;
  onClick?: () => void;
}) => {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group text-sm font-medium",
          isActive
            ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300 shadow-sm"
            : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
        )
      }
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </NavLink>
  );
};

/** -----------------------
 * Types
 * ----------------------*/
type DbOrderReminder = {
  id: string;
  customer_id: string | null;
  status: string | null;
  note: string | null;
  due_at: string | null;
  due_remind_days: number | null;
  due_done: boolean | null;
  due_done_at: string | null;
};

type DbAppointment = {
  id: string;
  customer_id: string | null;
  order_id: string | null;
  type: string | null;
  title: string | null;
  start_at: string | null;
  remind_before_minutes: number | null;
  done: boolean | null;
  done_at: string | null;
  note: string | null;
};

type DbCustomer = {
  id: string;
  name: string | null;
  phone: string | null;
};

type ReminderItem =
  | {
    kind: "order";
    id: string;
    title: string;
    when: Date;
    isOverdue: boolean;
    customerName?: string;
    customerPhone?: string;
    note?: string;
    done: boolean;
    doneAt?: Date;
  }
  | {
    kind: "appointment";
    id: string;
    title: string;
    when: Date;
    isOverdue: boolean;
    customerName?: string;
    customerPhone?: string;
    note?: string;
    done: boolean;
    doneAt?: Date;
  };

type TrialInfo = {
  plan: string;
  trialEndsAt: Date | null;
  isExpired: boolean;
  daysLeft: number | null;
};

/** -----------------------
 * Helpers
 * ----------------------*/
function safeDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatTR(d: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function displayCustomerName(name?: string) {
  if (!name) return "";
  return /test|demo/i.test(name) ? "Müşteri" : name;
}

function displayCustomerPhone(phone?: string) {
  if (!phone) return "";
  return phone.replace(/\d(?=\d{2})/g, "•");
}

function daysBefore(date: Date, days: number) {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(date.getTime() - ms);
}

function useNowInterval() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function wasNotified(key: string) {
  try {
    const raw = localStorage.getItem("reminder_notified_map") || "{}";
    const map = JSON.parse(raw) as Record<string, string>;
    return Boolean(map[key]);
  } catch {
    return false;
  }
}

function setNotified(key: string) {
  try {
    const raw = localStorage.getItem("reminder_notified_map") || "{}";
    const map = JSON.parse(raw) as Record<string, string>;
    map[key] = new Date().toISOString();
    localStorage.setItem("reminder_notified_map", JSON.stringify(map));
  } catch {
    // ignore
  }
}

function getPurchaseUrl() {
  const msg = encodeURIComponent("Merhaba, PerdePRO deneme surem doldu. Lisans satin almak ve devam etmek istiyorum.");
  return `https://wa.me/905308427870?text=${msg}`;
}

function PurchaseRequiredScreen({ trialInfo }: { trialInfo: TrialInfo | null }) {
  const endedAt = trialInfo?.trialEndsAt ? formatTR(trialInfo.trialEndsAt) : null;

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-red-100 dark:border-red-900 rounded-3xl p-6 sm:p-8 shadow-xl text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-600 mx-auto flex items-center justify-center mb-5">
          <ShieldAlert className="w-9 h-9" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
          Deneme sureniz doldu
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
          Giriş yapabilirsiniz, ancak yeni kayit, guncelleme, silme ve odeme islemleri lisans alana kadar kapatildi.
        </p>
        {endedAt ? (
          <div className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Deneme bitiş tarihi: {endedAt}
          </div>
        ) : null}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          {["Siparis ve müşteri yonetimi", "Muhasebe ve tedarikci islemleri", "Personel, rota ve fiyat listesi"].map((item) => (
            <div key={item} className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 mb-2" />
              {item}
            </div>
          ))}
        </div>
        <a
          href={getPurchaseUrl()}
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-3 text-white font-black shadow-lg shadow-red-600/20 hover:bg-red-700 active:scale-95 transition"
        >
          <CreditCard className="w-5 h-5" />
          Satın Al
        </a>
      </div>
    </div>
  );
}

const playNotificationSound = () => {
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        // SMS like double beep
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(1046.50, audioCtx.currentTime); // C6
        oscillator.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.15); // E6
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        
        gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.16);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.error("Audio error:", e);
    }
};

async function getContext() {
  const ctx = await getEffectiveTenantContext().catch(() => null);
  const user = ctx?.user ?? null;

  if (!user) return { user: null, company_id: null, company_name: null, company_logo: null, user_id: null };

  let company_name = "Perde SaaS";
  let company_logo = null;
  if (ctx?.company_id) {
    const { data: comp } = await supabase.from("companies").select("name, logo_url").eq("id", ctx.company_id).maybeSingle();
    if (comp?.name) company_name = comp.name;
    if (comp?.logo_url) company_logo = comp.logo_url;
  }

  const company_id = ctx?.company_id ?? null;
  const user_id = user.id;

  return { user, company_id, company_name, company_logo, user_id };
}

/** -----------------------
 * Layout Component
 * ----------------------*/
export const Layout = () => {
  const { effectiveRole: role, realRole, viewingRole, viewingUserId, viewingLabel, isSimulating, setViewingRoleAndUser } = useRole();
  const { hasModule, company, readOnly } = useAuth();
  const isDemoWriteMode = realRole === "super_admin" && isSimulating && localStorage.getItem("demo_read_only") === "false";
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [currentUserData, setCurrentUserData] = useState<{ userId: string, companyId: string } | null>(null);

  useEffect(() => {
    getEffectiveTenantContext()
      .then((ctx) => setCurrentUserData({ userId: ctx.user.id, companyId: ctx.company_id }))
      .catch(() => setCurrentUserData(null));
  }, [realRole]);

  const [companyName, setCompanyName] = useState("Curtain Saas");
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [isExpiredTrial, setIsExpiredTrial] = useState(false);
  const [trialInfo, setTrialInfo] = useState<TrialInfo | null>(null);
  const [showPurchaseScreen, setShowPurchaseScreen] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadCompanyInfo() {
      const ctx = await getContext();
      if (!ctx.user || !alive) return;


      // Trial check
      if (ctx.company_id) {
         setCompanyName(ctx.company_name || "Perde SaaS");
         setCompanyLogo(ctx.company_logo || null);
         try {
             const { data: comp } = await supabase
                   .from("companies")
                   .select("subscription_plan, trial_ends_at")
                   .eq("id", ctx.company_id)
                   .maybeSingle();

             if (comp) {
                 const plan = comp.subscription_plan || 'trial';
                 if (plan === 'trial') {
                     const endsAt = comp.trial_ends_at ? new Date(comp.trial_ends_at).getTime() : 0;
                     const trialEndsAt = endsAt > 0 ? new Date(endsAt) : null;
                     const daysLeft = endsAt > 0 ? Math.max(0, Math.ceil((endsAt - Date.now()) / (24 * 60 * 60 * 1000))) : null;
                     setTrialInfo({ plan, trialEndsAt, isExpired: endsAt > 0 && Date.now() > endsAt, daysLeft });
                     const isSuperAdminWriteDemo = realRole === "super_admin" && localStorage.getItem("demo_company_id") && localStorage.getItem("demo_read_only") === "false";
                     if (endsAt > 0 && Date.now() > endsAt && !isSuperAdminWriteDemo) {
                         setIsExpiredTrial(true);
                         setShowPurchaseScreen(true);
                         setAppReadOnlyMode(true);
                     } else {
                         setIsExpiredTrial(false);
                         setShowPurchaseScreen(false);
                         setAppReadOnlyMode(false);
                     }
                 } else {
                     setTrialInfo({ plan, trialEndsAt: null, isExpired: false, daysLeft: null });
                     setIsExpiredTrial(false);
                     setShowPurchaseScreen(false);
                     setAppReadOnlyMode(false);
                 }
             }
         } catch {
             // Tablo henüz yoksa veya hata varsa varsayılanı kullan
         }
      }
    }

    loadCompanyInfo();
    return () => {
      alive = false;
    };
  }, [realRole]);

  useEffect(() => {
    const handler = () => setShowPurchaseScreen(true);
    window.addEventListener("trial-expired-action", handler);
    return () => window.removeEventListener("trial-expired-action", handler);
  }, []);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const isFieldOnlyRole = role === "installer";
  const canUseFieldWork = canAccess(role, ["admin", "installer"]);

  // Reminder UI
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [reminderTab, setReminderTab] = useState<"pending" | "done">("pending");
  const [dismissedToasts, setDismissedToasts] = useState<Set<string>>(new Set());
  const [playedNotifications, setPlayedNotifications] = useState<Set<string>>(new Set());

  const currentNow = useNowInterval();

  const pendingCount = useMemo(
    () => reminders.filter((r) => !r.done).length,
    [reminders]
  );

  const sortedReminders = useMemo(() => {
    return [...reminders].sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return a.when.getTime() - b.when.getTime();
    });
  }, [reminders]);

  useEffect(() => {
      const activeNotifs = sortedReminders.filter(r => {
          const diffMin = (r.when.getTime() - currentNow.getTime()) / 60000;
          const isAppr = diffMin > 0 && diffMin <= 10;
          const isOv = diffMin <= 0;
          return r.kind === "appointment" && !r.done && !dismissedToasts.has(r.id) && (isOv || isAppr);
      });

      let hasNew = false;
      activeNotifs.forEach(r => {
          if (!playedNotifications.has(r.id)) {
              hasNew = true;
              setPlayedNotifications(prev => new Set(prev).add(r.id));
          }
      });

      if (hasNew) {
          playNotificationSound();
      }
  }, [sortedReminders, currentNow, dismissedToasts, playedNotifications]);

  const toggleMobileMenu = () => setIsMobileMenuOpen((p) => !p);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const toggleReminder = () => setIsReminderOpen((p) => !p);
  const closeReminder = () => setIsReminderOpen(false);

  function switchDemoRole(value: RoleState) {
    if (value === "super_admin") {
      clearDemoTenantContext();
    }
    setViewingRoleAndUser(value, null);
    if (value === "super_admin") navigate("/super-admin/companies");
    else if (value === "accountant") navigate("/accounting");
    else if (value === "installer") navigate("/field");
    else navigate("/dashboard");
    closeMobileMenu();
  }

  function toggleDemoWriteMode() {
    if (!isSimulating || realRole !== "super_admin") return;
    const nextReadOnly = isDemoWriteMode;
    localStorage.setItem("demo_read_only", nextReadOnly ? "true" : "false");
    setAppReadOnlyMode(nextReadOnly);
    navigate(0);
  }


  async function fetchReminders() {
    setRemindersLoading(true);
    try {
      const ctx = await getContext();
      if (!ctx.user) {
        setReminders([]);
        return;
      }

      // Customers map
      const customersRes = await supabase
        .from("customers")
        .select("id,name,phone,company_id")
        .order("name");

      const customersAll = (customersRes.data || []) as (DbCustomer & {
        company_id?: string | null;
      })[];

      const customers = ctx.company_id
        ? customersAll.filter((c) => (c as any).company_id === ctx.company_id)
        : customersAll;

      const customerMap = new Map<string, DbCustomer>();
      customers.forEach((c) =>
        customerMap.set(c.id, { id: c.id, name: c.name, phone: c.phone })
      );

      const now = new Date();

      // Orders reminders
      const ordersRes = await supabase
        .from("orders")
        .select(
          "id,customer_id,status,note,due_at,due_remind_days,due_done,due_done_at,company_id"
        )
        .order("due_at", { ascending: true });

      const ordersAll = (ordersRes.data || []) as (DbOrderReminder & {
        company_id?: string | null;
      })[];

      const orders = ctx.company_id
        ? ordersAll.filter((o) => (o as any).company_id === ctx.company_id)
        : ordersAll;

      const orderItems: ReminderItem[] = orders
        .map((o) => {
          const due = safeDate(o.due_at);
          if (!due) return null;

          const remindDays =
            typeof o.due_remind_days === "number" ? o.due_remind_days : 3;
          const remindAt = daysBefore(due, remindDays);

          if (!o.due_done && remindAt.getTime() > now.getTime()) return null;

          const c = o.customer_id ? customerMap.get(o.customer_id) : undefined;
          const isOverdue = due.getTime() < now.getTime();

          return {
            kind: "order",
            id: o.id,
            title: `Sipariş termin: ${formatTR(due)}`,
            when: due,
            isOverdue,
            customerName: c?.name || undefined,
            customerPhone: c?.phone || undefined,
            note: o.note || undefined,
            done: !!o.due_done,
            doneAt: safeDate(o.due_done_at) || undefined,
          } as ReminderItem;
        })
        .filter(Boolean) as ReminderItem[];

      // Appointments reminders
      const apptRes = await supabase
        .from("appointments")
        .select(
          "id,customer_id,order_id,type,title,start_at,remind_before_minutes,done,done_at,note,company_id"
        )
        .order("start_at", { ascending: true });

      const apptsAll = (apptRes.data || []) as (DbAppointment & {
        company_id?: string | null;
      })[];

      const appts = ctx.company_id
        ? apptsAll.filter((a) => (a as any).company_id === ctx.company_id)
        : apptsAll;
      const apptItems: ReminderItem[] = appts
        .map((a) => {
          const start = safeDate(a.start_at);
          if (!start) return null;


          const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

          if (!a.done && start.getTime() > sevenDaysLater.getTime()) return null;

          // Hatırlatma zamanı gelmediyse listeye alma (SADECE done değilse)
          //if (!a.done && remindAt.getTime() > now.getTime()) return null;

          const c = a.customer_id ? customerMap.get(a.customer_id) : undefined;
          const isOverdue = start.getTime() < now.getTime();

          const titleBase =
            a.title || (a.type === "measurement" ? "Ölçü randevusu" : "Randevu");

          return {
            kind: "appointment",
            id: a.id,
            title: `${titleBase}: ${formatTR(start)}`,
            when: start,
            isOverdue,
            customerName: c?.name || undefined,
            customerPhone: c?.phone || undefined,
            note: a.note || undefined,
            done: !!a.done,
            doneAt: safeDate(a.done_at) || undefined,
          } as ReminderItem;
        })
        .filter(Boolean) as ReminderItem[];
      const map = new Map<string, ReminderItem>();

      // sipariş terminleri
      orderItems.forEach((item) => {
        map.set("order-" + item.id, item);
      });

      // randevular
      apptItems.forEach((item: ReminderItem) => {
        map.set("appt-" + item.id, item);
      });

      const mergedReminders = Array.from(map.values());
      setReminders(mergedReminders);

      // Browser notification (opsiyonel)
      if ("Notification" in window) {
        mergedReminders.forEach((r: ReminderItem) => {
          const key = `${r.kind}:${r.id}`;
          if (wasNotified(key)) return;

          const diffMin = (r.when.getTime() - now.getTime()) / 60000;
          const shouldNotify = r.isOverdue || diffMin <= 10;

          if (shouldNotify && Notification.permission === "granted") {
            new Notification("Hatırlatma", {
              body: `${r.title}${r.customerName ? ` • ${r.customerName}` : ""}`,
            });
            setNotified(key);
          }
        });
      }
    } finally {
      setRemindersLoading(false);
    }
  }

  useEffect(() => {
    fetchReminders();
    const t = window.setInterval(fetchReminders, 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  async function requestBrowserNotifications() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    try {
      await Notification.requestPermission();
    } catch {
      // ignore
    }
  }

  async function markDone(item: ReminderItem) {
    try {
      if (item.kind === "order") {
        const { error } = await supabase
          .from("orders")
          .update({ due_done: true, due_done_at: new Date().toISOString() })
          .eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("appointments")
          .update({ done: true, done_at: new Date().toISOString() })
          .eq("id", item.id);
        if (error) throw error;
      }

      setReminders((prev) =>
        prev.map((x) =>
          x.kind === item.kind && x.id === item.id
            ? { ...x, done: true, doneAt: new Date() }
            : x
        )
      );
    } catch (e: any) {
      alert("İşaretleme hatası: " + (e?.message || String(e)));
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 w-full transition-colors duration-300">
      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 h-[100dvh] w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-300 ease-in-out lg:translate-x-0 flex flex-col shadow-xl lg:shadow-none",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {role !== "super_admin" && companyLogo ? (
              <img src={companyLogo} alt={companyName} className="w-8 h-8 rounded-lg object-contain bg-white shrink-0 shadow-sm" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold shrink-0 shadow-md">
                {(role === "super_admin" ? "Curtain Saas" : companyName).charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-xl font-bold bg-gradient-to-r from-primary-700 to-primary-500 bg-clip-text text-transparent dark:from-primary-400 dark:to-primary-200 truncate">
              {role === "super_admin" ? "Curtain Saas" : companyName}
            </span>
          </div>
          <button
            onClick={closeMobileMenu}
            className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 mb-2 mt-2">
            Ana Menü
          </div>

          {role === "super_admin" && (
            <>
              <NavItem to="/super-admin/companies" icon={Building2} label="Müşteri Firmalar" onClick={closeMobileMenu} />
              <NavItem to="/super-admin/trials" icon={ShieldAlert} label="Deneme Hesapları" onClick={closeMobileMenu} />
              <NavItem to="/super-admin/mobile" icon={MonitorSmartphone} label="Mobil Uygulama Yönetimi" onClick={closeMobileMenu} />
              <NavItem to="/super-admin/support" icon={LifeBuoy} label="Destek / Hata Merkezi" onClick={closeMobileMenu} />
              <NavItem to="/super-admin/updates" icon={Megaphone} label="Güncellemeler" onClick={closeMobileMenu} />
              <NavItem to="/super-admin/notifications" icon={Megaphone} label="Bildirimler" onClick={closeMobileMenu} />
            </>
          )}

          {role === "admin" && (
            <>
              {hasModule("admin") && <NavItem to="/dashboard" icon={LayoutDashboard} label="Gösterge Paneli" onClick={closeMobileMenu} />}
              {hasModule("customers") && <NavItem to="/customers" icon={Users} label="Müşteriler" onClick={closeMobileMenu} />}
              {hasModule("measurements") && <NavItem to="/measurements/new" icon={Ruler} label="Ölçü Al" onClick={closeMobileMenu} />}
              {hasModule("orders") && <NavItem to="/orders/new" icon={FilePlus2} label="Teklifler" onClick={closeMobileMenu} />}
              {hasModule("orders") && <NavItem to="/orders" icon={ShoppingCart} label="Siparişler" onClick={closeMobileMenu} />}
              {hasModule("appointments") && <NavItem to="/route/today" icon={Calendar} label="Randevular" onClick={closeMobileMenu} />}
              {hasModule("suppliers") && <NavItem to="/suppliers" icon={Truck} label="Tedarikçiler" onClick={closeMobileMenu} />}
              {(hasModule("catalogs") || hasModule("suppliers") || hasModule("orders")) && <NavItem to="/products" icon={Package} label="Ürünler" onClick={closeMobileMenu} />}
              {hasModule("installation") && <NavItem to="/route/today" icon={MapIcon} label="Montaj Takibi" onClick={closeMobileMenu} />}
              {hasModule("accounting") && <NavItem to="/accounting" icon={Calculator} label="Finans" onClick={closeMobileMenu} />}
              {hasModule("catalogs") && <NavItem to="/catalogs" icon={Palette} label="Kartela Yönetimi" onClick={closeMobileMenu} />}
              {hasModule("staff") && <NavItem to="/staff" icon={UserCog} label="Personel" onClick={closeMobileMenu} />}
              <NavItem to="/settings" icon={Settings} label="Ayarlar" onClick={closeMobileMenu} />
            </>
          )}

          {role === "accountant" && (
            <>
              <NavItem to="/dashboard" icon={LayoutDashboard} label="Panel" onClick={closeMobileMenu} />
              {hasModule("accounting") && <NavItem to="/accounting" icon={Calculator} label="Finans" onClick={closeMobileMenu} />}
              {hasModule("suppliers") && <NavItem to="/suppliers" icon={Truck} label="Tedarikçiler" onClick={closeMobileMenu} />}
              {hasModule("accounting") && <NavItem to="/invoices" icon={FileText} label="Faturalar" onClick={closeMobileMenu} />}
              {hasModule("reports") && <NavItem to="/reports" icon={FileText} label="Raporlar" onClick={closeMobileMenu} />}
            </>
          )}

          {isFieldOnlyRole && (
            <>
              <NavItem to="/field" icon={LayoutDashboard} label="Panel" onClick={closeMobileMenu} />
              <NavItem to="/route/today" icon={MapIcon} label="Bugünün Rotası" onClick={closeMobileMenu} />
              <NavItem to="/measurements/new" icon={Ruler} label="Ölçü Al" onClick={closeMobileMenu} />
              <NavItem to="/orders/new" icon={FilePlus2} label="Sipariş / Teklif Oluştur" onClick={closeMobileMenu} />
              <NavItem to="/visual-previews" icon={ImagePlus} label="Kartela Önizleme" onClick={closeMobileMenu} />
              <NavItem to="/field/customers" icon={Users} label="Müşterilerim" onClick={closeMobileMenu} />
            </>
          )}

            {/* Support Button for customer users */}
            {role !== "super_admin" && (
            <div className="px-4 py-6 border-t border-slate-200 dark:border-slate-800 mt-auto">
              <button 
                onClick={() => {
                  setIsSupportOpen(true);
                  closeMobileMenu();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-bold hover:bg-blue-100 transition-all group"
              >
                <LifeBuoy size={20} className="group-hover:rotate-12 transition-transform" />
                <span>Sorun Bildir</span>
              </button>
            </div>
            )}
          </nav>
      </aside>

      {/* Support Modal */}
      {currentUserData && (
        <SupportModal 
          isOpen={isSupportOpen} 
          onClose={() => setIsSupportOpen(false)} 
          companyId={currentUserData.companyId}
          userId={currentUserData.userId}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pointer-events-auto">
        <AppUpdateNotifier />
	        {role !== "super_admin" && company ? (
	          <div className="border-b border-slate-200 bg-white/90 px-4 py-2 text-xs font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300">
	            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
	              <span>Paket: <span className="text-slate-900 dark:text-white">{company.subscription_plan || "starter"}</span></span>
	              {company.trial_end || company.trial_ends_at ? (
	                <span>Deneme bitiş: {formatTR(new Date(company.trial_end || company.trial_ends_at || ""))}</span>
	              ) : null}
	              {readOnly ? <span className="text-red-600">Read-only mod aktif</span> : null}
	              {isDemoWriteMode ? <span className="text-emerald-600">Süper admin işlem modu aktif</span> : null}
	              {isSimulating ? (
	                <>
	                  <button
	                    type="button"
	                    onClick={toggleDemoWriteMode}
	                    className={cn(
	                      "rounded-full px-3 py-1 text-[11px] font-black text-white shadow-sm",
	                      isDemoWriteMode ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700",
	                    )}
	                  >
	                    {isDemoWriteMode ? "Read-only Moda Al" : "İşlem Moduna Al"}
	                  </button>
	                  <button
	                    type="button"
	                    onClick={() => switchDemoRole("super_admin")}
	                    className="rounded-full bg-amber-500 px-3 py-1 text-[11px] font-black text-white shadow-sm hover:bg-amber-600"
	                  >
	                    Süper Admin'e Dön
	                  </button>
	                </>
	              ) : null}
	              <button
	                type="button"
	                onClick={() => window.open(getPurchaseUrl(), "_blank")}
	                className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white"
	              >
	                Satın Al / Yükselt
	              </button>
	            </div>
	          </div>
	        ) : null}
        {isExpiredTrial && (
            <div className="bg-red-600 text-white text-center py-2 px-4 shadow-md sticky top-0 z-[60] flex items-center justify-center gap-3">
                <span className="font-bold">Uyarı: DENEME SÜRENİZ DOLMUŞTUR</span>
                <span className="text-sm">Hesabınız salt-okunur (read-only) moddadır. Yeni işlem yapılamaz.</span>
                <a 
                  href="#" 
                  onClick={(e) => { 
                    e.preventDefault(); 
                    const msg = encodeURIComponent("Merhaba Özlem Hanım, Perde SaaS deneme sürem doldu. Lisans satın almak ve devam etmek istiyorum.");
                    window.open(`https://wa.me/905308427870?text=${msg}`, "_blank");
                  }} 
                  className="bg-white text-red-700 px-3 py-1 rounded-full text-xs font-bold shadow hover:bg-red-50 transition"
                >
                    Özlem Cihan (Satış & Destek)
                </a>
            </div>
        )}
	        <header className={cn("min-h-[64px] sm:min-h-[80px] pt-safe bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 lg:px-8 z-50 transition-all duration-300", !isExpiredTrial && "sticky top-0")}>


          <button
            onClick={toggleMobileMenu}
            className="lg:hidden p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>

	          <div className="min-w-0 flex-1 font-bold text-slate-900 dark:text-white text-sm sm:text-lg uppercase tracking-tight flex items-center gap-2">
	            {role !== "super_admin" && companyLogo && <img src={companyLogo} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain hidden sm:block" />}
	            <span className="min-w-0 max-w-[42vw] truncate sm:max-w-none">{role === "super_admin" ? "Curtain Saas" : companyName}</span>
	            {/* Simulation Badge if active */}
	            {isSimulating && (
	                <span className="hidden sm:inline-flex shrink-0 text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
	                    Demo Görünümü: {viewingLabel}
	                </span>
	            )}
	          </div>

	          <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-3">
            {/* Role Switcher for Super Admin */}
            {realRole === "super_admin" && (
              <select
                value={viewingUserId || viewingRole}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "super_admin" || val === "admin" || val === "accountant" || val === "installer") {
                    switchDemoRole(val as RoleState);
                  }
                }}
	                className="max-w-[110px] sm:max-w-[140px] text-xs border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md py-1 pl-2 pr-7 text-slate-700 dark:text-slate-300"
              >
                <option value="super_admin">Süper Admin</option>
                <option value="admin">Yönetici</option>
                <option value="accountant">Muhasebe</option>
                <option value="installer">Saha Personeli</option>
              </select>
            )}
            {/* Notification Bell (Global) */}
            {currentUserData && <NotificationBell userId={currentUserData.userId} />}

            {/* Reminder Bell */}
            {role !== "super_admin" && (
            <div className="relative">
              <button
                type="button"
                onClick={async () => {
                  await requestBrowserNotifications();
                  toggleReminder();
                }}
                className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-all"
                title="Hatırlatmalar"
              >
                <Bell className="w-5 h-5" />
                {pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 text-[11px] min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white flex items-center justify-center">
                    {pendingCount}
                  </span>
                )}
              </button>

              {isReminderOpen && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[1px]"
                    onClick={closeReminder}
                  />

                  {/* Panel */}
                  <div
                    className="fixed top-16 right-2 left-2 sm:left-auto sm:right-4 sm:w-[440px]
                      bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700
                      rounded-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 z-[70]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
                      {/* Header */}
                      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          Hatırlatmalar
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200">
                            {pendingCount}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={fetchReminders}
                            className="text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                          >
                            Yenile
                          </button>
                          <button
                            type="button"
                            onClick={closeReminder}
                            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                            aria-label="Kapat"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Tabs */}
                      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReminderTab("pending")}
                          className={cn(
                            "text-xs px-3 py-1 rounded-lg",
                            reminderTab === "pending"
                              ? "bg-primary-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                          )}
                        >
                          Bekleyenler
                        </button>

                        <button
                          type="button"
                          onClick={() => setReminderTab("done")}
                          className={cn(
                            "text-xs px-3 py-1 rounded-lg",
                            reminderTab === "done"
                              ? "bg-primary-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                          )}
                        >
                          Yapılanlar
                        </button>
                      </div>

                      {/* List */}
                      <div className="p-2">
                        {remindersLoading ? (
                          <div className="p-4 text-sm text-slate-500">
                            Kontrol ediyorum...
                          </div>
                        ) : sortedReminders.filter((r) =>
                          reminderTab === "pending" ? !r.done : r.done
                        ).length === 0 ? (
                          <div className="p-4 text-sm text-slate-500">
                            Şu an hatırlatma yok ✓
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {sortedReminders
                              .filter((r) =>
                                reminderTab === "pending" ? !r.done : r.done
                              )
                              .map((r) => (
                                <div
                                  key={`${r.kind}:${r.id}`}
                                  className={cn(
                                    "p-3 rounded-xl border",
                                    r.isOverdue
                                      ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
                                      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {r.title}
                                      </div>

                                      {(r.customerName || r.customerPhone) && (
                                        <div className="text-xs text-slate-600 dark:text-slate-300 mt-1 break-words">
                                          {r.customerName ? displayCustomerName(r.customerName) : ""}
                                          {r.customerPhone
                                            ? ` • ${displayCustomerPhone(r.customerPhone)}`
                                            : ""}
                                        </div>
                                      )}

                                      {r.note && (
                                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                          {r.note}
                                        </div>
                                      )}

                                      <div className="text-[11px] mt-2 text-slate-500 dark:text-slate-400">
                                        {r.isOverdue ? "Gecikti" : "Yaklaşıyor"} •{" "}
                                        {formatTR(r.when)}
                                      </div>
                                    </div>

                                    {/* Buttons */}
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const path =
                                            r.kind === "order"
                                              ? `/orders/${r.id}`
                                              : `/appointments/${r.id}`;
                                          navigate(path);
                                          closeReminder();
                                        }}
                                        className="text-xs px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                                      >
                                        Detay
                                      </button>

                                      {!r.done && (
                                        <button
                                          type="button"
                                          onClick={() => markDone(r)}
                                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                          title="Yapıldı"
                                        >
                                          <CheckCircle2 className="w-4 h-4" />
                                          Yapıldı
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>

                      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                        Not: “Yapıldı” işaretleyince yapılanlar listesine gider.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            )}

            {/* Profile (dummy) */}
            <div className="hidden sm:flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-800">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Kullanıcı
                </div>
                <div className="text-xs text-slate-500">
                  {roleLabel(role)}
                </div>
              </div>
              <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden border-2 border-white dark:border-slate-800 shadow-sm">
                <img
                  src="https://api.dicebear.com/7.x/avataaars/svg?seed=Curtain"
                  alt="User"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-4 pb-24 pt-6 sm:pt-8 lg:p-8 max-w-7xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">

          {showPurchaseScreen ? <PurchaseRequiredScreen trialInfo={trialInfo} /> : <Outlet />}
        </div>
      </main>

      {/* Global In-App Notification Overlay */}
      {role !== "super_admin" && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-3 pointer-events-none w-full max-w-sm px-4">
         {sortedReminders.filter(r => {
             const diffMin = (r.when.getTime() - currentNow.getTime()) / 60000;
             const isAppr = diffMin > 0 && diffMin <= 10;
             const isOv = diffMin <= 0;
             return r.kind === "appointment" && !r.done && !dismissedToasts.has(r.id) && (isOv || isAppr);
         }).slice(0, 1).map(r => {
             const diffMin = (r.when.getTime() - currentNow.getTime()) / 60000;
             const isOv = diffMin <= 0;

             return (
                 <div key={r.id} className={cn("pointer-events-auto p-4 rounded-xl border shadow-2xl w-full transition-all animate-in slide-in-from-top-10 relative overflow-hidden", isOv ? "bg-red-50 border-red-500 dark:bg-red-900/30 text-red-900 dark:text-red-100" : "bg-amber-50 border-amber-500 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100")}>
                     <div className={cn("absolute top-0 left-0 w-1 h-full", isOv ? "bg-red-500" : "bg-amber-500")} />
                     <button onClick={() => setDismissedToasts(prev => new Set(prev).add(r.id))} className="absolute top-2 right-2 p-1 text-current opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
                     <div className="font-bold mb-1 flex items-center gap-2">
                         <Bell className="w-4 h-4" />
                         {isOv ? "Geciken Randevu Uyarısı!" : "Randevu Yaklaştı (Son 10 dk)"}
                     </div>
                     <div className="text-sm font-medium mb-1 drop-shadow-sm">{r.title}</div>
                     {(r.customerName || r.customerPhone) && (
                         <div className="text-xs opacity-90 mb-2">
                             {displayCustomerName(r.customerName)} {r.customerPhone ? ` • ${displayCustomerPhone(r.customerPhone)}` : ""}
                         </div>
                     )}
                     <div className="flex items-center gap-2 mt-3 text-sm">
                         <button onClick={() => { navigate(`/appointments/${r.id}`); setDismissedToasts(prev => new Set(prev).add(r.id)); }} className="flex-1 py-1.5 px-3 bg-white/60 dark:bg-black/30 hover:bg-white text-current border border-current/20 rounded shadow-sm font-semibold text-center transition">Detay</button>
                         <button onClick={() => markDone(r)} className="flex-1 py-1.5 px-3 bg-white/60 dark:bg-black/30 hover:bg-white text-current border border-current/20 rounded shadow-sm font-semibold text-center transition">Tamamlandı</button>
                     </div>
                 </div>
             );
         })}
      </div>
      )}

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 min-h-[calc(64px+env(safe-area-inset-bottom))] pb-safe bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center lg:hidden z-[60] shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)]">

        <NavLink 
          to={isFieldOnlyRole ? "/field" : "/dashboard"}
          className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="max-w-full truncate">Panel</span>
        </NavLink>
        {role === "accountant" ? (
          <>
            <NavLink 
              to="/accounting"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <Calculator className="w-5 h-5" />
              <span className="max-w-full truncate">Muhasebe</span>
            </NavLink>
            <NavLink 
              to="/invoices"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <FileText className="w-5 h-5" />
              <span className="max-w-full truncate">Fatura</span>
            </NavLink>
          </>
        ) : isFieldOnlyRole ? (
          <>
            <NavLink 
              to="/route/today"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <MapIcon className="w-5 h-5" />
              <span className="max-w-full truncate">Rota</span>
            </NavLink>
            <NavLink 
              to="/measurements/new"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <Ruler className="w-5 h-5" />
              <span className="max-w-full truncate">Ölçü</span>
            </NavLink>
            <NavLink 
              to="/visual-previews"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <ImagePlus className="w-5 h-5" />
              <span className="max-w-full truncate">Kartela</span>
            </NavLink>
          </>
        ) : canUseFieldWork ? (
          <>
            <NavLink 
              to="/orders"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <ShoppingCart className="w-5 h-5" />
              <span className="max-w-full truncate">Sipariş</span>
            </NavLink>
            <NavLink 
              to="/route/today"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <MapIcon className="w-5 h-5" />
              <span className="max-w-full truncate">Rota</span>
            </NavLink>
            <NavLink 
              to="/customers"
              className={({ isActive }) => cn("min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors", isActive ? "text-primary-600" : "text-slate-500")}
            >
              <Users className="w-5 h-5" />
              <span className="max-w-full truncate">Müşteri</span>
            </NavLink>
          </>
        ) : null}
        <button 
          onClick={toggleMobileMenu}
          className="min-w-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium text-slate-500"
        >
          <Menu className="w-5 h-5" />
          <span className="max-w-full truncate">Menü</span>
        </button>
      </nav>
    </div>
  );
};

