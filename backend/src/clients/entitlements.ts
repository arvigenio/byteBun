// What an organization may use: its plan plus add-ons, resolved into billing.entitlements rows.
// Every client API request checks these (client-context.ts) before the role check.
//
// Keys:
//   app:<app>               the app is part of the plan (bookings, ...)
//   feature:<feature>       a feature flag
//   limit:<name>            a number; no row = unlimited
//
// Features: bookings.unlimited (no monthly cap, data kept), bookings.custom_reminders (up to 3,
// down to 1 hour before), bookings.whatsapp (WhatsApp to customers), bookings.whatsapp_alerts
// (WhatsApp alerts to the owner), bookings.full_branding (all colors, no "Powered by" footer).
// Limits: bookings.monthly (bookings created per month, cancelled ones count),
// bookings.services (active services), bookings.staff (members), bookings.retention_days,
// events.participants (per event; bigger events: vouchers, booking/events.ts), events.per_day.
import type { ClientsDb, ClientsTx } from './clients-db';

export interface AppInfo {
  key: string;
  name: string;
  description: string;
  /** false: shown as "coming soon". */
  live: boolean;
}

/** Every client app. A new app = a new entry here + its own schema in clients_db. */
export const APP_CATALOG: readonly AppInfo[] = [
  { key: 'bookings', name: 'Bookings', description: 'Online booking page, reminders and your schedule.', live: true },
  { key: 'invoices', name: 'Invoices', description: 'Quotes, invoices and payments.', live: false },
  { key: 'surveys', name: 'Surveys', description: 'Feedback and review requests.', live: false },
  { key: 'forms', name: 'Forms', description: 'Intake and consent forms.', live: false },
];

export interface Entitlements {
  planCode: string;
  planName: string;
  apps: string[];
  features: string[];
  limits: Record<string, number>;
  /** Packaged plan: lands on the client portal. */
  portal: boolean;
}

export const hasApp = (e: Entitlements, app: string) => e.apps.includes(app);
export const hasFeature = (e: Entitlements, feature: string) => e.features.includes(feature);
export const limitOf = (e: Entitlements, name: string): number | null => (name in e.limits ? e.limits[name] : null);

/** Where the client lands after signing in: straight into their only app, or the portal. */
export function landingOf(e: Entitlements): 'portal' | 'bookings' {
  const live = e.apps.filter((a) => APP_CATALOG.some((c) => c.key === a && c.live));
  return e.portal || live.length >= 2 ? 'portal' : 'bookings';
}

type Db = ClientsDb | ClientsTx;

const asLimits = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  return out;
};

/** Rebuilds billing.entitlements for one organization from its subscription (plan + add-ons). */
export async function syncEntitlements(db: Db, organizationId: string) {
  const sub = await db.subscription.findUnique({ where: { organizationId }, include: { plan: true, addons: { include: { addon: true } } } });
  const rows = new Map<string, number | null>();
  if (sub && sub.status !== 'cancelled') {
    for (const a of sub.plan.apps) rows.set(`app:${a}`, null);
    for (const f of sub.plan.features) rows.set(`feature:${f}`, null);
    for (const [k, n] of Object.entries(asLimits(sub.plan.limits))) rows.set(`limit:${k}`, n);
    for (const { addon } of sub.addons) {
      for (const a of addon.apps) rows.set(`app:${a}`, null);
      for (const f of addon.features) rows.set(`feature:${f}`, null);
      // An add-on raises a limit (or removes it with a negative number = unlimited).
      for (const [k, n] of Object.entries(asLimits(addon.limits))) {
        if (n < 0) rows.delete(`limit:${k}`);
        else rows.set(`limit:${k}`, Math.max(n, rows.get(`limit:${k}`) ?? 0));
      }
    }
    // Unlimited bookings removes the monthly cap and the data deletion.
    if (rows.has('feature:bookings.unlimited')) {
      rows.delete('limit:bookings.monthly');
      rows.delete('limit:bookings.retention_days');
    }
  }
  await db.entitlement.deleteMany({ where: { organizationId } });
  if (rows.size) {
    await db.entitlement.createMany({ data: [...rows].map(([key, value]) => ({ organizationId, key, value })) });
  }
}

export async function loadEntitlements(db: Db, organizationId: string): Promise<Entitlements> {
  const [rows, sub] = await Promise.all([
    db.entitlement.findMany({ where: { organizationId } }),
    db.subscription.findUnique({ where: { organizationId }, include: { plan: { select: { name: true, portal: true } } } }),
  ]);
  const e: Entitlements = { planCode: sub?.planCode ?? 'none', planName: sub?.plan.name ?? 'No plan', apps: [], features: [], limits: {}, portal: !!sub?.plan.portal };
  for (const r of rows) {
    const [kind, name] = [r.key.slice(0, r.key.indexOf(':')), r.key.slice(r.key.indexOf(':') + 1)];
    if (kind === 'app') e.apps.push(name);
    else if (kind === 'feature') e.features.push(name);
    else if (kind === 'limit' && r.value !== null) e.limits[name] = r.value;
  }
  return e;
}

/** A new client account starts on the free plan (Bookings freemium). */
export async function startPlan(db: ClientsTx, organizationId: string, planCode: string, actor: string) {
  await db.subscription.create({ data: { organizationId, planCode } });
  await db.billingEvent.create({ data: { organizationId, type: 'plan_started', data: { plan: planCode }, actor } });
  await syncEntitlements(db, organizationId);
}
