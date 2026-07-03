import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ImpersonationContextType {
  isImpersonating: boolean;
  sessionId: string | null;
  companyId: string | null;
  companyName: string | null;
  readOnly: boolean;
  endSession: () => Promise<void>;
}

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    const sessionIdStored = localStorage.getItem("impersonation_session_id");
    if (sessionIdStored) {
      setSessionId(sessionIdStored);
      setCompanyId(localStorage.getItem("impersonation_company_id"));
      setCompanyName(localStorage.getItem("impersonation_company_name"));
      setReadOnly(localStorage.getItem("impersonation_read_only") === "true");
      setIsImpersonating(true);
    }

    // Listen for impersonation started event
    const handleImpersonationStarted = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { sessionId, companyId, companyName, readOnly } = customEvent.detail;
      setSessionId(sessionId);
      setCompanyId(companyId);
      setCompanyName(companyName);
      setReadOnly(readOnly);
      setIsImpersonating(true);
    };

    window.addEventListener("impersonation-started", handleImpersonationStarted);
    return () => {
      window.removeEventListener("impersonation-started", handleImpersonationStarted);
    };
  }, []);

  const endSession = async () => {
    if (!sessionId) return;

    try {
      // Call RPC to end session (if you want to log it)
      // await supabase.rpc("end_impersonation_session", { p_session_id: sessionId });
    } catch (error) {
      console.error("Error ending impersonation session:", error);
    } finally {
      // Clear localStorage
      localStorage.removeItem("impersonation_session_id");
      localStorage.removeItem("impersonation_company_id");
      localStorage.removeItem("impersonation_company_name");
      localStorage.removeItem("impersonation_read_only");

      // Reset state
      setIsImpersonating(false);
      setSessionId(null);
      setCompanyId(null);
      setCompanyName(null);

      // Navigate to super admin panel with graceful reload
      setTimeout(() => {
        window.location.href = "/#/super-admin/companies";
      }, 300);
    }
  };

  const contextValue = useMemo(() => ({
    isImpersonating,
    sessionId,
    companyId,
    companyName,
    readOnly,
    endSession,
  }), [isImpersonating, sessionId, companyId, companyName, readOnly]);

  return (
    <ImpersonationContext.Provider value={contextValue}>
      {children}
    </ImpersonationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook'u Provider ile aynı dosyada; yalnız Fast Refresh (HMR) sıcak-yenilemeyi etkiler, çalışma zamanı davranışı değişmez. Dosya bölmek context/hook yapısını değiştirir.
export function useImpersonation() {
  const context = useContext(ImpersonationContext);
  if (context === undefined) {
    throw new Error("useImpersonation must be used within ImpersonationProvider");
  }
  return context;
}
