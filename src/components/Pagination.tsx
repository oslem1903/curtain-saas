interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    isLoading?: boolean;
}

export function Pagination({
    currentPage,
    totalPages,
    onPageChange,
    isLoading = false,
}: PaginationProps) {
    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 0 || isLoading}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Önceki
            </button>

            <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                Sayfa {currentPage + 1} / {totalPages}
            </div>

            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages - 1 || isLoading}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Sonraki
            </button>
        </div>
    );
}
