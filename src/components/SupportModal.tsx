import { useState } from "react";
import { supabase } from "../supabaseClient";
import { 
    X, 
    Send, 
    MessageSquare, 
    HelpCircle, 
    CheckCircle2
} from "lucide-react";

interface SupportModalProps {
    isOpen: boolean;
    onClose: () => void;
    companyId: string;
    userId: string;
}

export default function SupportModal({ isOpen, onClose, companyId, userId }: SupportModalProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState<any>("other");
    const [priority, setPriority] = useState<any>("medium");
    const [sending, setSending] = useState(false);
    const [success, setSuccess] = useState(false);

    if (!isOpen) return null;

    async function handleSubmit() {
        if (!title || !description) return;
        setSending(true);
        try {
            const { error } = await supabase.from('support_tickets').insert({
                company_id: companyId,
                user_id: userId,
                title,
                description,
                category,
                priority,
                page_url: window.location.href,
                status: 'open'
            });

            if (error) throw error;
            setSuccess(true);
            setTimeout(() => {
                onClose();
                setSuccess(false);
                setTitle("");
                setDescription("");
            }, 2000);
        } catch (e) {
            console.error(e);
            alert("Destek talebi gönderilirken bir hata oluştu.");
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-300">
                {success ? (
                    <div className="p-12 text-center space-y-4">
                        <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto animate-bounce">
                            <CheckCircle2 size={40} />
                        </div>
                        <h2 className="text-2xl font-black text-slate-900 dark:text-white">Talep Gönderildi!</h2>
                        <p className="text-slate-500">Destek ekibimiz en kısa sürede sizinle iletişime geçecektir.</p>
                    </div>
                ) : (
                    <>
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/20">
                                    <MessageSquare size={20} />
                                </div>
                                <h2 className="text-xl font-black text-slate-900 dark:text-white">Sorun Bildir / Destek</h2>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Kategori</label>
                                    <select 
                                        value={category} 
                                        onChange={(e)=>setCategory(e.target.value)}
                                        className="w-full p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold text-sm"
                                    >
                                        <option value="bug">Hata Bildirimi</option>
                                        <option value="question">Soru / Yardım</option>
                                        <option value="request">Özellik İsteği</option>
                                        <option value="payment">Ödeme / Abonelik</option>
                                        <option value="other">Diğer</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Öncelik</label>
                                    <select 
                                        value={priority} 
                                        onChange={(e)=>setPriority(e.target.value)}
                                        className="w-full p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold text-sm"
                                    >
                                        <option value="low">Düşük</option>
                                        <option value="medium">Normal</option>
                                        <option value="high">Yüksek</option>
                                        <option value="urgent">Acil</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Konu</label>
                                <input 
                                    value={title}
                                    onChange={(e)=>setTitle(e.target.value)}
                                    placeholder="Kısaca sorunu özetleyin..."
                                    className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold focus:ring-4 focus:ring-blue-500/10 transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Açıklama</label>
                                <textarea 
                                    value={description}
                                    onChange={(e)=>setDescription(e.target.value)}
                                    placeholder="Neler olduğunu detaylıca anlatın..."
                                    className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm h-32 focus:ring-4 focus:ring-blue-500/10 transition-all"
                                />
                            </div>

                            <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 flex items-start gap-3">
                                <HelpCircle size={18} className="text-blue-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                                    Bulunduğunuz sayfa ({window.location.hash}) ve sistem bilgileriniz otomatik olarak eklenecektir.
                                </p>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={onClose} className="px-6 py-2 text-sm font-bold text-slate-500">İptal</button>
                            <button 
                                onClick={handleSubmit}
                                disabled={sending || !title || !description}
                                className="px-10 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-2xl font-black shadow-xl shadow-blue-600/20 active:scale-95 transition-all flex items-center gap-2"
                            >
                                <Send size={18} /> {sending ? 'Gönderiliyor...' : 'Talebi Gönder'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
