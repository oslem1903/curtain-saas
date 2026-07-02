// ============================================================================
// FieldInfoEditor — PerdePRO profesyonel saha kayıt kartı (ölçü ekranı)
// 1) Kartela/Renk kodu (+ QR/barkod okuma)  2) Kartela fotoğrafı (+ işaretleme)
// 3) Çoklu mekan fotoğrafları  4) Sesli not  5) Montaj notu
// Dosyalar anında measurement-photos bucket'ına yüklenir; FieldInfo'da yalnızca
// URL'ler tutulur (taslak/localStorage şişmez). Foto opsiyoneldir.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Tag, QrCode, Camera, ImagePlus, Mic, Square as StopSquare, Trash2, PencilLine, Loader2, X, ChevronUp, ChevronDown } from "lucide-react";
import type { FieldInfo } from "../utils/fieldInfo";
import { uploadFieldFile, dataUrlToBlob } from "../utils/fieldInfo";
import PhotoAnnotator from "./PhotoAnnotator";

type AnnotateTarget = { kind: "swatch" } | { kind: "room"; index: number };

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function pickFileWeb(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    // capture AYARLANMAZ → mobil tarayıcıda OS hem "Kamera" hem "Galeri" seçeneği sunar.
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

async function capturePhoto(): Promise<{ dataUrl: string; blob: Blob } | null> {
  if (Capacitor.isNativePlatform()) {
    const captured = await CapacitorCamera.getPhoto({
      quality: 80, resultType: CameraResultType.Uri, source: CameraSource.Prompt, saveToGallery: false,
      promptLabelHeader: "Fotoğraf", promptLabelPhoto: "Kameradan çek", promptLabelPicture: "Galeriden seç",
    });
    if (!captured.webPath) return null;
    const blob = await (await fetch(captured.webPath)).blob();
    return { dataUrl: await blobToDataUrl(blob), blob };
  }
  const file = await pickFileWeb("image/*");
  if (!file) return null;
  return { dataUrl: await blobToDataUrl(file), blob: file };
}

export default function FieldInfoEditor({ value, onChange, getCompanyId }: {
  value: FieldInfo;
  onChange: (fi: FieldInfo) => void;
  getCompanyId: () => Promise<string>;
}) {
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [annotate, setAnnotate] = useState<{ target: AnnotateTarget; src: string } | null>(null);

  // Sesli not
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // QR
  const [qrOpen, setQrOpen] = useState(false);
  const [qrErr, setQrErr] = useState("");
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);

  function update(partial: Partial<FieldInfo>) { onChange({ ...value, ...partial }); }

  // ── Kartela fotoğrafı ──────────────────────────────────────────────────────
  async function addSwatchPhoto() {
    setErr("");
    try {
      const shot = await capturePhoto();
      if (!shot) return;
      setBusy("Kartela fotoğrafı yükleniyor...");
      const companyId = await getCompanyId();
      const url = await uploadFieldFile(companyId, shot.blob, "kartela", "jpg");
      if (!url) { setErr("Kartela fotoğrafı yüklenemedi."); return; }
      update({ swatch_photo_url: url });
    } catch (e: any) {
      const m = String(e?.message ?? e ?? "");
      if (!/cancel|dismiss/i.test(m)) setErr(`Fotoğraf alınamadı: ${m}`);
    } finally { setBusy(""); }
  }

  // ── Mekan fotoğrafı ekle ───────────────────────────────────────────────────
  async function addRoomPhoto() {
    setErr("");
    try {
      const shot = await capturePhoto();
      if (!shot) return;
      setBusy("Mekan fotoğrafı yükleniyor...");
      const companyId = await getCompanyId();
      const url = await uploadFieldFile(companyId, shot.blob, "mekan", "jpg");
      if (!url) { setErr("Mekan fotoğrafı yüklenemedi."); return; }
      update({ room_photos: [...value.room_photos, url] });
    } catch (e: any) {
      const m = String(e?.message ?? e ?? "");
      if (!/cancel|dismiss/i.test(m)) setErr(`Fotoğraf alınamadı: ${m}`);
    } finally { setBusy(""); }
  }

  function removeRoomPhoto(index: number) {
    update({ room_photos: value.room_photos.filter((_, i) => i !== index) });
  }
  function moveRoomPhoto(index: number, dir: -1 | 1) {
    const next = [...value.room_photos];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    update({ room_photos: next });
  }

  // ── İşaretleme (annotation) ────────────────────────────────────────────────
  function openAnnotate(target: AnnotateTarget) {
    const src = target.kind === "swatch" ? value.swatch_photo_url : value.room_photos[target.index];
    if (src) setAnnotate({ target, src });
  }
  async function saveAnnotation(dataUrl: string) {
    const target = annotate?.target;
    setAnnotate(null);
    if (!target) return;
    try {
      setBusy("İşaretli fotoğraf kaydediliyor...");
      const companyId = await getCompanyId();
      const blob = await dataUrlToBlob(dataUrl);
      const url = await uploadFieldFile(companyId, blob, "isaretli", "jpg");
      if (!url) { setErr("İşaretli fotoğraf yüklenemedi."); return; }
      if (target.kind === "swatch") update({ swatch_photo_url: url });
      else { const next = [...value.room_photos]; next[target.index] = url; update({ room_photos: next }); }
    } finally { setBusy(""); }
  }

  // ── Sesli not ──────────────────────────────────────────────────────────────
  async function startRecording() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const ext = (rec.mimeType || "").includes("mp4") ? "mp4" : "webm";
        try {
          setBusy("Sesli not yükleniyor...");
          const companyId = await getCompanyId();
          const url = await uploadFieldFile(companyId, blob, "ses", ext);
          if (!url) setErr("Sesli not yüklenemedi."); else update({ voice_note_url: url });
        } finally { setBusy(""); }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e: any) {
      setErr(`Mikrofona erişilemedi: ${String(e?.message ?? e ?? "")}`);
    }
  }
  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  // ── QR / Barkod ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!qrOpen) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let active = true;
    const AnyBD = (window as any).BarcodeDetector;
    (async () => {
      if (!AnyBD) { setQrErr("Bu cihaz/tarayıcı QR-barkod okumayı desteklemiyor. Kodu elle girin."); return; }
      try {
        const detector = new AnyBD({ formats: ["qr_code", "code_128", "ean_13", "code_39", "code_93", "codabar"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = qrVideoRef.current;
        if (video) { video.srcObject = stream; await video.play(); }
        const scan = async () => {
          if (!active) return;
          try {
            const video2 = qrVideoRef.current;
            if (video2 && video2.readyState >= 2) {
              const codes = await detector.detect(video2);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                update({ swatch_code: String(codes[0].rawValue) });
                active = false; setQrOpen(false); return;
              }
            }
          } catch { /* yoksay, devam et */ }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch (e: any) {
        setQrErr(`Kamera açılamadı: ${String(e?.message ?? e ?? "")}`);
      }
    })();
    return () => { active = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOpen]);

  const photoBtn = "flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 text-sm font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300";

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-amber-900 dark:text-amber-200">
        <Tag className="h-4 w-4" /> Saha Bilgileri
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600/70">(opsiyonel — montaj karışıklığını önler)</span>
      </div>

      {err ? <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-950/30">{err}</div> : null}
      {busy ? <div className="mb-3 flex items-center gap-2 text-xs font-bold text-amber-700"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</div> : null}

      <div className="space-y-4">
        {/* 1) Kartela / Renk Kodu + QR */}
        <div>
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Kartela / Renk Kodu</span>
          <div className="mt-2 flex gap-2">
            <input
              value={value.swatch_code}
              onChange={(e) => update({ swatch_code: e.target.value })}
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 font-mono outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-950"
              placeholder="ZB-214, Bambu 301, Luna 15..."
            />
            <button type="button" onClick={() => { setQrErr(""); setQrOpen(true); }} title="QR / barkod okut" className="inline-flex min-h-12 shrink-0 items-center gap-1 rounded-xl border border-amber-300 bg-amber-100 px-3 text-sm font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              <QrCode className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 2) Kartela Fotoğrafı */}
        <div>
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Kartela Fotoğrafı</span>
          {value.swatch_photo_url ? (
            <div className="mt-2 flex items-start gap-3">
              <img src={value.swatch_photo_url} alt="Kartela" className="h-24 w-24 rounded-xl object-cover ring-1 ring-amber-300" />
              <div className="flex flex-col gap-1.5">
                <button type="button" onClick={() => openAnnotate({ kind: "swatch" })} className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline"><PencilLine className="h-3.5 w-3.5" /> İşaretle</button>
                <button type="button" onClick={addSwatchPhoto} className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:underline"><Camera className="h-3.5 w-3.5" /> Değiştir</button>
                <button type="button" onClick={() => update({ swatch_photo_url: null })} className="inline-flex items-center gap-1 text-xs font-bold text-red-500 hover:underline"><Trash2 className="h-3.5 w-3.5" /> Sil</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={addSwatchPhoto} className={`mt-2 w-full ${photoBtn}`}><Camera className="h-4 w-4" /> Kamera / Galeri</button>
          )}
        </div>

        {/* 3) Mekan Fotoğrafları (çoklu) */}
        <div>
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Mekan Fotoğrafları <span className="text-slate-400">(salon, pencere, korniş, motor, priz...)</span></span>
          {value.room_photos.length > 0 ? (
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {value.room_photos.map((url, i) => (
                <div key={url + i} className="group relative aspect-square">
                  <img src={url} alt={`Mekan ${i + 1}`} className="h-full w-full rounded-lg object-cover ring-1 ring-amber-300" />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{i + 1}</span>
                  <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 rounded-b-lg bg-black/55 p-0.5 opacity-0 transition group-hover:opacity-100">
                    <button type="button" onClick={() => moveRoomPhoto(i, -1)} title="Sola al" className="text-white"><ChevronUp className="h-3.5 w-3.5 -rotate-90" /></button>
                    <button type="button" onClick={() => openAnnotate({ kind: "room", index: i })} title="İşaretle" className="text-white"><PencilLine className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => removeRoomPhoto(i)} title="Sil" className="text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => moveRoomPhoto(i, 1)} title="Sağa al" className="text-white"><ChevronDown className="h-3.5 w-3.5 -rotate-90" /></button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRoomPhoto} className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/30"><ImagePlus className="h-6 w-6" /></button>
            </div>
          ) : (
            <button type="button" onClick={addRoomPhoto} className={`mt-2 w-full ${photoBtn}`}><ImagePlus className="h-4 w-4" /> Fotoğraf Ekle</button>
          )}
        </div>

        {/* 4) Sesli Not */}
        <div>
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Sesli Not</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!recording ? (
              <button type="button" onClick={startRecording} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><Mic className="h-4 w-4" /> Kayıt</button>
            ) : (
              <button type="button" onClick={stopRecording} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-black text-white"><StopSquare className="h-4 w-4" /> Durdur (kaydediliyor)</button>
            )}
            {value.voice_note_url ? (
              <>
                <audio controls preload="none" src={value.voice_note_url} className="h-9 max-w-[220px]" />
                <button type="button" onClick={() => update({ voice_note_url: null })} className="inline-flex items-center gap-1 text-xs font-bold text-red-500 hover:underline"><Trash2 className="h-3.5 w-3.5" /> Sil</button>
              </>
            ) : null}
          </div>
        </div>

        {/* 5) Montaj Notu */}
        <div>
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Montaj Notu</span>
          <textarea
            value={value.install_note}
            onChange={(e) => update({ install_note: e.target.value })}
            rows={3}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-950"
            placeholder={"Sağdan toplansın\nZincir beyaz olsun\nElektrik solda"}
          />
        </div>
      </div>

      {annotate ? <PhotoAnnotator src={annotate.src} onSave={saveAnnotation} onClose={() => setAnnotate(null)} /> : null}

      {qrOpen ? (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/95">
          <div className="flex items-center justify-between p-3">
            <span className="text-sm font-black text-white">QR / Barkod Okut</span>
            <button type="button" onClick={() => setQrOpen(false)} className="rounded-full bg-white/10 p-2 text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex flex-1 items-center justify-center p-3">
            {qrErr ? (
              <p className="max-w-xs text-center text-sm font-bold text-white/90">{qrErr}</p>
            ) : (
              <video ref={qrVideoRef} playsInline muted className="max-h-full max-w-full rounded-xl" />
            )}
          </div>
          <p className="p-3 text-center text-xs text-white/60">Kodu kameraya gösterin; otomatik okunup kartela koduna yazılır.</p>
        </div>
      ) : null}
    </div>
  );
}
