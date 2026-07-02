import { useState } from "react";
import { supabase } from "../supabaseClient";
import { X, LogIn, Loader, AlertCircle, CheckCircle2 } from "lucide-react";

interface ImpersonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  onSuccess?: (sessionId: string) => void;
}

export default function ImpersonationModal({
  isOpen,
  onClose,
  companyId,
  companyName,
  onSuccess,
}: ImpersonationModalProps) {
  const [loading, setLoading] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  async function handleStartImpersonation() {
    setLoading(true);
    setError("");

    try {
      const { data, error: err } = await supabase.rpc(
        "start_impersonation_session",
        {
          p_company_id: companyId,
          p_read_only: readOnly,
        }
      );

      if (err) throw err;

      setSuccess(true);
      setTimeout(() => {
        // Store in localStorage for app-wide state
        localStorage.setItem("impersonation_session_id", data);
        localStorage.setItem("impersonation_company_id", companyId);
        localStorage.setItem("impersonation_company_name", companyName);
        localStorage.setItem("impersonation_read_only", String(readOnly));

        // Dispatch custom event for ImpersonationContext to listen
        window.dispatchEvent(new CustomEvent("impersonation-started", {
          detail: { sessionId: data, companyId, companyName, readOnly }
        }));

        onSuccess?.(data);
        onClose();
      }, 1500);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "İşlem başarısız oldu");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center">
              <LogIn size={20} />
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">
              Firma Olarak Giriş Yap
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400"
          >
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mx-auto animate-bounce">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white">
              Başarılı!
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              {companyName} olarak giriş yapılıyor...
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-800">
              <p className="text-sm font-bold text-blue-900 dark:text-blue-200">
                <span className="block font-black">Firma:</span> {companyName}
              </p>
            </div>

            <div className="space-y-4">
              <label className="space-y-2 cursor-pointer">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="mode"
                    checked={readOnly}
                    onChange={() => setReadOnly(true)}
                    className="w-4 h-4 rounded-full"
                  />
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      Salt Okunur (Önerilen)
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      Sadece görüntüle, değişiklik yapma
                    </div>
                  </div>
                </div>
              </label>

              <label className="space-y-2 cursor-pointer">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="mode"
                    checked={!readOnly}
                    onChange={() => setReadOnly(false)}
                    className="w-4 h-4 rounded-full"
                  />
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      İşlem Modu
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      Test amacıyla değişiklik yapabilir
                    </div>
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex gap-2">
                <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                ⚠️ Tüm işlemler kayıt altında tutulacaktır.
              </p>
            </div>
          </div>
        )}

        {!success && (
          <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-6 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              İptal
            </button>
            <button
              onClick={handleStartImpersonation}
              disabled={loading}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-2xl font-black shadow-lg shadow-blue-600/20 active:scale-95 transition-all flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader size={18} className="animate-spin" />
                  Giriş yapılıyor...
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  Giriş Yap
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
