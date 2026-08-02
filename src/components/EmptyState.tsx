import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaOnClick?: () => void;
  ctaHref?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaOnClick,
  ctaHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20">
      <Icon className="w-16 h-16 text-slate-300 dark:text-slate-600 mb-4" />
      <h3 className="text-lg font-black text-slate-900 dark:text-white text-center mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-slate-600 dark:text-slate-400 text-center max-w-sm mb-6">
          {description}
        </p>
      )}
      {ctaLabel && (ctaOnClick || ctaHref) && (
        <>
          {ctaHref ? (
            <a
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-black text-white hover:bg-primary-700 transition-colors shadow-sm"
            >
              {ctaLabel}
            </a>
          ) : (
            <button
              onClick={ctaOnClick}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-black text-white hover:bg-primary-700 transition-colors shadow-sm"
            >
              {ctaLabel}
            </button>
          )}
        </>
      )}
    </div>
  );
}
