// ============================================================================
// FieldInfoGallery — Saha Bilgileri salt-okunur görünüm (Sipariş Detay + Montaj)
// Kartela kodu, kartela fotoğrafı, çoklu mekan fotoğrafları (galeri + lightbox),
// sesli not (oynatıcı) ve montaj notu. Boşsa hiçbir şey göstermez.
// ============================================================================
import { useState } from "react";
import { Volume2, Maximize2, X, ChevronLeft, ChevronRight, Tag } from "lucide-react";
import type { FieldInfo } from "../utils/fieldInfo";
import { hasFieldInfo } from "../utils/fieldInfo";

export default function FieldInfoGallery({ info, compact = false }: { info: FieldInfo; compact?: boolean }) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (!hasFieldInfo(info)) return null;

  const photos: Array<{ url: string; label: string }> = [];
  if (info.swatch_photo_url) photos.push({ url: info.swatch_photo_url, label: "Kartela" });
  (info.room_photos || []).forEach((url, i) => photos.push({ url, label: `Mekan ${i + 1}` }));

  const thumbSize = compact ? "h-12 w-12" : "h-16 w-16";

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/10">
      {info.swatch_code ? (
        <div className="flex items-center gap-1.5 text-xs font-black text-amber-800 dark:text-amber-300">
          <Tag className="h-3.5 w-3.5" /> Kartela: <span className="rounded-md bg-amber-200/70 px-1.5 py-0.5 font-mono text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{info.swatch_code}</span>
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <button key={p.url + i} type="button" onClick={() => setLightbox(i)} title={`${p.label} — büyütmek için tıkla`} className="group relative">
              <img src={p.url} alt={p.label} loading="lazy" className={`${thumbSize} rounded-lg object-cover ring-1 ring-amber-300`} />
              <span className="absolute inset-0 hidden items-center justify-center rounded-lg bg-black/30 group-hover:flex">
                <Maximize2 className="h-4 w-4 text-white" />
              </span>
              <span className="absolute bottom-0 left-0 right-0 truncate rounded-b-lg bg-black/55 px-1 py-0.5 text-center text-[8px] font-bold text-white">{p.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {info.voice_note_url ? (
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <audio controls preload="none" src={info.voice_note_url} className="h-8 w-full max-w-[240px]" />
        </div>
      ) : null}

      {info.install_note && info.install_note.trim() ? (
        <div className="whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[11px] leading-relaxed text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
          <span className="font-black text-amber-800 dark:text-amber-300">Montaj Notu: </span>{info.install_note}
        </div>
      ) : null}

      {lightbox !== null && photos[lightbox] ? (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/95" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between p-3" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm font-bold text-white">{photos[lightbox].label} ({lightbox + 1}/{photos.length})</span>
            <button type="button" onClick={() => setLightbox(null)} className="rounded-full bg-white/10 p-2 text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden p-2" onClick={(e) => e.stopPropagation()}>
            {photos.length > 1 ? (
              <button type="button" onClick={() => setLightbox((lightbox - 1 + photos.length) % photos.length)} className="shrink-0 rounded-full bg-white/10 p-2 text-white"><ChevronLeft className="h-6 w-6" /></button>
            ) : null}
            <img src={photos[lightbox].url} alt={photos[lightbox].label} className="mx-2 max-h-full max-w-full rounded-lg object-contain" />
            {photos.length > 1 ? (
              <button type="button" onClick={() => setLightbox((lightbox + 1) % photos.length)} className="shrink-0 rounded-full bg-white/10 p-2 text-white"><ChevronRight className="h-6 w-6" /></button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
