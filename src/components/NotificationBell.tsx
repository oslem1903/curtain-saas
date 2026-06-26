import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { 
    Bell, 
    X, 
    CheckCircle2, 
    Info, 
    AlertTriangle,
    RefreshCw,
    Circle
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "../utils/cn";

type Notification = {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'success' | 'error' | 'update';
    is_read: boolean;
    created_at: string;
    related_ticket_id: string | null;
    related_update_id: string | null;
};

export default function NotificationBell({ userId }: { userId: string }) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const unreadCount = notifications.filter(n => !n.is_read).length;

    const loadNotifications = useCallback(async () => {
        const { data } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);
        
        if (data) setNotifications(data as Notification[]);
    }, [userId]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadNotifications();
        }, 0);

        // Subscribe to new notifications
        const channel = supabase
            .channel(`user-notifications-${userId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`
            }, () => {
                loadNotifications();
            })
            .subscribe();

        return () => {
            window.clearTimeout(timer);
            supabase.removeChannel(channel);
        };
    }, [loadNotifications, userId]);

    async function markAsRead(id: string) {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id);
        
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    }

    async function markAllAsRead() {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);
        
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    }

    const typeIcons = {
        info: <Info size={16} className="text-blue-500" />,
        success: <CheckCircle2 size={16} className="text-emerald-500" />,
        warning: <AlertTriangle size={16} className="text-amber-500" />,
        error: <X size={16} className="text-red-500" />,
        update: <RefreshCw size={16} className="text-purple-500" />
    };

    return (
        <div className="relative">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:bg-slate-100 transition-colors"
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white dark:border-slate-900 animate-in zoom-in duration-300">
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                Bildirimler
                                {unreadCount > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-black">{unreadCount} Yeni</span>}
                            </h3>
                            {unreadCount > 0 && (
                                <button 
                                    onClick={markAllAsRead}
                                    className="text-xs font-bold text-blue-600 hover:underline"
                                >
                                    Tümünü Oku
                                </button>
                            )}
                        </div>

                        <div className="max-h-[400px] overflow-y-auto">
                            {notifications.length > 0 ? (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {notifications.map((n) => (
                                        <div 
                                            key={n.id}
                                            onClick={() => markAsRead(n.id)}
                                            className={cn(
                                                "p-4 flex gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer relative",
                                                !n.is_read && "bg-blue-50/30 dark:bg-blue-900/10"
                                            )}
                                        >
                                            <div className="shrink-0 mt-1">
                                                {typeIcons[n.type]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                    <h4 className={cn("text-sm truncate", n.is_read ? "font-medium text-slate-700 dark:text-slate-300" : "font-black text-slate-900 dark:text-white")}>
                                                        {n.title}
                                                    </h4>
                                                    {!n.is_read && <Circle size={8} className="fill-blue-600 text-blue-600 shrink-0" />}
                                                </div>
                                                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                                                    {n.message}
                                                </p>
                                                <span className="text-[10px] text-slate-400 mt-2 block">
                                                    {format(new Date(n.created_at), 'dd MMM HH:mm', { locale: tr })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-300 mx-auto mb-4">
                                        <Bell size={32} />
                                    </div>
                                    <h4 className="font-bold text-slate-900 dark:text-white">Bildirim Yok</h4>
                                    <p className="text-xs text-slate-500 mt-1">Şu an için yeni bir bildiriminiz bulunmuyor.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 text-center">
                            <button className="text-xs font-black text-slate-500 uppercase tracking-widest hover:text-slate-900">
                                Tüm Geçmişi Gör
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
