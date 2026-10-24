/**
 * team-invite — firma sahibinin ekip uyesini e-posta ile davet etmesi.
 *
 * Girdi : { company_id, email, modules: string[] }   (JWT'li; yalniz firma sahibi)
 * Cikti : { ok: true, existing_account: boolean, expires_at }  |  { ok: false, code, message }
 *
 * GUVENLIK
 *   - Davet kaydi (kota, modul listesi, sahip denetimi) SUNUCUDA create_team_invite RPC'si ile, CAGIRANIN
 *     JWT'si ile olusturulur; bu fonksiyon yetki karari vermez.
 *   - Service role yalniz Auth davet e-postasini gondermek icindir; e-posta, RPC'nin kaydettigi adrestir.
 *   - Davet linki /#/reset-password'a doner: kullanici KENDI sifresini belirler; e-posta eslesmesi
 *     accept_verified_invite icinde (INVITE_EMAIL_MISMATCH) zorunludur.
 * Gerekli ortam: APP_PUBLIC_URL (https://<web-adresi>), isteğe bağlı ALLOWED_ORIGINS.
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY Supabase tarafindan otomatik saglanir.
 * E-posta sablonu: Auth > Email Templates > "Invite user" (SMTP/Resend ayarlari Auth'tan gelir).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function cors(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOWED.length === 0 || ALLOWED.includes(origin) ? origin || '*' : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
}

const KNOWN_ERRORS: Record<string, string> = {
  OWNER_ONLY: 'Bu işlemi yalnızca firma sahibi yapabilir.',
  MEMBER_LIMIT: 'Kullanıcı sınırına ulaşıldı.',
  ALREADY_MEMBER: 'Bu e-posta zaten firmanızın kullanıcısı.',
  EMAIL_INVALID: 'Geçerli bir e-posta adresi girin.',
  MODULES_REQUIRED: 'En az bir modül seçin.',
  MODULE_INVALID: 'Geçersiz modül seçimi.',
  MODULE_NOT_IN_PLAN: 'Seçilen modül paketinizde yok.',
  COMPANY_UNAVAILABLE: 'Firma şu anda kullanıcı ekleyemiyor (lisans veya salt okunur mod).',
};

function mapError(message: string) {
  for (const code of Object.keys(KNOWN_ERRORS)) if (message.includes(code)) return { code, message: KNOWN_ERRORS[code] };
  return { code: 'UNKNOWN', message: 'Davet oluşturulamadı.' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, 405, { ok: false, code: 'METHOD', message: 'POST gerekli.' });

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return reply(req, 401, { ok: false, code: 'AUTH', message: 'Oturum gerekli.' });

  let payload: { company_id?: string; email?: string; modules?: string[] };
  try { payload = await req.json(); } catch { return reply(req, 400, { ok: false, code: 'BODY', message: 'Geçersiz istek.' }); }
  const { company_id, email, modules } = payload;
  if (!company_id || !email || !Array.isArray(modules)) return reply(req, 400, { ok: false, code: 'BODY', message: 'Eksik bilgi.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });

  const { data, error } = await userClient.rpc('create_team_invite', { p_company_id: company_id, p_email: email, p_modules: modules });
  if (error) {
    const mapped = mapError(error.message ?? '');
    return reply(req, mapped.code === 'UNKNOWN' ? 500 : 400, { ok: false, ...mapped });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) return reply(req, 500, { ok: false, code: 'UNKNOWN', message: 'Davet oluşturulamadı.' });

  const appUrl = (Deno.env.get('APP_PUBLIC_URL') ?? '').replace(/\/+$/, '');
  if (!appUrl) return reply(req, 500, { ok: false, code: 'CONFIG', message: 'Uygulama adresi ayarlı değil.' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const cleanEmail = email.trim().toLowerCase();
  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
    redirectTo: `${appUrl}/#/reset-password`,
    data: { perdepro_invite: { token: row.token } },
  });

  if (mailError) {
    // Hesap zaten varsa e-posta gonderilmez; davet kaydi kalir ve kullanici giriş yapinca firmaya katilir.
    if (/already (been )?registered|already exists/i.test(mailError.message)) {
      return reply(req, 200, { ok: true, existing_account: true, expires_at: row.expires_at });
    }
    return reply(req, 502, { ok: false, code: 'MAIL', message: 'Davet kaydı oluşturuldu ama e-posta gönderilemedi. Tekrar deneyin.' });
  }
  return reply(req, 200, { ok: true, existing_account: false, expires_at: row.expires_at });
});
