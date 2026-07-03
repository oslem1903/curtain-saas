import { UserCog, MapIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import InstallerLedger from "./InstallerLedger";
import TodayRoute from "./TodayRoute";
import { useRole } from "../context/RoleContext";

export default function Installations() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { effectiveRole } = useRole();
    const isFieldRole = effectiveRole === "installer" || effectiveRole === "measurement" || effectiveRole === "personnel";
    
    // Field personeli sadece "takip" sekmesini görebilir
    const tab = isFieldRole ? "takip" : (searchParams.get("tab") || "cari");

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900 sticky top-0 z-10">
                <div className="mx-auto flex max-w-5xl items-center gap-6">
                    {!isFieldRole && (
                        <button
                            onClick={() => setSearchParams({ tab: "cari" })}
                            className={`flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-bold transition-colors ${
                                tab === "cari"
                                    ? "border-primary-600 text-primary-600 dark:text-primary-400"
                                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                            }`}
                        >
                            <UserCog className="h-4 w-4" /> Montajcı Cari
                        </button>
                    )}
                    <button
                        onClick={() => setSearchParams({ tab: "takip" })}
                        className={`flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-bold transition-colors ${
                            tab === "takip"
                                ? "border-primary-600 text-primary-600 dark:text-primary-400"
                                : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                    >
                        <MapIcon className="h-4 w-4" /> Bugünün Rotası
                    </button>
                </div>
            </div>
            
            <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-950/50">
                {tab === "cari" && <InstallerLedger hideTitle />}
                {tab === "takip" && <TodayRoute />}
            </div>
        </div>
    );
}
