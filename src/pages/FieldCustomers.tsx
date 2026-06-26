import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Phone, RefreshCcw, Ruler, Search, UserRound } from "lucide-react";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
};

function mapsUrl(customer: CustomerRow) {
  const address = [customer.address, customer.district, customer.city].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || customer.name || "")}`;
}

export default function FieldCustomers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function loadCustomers() {
    setLoading(true);
    setError("");
    try {
      const ctx = await getEffectiveTenantContext();
      let { data, error: queryError } = await supabase
        .from("customers")
        .select("id,name,phone,address,city,district")
        .eq("company_id", ctx.company_id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (queryError && String(queryError.message || "").includes("address")) {
        const retry = await supabase
          .from("customers")
          .select("id,name,phone")
          .eq("company_id", ctx.company_id)
          .order("created_at", { ascending: false })
          .limit(200);
        data = retry.data as any;
        queryError = retry.error;
      }

      if (queryError) throw queryError;
      setCustomers((data ?? []) as CustomerRow[]);
    } catch (err: any) {
      setError(err?.message ?? "Müşteri listesi yüklenemedi.");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    if (!q) return customers;
    return customers.filter((customer) => {
      const haystack = [customer.name, customer.phone, customer.address, customer.city, customer.district]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(q);
    });
  }, [customers, search]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950 dark:text-white">Müşterilerim</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Saha personeli için müşteri bilgisi, arama, konum ve ölçü başlangıcı.</p>
          </div>
          <button onClick={loadCustomers} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <RefreshCcw className="h-4 w-4" />
            Yenile
          </button>
        </div>

        <label className="mt-5 flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 dark:border-slate-800 dark:bg-slate-950">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Müşteri adı, telefon veya adres ara"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
      </section>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Müşteriler yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Müşteri bulunamadı.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((customer) => {
            const address = [customer.address, customer.district, customer.city].filter(Boolean).join(", ");
            return (
              <article key={customer.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-black text-slate-950 dark:text-white">{customer.name || "İsimsiz müşteri"}</h2>
                    <p className="mt-1 text-sm text-slate-500">{customer.phone || "Telefon yok"}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{address || "Adres bilgisi yok"}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {customer.phone ? (
                    <a href={`tel:${customer.phone.replace(/\s+/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700">
                      <Phone className="h-4 w-4" />
                      Ara
                    </a>
                  ) : null}
                  {address ? (
                    <a href={mapsUrl(customer)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <MapPin className="h-4 w-4" />
                      Konum
                    </a>
                  ) : null}
                  <button
                    onClick={() => navigate("/measurements/new", { state: { customerId: customer.id, customerName: customer.name ?? "", phone: customer.phone ?? "", address } })}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary-200 px-4 text-sm font-bold text-primary-700 hover:bg-primary-50 dark:border-primary-900 dark:text-primary-300"
                  >
                    <Ruler className="h-4 w-4" />
                    Ölçü Al
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
