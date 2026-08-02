import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Hook to track user activity:
 * - Record login on first load with valid session (per-tab, sessionStorage-based)
 * - Send heartbeat every 5 minutes while user is active
 * - Log page views and errors via RPC
 *
 * Safe: silently fails if RPC calls fail, doesn't break user flow
 */
function getCurrentPage(): string {
  return window.location.hash || window.location.pathname || '/';
}

export function useActivityTracking() {
  const lastHeartbeatRef = useRef<number>(0);

  useEffect(() => {
    let mounted = true;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    async function recordLogin() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const loginStorageKey = `activity_login_recorded:${user.id}`;

        // Skip if already recorded in this tab session
        if (sessionStorage.getItem(loginStorageKey)) {
          return;
        }

        // Call record_login RPC (handles user_activity insert + profiles update)
        try {
          await supabase.rpc('record_login');
          // Only set key if RPC succeeded
          sessionStorage.setItem(loginStorageKey, '1');
        } catch {
          // Silently fail - don't set key so we can retry on next mount
        }
      } catch (error) {
        console.error('Failed to record login:', error);
      }
    }

    async function recordHeartbeat() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Only record if 5+ minutes have passed since last heartbeat
        const now = Date.now();
        if (lastHeartbeatRef.current && now - lastHeartbeatRef.current < 5 * 60 * 1000) {
          return;
        }

        lastHeartbeatRef.current = now;

        try {
          await supabase.rpc('record_user_activity', {
            p_activity_type: 'heartbeat',
            p_page: getCurrentPage(),
          });
        } catch {
          // Silently fail
        }
      } catch (error) {
        console.error('Failed to record heartbeat:', error);
      }
    }

    async function initializeTracking() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !mounted) return;

        // Record login (sessionStorage prevents duplicate in same tab)
        await recordLogin();

        // Set up heartbeat (every 5 minutes)
        heartbeatTimer = setInterval(recordHeartbeat, 5 * 60 * 1000);

        // Also record heartbeat on user interaction (mouse, keyboard, scroll)
        const handleActivity = () => {
          recordHeartbeat().catch(() => {
            // Silently fail
          });
        };

        window.addEventListener('mousemove', handleActivity, { once: true });
        window.addEventListener('keydown', handleActivity, { once: true });
        window.addEventListener('scroll', handleActivity, { once: true });

        return () => {
          window.removeEventListener('mousemove', handleActivity);
          window.removeEventListener('keydown', handleActivity);
          window.removeEventListener('scroll', handleActivity);
        };
      } catch (error) {
        console.error('Failed to initialize activity tracking:', error);
      }
    }

    void initializeTracking();

    return () => {
      mounted = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
  }, []);
}
