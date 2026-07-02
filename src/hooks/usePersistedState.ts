import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState + localStorage kalıcılığı — sayfa filtrelerinin (durum/tür/tarih vb.) F5
 * hard-refresh sonrası korunması için. İmza useState ile BİREBİR aynıdır; yalnız değeri
 * localStorage'a yazar/okur.
 *
 * Güvenli: okuma/yazma/parse hatasında sessizce default'a düşer, ASLA throw etmez
 * (davranış useState'e eşdeğer kalır). Veri hesaplama/toplamlara dokunmaz.
 *
 * Kullanım:
 *   const [statusFilter, setStatusFilter] = usePersistedState("perdepro.orders.status", "all");
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // kota/erişim hatası → persist edilemez, davranış useState gibi devam eder
    }
  }, [key, value]);

  return [value, setValue];
}
