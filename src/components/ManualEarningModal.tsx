import { X } from "lucide-react";
import { useState } from "react";

interface ManualEarningModalProps {
    employee: { id: string; full_name: string | null };
    onSave: (amount: number, date: string, description: string) => Promise<void>;
    onCancel: () => void;
}

export function ManualEarningModal({ employee, onSave, onCancel }: ManualEarningModalProps) {
    const [amount, setAmount] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
    const [description, setDescription] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    async function handleSave() {
        // Validation
        const numAmount = Number(amount);
        if (!amount || numAmount <= 0) {
            setError("Tutar sıfırdan büyük olmalı");
            return;
        }

        if (!date) {
            setError("Tarih gerekli");
            return;
        }

        // Check date not in future
        if (new Date(date) > new Date()) {
            setError("Tarih bugünden önce olmalı");
            return;
        }

        if (description && description.length > 200) {
            setError("Açıklama 200 karakterden kısa olmalı");
            return;
        }

        setSaving(true);
        setError("");

        try {
            await onSave(numAmount, date, description);
        } catch (e: any) {
            setError(e?.message || "Hakediş kaydedilemedi");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-lg font-bold text-slate-900">Manuel Hakediş Ekle</h2>
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Montajcı
                        </label>
                        <input
                            type="text"
                            value={employee.full_name || "Bilinmiyor"}
                            disabled
                            className="w-full px-3 py-2 border border-slate-300 rounded bg-slate-50 text-slate-600"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Tutar (₺) *
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={amount}
                            onChange={(e) => {
                                setAmount(e.target.value);
                                setError("");
                            }}
                            placeholder="0.00"
                            disabled={saving}
                            className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Tarih *
                        </label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => {
                                setDate(e.target.value);
                                setError("");
                            }}
                            disabled={saving}
                            className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Açıklama (isteğe bağlı)
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => {
                                setDescription(e.target.value);
                                setError("");
                            }}
                            maxLength={200}
                            placeholder="Örn: Ekstra erbium perdesi"
                            disabled={saving}
                            rows={2}
                            className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                        <div className="text-xs text-slate-500 mt-1">{description.length}/200</div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex gap-2 p-6 border-t bg-slate-50">
                    <button
                        onClick={onCancel}
                        disabled={saving}
                        className="flex-1 px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        İptal
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-400 font-medium"
                    >
                        {saving ? "Kaydediliyor..." : "Kaydet"}
                    </button>
                </div>
            </div>
        </div>
    );
}
