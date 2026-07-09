import { useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useSupportModal } from "../context/SupportModalContext";
import {
    X,
    Send,
    MessageSquare,
    HelpCircle,
    CheckCircle2,
    Paperclip
} from "lucide-react";

const ALLOWED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Otomatik teknik bilgiler — kullanıcıya gösterilmez, support_metadata'ya yazılır
function collectTechnicalInfo() {
    const ua = navigator.userAgent;
    const browser =
        /Edg\//.test(ua) ? "Edge" :
        /Chrome\//.test(ua) ? "Chrome" :
        /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" :
        /Firefox\//.test(ua) ? "Firefox" : "Diğer";
    const os =
        /Windows/.test(ua) ? "Windows" :
        /Android/.test(ua) ? "Android" :
        /iPhone|iPad/.test(ua) ? "iOS" :
        /Mac/.test(ua) ? "macOS" :
        /Linux/.test(ua) ? "Linux" : "Diğer";
    return {
        browser,
        os,
        user_agent: ua.slice(0, 300),
        screen: `${window.screen.width}x${window.screen.height}`,
        app_version: String(import.meta.env.VITE_APP_VERSION || "0.0.0"),
        route: window.location.hash || "/",
        timestamp: new Date().toISOString(),
    };
}

interface SupportModalProps {
    companyId: string;
    userId: string;
}

export default function SupportModal({ companyId, userId }: SupportModalProps) {
    const { isOpen, closeModal, formData, setFormData, resetForm } = useSupportModal();
    const [sending, setSending] = useState(false);
    const [success, setSuccess] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [fileError, setFileError] = useState("");
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    if (!isOpen) return null;

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        setFileError("");
        const file = e.target.files?.[0];
        if (!file) return;
        if (!ALLOWED_FILE_TYPES.includes(file.type)) {
            setFileError("Yalnızca JPG, PNG veya WEBP görseller eklenebilir.");
            e.target.value = "";
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            setFileError("Dosya çok büyük. Maksimum 5 MB olmalı.");
            e.target.value = "";
            return;
        }
        setFormData({
            attachment: file,
            attachmentPreview: URL.createObjectURL(file),
        });
    }

    function clearAttachment() {
        if (formData.attachmentPreview) URL.revokeObjectURL(formData.attachmentPreview);
        setFormData({
            attachment: null,
            attachmentPreview: "",
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
    }

    async function handleSubmit() {
        if (!formData.title || !formData.description) return;
        setSending(true);
        setSubmitError("");
        try {
            if (!companyId || !userId) {
                throw new Error("Oturum bilgisi eksik. Lütfen sayfayı yenileyip tekrar deneyin.");
            }
            const { data: ticketRow, error } = await supabase.from('support_tickets').insert({
                company_id: companyId,
                user_id: userId,
                title: formData.title,
                description: formData.description,
                category: formData.category,
                priority: formData.priority,
                page_url: window.location.hash || window.location.href,
                status: 'open'
            }).select('id').single();

            if (error) throw error;
            const ticketId = ticketRow?.id;

            // Otomatik teknik bilgiler (kolon yoksa sessizce geçer — talep yine de oluşur)
            if (ticketId) {
                await supabase.from('support_tickets')
                    .update({ support_metadata: collectTechnicalInfo() })
                    .eq('id', ticketId)
                    .then(() => {}, () => {});
            }

            // Ekran görüntüsü yükleme (varsa) — başarısızlık talebi iptal etmez
            let uploadWarning = "";
            if (ticketId && formData.attachment) {
                try {
                    const ext = formData.attachment.name.split('.').pop() || 'png';
                    const path = `${companyId}/${ticketId}/screenshot.${ext}`;
                    const { error: upErr } = await supabase.storage
                        .from('support-attachments')
                        .upload(path, formData.attachment, { upsert: true });
                    if (upErr) throw upErr;
                    await supabase.from('support_tickets')
                        .update({ screenshot_url: path })
                        .eq('id', ticketId);
                } catch (upError) {
                    console.error("Ek dosya yüklenemedi:", upError);
                    uploadWarning = "Talebiniz gönderildi ancak ekran görüntüsü yüklenemedi.";
                }
            }

            if (uploadWarning) setFileError(uploadWarning);
            setSuccess(true);
            setTimeout(() => {
                closeModal();
                setSuccess(false);
                resetForm();
                setFileError("");
            }, 2000);
        } catch (e: any) {
            console.error(e);
            const msg = String(e?.message || "");
            setSubmitError(
                /support_tickets|schema cache|does not exist|policy|permission/i.test(msg)
                    ? "Destek sistemi şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin veya WhatsApp ile ulaşın."
                    : msg || "Destek talebi gönderilemedi. Lütfen tekrar deneyin."
            );
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
                            <button onClick={closeModal} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Kategori</label>
                                    <select
                                        value={formData.category}
                                        onChange={(e)=>setFormData({ category: e.target.value })}
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
                                        value={formData.priority}
                                        onChange={(e)=>setFormData({ priority: e.target.value })}
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
                                    value={formData.title}
                                    onChange={(e)=>setFormData({ title: e.target.value })}
                                    placeholder="Kısaca sorunu özetleyin..."
                                    className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none font-bold focus:ring-4 focus:ring-blue-500/10 transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Açıklama</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e)=>setFormData({ description: e.target.value })}
                                    placeholder="Neler olduğunu detaylıca anlatın..."
                                    className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-sm h-32 focus:ring-4 focus:ring-blue-500/10 transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400 tracking-widest">Dosya Ekle <span className="font-normal normal-case">(isteğe bağlı — JPG/PNG/WEBP, max 5MB)</span></label>
                                {formData.attachment ? (
                                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
                                        <img src={formData.attachmentPreview} alt="Önizleme" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-bold text-slate-700 dark:text-slate-300">{formData.attachment.name}</div>
                                            <div className="text-xs text-slate-400">{(formData.attachment.size / 1024).toFixed(0)} KB</div>
                                        </div>
                                        <button type="button" onClick={clearAttachment} className="rounded-full p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                                            <X size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 text-sm font-bold text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-colors">
                                        <Paperclip size={16} /> Ekran görüntüsü seç
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/jpeg,image/jpg,image/png,image/webp"
                                            className="hidden"
                                            onChange={handleFileSelect}
                                        />
                                    </label>
                                )}
                                {fileError && <p className="text-xs font-medium text-red-600">{fileError}</p>}
                            </div>

                            {submitError && (
                                <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 flex items-start gap-3">
                                    <HelpCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{submitError}</p>
                                </div>
                            )}
                        </div>

                        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button onClick={closeModal} className="px-6 py-2 text-sm font-bold text-slate-500">İptal</button>
                            <button
                                onClick={handleSubmit}
                                disabled={sending || !formData.title || !formData.description}
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
