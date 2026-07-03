import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";

type ShareTextFileOptions = {
  filename: string;
  mimeType: string;
  text: string;
  title?: string;
};

function downloadTextFile({ filename, mimeType, text }: ShareTextFileOptions) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export async function shareOrDownloadTextFile(options: ShareTextFileOptions) {
  if (!Capacitor.isNativePlatform()) {
    downloadTextFile(options);
    return;
  }

  try {
    const result = await Filesystem.writeFile({
      path: options.filename,
      data: toBase64(options.text),
      directory: Directory.Cache,
      recursive: true,
    });

    await Share.share({
      title: options.title || options.filename,
      text: options.title || options.filename,
      url: result.uri,
      dialogTitle: options.title || "Dosyayı paylaş",
    });
  } catch {
    downloadTextFile(options);
  }
}
