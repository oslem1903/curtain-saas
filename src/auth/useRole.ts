import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { normalizeRole, type AppRole } from "./roles";

export type Role = AppRole | null;

export function useRole() {
    const [role, setRole] = useState<Role>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        async function loadRole() {
            const { data: sessionData } = await supabase.auth.getSession();
            const user = sessionData.session?.user;

            if (!user) {
                if (active) {
                    setRole(null);
                    setLoading(false);
                }
                return;
            }

            const { data, error } = await supabase
                .from("profiles")
                .select("role")
                .eq("user_id", user.id)
                .single();

            if (active) {
                if (error) {
                    setRole(null);
                } else {
                    const normalized = normalizeRole(data.role);
                    setRole(normalized === "unknown" ? null : normalized);
                }
                setLoading(false);
            }
        }

        loadRole();

        const { data: sub } = supabase.auth.onAuthStateChange(() => {
            loadRole();
        });

        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, []);

    return { role, loading };
}
