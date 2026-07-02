import { useEffect, useState } from "react";
import { ChevronRight, ChevronLeft, Check, AlertCircle, Loader2, Package, Target, Zap } from "lucide-react";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type CompanyInfo = {
    id: string;
    name: string;
    is_test_company: boolean;
    subscription_plan: string;
};

type DeploymentStep = "version" | "release_notes" | "test_companies" | "early_adopters" | "error_threshold" | "rollback_settings" | "preview" | "confirm";

type CanaryStages = {
    test: string[];
    early_adopters: string[];
    ten_percent: number;
    twenty_five_percent: number;
    fifty_percent: number;
    full_rollout: number;
};

interface DeploymentWizardProps {
    onClose?: () => void;
}

export default function DeploymentWizard({ onClose }: DeploymentWizardProps) {
    // Step management
    const [currentStep, setCurrentStep] = useState<DeploymentStep>("version");
    const steps: DeploymentStep[] = ["version", "release_notes", "test_companies", "early_adopters", "error_threshold", "rollback_settings", "preview", "confirm"];
    const stepIndex = steps.indexOf(currentStep);

    // Form state
    const [newVersion, setNewVersion] = useState("");
    const [releaseNotes, setReleaseNotes] = useState("");
    const [selectedTestCompanies, setSelectedTestCompanies] = useState<string[]>([]);
    const [selectedEarlyAdopters, setSelectedEarlyAdopters] = useState<string[]>([]);
    const [errorThreshold, setErrorThreshold] = useState(5);
    const [autoRollbackEnabled, setAutoRollbackEnabled] = useState(true);

    // Data loading
    const [testCompanies, setTestCompanies] = useState<CompanyInfo[]>([]);
    const [productionCompanies, setProductionCompanies] = useState<CompanyInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Canary stages preview
    const [canaryStages, setCanaryStages] = useState<CanaryStages>({
        test: [],
        early_adopters: [],
        ten_percent: 0,
        twenty_five_percent: 0,
        fifty_percent: 0,
        full_rollout: 0,
    });

    // Load companies on mount
    useEffect(() => {
        loadCompanies();
    }, []);

    // Update canary stages preview when selections change
    useEffect(() => {
        updateCanaryStagesPreview();
    }, [selectedTestCompanies, selectedEarlyAdopters, productionCompanies]);

    async function loadCompanies() {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .from("companies")
                .select("id, name, is_test_company, subscription_plan")
                .eq("is_active", true)
                .order("name");

            if (fetchError) throw fetchError;

            const allCompanies = data || [];

            // Separate test and production companies
            const test = allCompanies.filter((c) => c.is_test_company);
            const prod = allCompanies.filter((c) => !c.is_test_company);

            setTestCompanies(test);
            setProductionCompanies(prod);

            // Auto-select all test companies
            setSelectedTestCompanies(test.map((c) => c.id));
        } catch (e: any) {
            setError(`Firmalar yüklenirken hata: ${e?.message || "Bilinmeyen hata"}`);
        } finally {
            setLoading(false);
        }
    }

    function updateCanaryStagesPreview() {
        const totalProduction = productionCompanies.length;
        setCanaryStages({
            test: selectedTestCompanies,
            early_adopters: selectedEarlyAdopters,
            ten_percent: Math.ceil((totalProduction * 10) / 100),
            twenty_five_percent: Math.ceil((totalProduction * 25) / 100),
            fifty_percent: Math.ceil((totalProduction * 50) / 100),
            full_rollout: totalProduction,
        });
    }

    function toggleTestCompany(companyId: string) {
        setSelectedTestCompanies((prev) =>
            prev.includes(companyId) ? prev.filter((id) => id !== companyId) : [...prev, companyId]
        );
    }

    function toggleEarlyAdopter(companyId: string) {
        setSelectedEarlyAdopters((prev) => {
            if (prev.includes(companyId)) {
                return prev.filter((id) => id !== companyId);
            } else if (prev.length < 5) {
                return [...prev, companyId];
            }
            return prev;
        });
    }

    function canAdvance(): boolean {
        switch (currentStep) {
            case "version":
                return newVersion.trim().length > 0 && /^\d+\.\d+\.\d+/.test(newVersion);
            case "release_notes":
                return releaseNotes.trim().length > 0;
            case "test_companies":
                return selectedTestCompanies.length > 0;
            case "early_adopters":
                return selectedEarlyAdopters.length > 0 && selectedEarlyAdopters.length <= 5;
            case "error_threshold":
                return errorThreshold > 0 && errorThreshold <= 100;
            case "rollback_settings":
                return true;
            case "preview":
                return true;
            case "confirm":
                return true;
            default:
                return false;
        }
    }

    async function handleDeploy() {
        setDeploying(true);
        setError(null);

        try {
            // 1. Create version release
            const { error: versionError } = await supabase.rpc("create_version_release", {
                p_version: newVersion,
                p_title: `Release ${newVersion}`,
                p_description: releaseNotes,
                p_release_type: "general",
                p_download_urls: {},
            });

            if (versionError) throw versionError;

            // Get the created version ID
            const { data: createdVersion, error: getVersionError } = await supabase
                .from("version_releases")
                .select("id")
                .eq("version", newVersion)
                .single();

            if (getVersionError) throw getVersionError;
            const versionId = createdVersion.id;

            // 2. Start canary release
            const { error: canaryError } = await supabase.rpc("start_canary_release", {
                p_version_release_id: versionId,
                p_error_threshold_percentage: errorThreshold,
                p_auto_rollback_enabled: autoRollbackEnabled,
            });

            if (canaryError) throw canaryError;

            // 3. Deploy to test companies
            const { error: deployTestError } = await supabase.rpc("deploy_version_to_companies", {
                p_version_release_id: versionId,
                p_company_ids: selectedTestCompanies,
                p_stage: "test",
            });

            if (deployTestError) throw deployTestError;

            // 4. Store early adopters for next stage
            const { data: earlyAdopterStage } = await supabase
                .from("deployment_canary_stages")
                .select("id")
                .eq("version_release_id", versionId)
                .eq("stage_name", "early_adopters")
                .single();

            if (earlyAdopterStage) {
                const { error: updateError } = await supabase.rpc("update_canary_stage_companies", {
                    p_stage_id: earlyAdopterStage.id,
                    p_company_ids: selectedEarlyAdopters,
                });

                if (updateError) throw updateError;
            }

            // Success
            if (onClose) onClose();
            alert(`✅ Deployment başlatıldı!\nSürüm: ${newVersion}\nTest firmalarına yayınlandı.`);
        } catch (e: any) {
            setError(`Deployment hatası: ${e?.message || "Bilinmeyen hata"}`);
        } finally {
            setDeploying(false);
        }
    }

    const getStepLabel = (step: DeploymentStep): string => {
        const labels: Record<DeploymentStep, string> = {
            version: "Versiyon",
            release_notes: "Release Notes",
            test_companies: "Test Firmaları",
            early_adopters: "Early Adopters",
            error_threshold: "Hata Limiti",
            rollback_settings: "Rollback Ayarları",
            preview: "Özet",
            confirm: "Onayla",
        };
        return labels[step];
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                <div className="text-center">
                    <Loader2 size={40} className="animate-spin text-blue-600 mx-auto mb-3" />
                    <p className="text-slate-600 dark:text-slate-400">Deployment Wizard yükleniyor...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <Package size={20} className="text-blue-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Deployment Wizard</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">Yeni sürümü adım adım yayınla</p>
                </div>

                {/* Error Alert */}
                {error && (
                    <div className="mb-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 flex gap-3">
                        <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {/* Step Indicator */}
                <div className="mb-8">
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {steps.map((step, idx) => (
                            <div key={step} className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => idx <= stepIndex && setCurrentStep(step)}
                                    className={cn(
                                        "flex items-center justify-center h-10 w-10 rounded-full font-bold text-sm transition-all",
                                        idx === stepIndex
                                            ? "bg-blue-600 text-white scale-110"
                                            : idx < stepIndex
                                            ? "bg-green-600 text-white"
                                            : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                    )}
                                    disabled={idx > stepIndex}
                                >
                                    {idx < stepIndex ? <Check size={16} /> : idx + 1}
                                </button>
                                {idx < steps.length - 1 && (
                                    <div className={cn("w-6 h-0.5", idx < stepIndex ? "bg-green-600" : "bg-slate-200 dark:bg-slate-800")} />
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-3">
                        Adım {stepIndex + 1}/8: <span className="font-semibold">{getStepLabel(currentStep)}</span>
                    </p>
                </div>

                {/* Content Card */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8">
                    {/* STEP 1: Version */}
                    {currentStep === "version" && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    Versiyon Numarası *
                                </label>
                                <input
                                    type="text"
                                    placeholder="örn: 1.2.0"
                                    value={newVersion}
                                    onChange={(e) => setNewVersion(e.target.value)}
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Format: X.Y.Z (örn: 1.2.0)</p>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Release Notes */}
                    {currentStep === "release_notes" && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                    Release Notes *
                                </label>
                                <textarea
                                    placeholder="Bu sürümde neler değişti? Yeni özellikler, bugfix vb."
                                    value={releaseNotes}
                                    onChange={(e) => setReleaseNotes(e.target.value)}
                                    rows={6}
                                    className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                    {releaseNotes.length} karakter
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Test Companies */}
                    {currentStep === "test_companies" && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
                                    Test Firmaları Seç *
                                </label>
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {testCompanies.map((company) => (
                                        <label
                                            key={company.id}
                                            className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedTestCompanies.includes(company.id)}
                                                onChange={() => toggleTestCompany(company.id)}
                                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                                    {company.name}
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">Test • {company.subscription_plan}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                                    {selectedTestCompanies.length} firma seçildi
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP 4: Early Adopters */}
                    {currentStep === "early_adopters" && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
                                    Early Adopters Seç (Max 5) *
                                </label>
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {productionCompanies.map((company) => (
                                        <label
                                            key={company.id}
                                            className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedEarlyAdopters.includes(company.id)}
                                                onChange={() => toggleEarlyAdopter(company.id)}
                                                disabled={
                                                    selectedEarlyAdopters.length >= 5 &&
                                                    !selectedEarlyAdopters.includes(company.id)
                                                }
                                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                                    {company.name}
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    Production • {company.subscription_plan}
                                                </p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                                    {selectedEarlyAdopters.length}/5 firma seçildi
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP 5: Error Threshold */}
                    {currentStep === "error_threshold" && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
                                    Hata Limiti (%) *
                                </label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="1"
                                        max="100"
                                        value={errorThreshold}
                                        onChange={(e) => setErrorThreshold(Number(e.target.value))}
                                        className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex-shrink-0">
                                        <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                                            {errorThreshold}%
                                        </span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                                    Hata oranı bu limitin üzerine çıkarsa deployment otomatik olarak durur.
                                </p>
                            </div>

                            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
                                <p className="text-sm text-blue-700 dark:text-blue-300">
                                    💡 Önerilen değer: <span className="font-semibold">5%</span>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP 6: Rollback Settings */}
                    {currentStep === "rollback_settings" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                        Otomatik Rollback Aktif
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        Hata oranı limitini aşarsa otomatik olarak geri al
                                    </p>
                                </div>
                                <button
                                    onClick={() => setAutoRollbackEnabled(!autoRollbackEnabled)}
                                    className={cn(
                                        "flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                                        autoRollbackEnabled
                                            ? "bg-green-600"
                                            : "bg-slate-300 dark:bg-slate-600"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                            autoRollbackEnabled ? "translate-x-6" : "translate-x-1"
                                        )}
                                    />
                                </button>
                            </div>

                            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
                                <p className="text-sm text-amber-700 dark:text-amber-300">
                                    ⚠️ Otomatik rollback enabled = hata fark edilirse sürüm otomatik geri alınır
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP 7: Preview */}
                    {currentStep === "preview" && (
                        <div className="space-y-6">
                            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4 space-y-4">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Package size={16} />
                                    Versiyon Bilgisi
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">Versiyon</p>
                                        <p className="text-lg font-bold text-slate-900 dark:text-white">{newVersion}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">Hata Limiti</p>
                                        <p className="text-lg font-bold text-slate-900 dark:text-white">{errorThreshold}%</p>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4 space-y-4">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Target size={16} />
                                    Canary Aşamaları
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-900">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">1. Test Firmaları</span>
                                        <span className="font-bold text-blue-600">{canaryStages.test.length}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-900">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">2. Early Adopters</span>
                                        <span className="font-bold text-blue-600">{canaryStages.early_adopters.length}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-900">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">3. 10% Rollout</span>
                                        <span className="font-bold text-blue-600">{canaryStages.ten_percent}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-900">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">4. 25% Rollout</span>
                                        <span className="font-bold text-blue-600">{canaryStages.twenty_five_percent}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-900">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">5. 50% Rollout</span>
                                        <span className="font-bold text-blue-600">{canaryStages.fifty_percent}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-900">
                                        <span className="text-sm text-slate-600 dark:text-slate-400">6. Full Rollout</span>
                                        <span className="font-bold text-blue-600">{canaryStages.full_rollout}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 8: Confirm */}
                    {currentStep === "confirm" && (
                        <div className="space-y-4">
                            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
                                <p className="text-sm text-blue-700 dark:text-blue-300">
                                    ✓ Tüm adımlar tamamlandı. Deployment'ı başlatmak için aşağıdaki butona tıklayın.
                                </p>
                            </div>

                            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4">
                                <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                                    Deployment aşaması:
                                </p>
                                <ol className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                                    <li>✓ Test firmalarına deploy edilecek</li>
                                    <li>✓ 1 saat monitoring</li>
                                    <li>✓ Hata oranı kontrol edilecek</li>
                                    <li>✓ Eğer temiz ise next stage'e geçilecek</li>
                                </ol>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation Buttons */}
                <div className="mt-8 flex gap-3 justify-between">
                    <button
                        onClick={() => {
                            const prevIndex = stepIndex - 1;
                            if (prevIndex >= 0) {
                                setCurrentStep(steps[prevIndex]);
                            } else if (onClose) {
                                onClose();
                            }
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <ChevronLeft size={16} />
                        <span className="hidden sm:inline">{stepIndex === 0 ? "Kapat" : "Geri"}</span>
                    </button>

                    {currentStep === "confirm" ? (
                        <button
                            onClick={handleDeploy}
                            disabled={deploying}
                            className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {deploying ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    <span className="hidden sm:inline">Başlatılıyor...</span>
                                </>
                            ) : (
                                <>
                                    <Zap size={16} />
                                    <span className="hidden sm:inline">Deployment Başlat</span>
                                </>
                            )}
                        </button>
                    ) : (
                        <button
                            onClick={() => {
                                if (stepIndex < steps.length - 1) {
                                    setCurrentStep(steps[stepIndex + 1]);
                                }
                            }}
                            disabled={!canAdvance() || deploying}
                            className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span className="hidden sm:inline">İleri</span>
                            <ChevronRight size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
