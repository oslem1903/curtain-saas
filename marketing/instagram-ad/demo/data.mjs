// Tamamen örnek (kurgusal) veri: firma "PerdePRO Demo", müşteriler "Örnek Müşteri A/B/C".
import { COMPANY_ID, USER_ID } from './harness.mjs';
const now = new Date();
const at = (days, h = 10, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
const day = (days) => at(days).slice(0, 10);
const cid = n => `00000000-0000-4000-8000-00000000d0${n}`;
export const company = {
  id: COMPANY_ID, name: 'PerdePRO Demo', is_active: true, read_only: false, plan_status: 'active', subscription_plan: 'pro', package_code: 'pro',
  max_users: 10, max_devices: 10, branch_limit: 1, trial_end: null, trial_ends_at: null, is_pilot: false, pilot_until: null,
  onboarding_completed: true, license_expires_at: '2030-01-01T00:00:00Z', phone: null, email: null, address: null,
  enabled_modules: ['admin','measurements','orders','customers','appointments','suppliers','installation','collections','accounting','staff','catalogs','reports','expenses','profit'],
};
const cust = [
  { id: cid(1), name: 'Örnek Müşteri A', phone: '0500 000 00 01', address: 'Örnek Mah. Demo Sk. No:1', email: null },
  { id: cid(2), name: 'Örnek Müşteri B', phone: '0500 000 00 02', address: 'Örnek Mah. Demo Sk. No:2', email: null },
  { id: cid(3), name: 'Örnek Müşteri C', phone: '0500 000 00 03', address: 'Örnek Mah. Demo Sk. No:3', email: null },
].map(c => ({ ...c, company_id: COMPANY_ID, created_at: at(-20) }));
const cj = i => ({ name: cust[i].name, phone: cust[i].phone });
const mrow = (i, ci, grp, room, type, model, color, w, h, area, qty, price, orderId = null, status = 'done', dayOff = -2) => ({
  id: `m${i}`, created_at: at(dayOff, 11), status, order_id: orderId, customer_id: cust[ci].id, address: cust[ci].address, room_name: room, product_type: type,
  model_name: model, color_name: color, width_cm: w, height_cm: h, rounded_width_cm: w, rounded_height_cm: h, estimated_area_m2: area, quantity: qty,
  unit_price: price, supplier_id: null, supplier_unit_cost: 0, note: `[Grup: ${grp}]`, customer: cj(ci), company_id: COMPANY_ID, type: 'measurement',
  title: 'Ölçü', start_at: at(dayOff, 11), scheduled_at: at(dayOff, 11), done: true,
});
const meas = [
  mrow(1, 0, 'ga', 'Salon', 'tul', 'Düz Tül', 'Krem', 320, 250, 8.0, 1, 450),
  mrow(2, 0, 'ga', 'Salon', 'fon', 'Keten Fon', 'Bej', 160, 250, 4.0, 2, 650),
  mrow(3, 1, 'gb', 'Yatak Odası', 'stor', 'Stor Perde', 'Beyaz', 140, 200, 2.8, 1, 520, 'o1', 'done', -4),
  mrow(4, 2, 'gc', 'Çocuk Odası', 'zebra', 'Zebra Perde', 'Gri', 120, 180, 2.16, 1, 480, null, 'done', -1),
];
const ord = (i, ci, status, total, paid, due, items, dayOff) => ({
  id: `o${i}`, created_at: at(dayOff, 9), status, note: null, customer_id: cust[ci].id, company_id: COMPANY_ID, assigned_to: null, assigned_user_id: null,
  created_by: USER_ID, appointment_id: null, total_amount: total, paid_amount: paid, remaining_amount: total - paid, payment_due_date: due,
  customer: cj(ci), order_items: items.map(x => ({ line_total: x })), deleted_at: null,
});
const orders = [
  ord(1, 1, 'approved', 1456, 500, day(0), [1456], -4),
  ord(2, 0, 'production', 5600, 2000, day(5), [3600, 2000], -9),
  ord(3, 2, 'montaj_planlandi', 2850, 1000, day(-3), [2850], -14),
  ord(4, 1, 'completed', 3200, 3200, null, [3200], -25),
];
const pay = (i, oi, amt, method, dayOff) => ({ id: `p${i}`, order_id: orders[oi].id, amount: amt, method, note: null, payment_date: at(dayOff), reverses_payment_id: null, company_id: COMPANY_ID });
const apt = (i, ci, type, title, start, status = 'planned') => ({
  id: `a${i}`, customer_id: cust[ci].id, order_id: null, type, title, start_at: start, scheduled_at: start, status, done: status === 'done', done_at: null,
  note: null, address: cust[ci].address, remind_before_minutes: 30, customer: cj(ci), company_id: COMPANY_ID, assigned_to: null,
});
export const db = {
  company_members: [{ company_id: COMPANY_ID, role: 'admin', is_active: true, created_at: at(-60), companies: company, user_id: USER_ID }],
  profiles: [{ user_id: USER_ID, role: 'admin', is_active: true, company_id: COMPANY_ID, full_name: 'Demo Kullanıcı' }],
  companies: [company],
  customers: cust,
  appointments: [
    ...meas,
    apt(1, 0, 'measurement', 'Ölçü Randevusu', at(0, 14, 0)),
    apt(2, 1, 'installation', 'Montaj Randevusu', at(0, 16, 30)),
    apt(3, 2, 'measurement', 'Ölçü Randevusu', at(1, 11, 0)),
  ],
  orders,
  payments: [pay(1, 0, 500, 'cash', -4), pay(2, 1, 2000, 'transfer', -8), pay(3, 2, 1000, 'cash', -12), pay(4, 3, 3200, 'card', -24)],
  order_payment_plans: [],
  products: [
    { id: 'pr1', name: 'Düz Tül', category: 'tul', unit_price: 450, cost_price: 250, is_active: true, company_id: COMPANY_ID },
    { id: 'pr2', name: 'Keten Fon', category: 'fon', unit_price: 650, cost_price: 400, is_active: true, company_id: COMPANY_ID },
    { id: 'pr3', name: 'Stor Perde', category: 'stor', unit_price: 520, cost_price: 300, is_active: true, company_id: COMPANY_ID },
    { id: 'pr4', name: 'Zebra Perde', category: 'zebra', unit_price: 480, cost_price: 280, is_active: true, company_id: COMPANY_ID },
  ],
  suppliers: [], supplier_product_prices: [], employees: [], notifications: [], app_updates: [], installation_jobs: [], supplier_transactions: [],
  support_tickets: [], income: [], order_items: [], app_devices: [],
};
export const rpc = {
  get_current_auth_context: [{ role: 'admin', is_active: true }],
  company_subscription_access_allowed: true,
  company_subscription_access_snapshot: [{ allowed: true }],
  register_device_and_touch_login: 'ok',
  record_login: null,
};
