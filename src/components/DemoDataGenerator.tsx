import { useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Message = { type: "success" | "error"; text: string } | null;

interface DemoDataGeneratorProps {
  onSuccess?: () => void;
}

export function DemoDataGenerator({ onSuccess }: DemoDataGeneratorProps) {
  const { company, refreshAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function generateDemoData() {
    if (!company?.id) return;

    setLoading(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.rpc("generate_demo_data", {
        p_company_id: company.id,
      });

      if (error) throw error;

      if (data?.success) {
        setMessage({ type: "success", text: data.message });

        // Refresh auth context to update dashboard
        setTimeout(async () => {
          await refreshAuth();
          onSuccess?.();
          window.location.reload();
        }, 1500);
      } else {
        setMessage({
          type: "error",
          text: data?.message || "Demo verisi oluşturulamadı.",
        });
      }
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Demo verisi oluşturulurken hata oluştu.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 rounded-2xl border border-blue-200 dark:border-slate-700 shadow-sm p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-blue-100 dark:bg-blue-950/30 rounded-full">
              <Sparkles className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Sistem Boş Görünüyor
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
            PerdePRO deneyimini anlamak için gerçekçi demo verisi oluşturun. 20 müşteri, 25 ürün, 12 sipariş ve daha fazlası eklenecek.
          </p>

          {message && (
            <div
              className={`p-4 rounded-xl flex items-center gap-3 mb-6 justify-center ${
                message.type === "success"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200"
                  : "bg-red-50 text-red-700 border border-red-100 dark:bg-red-950/30 dark:text-red-200"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{message.text}</span>
            </div>
          )}

          <button
            onClick={generateDemoData}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white px-8 py-3 rounded-lg font-medium transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Oluşturuluyor...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Demo Verilerini Oluştur
              </>
            )}
          </button>

      <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
        Gerçek müşteri verileri varsa bu düğme gösterilmez.
      </p>
    </div>
  );
}
