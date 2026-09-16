// ============================================================================
// PDF / yazdırma çıktısı — TEK giriş noktası.
//
// KÖK NEDEN: Ekstre/fatura/hakediş PDF'leri `window.open("", "_blank")` ile
// yeni bir pencere açıp oraya HTML yazıyordu. Windows (Electron) sürümünde
// electron/main.cjs içindeki
//
//     win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
//
// kuralı TÜM window.open çağrılarını reddeder — dolayısıyla `printWindow`
// null döner, çağıran kod `if (!printWindow) return;` ile sessizce çıkar ve
// kullanıcı butona bastığında HİÇBİR ŞEY olmaz. Aynı sorun Capacitor
// (Android/iOS) WebView'inde de görülür.
//
// ÇÖZÜM: Yazdırma artık pencere açmadan, aynı doküman içinde gizli bir
// <iframe> üzerinden yapılır (tarayıcı + Electron). Native (Capacitor)
// platformlarda WebView'in kendi print desteği olmadığı için HTML dosyası
// yazılıp sistem paylaşım sayfasına verilir; kullanıcı oradan "Yazdır"ı
// seçebilir.
// ============================================================================

import { Capacitor } from "@capacitor/core";
import { shareOrDownloadTextFile } from "./nativeShare";

export type PrintDocumentOptions = {
  /** Yazdırma diyaloğunda / dosya adında görünen başlık. */
  title?: string;
  /** Native paylaşımda kullanılacak dosya adı (uzantısız verilirse .html eklenir). */
  fileName?: string;
  /** İçerik yerleşmesi için yazdırmadan önce beklenecek süre (ms). */
  delayMs?: number;
};

function slugify(value: string): string {
  return (
    String(value || "belge")
      .toLocaleLowerCase("tr-TR")
      .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
      .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "belge"
  );
}

/** Verilen HTML'i tam bir doküman haline getirir (çağıranlar <html> ile de gönderebilir). */
function ensureDocument(html: string, title?: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return /^<!doctype/i.test(trimmed) ? trimmed : `<!doctype html>\n${trimmed}`;
  }
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><title>${title || "PerdePRO"}</title></head><body>${trimmed}</body></html>`;
}

/**
 * HTML içeriğini yazdırır.
 * - Web / Electron : gizli iframe + iframe.contentWindow.print()
 * - Capacitor      : HTML dosyası olarak paylaşılır/indirilir
 *
 * Hiçbir zaman sessizce başarısız olmaz: yazdırma başlatılamazsa dosya
 * indirmeye düşer ve `false` döner.
 */
export async function printHtmlDocument(html: string, options: PrintDocumentOptions = {}): Promise<boolean> {
  const { title, delayMs = 350 } = options;
  const documentHtml = ensureDocument(html, title);
  const baseName = slugify(options.fileName || title || "perdepro-belge");
  const fileName = /\.html?$/i.test(options.fileName || "") ? (options.fileName as string) : `${baseName}.html`;

  // Native (Capacitor): WebView'de window.print() yoktur — dosya olarak paylaş.
  if (Capacitor.isNativePlatform()) {
    await shareOrDownloadTextFile({
      filename: fileName,
      mimeType: "text/html",
      text: documentHtml,
      title: title || "PerdePRO belgesi",
    });
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = document.createElement("iframe");
      // Ekran dışında ama "display:none" DEĞİL — gizli iframe'lerde bazı
      // tarayıcılar yazdırma içeriğini boş üretir.
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      document.body.appendChild(iframe);

      const frame = iframe;
      const cleanup = () => {
        window.setTimeout(() => {
          if (frame.parentNode) frame.parentNode.removeChild(frame);
        }, 1000);
      };

      const doPrint = () => {
        try {
          const target = frame.contentWindow;
          if (!target) {
            cleanup();
            finish(false);
            return;
          }
          target.focus();
          target.print();
          cleanup();
          finish(true);
        } catch {
          cleanup();
          finish(false);
        }
      };

      frame.onload = () => window.setTimeout(doPrint, delayMs);

      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc) {
        cleanup();
        finish(false);
        return;
      }
      doc.open();
      doc.write(documentHtml);
      doc.close();

      // onload bazı ortamlarda srcdoc olmadan tetiklenmeyebilir — güvenlik ağı.
      window.setTimeout(() => {
        if (!settled) doPrint();
      }, delayMs + 800);
    } catch {
      if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
      finish(false);
    }
  }).then(async (printed) => {
    if (printed) return true;
    // Yazdırma başlatılamadı — kullanıcı en azından dosyayı alsın.
    await shareOrDownloadTextFile({
      filename: fileName,
      mimeType: "text/html",
      text: documentHtml,
      title: title || "PerdePRO belgesi",
    });
    return false;
  });
}
