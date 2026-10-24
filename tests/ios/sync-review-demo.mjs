import { createPrivateKey, sign } from 'node:crypto';

// Only the existing PerdePRO draft may receive the user-provided review credential.
// Never log the private key, JWT, password, request body or API response body.
const APP_ID = '6815155998';
const VERSION = '1.0.20';
const ORIGIN = 'https://api.appstoreconnect.apple.com';
const email = process.env.MAESTRO_DEMO_EMAIL;
const password = process.env.MAESTRO_DEMO_PASSWORD;
const keyId = process.env.APP_STORE_CONNECT_KEY_IDENTIFIER;
const issuer = process.env.APP_STORE_CONNECT_ISSUER_ID;
const pem = process.env.APP_STORE_CONNECT_PRIVATE_KEY;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const editable = new Set(['PREPARE_FOR_SUBMISSION', 'REJECTED', 'METADATA_REJECTED', 'DEVELOPER_REJECTED']);
let phase = 'integration_configuration';
let httpStatus;
try {
  if (email !== 'test0924064036@gmail.com' || !password || !/^[A-Z0-9]{10}$/.test(keyId || '') || !uuid.test(issuer || '') || !pem) throw new Error();
  const key = createPrivateKey(pem);
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({ iss: issuer, iat: now - 30, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const authorization = `Bearer ${input}.${signature}`;
  async function request(path, method = 'GET', body) {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/v1/')) throw new Error();
    const response = await fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    httpStatus = response.status;
    if (!response.ok) throw new Error();
    return response;
  }
  phase = 'find_exact_editable_version';
  const query = new URLSearchParams({ 'filter[versionString]': VERSION, 'filter[platform]': 'IOS', 'fields[appStoreVersions]': 'platform,versionString,appStoreState,appVersionState', limit: '5' });
  const versions = await (await request(`/v1/apps/${APP_ID}/appStoreVersions?${query}`)).json();
  if (versions.data?.length !== 1) throw new Error();
  const version = versions.data[0];
  const attrs = version.attributes || {};
  if (version.type !== 'appStoreVersions' || !uuid.test(version.id) || attrs.platform !== 'IOS' || attrs.versionString !== VERSION || !editable.has(attrs.appVersionState || attrs.appStoreState)) throw new Error();
  phase = 'find_existing_review_detail';
  const relation = `/v1/appStoreVersions/${version.id}/appStoreReviewDetail?fields[appStoreReviewDetails]=demoAccountRequired`;
  const detail = (await (await request(relation)).json()).data;
  if (detail?.type !== 'appStoreReviewDetails' || !uuid.test(detail.id)) throw new Error();
  phase = 'update_dedicated_demo_credential';
  // Apple receives the same secure value accepted by the authentication preflight.
  // All contact information, notes, build selection and submission state stay intact.
  await request(`/v1/appStoreReviewDetails/${detail.id}`, 'PATCH', {
    data: { type: 'appStoreReviewDetails', id: detail.id, attributes: {
      demoAccountRequired: true, demoAccountName: email, demoAccountPassword: password,
    } },
  });
  phase = 'confirm_review_detail';
  const confirmed = (await (await request(relation)).json()).data;
  if (confirmed?.id !== detail.id || confirmed.attributes?.demoAccountRequired !== true) throw new Error();
  console.log('APP_REVIEW_DEMO_SYNC: dedicated credential saved for PerdePRO iOS 1.0.20.');
  console.log('APP_REVIEW_DEMO_SYNC: confirmed sign-in requirement; no credential was retrieved or printed.');
} catch {
  console.log('APP_REVIEW_DEMO_SYNC: failed at', phase);
  if (Number.isInteger(httpStatus)) console.log('APP_REVIEW_HTTP_STATUS:', httpStatus);
  process.exitCode = 1;
}
