/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import { useAuth } from "./AuthContext";

export type StaffMember = {
    user_id: string;
    full_name: string;
    role: string;
};

interface RoleContextType {
    realRole: RoleState;
    viewingRole: RoleState;
    viewingUserId: string | null;
    currentUserId: string | null;
    effectiveRole: RoleState;
    staffList: StaffMember[];
    viewingLabel: string;
    setViewingRoleAndUser: (role: RoleState, userId: string | null) => void;
    clearSimulation: () => void;
    isSimulating: boolean;
}

const RoleContext = createContext<RoleContextType | undefined>(undefined);

function withTimeout<T>(promise: PromiseLike<T>, label: string, ms = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`${label} zaman aşımına uğradı.`)), ms);
        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export function RoleProvider({ children }: { children: ReactNode }) {
    const { user, role: authRole, companyId } = useAuth();
    const [realRole, setRealRole] = useState<RoleState>("unknown");
    const [viewingRole, setViewingRole] = useState<RoleState>("unknown");
    const [viewingUserId, setViewingUserId] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [staffList, setStaffList] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);

        const fallbackTimer = window.setTimeout(() => {
            if (!alive) return;
            const fallbackRole = normalizeRole(authRole);
            setRealRole(fallbackRole);
            setViewingRole(fallbackRole);
            setViewingUserId(null);
            setCurrentUserId(user?.id ?? null);
            setStaffList([]);
            setLoading(false);
        }, 6500);

        const fetchRole = async () => {
            try {
                if (!user) {
                    if (alive) {
                        setRealRole("unknown");
                        setViewingRole("unknown");
                        setViewingUserId(null);
                        setCurrentUserId(null);
                        setStaffList([]);
                    }
                    return;
                }

                setCurrentUserId(user.id);
                const role = normalizeRole(authRole);
                if (!alive) return;

                setRealRole(role);

                if (role !== "super_admin") {
                    setViewingRole(role);
                    setViewingUserId(null);
                } else {
                    localStorage.removeItem("demo_viewing_role");
                    localStorage.removeItem("demo_viewing_user_id");
                    setViewingRole(role);
                    setViewingUserId(null);
                }

                if (role === "super_admin" || role === "admin") {
                    let query = supabase.from("profiles").select("user_id, full_name, role");
                    if (role === "admin" && companyId) {
                        const { data: members } = await withTimeout(
                            supabase
                                .from("company_members")
                                .select("user_id")
                                .eq("company_id", companyId),
                            "Personel üyelik kontrolü",
                        );
                        const ids = (members ?? []).map((member) => member.user_id).filter(Boolean);
                        if (ids.length > 0) query = query.in("user_id", ids);
                    }
                    const { data: staff } = await withTimeout(query, "Personel rol listesi");
                    if (staff && alive) setStaffList(staff as StaffMember[]);
                }
            } catch (error) {
                console.error("Role context error:", error);
                if (alive) setStaffList([]);
            } finally {
                if (alive) {
                    window.clearTimeout(fallbackTimer);
                    setLoading(false);
                }
            }
        };

        void fetchRole();

        return () => {
            alive = false;
            window.clearTimeout(fallbackTimer);
        };
    }, [authRole, companyId, user]);

    useEffect(() => {
        const tables = ["appointments", "orders", "customers", "payments", "income", "expenses"];
        const channel = supabase
            .channel("global-business-realtime")
            .on(
                "postgres_changes",
                { event: "*", schema: "public" },
                (payload) => {
                    if (tables.includes(payload.table)) {
                        window.dispatchEvent(new CustomEvent("perde:data-changed", { detail: payload }));
                    }
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const setViewingRoleAndUser = (role: RoleState, userId: string | null) => {
        if (realRole === "super_admin") {
            setViewingRole(role);
            setViewingUserId(userId);
            localStorage.setItem("demo_viewing_role", role);
            if (userId) localStorage.setItem("demo_viewing_user_id", userId);
            else localStorage.removeItem("demo_viewing_user_id");
        }
    };

    const clearSimulation = () => {
        if (realRole === "super_admin") {
            setViewingRole("super_admin");
            setViewingUserId(null);
            localStorage.removeItem("demo_viewing_role");
            localStorage.removeItem("demo_viewing_user_id");
        }
    };

    const effectiveRole = realRole === "super_admin" ? viewingRole : realRole;
    const isSimulating = realRole === "super_admin" && (viewingRole !== "super_admin" || viewingUserId !== null);
    const viewingStaff = viewingUserId ? staffList.find((item) => item.user_id === viewingUserId) : null;
    const viewingLabel = viewingStaff?.full_name || (
        viewingRole === "admin" ? "Yönetici" :
        viewingRole === "accountant" ? "Muhasebe" :
        viewingRole === "installer" || viewingRole === "measurement" || viewingRole === "personnel" ? "Saha Personeli" :
        viewingRole === "super_admin" ? "Süper Admin" :
        "Bilinmiyor"
    );

    if (loading) {
        return <div style={{ padding: 16 }}>Giriş bilgileri doğrulanıyor...</div>;
    }

    return (
        <RoleContext.Provider value={{
            realRole,
            viewingRole,
            viewingUserId,
            currentUserId,
            effectiveRole,
            staffList,
            viewingLabel,
            setViewingRoleAndUser,
            clearSimulation,
            isSimulating
        }}>
            {children}
        </RoleContext.Provider>
    );
}

export function useRole() {
    const context = useContext(RoleContext);
    if (context === undefined) {
        throw new Error("useRole must be used within a RoleProvider");
    }
    return context;
}
