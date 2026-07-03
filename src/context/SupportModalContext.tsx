import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface SupportModalContextType {
  isOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  formData: {
    title: string;
    description: string;
    category: string;
    priority: string;
    attachment: File | null;
    attachmentPreview: string;
  };
  setFormData: (data: Partial<SupportModalContextType['formData']>) => void;
  resetForm: () => void;
}

const SupportModalContext = createContext<SupportModalContextType | undefined>(undefined);

export function SupportModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormDataState] = useState({
    title: "",
    description: "",
    category: "other",
    priority: "medium",
    attachment: null as File | null,
    attachmentPreview: "",
  });

  const openModal = () => setIsOpen(true);
  const closeModal = () => setIsOpen(false);

  const setFormData = (data: Partial<typeof formData>) => {
    setFormDataState((prev) => ({ ...prev, ...data }));
  };

  const resetForm = () => {
    if (formData.attachmentPreview) {
      URL.revokeObjectURL(formData.attachmentPreview);
    }
    setFormDataState({
      title: "",
      description: "",
      category: "other",
      priority: "medium",
      attachment: null,
      attachmentPreview: "",
    });
  };

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- deps kasıtlı olarak [isOpen, formData]; resetForm/setFormData eklemek memoizasyon sıklığını (davranışı) değiştirir, bu görevin kapsamı dışında.
  const contextValue = useMemo(() => ({
    isOpen,
    openModal,
    closeModal,
    formData,
    setFormData,
    resetForm,
  }), [isOpen, formData]);

  return (
    <SupportModalContext.Provider value={contextValue}>
      {children}
    </SupportModalContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook'u Provider ile aynı dosyada; yalnız Fast Refresh (HMR) sıcak-yenilemeyi etkiler, çalışma zamanı davranışı değişmez. Dosya bölmek context/hook yapısını değiştirir.
export function useSupportModal() {
  const context = useContext(SupportModalContext);
  if (context === undefined) {
    throw new Error("useSupportModal must be used within SupportModalProvider");
  }
  return context;
}
