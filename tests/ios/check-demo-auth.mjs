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
    if (process.env.PERDEPRO_REVIEW_DEVICE_AUDIT === '1') {
      const membership = await client.from('company_members').select('company_id,is_active,companies(name,max_devices)').eq('user_id', data.user.id).eq('is_active', true);
      const rows = Array.isArray(membership.data) ? membership.data : [];
      const review = rows.find(row => String((Array.isArray(row.companies) ? row.companies[0] : row.companies)?.name || '').toLowerCase() === 'apple test');
      if (review) {
        const company = Array.isArray(review.companies) ? review.companies[0] : review.companies;
        const devices = await client.from('company_devices').select('id', { count: 'exact', head: true }).eq('company_id', review.company_id).eq('is_active', true);
        if (Number.isInteger(company.max_devices)) console.log('DEMO_DEVICE_LIMIT:', company.max_devices);
        if (!devices.error && Number.isInteger(devices.count)) console.log('DEMO_ACTIVE_DEVICE_COUNT:', devices.count);
        console.log('DEMO_DEVICE_AUDIT:', !devices.error && Number.isInteger(devices.count) && Number.isInteger(company.max_devices) ? (devices.count >= company.max_devices ? 'capacity_reached' : 'capacity_available') : 'capacity_not_resolved');
      } else {
        console.log('DEMO_DEVICE_AUDIT: review_membership_not_resolved');
      }
    }
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    console.log('AUTH_CHECK:', signOutError ? 'test_session_cleanup_failed' : 'test_session_closed');
    if (signOutError) process.exitCode = 1;
  }
} catch {
  console.log('AUTH_CHECK: request_could_not_complete');
  process.exitCode = 1;
}
