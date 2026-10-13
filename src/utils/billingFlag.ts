/**
 * Uygulama ici satin alma ekranlari (web/Windows). Varsayilan ACIK: ekran, sunucuda
 * odeme saglayicisi/plan hazir degilse "satin alinabilir paket yok" durumunu gosterir.
 * Acil kapatma: VITE_BILLING_ENABLED=0. Mobil magaza paketlerinde satin alma zaten gizlidir.
 */
export const BILLING_UI_ENABLED = import.meta.env.VITE_BILLING_ENABLED !== "0";
