import { supabase } from '../supabaseClient';
import { subscribeCapturedErrors } from './consoleCapture';

/** Send bounded, redacted diagnostics. A failed report never reports itself. */
export function redactDiagnostic(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/([?&](?:token|access_token|refresh_token|code|key|apikey|password)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .slice(0, 2000);
}

export function installRemoteErrorReporting(): () => void {
  const seen = new Map<string, number>();
  let inFlight = false;
  let lastAttempt = 0;
  return subscribeCapturedErrors((entry) => {
    if (entry.type === 'warn' || inFlight) return;
    const now = Date.now();
    const message = redactDiagnostic(entry.message);
    const route = entry.route.split('?')[0];
    const key = `${route}:${message}`;
    if (now - lastAttempt < 5000 || now - (seen.get(key) ?? 0) < 60000) return;
    lastAttempt = now;
    seen.set(key, now);
    if (seen.size > 100) seen.delete(seen.keys().next().value!);
    inFlight = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) return;
        // Server derives user/company, never trust a supplied tenant id.
        await supabase.rpc('report_client_error', {
          p_message: message,
          p_stack: redactDiagnostic(entry.detail ?? ''),
          p_path: route.slice(0, 250),
          p_version: String(import.meta.env.VITE_APP_VERSION || '1.0.1'),
        });
      } catch { /* retain the existing local support buffer */ }
      finally { inFlight = false; }
    })();
  });
}
