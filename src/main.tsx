import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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

void clearNativeWebCache();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
