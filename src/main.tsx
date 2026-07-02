import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeNativeRuntime } from './utils/nativeRuntime'
import { installConsoleCapture } from './utils/consoleCapture'

// Global hata/console yakalayıcıyı mümkün olan en erken kur
installConsoleCapture()

async function clearNativeWebCache() {
  const isNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const isLocalPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  if (!isNative && !isLocalPreview) return;

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
    const cacheNames = await caches?.keys?.();
    await Promise.all((cacheNames ?? []).map((cacheName) => caches.delete(cacheName)));
  } catch (error) {
    console.warn("Native cache cleanup skipped", error);
  }
}

void initializeNativeRuntime();
void clearNativeWebCache();

// Web/PWA push bildirimleri için service worker kaydı
// (native Capacitor uygulamasında LocalNotifications kullanılır, SW gerekmez)
async function registerPushServiceWorker() {
  const isNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const isLocalPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  if (isNative || isLocalPreview || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("Service worker kaydı atlandı", error);
  }
}

void registerPushServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
