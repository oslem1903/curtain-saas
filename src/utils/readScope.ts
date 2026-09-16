/** A bounded, cancellable group of reads. Never use this to retry writes. */
export function createReadScope(timeoutMs = 30000) {
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    let cancelled = false;
    return {
        get cancelled() { return cancelled; },
        cancel() { cancelled = true; controller.abort(); },
        dispose() { controller.abort(); },
        read<T>(query: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> }): Promise<T> {
            return new Promise((resolve, reject) => {
                const signal = controller.signal;
                const aborted = () => reject(new Error("Yükleme iptal edildi."));
                if (signal.aborted) { aborted(); return; }
                const remaining = deadline - Date.now();
                if (remaining <= 0) {
                    reject(new Error("Sipariş yüklemesi zaman aşımına uğradı. Bağlantınızı kontrol edip yeniden deneyin."));
                    controller.abort();
                    return;
                }
                const timeoutRef: { id?: ReturnType<typeof setTimeout> } = {};
                const cleanup = () => { if (timeoutRef.id !== undefined) clearTimeout(timeoutRef.id); signal.removeEventListener("abort", onAbort); };
                const onAbort = () => { cleanup(); aborted(); };
                signal.addEventListener("abort", onAbort, { once: true });
                timeoutRef.id = setTimeout(() => {
                    cleanup();
                    reject(new Error("Sipariş yüklemesi zaman aşımına uğradı. Bağlantınızı kontrol edip yeniden deneyin."));
                    controller.abort();
                }, remaining);
                try {
                    const request = query.abortSignal ? query.abortSignal(signal) : query;
                    Promise.resolve(request).then(
                        value => { cleanup(); if (signal.aborted) aborted(); else resolve(value); },
                        error => { cleanup(); reject(error); },
                    );
                } catch (error) { cleanup(); reject(error); }
            });
        },
    };
}
