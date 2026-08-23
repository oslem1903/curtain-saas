import { useRef, useState } from "react";
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import { supabase } from "../supabaseClient";

interface Photo {
  id: string;
  url: string;
  note?: string;
}

interface FieldInfoSectionProps {
  itemId: string;
  companyId: string;
  photos: Photo[];
  colorName: string;
  modelName: string;
  fieldNotes: string;
  onPhotosChange: (photos: Photo[]) => void;
  onColorChange: (color: string) => void;
  onModelChange: (model: string) => void;
  onFieldNotesChange: (notes: string) => void;
}

const labelCls = "block text-xs font-bold text-slate-600 mb-1 dark:text-slate-400";
const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:border-primary-500";
const buttonCls = "inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-700 dark:bg-primary-700 dark:hover:bg-primary-600";

export default function FieldInfoSection({
  itemId,
  companyId,
  photos,
  colorName,
  modelName,
  fieldNotes,
  onPhotosChange,
  onColorChange,
  onModelChange,
  onFieldNotesChange,
}: FieldInfoSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);

  const handleCapturePhoto = async () => {
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const photo = await CapacitorCamera.getPhoto({
        quality: 90,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });

      if (photo.base64String) {
        const blob = base64ToBlob(photo.base64String, photo.format);
        await uploadPhoto(blob);
      }
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const handleGalleryImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Lütfen bir görüntü dosyası seçiniz.");
      return;
    }

    await uploadPhoto(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadPhoto = async (file: Blob) => {
    if (file.size > 5 * 1024 * 1024) {
      alert("Dosya boyutu 5MB'dan küçük olmalıdır.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.type.split("/")[1] || "jpg";
      const fileName = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
      const path = `${companyId}/${itemId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("measurement-photos")
        .upload(path, file, { upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("measurement-photos").getPublicUrl(path);
      const newPhoto: Photo = {
        id: fileName,
        url: data.publicUrl,
      };

      onPhotosChange([...photos, newPhoto]);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Fotoğraf yüklenemedi.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!window.confirm("Fotoğrafı silmek istediğinize emin misiniz?")) return;

    setUploading(true);
    try {
      const photoToDelete = photos.find(p => p.id === photoId);
      if (photoToDelete) {
        const path = `${companyId}/${itemId}/${photoId}`;
        await supabase.storage.from("measurement-photos").remove([path]);
      }

      onPhotosChange(photos.filter(p => p.id !== photoId));
      setSelectedPhotoUrl(null);
    } catch (err) {
      console.error("Delete error:", err);
      alert("Fotoğraf silinemedi.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      {/* Section Title */}
      <div className="flex items-center gap-2">
        <h3 className="font-bold text-slate-900 dark:text-white">📋 Saha Bilgileri</h3>
      </div>

      {/* Photo Gallery */}
      <div className="space-y-2">
        <label className={labelCls}>Kartela / Ürün Fotoğrafı</label>

        {photos.length > 0 && (
          <div className="mb-3">
            {selectedPhotoUrl ? (
              <div className="relative">
                <img src={selectedPhotoUrl} alt="Seçili fotoğraf" className="max-h-48 w-full rounded-lg object-cover" />
                <button
                  onClick={() => setSelectedPhotoUrl(null)}
                  className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {photos.map((photo) => (
                  <div key={photo.id} className="group relative aspect-square">
                    <img
                      src={photo.url}
                      alt="Ürün fotoğrafı"
                      className="h-full w-full rounded-lg border border-slate-300 object-cover dark:border-slate-600 cursor-pointer hover:border-primary-500"
                      onClick={() => setSelectedPhotoUrl(photo.url)}
                    />
                    <button
                      onClick={() => handleDeletePhoto(photo.id)}
                      disabled={uploading}
                      className="absolute -right-2 -top-2 hidden rounded-full bg-red-500 p-1 text-white hover:bg-red-600 group-hover:block disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {photos.length < 10 && (
                  <button
                    onClick={handleCapturePhoto}
                    disabled={uploading}
                    className="aspect-square rounded-lg border-2 border-dashed border-primary-300 bg-primary-50 flex items-center justify-center hover:bg-primary-100 disabled:opacity-50 dark:border-primary-800 dark:bg-primary-950/20"
                  >
                    <span className="text-lg">+</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {photos.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-100 p-4 text-center dark:border-slate-600 dark:bg-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">Henüz fotoğraf yüklenmedi</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCapturePhoto}
            disabled={uploading}
            className={`${buttonCls} disabled:opacity-50`}
          >
            <Camera className="h-3.5 w-3.5" /> Fotoğraf Çek
          </button>
          <button
            onClick={handleGalleryImport}
            disabled={uploading}
            className={`${buttonCls} disabled:opacity-50`}
          >
            <ImagePlus className="h-3.5 w-3.5" /> Galeriden Ekle
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {photos.length > 0 && `${photos.length} fotoğraf yüklü`}
          </span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Color and Model */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelCls}>Renk / Kartela Kodu</span>
          <input
            value={colorName}
            onChange={(e) => onColorChange(e.target.value)}
            placeholder="Sedef Beyaz, Kod 123..."
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>Model Adı</span>
          <input
            value={modelName}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="RS 2000, Picasso..."
            className={inputCls}
          />
        </label>
      </div>

      {/* Field Notes */}
      <label>
        <span className={labelCls}>Montaj Notu</span>
        <textarea
          value={fieldNotes}
          onChange={(e) => onFieldNotesChange(e.target.value)}
          rows={2}
          placeholder="Kurulum notu, özel istek, uyarı..."
          className={inputCls}
        />
      </label>
    </div>
  );
}

function base64ToBlob(base64: string, format: string): Blob {
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  const mimeType = `image/${format || "jpeg"}`;
  return new Blob([array], { type: mimeType });
}
