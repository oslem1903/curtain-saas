// ============================================================================
// PhotoAnnotator — fotoğraf üzerine işaretleme (ok / daire / kare / serbest / yazı)
// İşaretlenen görsel tek katmana düzleştirilip dataURL (JPEG) olarak döner.
// ============================================================================
import { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { ArrowUpRight, Circle, Square, Pencil, Type, Undo2, Check, X } from "lucide-react";

type Tool = "arrow" | "circle" | "rect" | "free" | "text";
type Point = { x: number; y: number };
type Shape =
  | { type: "arrow" | "circle" | "rect"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: "free"; points: Point[]; color: string }
  | { type: "text"; x: number; y: number; text: string; color: string };

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#111827", "#ffffff"];
const MAX_DIM = 1600;

export default function PhotoAnnotator({ src, onSave, onClose }: { src: string; onSave: (dataUrl: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const draftRef = useRef<Shape | null>(null);
  const drawingRef = useRef(false);

  // Görseli yükle ve canvas boyutunu ayarla.
  // Uzak (http) görseli blob/objectURL üzerinden yükleriz → canvas taint olmaz,
  // toDataURL ile işaretli görsel güvenle dışa aktarılır (CORS sorununu önler).
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      let loadSrc = src;
      if (/^https?:\/\//i.test(src)) {
        try {
          const blob = await (await fetch(src, { mode: "cors" })).blob();
          objectUrl = URL.createObjectURL(blob);
          loadSrc = objectUrl;
        } catch { loadSrc = src; }
      }
      if (cancelled) return;
      const img = new Image();
      if (loadSrc === src && /^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled) return;
        let w = img.naturalWidth || 1024;
        let h = img.naturalHeight || 768;
        const scale = Math.min(1, MAX_DIM / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = canvasRef.current;
        if (canvas) { canvas.width = w; canvas.height = h; }
        imgRef.current = img;
        setReady(true);
      };
      img.onerror = () => { if (!cancelled) setReady(true); };
      img.src = loadSrc;
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);

  const redraw = useCallback((extra?: Shape | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
    const all = extra ? [...shapes, extra] : shapes;
    const lw = Math.max(3, Math.round(canvas.width / 250));
    for (const s of all) drawShape(ctx, s, lw);
  }, [shapes]);

  useEffect(() => { if (ready) redraw(); }, [ready, shapes, redraw]);

  function toCanvasCoords(e: React.PointerEvent): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!ready) return;
    const p = toCanvasCoords(e);
    if (tool === "text") {
      const text = window.prompt("Etiket yazısı (örn. Motor, Kasa, Sağ):", "");
      if (text && text.trim()) setShapes((prev) => [...prev, { type: "text", x: p.x, y: p.y, text: text.trim(), color }]);
      return;
    }
    drawingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (tool === "free") draftRef.current = { type: "free", points: [p], color };
    else draftRef.current = { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawingRef.current || !draftRef.current) return;
    const p = toCanvasCoords(e);
    const d = draftRef.current;
    if (d.type === "free") d.points.push(p);
    else if (d.type !== "text") { d.x2 = p.x; d.y2 = p.y; }
    redraw(d);
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const d = draftRef.current;
    draftRef.current = null;
    if (!d) return;
    // Çok küçük (kazara) çizimleri yok say
    if (d.type === "free") {
      if (d.points.length < 2) { redraw(); return; }
    } else if (d.type !== "text") {
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 6) { redraw(); return; }
    }
    setShapes((prev) => [...prev, d]);
  }

  function undo() { setShapes((prev) => prev.slice(0, -1)); }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) { onClose(); return; }
    redraw();
    try {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      onSave(dataUrl);
    } catch {
      // CORS taint vb. → orijinali koru
      onSave(src);
    }
  }

  const tools: Array<{ key: Tool; icon: ReactNode; label: string }> = [
    { key: "arrow", icon: <ArrowUpRight className="h-5 w-5" />, label: "Ok" },
    { key: "circle", icon: <Circle className="h-5 w-5" />, label: "Daire" },
    { key: "rect", icon: <Square className="h-5 w-5" />, label: "Kare" },
    { key: "free", icon: <Pencil className="h-5 w-5" />, label: "Serbest" },
    { key: "text", icon: <Type className="h-5 w-5" />, label: "Yazı" },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
        <span className="text-sm font-black text-white">Fotoğrafı İşaretle</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={undo} disabled={shapes.length === 0} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-sm font-bold text-white disabled:opacity-40"><Undo2 className="h-4 w-4" /> Geri</button>
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-sm font-bold text-white"><X className="h-4 w-4" /> İptal</button>
          <button type="button" onClick={save} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-emerald-500 px-3 text-sm font-black text-white"><Check className="h-4 w-4" /> Kaydet</button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-3">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="max-h-full max-w-full touch-none rounded-lg bg-white shadow-2xl"
          style={{ cursor: "crosshair" }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 p-3">
        {tools.map((t) => (
          <button key={t.key} type="button" onClick={() => setTool(t.key)} title={t.label}
            className={`inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-3 text-[10px] font-bold ${tool === t.key ? "bg-primary-600 text-white" : "bg-white/10 text-white/80"}`}>
            {t.icon}{t.label}
          </button>
        ))}
        <div className="mx-2 h-8 w-px bg-white/20" />
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Renk ${c}`}
            className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-white ring-2 ring-white/50" : "border-white/30"}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
    </div>
  );
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, lw: number) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.type === "rect") {
    ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  } else if (s.type === "circle") {
    ctx.beginPath();
    ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === "arrow") {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const head = Math.max(12, lw * 4);
    ctx.beginPath();
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 6), s.y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 6), s.y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (s.type === "free") {
    ctx.beginPath();
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  } else if (s.type === "text") {
    const size = Math.max(20, lw * 7);
    ctx.font = `900 ${size}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = s.color === "#ffffff" ? "#000000" : "#ffffff";
    ctx.strokeText(s.text, s.x, s.y);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, s.x, s.y);
  }
}
