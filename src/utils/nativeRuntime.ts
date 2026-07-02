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

export async function initializeNativeRuntime() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.dataset.platform = nativePlatform();
  document.documentElement.classList.add("capacitor-native", `capacitor-${nativePlatform()}`);

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#ffffff" });
  } catch {
    // Status bar support differs between platforms and OS versions.
  }

  try {
    if (isNativeIos()) {
      await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
      await Keyboard.setStyle({ style: KeyboardStyle.Light });
    }
  } catch {
    // Keyboard plugin is best-effort; forms still work with CSS fallbacks.
  }

  window.setTimeout(() => {
    void SplashScreen.hide().catch(() => undefined);
  }, 250);
}
