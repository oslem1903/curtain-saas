import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { 
    Users, UserCog, Loader2, Plus, 
    Wallet, History, Phone, Briefcase,
    Calendar, DollarSign, ShieldCheck, X, Edit2, Trash2, ArrowLeft, RefreshCw, Copy
} from "lucide-react";
import { useNavigate } from "react-router-dom";
type Employee = {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    salary_amount: number;
    hire_date: string;
    is_active: boolean;
    user_id: string | null;
    target_role?: string | null;
    invite_code?: string | null;
};

type Transaction = {
    id: string;
    transaction_date: string;
    type: 'salary' | 'advance' | 'bonus';
    amount: number;
    description: string | null;
};

type StaffInviteResult = {
    email: string;
    role: string;
    code: string;
};

export default function StaffManagement() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const nav = useNavigate();

    
    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showPayModal, setShowPayModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showRoleModal, setShowRoleModal] = useState(false);

    // Form States
    const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
    const [empForm, setEmpForm] = useState({
        full_name: "",
        email: "",
        phone: "",
        salary_amount: 0,
        hire_date: new Date().toISOString().split('T')[0]
    });
    
    const [payForm, setPayForm] = useState({
        type: 'salary',
        amount: 0,
        description: "",
        date: new Date().toISOString().split('T')[0]
    });

    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [allTransactions, setAllTransactions] = useState<(Transaction & { employee_id: string })[]>([]);
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [inviteResult, setInviteResult] = useState<StaffInviteResult | null>(null);
    const [roleSaving, setRoleSaving] = useState(false);

    const roles = [
        { id: "accountant", label: "Muhasebe", color: "text-blue-600 bg-blue-50 border-blue-200" },
        { id: "installer", label: "Montaj Personeli", color: "text-orange-600 bg-orange-50 border-orange-200" },
    ];

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const { data: authUser } = await supabase.auth.getUser();
            if (!authUser?.user) return;

            const { data: cm } = await supabase
                .from("company_members")
                .select("company_id")
                .eq("user_id", authUser.user.id)
                .maybeSingle();

            if (!cm?.company_id) return;
            setCompanyId(cm.company_id);

            const { data: emps, error } = await supabase
                .from("employees")
                .select("*")
                .eq("company_id", cm.company_id)
                .order("full_name");

            if (error) throw error;
            setEmployees(emps || []);

            const { data: txs } = await supabase
                .from("employee_transactions")
                .select("id, employee_id, transaction_date, type, amount, description")
                .eq("company_id", cm.company_id);
            setAllTransactions((txs ?? []) as (Transaction & { employee_id: string })[]);

        } catch (e: any) {
            console.error(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function generateInviteCode() {
        if (!selectedEmp) return;
        setInviteResult(null);
        setShowRoleModal(true);
    }

    async function handleAddEmployee() {
        if (!empForm.full_name || !companyId) return;
        try {
            if (editingId) {
                const { error } = await supabase
                    .from("employees")
                    .update(empForm)
                    .eq("id", editingId);
                if (error) throw error;
                setEmployees(prev => prev.map(e => e.id === editingId ? { ...e, ...empForm } : e));
            } else {
                const { data, error } = await supabase
                    .from("employees")
                    .insert([{
                        ...empForm,
                        company_id: companyId
                    }])
                    .select()
                    .single();

                if (error) throw error;
                setEmployees([...employees, data]);
            }
            setShowAddModal(false);
            setEditingId(null);
            setEmpForm({ full_name: "", email: "", phone: "", salary_amount: 0, hire_date: new Date().toISOString().split('T')[0] });
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function handleDeleteEmployee(id: string) {
        if (!window.confirm("Bu personeli silmek istediğinize emin misiniz?")) return;
        try {
            const { error } = await supabase
                .from("employees")
                .delete()
                .eq("id", id);
            if (error) throw error;
            setEmployees(prev => prev.filter(e => e.id !== id));
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function handlePayment() {
        if (!selectedEmp || payForm.amount <= 0 || !companyId) return;
        try {
            const { error } = await supabase
                .from("employee_transactions")
                .insert([{
                    company_id: companyId,
                    employee_id: selectedEmp.id,
                    type: payForm.type,
                    amount: payForm.amount,
                    description: payForm.description,
                    transaction_date: payForm.date
                }]);

            if (error) throw error;
            
            // Muhasebe kaydı olarak da ekleyelim (Opsiyonel: Gider olarak yansısın)
            await supabase.from("transactions").insert([{
                company_id: companyId,
                type: 'expense',
                amount: payForm.amount,
                description: `${selectedEmp.full_name} - ${payForm.type === 'salary' ? 'Maaş' : payForm.type === 'advance' ? 'Avans' : 'Prim'} Ödemesi`,
                category: 'personnel',
                transaction_date: payForm.date
            }]);

            alert("Ödeme başarıyla kaydedildi ✓");
            setShowPayModal(false);
            setPayForm({ type: 'salary', amount: 0, description: "", date: new Date().toISOString().split('T')[0] });
            await loadData();
        } catch (e: any) {
            alert(e.message);
        }
    }

    function getEmployeeLedger(emp: Employee) {
        const rows = allTransactions.filter((tx) => tx.employee_id === emp.id);
        const salaryPaid = rows.filter((tx) => tx.type === "salary").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const advance = rows.filter((tx) => tx.type === "advance").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const bonus = rows.filter((tx) => tx.type === "bonus").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const net = Number(emp.salary_amount || 0) + bonus - salaryPaid - advance;
        return { salaryPaid, advance, bonus, net };
    }

    async function loadHistory(empId: string) {
        try {
            const { data, error } = await supabase
                .from("employee_transactions")
                .select("*")
                .eq("employee_id", empId)
                .order("transaction_date", { ascending: false });

            if (error) throw error;
            setTransactions(data || []);
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function handleAssignRole(newRole: string) {
        if (!selectedEmp) {
            return;
        }

        if (!companyId) {
            alert("Firma bilgisi bulunamadi. Oturumu yenileyip tekrar deneyin.");
            return;
        }

        if (newRole === "admin") {
            alert("Yeni yonetici daveti sadece Super Admin tarafindan olusturulabilir.");
            return;
        }

        try {
            setRoleSaving(true);
            setInviteResult(null);

            const normalizedEmail = selectedEmp.email?.trim().toLowerCase() || "";
            const prefix = newRole === "accountant" ? "MUH" : "MON";
            const code = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

            const { error: empErr } = await supabase
                .from("employees")
                .update({ target_role: newRole, invite_code: code })
                .eq("id", selectedEmp.id);

            if (empErr) throw empErr;

            if (selectedEmp.user_id) {
                const { error: memberErr } = await supabase
                    .from("company_members")
                    .update({ role: newRole })
                    .eq("company_id", companyId)
                    .eq("user_id", selectedEmp.user_id);
                if (memberErr) throw memberErr;

                const { error: profileErr } = await supabase
                    .from("profiles")
                    .update({ role: newRole })
                    .eq("user_id", selectedEmp.user_id);
                if (profileErr) throw profileErr;
            }

            const updatedEmp = { ...selectedEmp, target_role: newRole, invite_code: code };
            setSelectedEmp(updatedEmp);
            setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? updatedEmp : e));
            setInviteResult({ email: normalizedEmail, role: newRole, code });
        } catch (e: any) {
            const message = String(e?.message ?? "");
            alert(message || "Yetki kodu olusturulamadi.");
        } finally {
            setRoleSaving(false);
        }
    }

    async function copyStaffInviteCode() {
        if (!inviteResult?.code) return;
        try {
            await navigator.clipboard.writeText(inviteResult.code);
        } catch {
            alert("Davet kodu kopyalanamadi. Kodu elle secip kopyalayabilirsiniz.");
        }
    }
    const formatTL = (val: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);

    const displayEmail = (email?: string | null) => {
        if (!email) return "-";
        return /test|demo|abc/i.test(email) ? "personel@firma.com" : email;
    };

    const displayPhone = (phone?: string | null) => {
        if (!phone) return "-";
        return phone.replace(/\d(?=\d{2})/g, "•");
    };

    return (
        <div className="p-4 sm:p-6 max-w-7xl animate-in fade-in duration-500 overflow-x-hidden">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-200">
                        <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Personel & Maaş Yönetimi</h1>
                        <p className="text-slate-500 text-sm">Çalışan kartlarını, maaş ödemelerini ve yetkileri buradan yönetin.</p>
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                    <button
                        onClick={() => nav(-1)}
                        className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm hover:bg-slate-50 transition"
                        title="Geri"
                    >
                        <ArrowLeft className="w-6 h-6 text-slate-600 dark:text-slate-400" />
                    </button>
                    <button
                        onClick={loadData}
                        className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm hover:bg-slate-50 transition"
                        title="Yenile"
                    >
                        <RefreshCw className={`w-6 h-6 text-slate-600 dark:text-slate-400 ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <button
                        onClick={() => { setEditingId(null); setEmpForm({ full_name: "", email: "", phone: "", salary_amount: 0, hire_date: new Date().toISOString().split('T')[0] }); setShowAddModal(true); }}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all transform active:scale-95 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Yeni Personel Kartı
                    </button>
                </div>
            </div>

            {/* Stats Summary (Opsiyonel) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
                <div className="p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3 text-slate-500 text-sm mb-2">
                        <Briefcase className="w-4 h-4" /> Toplam Personel
                    </div>
                    <div className="text-3xl font-bold">{employees.length}</div>
                </div>
                <div className="p-6 bg-emerald-50 dark:bg-emerald-900/10 rounded-3xl border border-emerald-100 dark:border-emerald-800 shadow-sm">
                    <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 text-sm mb-2">
                        <Wallet className="w-4 h-4" /> Aylık Toplam Maaş Yükü
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold text-emerald-700 dark:text-emerald-400 break-words">
                        {formatTL(employees.reduce((acc, curr) => acc + (curr.salary_amount || 0), 0))}
                    </div>
                </div>
                <div className="p-6 bg-orange-50 dark:bg-orange-900/10 rounded-3xl border border-orange-100 dark:border-orange-800 shadow-sm">
                    <div className="flex items-center gap-3 text-orange-600 dark:text-orange-400 text-sm mb-2">
                        <DollarSign className="w-4 h-4" /> Toplam Avans
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold text-orange-700 dark:text-orange-400 break-words">
                        {formatTL(allTransactions.filter((tx) => tx.type === "advance").reduce((sum, tx) => sum + Number(tx.amount || 0), 0))}
                    </div>
                </div>
                <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-800 shadow-sm">
                    <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 text-sm mb-2">
                        <Calendar className="w-4 h-4" /> Toplam Prim
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold text-blue-700 dark:text-blue-400 break-words">
                        {formatTL(allTransactions.filter((tx) => tx.type === "bonus").reduce((sum, tx) => sum + Number(tx.amount || 0), 0))}
                    </div>
                </div>
            </div>

            {/* Bilgilendirme Kartı */}
            <div className="mb-8 p-5 sm:p-6 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                    <ShieldCheck className="w-6 h-6 text-indigo-600 mt-1" />
                    <div>
                        <h4 className="font-bold text-indigo-900 dark:text-white text-lg">Personel Girişi Yönetimi</h4>
                        <p className="text-sm text-indigo-800 dark:text-indigo-300 mt-1">
                            Personel karti olusturduktan sonra rol secerek yetki kodu uretin. Kod personel kartinda saklanir ve rol atamasini belirler.
                        </p>
                    </div>
                </div>
            </div>

            {/* Employee List */}

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden">
                {loading ? (
                    <div className="p-20 text-center"><Loader2 className="w-10 h-10 animate-spin mx-auto text-indigo-600 mb-4" /> Veriler Yükleniyor...</div>
                ) : (
                    <>
                    <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {employees.map((emp) => (
                            <div key={emp.id} className="p-4 space-y-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded-full flex items-center justify-center font-bold text-lg shrink-0">
                                        {emp.full_name[0]?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-slate-900 dark:text-white uppercase break-words">{emp.full_name}</div>
                                        <div className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">{formatTL(emp.salary_amount)}</div>
                                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
                                            <span className="rounded-full bg-orange-50 px-2 py-1 text-orange-700">Avans {formatTL(getEmployeeLedger(emp).advance)}</span>
                                            <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Prim {formatTL(getEmployeeLedger(emp).bonus)}</span>
                                        </div>
                                        <div className="text-xs text-slate-500">{new Date(emp.hire_date).toLocaleDateString('tr-TR')}</div>
                                    </div>
                                </div>

                                <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                                    <div className="flex items-center gap-2"><Phone className="w-4 h-4" /> {displayPhone(emp.phone)}</div>
                                    <div className="break-words">{displayEmail(emp.email)}</div>
                                    <div className="text-xs text-slate-400 italic">{emp.user_id ? 'Kullanıcı bağlı' : 'Sadece bordrolu'}</div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {emp.invite_code ? (
                                        <div className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-xs font-mono font-bold shadow-sm">
                                            KOD: {emp.invite_code}
                                        </div>
                                    ) : (
                                        <button onClick={() => { setSelectedEmp(emp); generateInviteCode(); }} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold">
                                            Kod Üret
                                        </button>
                                    )}
                                    <button onClick={() => { setSelectedEmp(emp); setShowPayModal(true); }} className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">Ödeme</button>
                                    <button onClick={() => { setSelectedEmp(emp); loadHistory(emp.id); setShowHistoryModal(true); }} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold">Geçmiş</button>
                                    <button onClick={() => { setSelectedEmp(emp); setShowRoleModal(true); }} className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold">Yetki</button>
                                    <button onClick={() => { 
                                        setEditingId(emp.id); 
                                        setEmpForm({
                                            full_name: emp.full_name,
                                            email: emp.email || "",
                                            phone: emp.phone || "",
                                            salary_amount: emp.salary_amount,
                                            hire_date: emp.hire_date
                                        });
                                        setShowAddModal(true);
                                    }} className="px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold">Düzenle</button>
                                    <button onClick={() => handleDeleteEmployee(emp.id)} className="px-3 py-2 bg-rose-50 text-rose-700 rounded-xl text-xs font-bold">Sil</button>
                                </div>
                            </div>
                        ))}
                        {employees.length === 0 && (
                            <div className="py-20 text-center text-slate-400 italic">Henüz personel kartı oluşturulmamış.</div>
                        )}
                    </div>

                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Çalışan Bilgileri</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Maaş / Başlangıç</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">İletişim</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Durum / Yetki</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">İşlemler</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {employees.map((emp) => (
                                    <tr key={emp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded-full flex items-center justify-center font-bold text-lg">
                                                    {emp.full_name[0].toUpperCase()}
                                                </div>
                                                <div className="font-bold text-slate-900 dark:text-white uppercase">{emp.full_name}</div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-emerald-600 dark:text-emerald-400">{formatTL(emp.salary_amount)}</div>
                                            <div className="mt-1 text-xs text-slate-500">
                                                Avans: {formatTL(getEmployeeLedger(emp).advance)} / Prim: {formatTL(getEmployeeLedger(emp).bonus)}
                                            </div>
                                            <div className="text-xs text-slate-500">{new Date(emp.hire_date).toLocaleDateString('tr-TR')}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 text-sm">
                                                <Phone className="w-3.5 h-3.5" /> {displayPhone(emp.phone)}
                                            </div>
                                            <div className="text-xs text-slate-500">{displayEmail(emp.email)}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {emp.user_id ? (
                                                <div className="flex flex-col gap-1.5 items-start">
                                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-xs font-bold border border-indigo-100 dark:border-indigo-800">
                                                        <ShieldCheck className="w-3 h-3" /> Kullanıcı Bağlı
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-xs text-slate-400 italic">Sadece Bordrolu</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2 text-sm">
                                                {emp.invite_code ? (
                                                    <div className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-xs font-mono font-bold shadow-sm">
                                                        KOD: {emp.invite_code}
                                                    </div>
                                                ) : (
                                                    <button 
                                                        onClick={() => { setSelectedEmp(emp); generateInviteCode(); }}
                                                        className="p-2.5 bg-blue-100 text-blue-700 hover:bg-blue-600 hover:text-white rounded-xl transition-all shadow-sm flex items-center gap-1 group" title="Davet Kodu Oluştur">
                                                        <ShieldCheck className="w-5 h-5" />
                                                        <span className="text-[10px] font-bold hidden group-hover:inline">KOD ÜRET</span>
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => { setSelectedEmp(emp); setShowPayModal(true); }}
                                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white transition hover:bg-emerald-700" title="Ödeme Yap">
                                                    <DollarSign className="w-5 h-5" />
                                                    Ödeme
                                                </button>
                                                <button 
                                                    onClick={() => { setSelectedEmp(emp); loadHistory(emp.id); setShowHistoryModal(true); }}
                                                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors" title="Geçmiş">
                                                    <History className="w-5 h-5" />
                                                </button>
                                                <button 
                                                    onClick={() => { setSelectedEmp(emp); setShowRoleModal(true); }}
                                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors" title="Yetki Tanımla">
                                                    <UserCog className="w-5 h-5" />
                                                </button>
                                                <button 
                                                    onClick={() => { 
                                                        setEditingId(emp.id); 
                                                        setEmpForm({
                                                            full_name: emp.full_name,
                                                            email: emp.email || "",
                                                            phone: emp.phone || "",
                                                            salary_amount: emp.salary_amount,
                                                            hire_date: emp.hire_date
                                                        });
                                                        setShowAddModal(true);
                                                    }}
                                                    className="p-2 text-amber-600 hover:bg-amber-50 rounded-xl transition-colors" title="Düzenle">
                                                    <Edit2 className="w-5 h-5" />
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteEmployee(emp.id)}
                                                    className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors" title="Sil">
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {employees.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="py-20 text-center text-slate-400 italic">Henüz personel kartı oluşturulmamış.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    </>
                )}
            </div>

            {/* Modal: Yeni Personel */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in duration-300">
                        <div className="p-8">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-2xl font-bold">{editingId ? "Personel Kartını Düzenle" : "Yeni Personel Kartı"}</h3>
                                <button onClick={() => { setShowAddModal(false); setEditingId(null); }} className="p-2 hover:bg-slate-100 rounded-full"><X /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-1 block">Ad Soyad</label>
                                    <input 
                                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 transition-all" 
                                        placeholder="Örn: Mehmet Perdeci"
                                        value={empForm.full_name}
                                        onChange={e => setEmpForm({...empForm, full_name: e.target.value})}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-1 block">Maaş (TL)</label>
                                        <input 
                                            type="number"
                                            className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 transition-all font-bold text-emerald-600" 
                                            value={empForm.salary_amount}
                                            onChange={e => setEmpForm({...empForm, salary_amount: Number(e.target.value)})}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-1 block">İşe Giriş</label>
                                        <input 
                                            type="date"
                                            className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 transition-all" 
                                            value={empForm.hire_date}
                                            onChange={e => setEmpForm({...empForm, hire_date: e.target.value})}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-1 block">Telefon</label>
                                        <input 
                                            className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono" 
                                            placeholder="05xx..."
                                            value={empForm.phone}
                                            onChange={e => setEmpForm({...empForm, phone: e.target.value})}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-1 block">E-posta (Opsiyonel)</label>
                                        <input 
                                            className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 transition-all" 
                                            placeholder="iletisim@mail.com"
                                            value={empForm.email}
                                            onChange={e => setEmpForm({...empForm, email: e.target.value})}
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={handleAddEmployee}
                                    className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all"
                                >
                                    {editingId ? "Değişiklikleri Kaydet" : "Personeli Kaydet"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Maaş/Avans Ödemesi */}
            {showPayModal && selectedEmp && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in duration-300">
                        <div className="p-8">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="text-2xl font-bold">Ödeme Yap</h3>
                                    <p className="text-slate-500 text-sm font-semibold uppercase">{selectedEmp.full_name}</p>
                                </div>
                                <button onClick={() => setShowPayModal(false)} className="p-2 hover:bg-slate-100 rounded-full"><X /></button>
                            </div>
                            <div className="space-y-4">
                                <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                                    <button 
                                        onClick={() => setPayForm({...payForm, type: 'salary'})}
                                        className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all ${payForm.type === 'salary' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-500'}`}>Maaş</button>
                                    <button 
                                        onClick={() => setPayForm({...payForm, type: 'advance'})}
                                        className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all ${payForm.type === 'advance' ? 'bg-white dark:bg-slate-700 shadow-sm text-amber-600' : 'text-slate-500'}`}>Avans</button>
                                    <button 
                                        onClick={() => setPayForm({...payForm, type: 'bonus'})}
                                        className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all ${payForm.type === 'bonus' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600' : 'text-slate-500'}`}>Prim</button>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Ödeme Tutarı</label>
                                    <input 
                                        type="number"
                                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 text-2xl font-bold text-center" 
                                        value={payForm.amount}
                                        onChange={e => setPayForm({...payForm, amount: Number(e.target.value)})}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Tarih</label>
                                    <input 
                                        type="date"
                                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2" 
                                        value={payForm.date}
                                        onChange={e => setPayForm({...payForm, date: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Açıklama (İsteğe Bağlı)</label>
                                    <textarea 
                                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2" 
                                        rows={2}
                                        value={payForm.description}
                                        onChange={e => setPayForm({...payForm, description: e.target.value})}
                                    />
                                </div>
                                <button
                                    onClick={handlePayment}
                                    className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all mt-2"
                                >
                                    Ödemeyi Onayla
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Ödeme Geçmişi */}
            {showHistoryModal && selectedEmp && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300">
                        <div className="p-8">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="text-2xl font-bold">Ödeme Geçmişi</h3>
                                    <p className="text-slate-500 text-sm font-semibold uppercase">{selectedEmp.full_name}</p>
                                </div>
                                <button onClick={() => setShowHistoryModal(false)} className="p-2 hover:bg-slate-100 rounded-full"><X /></button>
                            </div>
                            <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                                {transactions.map((tr) => (
                                    <div key={tr.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-slate-200 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-xl ${tr.type === 'salary' ? 'bg-indigo-50 text-indigo-600' : tr.type === 'advance' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                                {tr.type === 'salary' ? <Wallet className="w-5 h-5" /> : tr.type === 'advance' ? <DollarSign className="w-5 h-5" /> : <Calendar className="w-5 h-5" />}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-900 dark:text-white capitalize">{tr.type === 'salary' ? 'Maaş' : tr.type === 'advance' ? 'Avans' : 'Prim'}</div>
                                                <div className="text-xs text-slate-500">{new Date(tr.transaction_date).toLocaleDateString('tr-TR')} - {tr.description || 'Açıklama yok'}</div>
                                            </div>
                                        </div>
                                        <div className="text-lg font-bold">{formatTL(tr.amount)}</div>
                                    </div>
                                ))}
                                {transactions.length === 0 && (
                                    <div className="text-center py-10 text-slate-400 italic">Henüz işlem bulunamadı.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Yetki Atama (Role) */}
            {showRoleModal && selectedEmp && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in duration-300 border border-slate-200 dark:border-slate-800">
                        <div className="p-8">
                            <div className="w-14 h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-slate-900/10">
                                <UserCog className="w-8 h-8" />
                            </div>
                            <h3 className="text-2xl font-black text-center text-slate-900 dark:text-white mb-2">Rol ve Yetki</h3>
                            <p className="text-slate-500 text-sm text-center leading-6 mb-6">
                                <b className="text-slate-800 dark:text-slate-100">{selectedEmp.full_name}</b> için uygun kullanım rolünü seçin.
                            </p>
                            
                            {!selectedEmp.email ? (
                                <div className="p-4 bg-amber-50 text-amber-700 rounded-2xl text-sm border border-amber-100 leading-relaxed mb-6">
                                    Yetki verebilmek için önce personelin e-posta adresini personel kartından güncellemelisiniz.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-3">
                                    {roles.map((r) => (
                                        <button
                                            key={r.id}
                                            onClick={() => handleAssignRole(r.id)}
                                            disabled={roleSaving}
                                            className={`p-4 rounded-2xl border transition-all flex items-center justify-between group ${r.color} hover:shadow-lg hover:-translate-y-0.5`}
                                        >
                                            <span className="font-black">{r.label}</span>
                                            {roleSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5 opacity-60 group-hover:opacity-100 transition-opacity" />}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {inviteResult ? (
                                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                                    <div className="font-black">Davet kodu hazir</div>
                                    {inviteResult.email ? <div className="mt-1">E-posta: {inviteResult.email}</div> : null}
                                    <div className="mt-3 rounded-xl bg-white p-4 text-center font-mono text-2xl font-black tracking-widest text-slate-900">{inviteResult.code}</div>
                                    <button
                                        type="button"
                                        onClick={copyStaffInviteCode}
                                        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"
                                    >
                                        <Copy className="h-4 w-4" />
                                        Kodu Kopyala
                                    </button>
                                </div>
                            ) : null}

                            <button
                                onClick={() => { setShowRoleModal(false); setInviteResult(null); }}
                                className="w-full mt-6 py-4 rounded-2xl font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 transition-all"
                            >
                                Vazgeç
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}


