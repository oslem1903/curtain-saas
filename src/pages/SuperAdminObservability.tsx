import { useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Clock, Users, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type ObservabilityData = {
  total_companies: number;
  total_users: number;
  active_users_now: number;
  active_users_today: number;
  active_users_7d: number;
  active_users_30d: number;
  trials_ending_7d: number;
  open_support_tickets: number;
  error_count_24h: number;
  top_errors: Array<{
    message: string;
    count: number;
    last_seen: string;
    company_id: string;
  }>;
};

type RecentUser = {
  user_id: string;
  company_id: string | null;
  last_activity_at: string;
  activity_type: string;
};

type TrialWarning = {
  id: string;
  name: string;
  trial_ends_at: string;
  days_remaining: number;
};

export default function SuperAdminObservability() {
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [trialCompanies, setTrialCompanies] = useState<TrialWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    setRefreshing(true);
    try {
      // Get observability data
      const { data: obsData, error: obsErr } = await supabase.rpc(
        "get_super_admin_observability"
      );
      if (obsErr) throw obsErr;
      setData(obsData);

      // Get recent active users (last 10)
      const { data: recentData, error: recentErr } = await supabase
        .from("user_activity")
        .select("user_id, company_id, created_at, activity_type")
        .order("created_at", { ascending: false })
        .limit(10);
      if (recentErr) throw recentErr;
      setRecentUsers(
        (recentData || []).map((r: any) => ({
          user_id: r.user_id,
          company_id: r.company_id,
          last_activity_at: r.created_at,
          activity_type: r.activity_type,
        }))
      );

      // Get trials ending soon
      const now = new Date();
      const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data: trialsData, error: trialsErr } = await supabase
        .from("companies")
        .select("id, name, trial_ends_at")
        .not("trial_ends_at", "is", null)
        .gte("trial_ends_at", now.toISOString())
        .lte("trial_ends_at", in7days.toISOString())
        .order("trial_ends_at", { ascending: true });
      if (trialsErr) throw trialsErr;
      setTrialCompanies(
        (trialsData || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          trial_ends_at: t.trial_ends_at,
          days_remaining: Math.ceil(
            (new Date(t.trial_ends_at).getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24)
          ),
        }))
      );
    } catch (e: any) {
      setError(e?.message || "Veri yüklenirken hata oluştu");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    void loadData().then(() => setLoading(false));

    // Auto-refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="text-slate-500 dark:text-slate-400">
          Gözlemleme verileri yükleniyor...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="text-red-700 dark:text-red-200 font-bold">{error}</div>
          <button
            onClick={() => void loadData()}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded font-bold text-sm"
          >
            Tekrar Dene
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white">
              Super Admin Kontrol Paneli
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Sistem genelinde gerçek zamanlı aktivite ve sağlık durumu
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            disabled={refreshing}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-bold disabled:opacity-50"
          >
            {refreshing ? "Yükleniyor..." : "Yenile"}
          </button>
        </div>

        {/* KPI Cards Grid */}
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Total Companies */}
            <KPICard
              label="Toplam Firma"
              value={data.total_companies}
              icon={<Building className="w-6 h-6" />}
              color="blue"
            />
            {/* Total Users */}
            <KPICard
              label="Toplam Kullanıcı"
              value={data.total_users}
              icon={<Users className="w-6 h-6" />}
              color="green"
            />
            {/* Active Now */}
            <KPICard
              label="Şu Anda Aktif"
              value={data.active_users_now}
              icon={<Zap className="w-6 h-6" />}
              color="orange"
              badge={`${Math.round((data.active_users_now / Math.max(1, data.total_users)) * 100)}%`}
            />
            {/* Errors 24h */}
            <KPICard
              label="Son 24 Saat Hata"
              value={data.error_count_24h}
              icon={<AlertTriangle className="w-6 h-6" />}
              color={data.error_count_24h > 10 ? "red" : "yellow"}
            />

            {/* Active Today */}
            <KPICard
              label="Bugün Aktif"
              value={data.active_users_today}
              icon={<Activity className="w-6 h-6" />}
              color="purple"
            />
            {/* Active 7 Days */}
            <KPICard
              label="Son 7 Gün Aktif"
              value={data.active_users_7d}
              icon={<BarChart3 className="w-6 h-6" />}
              color="indigo"
            />
            {/* Active 30 Days */}
            <KPICard
              label="Son 30 Gün Aktif"
              value={data.active_users_30d}
              icon={<Clock className="w-6 h-6" />}
              color="slate"
            />
            {/* Open Tickets */}
            <KPICard
              label="Açık Destek Talebi"
              value={data.open_support_tickets}
              icon={<AlertTriangle className="w-6 h-6" />}
              color={data.open_support_tickets > 5 ? "red" : "blue"}
            />

            {/* Trial Warnings */}
            <KPICard
              label="7 Gün İçinde Süresi Bitecek"
              value={data.trials_ending_7d}
              icon={<Clock className="w-6 h-6" />}
              color={data.trials_ending_7d > 0 ? "red" : "green"}
            />
          </div>
        )}

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Errors */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              Son 24 Saat En Sık Hatalar
            </h2>
            {data?.top_errors && data.top_errors.length > 0 ? (
              <div className="space-y-3">
                {data.top_errors.map((err, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between p-3 bg-slate-50 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-slate-600 dark:text-slate-300 truncate">
                        {err.message}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Son görülme:{" "}
                        {formatDistanceToNow(new Date(err.last_seen), {
                          addSuffix: true,
                          locale: tr,
                        })}
                      </div>
                    </div>
                    <div className="ml-3 px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded font-bold text-sm whitespace-nowrap">
                      ×{err.count}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 dark:text-slate-400 text-center py-8">
                Son 24 saatte hata yok ✓
              </div>
            )}
          </div>

          {/* Trial Warnings */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              Trial Süresi Yaklaşan
            </h2>
            {trialCompanies.length > 0 ? (
              <div className="space-y-2">
                {trialCompanies.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      "p-3 rounded border font-bold text-sm",
                      c.days_remaining <= 1
                        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
                        : c.days_remaining <= 3
                          ? "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300"
                          : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300"
                    )}
                  >
                    <div className="font-bold">{c.name}</div>
                    <div className="text-xs mt-1">
                      {c.days_remaining} gün kaldı
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 dark:text-slate-400 text-center py-8 text-sm">
                Süresi yaklaşan trial yok
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mt-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
            Son Aktif Kullanıcılar
          </h2>
          {recentUsers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700">
                  <tr>
                    <th className="px-4 py-2 text-left">User ID</th>
                    <th className="px-4 py-2 text-left">Aktivite Türü</th>
                    <th className="px-4 py-2 text-left">Zaman</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {recentUsers.map((u) => (
                    <tr key={u.user_id}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {u.user_id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-bold">
                          {u.activity_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {formatDistanceToNow(new Date(u.last_activity_at), {
                          addSuffix: true,
                          locale: tr,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-slate-500 dark:text-slate-400 text-center py-8">
              Henüz aktivite yok
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// KPI Card Component
function KPICard({
  label,
  value,
  icon,
  color,
  badge,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  badge?: string;
}) {
  const colorClasses = {
    blue: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300",
    green:
      "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300",
    red: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
    orange:
      "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300",
    yellow:
      "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300",
    purple:
      "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300",
    indigo:
      "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300",
    slate:
      "bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300",
  };

  return (
    <div
      className={cn(
        "border rounded-lg p-4 font-bold",
        colorClasses[color as keyof typeof colorClasses]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-xs font-semibold opacity-75 mb-2">{label}</div>
          <div className="text-3xl font-black">{value}</div>
          {badge && (
            <div className="text-xs font-bold mt-2 opacity-75">{badge}</div>
          )}
        </div>
        <div className="opacity-50 ml-2">{icon}</div>
      </div>
    </div>
  );
}

// Placeholder icon component (replace with lucide if available)
function Building({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M6 3h12v2H6V3zm0 3h12v14H6V6zm2 2v10h2V8H8zm3 0v10h2V8h-2zm3 0v10h2V8h-2z" />
    </svg>
  );
}
