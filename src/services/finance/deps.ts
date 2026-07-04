// ============================================================================
// Finans servisleri için bağımlılık (dependency) yapısı (FAZ 1: yalnızca altyapı).
//
// Servisler global `supabase` client'ını doğrudan import ETMEZ; bunun yerine
// bu yapı üzerinden alır. Böylece ileride (test, farklı tenant/bağlam vb.)
// bağımlılık değiştirilebilir. Varsayılan davranış mevcut uygulamayla birebir
// aynıdır: paylaşılan supabaseClient singleton'ı kullanılır.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";

export type FinanceServiceDeps = {
  supabase: SupabaseClient;
};

/** Mevcut uygulamanın paylaşılan supabase client'ını kullanan varsayılan bağımlılık seti. */
export function createDefaultFinanceServiceDeps(): FinanceServiceDeps {
  return { supabase };
}
