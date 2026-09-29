import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export type NativePlatform = "ios" | "android" | "web";

export function nativePlatform(): NativePlatform {
  if (!Capacitor.isNativePlatform()) return "web";
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}

export function isNativeIos() {
  return nativePlatform() === "ios";
}

export function isNativeAndroid() {
  return nativePlatform() === "android";
}

function prefersDark() {
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

/**
 * Yalnizca iOS: uygulama `dark:` sinifleriyle sistem temasini takip ettigi
 * icin durum cubugu da ayni temaya uymali. Capacitor'da Style.Light = koyu
 * yazi (acik zemin icin), Style.Dark = acik yazi (koyu zemin icin) — isimler
 * tersmis gibi durur. iOS'ta setBackgroundColor desteklenmez.
 */
async function applyIosStatusBarTheme() {
  try {
    await StatusBar.setStyle({ style: prefersDark() ? Style.Dark : Style.Light });
  } catch {
    // Bazi OS surumlerinde desteklenmez.
  }
}

export async function initializeNativeRuntime() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.dataset.platform = nativePlatform();
  document.documentElement.classList.add("capacitor-native", `capacitor-${nativePlatform()}`);

  if (isNativeIos()) {
    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch {
      // Status bar support differs between platforms and OS versions.
    }
    await applyIosStatusBarTheme();
    window.matchMedia?.("(prefers-color-scheme: dark)")
      .addEventListener?.("change", () => void applyIosStatusBarTheme());
  } else {
    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: "#ffffff" });
    } catch {
      // Status bar support differs between platforms and OS versions.
    }
  }

  try {
    if (isNativeIos()) {
      await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
      await Keyboard.setStyle({ style: prefersDark() ? KeyboardStyle.Dark : KeyboardStyle.Light });
    }
  } catch {
    // Keyboard plugin is best-effort; forms still work with CSS fallbacks.
  }

  window.setTimeout(() => {
    void SplashScreen.hide().catch(() => undefined);
  }, 250);
}

/**
 * Yalnizca iOS: WKWebView'de `window.location.href` ile harici bir adrese
 * gitmek uygulamadan cikis yolu birakmaz — App Store linki uygulamanin icinde
 * acilir ve kullanici geri donemez. Diger platformlarda eski davranis korunur.
 */
export function openExternalUrl(url: string) {
  if (!url) return;
  if (isNativeIos()) {
    window.open(url, "_blank");
    return;
  }
  window.location.href = url;
}
