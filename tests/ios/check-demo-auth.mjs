import { createClient } from '@supabase/supabase-js';

// Use only the dedicated review account. Never print credentials, tokens or raw errors.
const target = 'https://ffhmzlcsgsgjonqqhgqq.supabase.co';
const url = process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URI;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.MAESTRO_DEMO_EMAIL;
const password = process.env.MAESTRO_DEMO_PASSWORD;
if (url?.replace(/\/$/, '') !== target || !key || email !== 'test0924064036@gmail.com' || !password) {
  console.log('AUTH_CHECK: invalid_or_missing_review_configuration');
  process.exit(1);
}
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
});
const categories = new Set(['invalid_credentials', 'email_not_confirmed', 'user_banned', 'over_request_rate_limit', 'over_email_send_rate_limit', 'captcha_failed', 'unexpected_failure']);
try {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    const message = String(error.message || '').toLowerCase();
    const category = categories.has(error.code) ? error.code
      : /invalid api key|invalid jwt|no api key/.test(message) ? 'invalid_api_key'
      : /fetch|network|timeout|abort/.test(message) ? 'network_failure'
      : /invalid login credentials/.test(message) ? 'invalid_credentials'
      : 'unclassified_auth_error';
    console.log('AUTH_CHECK:', category);
    if (Number.isInteger(error.status)) console.log('AUTH_HTTP_STATUS:', error.status);
    process.exitCode = 1;
  } else if (!data.session || data.user?.email?.toLowerCase() !== email) {
    console.log('AUTH_CHECK: unexpected_identity_or_missing_session');
    process.exitCode = 1;
  } else {
    console.log('AUTH_CHECK: dedicated_demo_credentials_accepted');
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    console.log('AUTH_CHECK:', signOutError ? 'test_session_cleanup_failed' : 'test_session_closed');
    if (signOutError) process.exitCode = 1;
  }
} catch {
  console.log('AUTH_CHECK: request_could_not_complete');
  process.exitCode = 1;
}
