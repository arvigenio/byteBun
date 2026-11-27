// Roles inside a client account, and what each may do. Checked by the API on every request
// (client-context.ts), not only hidden in the UI.
//
// Built-in roles (members.role, also Better Auth's organization roles):
//   owner  everything, including the plan and the account itself (one or more owners)
//   admin  everything except the plan and the account (can't touch owners)
//   staff  bookings, and the events they're assigned to (attendees, payments)
// Custom roles (booking.team_roles, made by owners and admins on the Team page): a name and a
// set of the permissions below. A member on a custom role has members.role = 'staff' and
// members.team_role_id set; their permissions are the custom role's.
//
// Events: owners and admins see every event. Everyone else sees only the events they're assigned
// to (booking.event_members), whatever their permissions (client-context.ts enforces it).
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const ROLES = ['owner', 'admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** Every permission, grouped for the Team page's role editor. */
export const PERMISSION_CATALOG = [
  {
    group: 'Bookings',
    items: [
      { key: 'bookings.view', label: 'See bookings', hint: 'Dashboard, calendar and the bookings list' },
      { key: 'bookings.manage', label: 'Manage bookings', hint: 'Book, reschedule, cancel, check in, mark no-shows' },
      { key: 'bookings.settings', label: 'Booking settings', hint: 'Opening hours, services, blocked dates, the booking page, export' },
    ],
  },
  {
    group: 'Events (only the events they’re assigned to)',
    items: [
      { key: 'events.view', label: 'See events', hint: 'The event, its attendees and exports' },
      { key: 'events.attendees', label: 'Manage attendees', hint: 'Register people, revoke, check in, claims' },
      { key: 'events.payments', label: 'Payments', hint: 'Verify proofs of payment, refunds, refund requests, collections' },
      { key: 'events.promotions', label: 'Promo codes and affiliates', hint: 'Discount codes and the event’s affiliates' },
      { key: 'events.scanners', label: 'Scanners', hint: 'Event scanners and claimables' },
      { key: 'events.manage', label: 'Edit events', hint: 'Create, edit, publish and delete events; payment channels, photos, the event team' },
    ],
  },
  {
    group: 'Team',
    items: [
      { key: 'team.view', label: 'See the team', hint: 'Who is on the team (inviting and roles: owners and admins)' },
    ],
  },
] as const;

// Owners and admins only (never in a custom role): managing the team (Better Auth's own invite
// checks only allow owners and admins), and the account itself (owners).
export type Permission = (typeof PERMISSION_CATALOG)[number]['items'][number]['key'] | 'team.manage' | 'account.manage';
/** What a custom role may hold. */
export const CUSTOM_PERMISSIONS: Permission[] = PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key));
export const ALL_PERMISSIONS: Permission[] = [...CUSTOM_PERMISSIONS, 'team.manage', 'account.manage'];
export const isPermission = (v: unknown): v is Permission => typeof v === 'string' && (ALL_PERMISSIONS as string[]).includes(v);

const BUILT_IN: Record<Role, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: [...CUSTOM_PERMISSIONS, 'team.manage'],
  staff: ['bookings.view', 'bookings.manage', 'team.view', 'events.view', 'events.attendees', 'events.payments'],
};

/** Who sees every event (everyone else: only the ones they're assigned to). */
export const seesAllEvents = (role: Role) => role === 'owner' || role === 'admin';

/** A member's permissions: the built-in role's, or (staff on a custom role) the custom role's. */
export function permissionsFor(role: Role, custom?: { permissions: string[] } | null): Permission[] {
  if (role === 'staff' && custom) return custom.permissions.filter((p): p is Permission => (CUSTOM_PERMISSIONS as string[]).includes(p));
  return [...BUILT_IN[role]];
}

/** Built-in roles only (no custom role): kept for code that only knows the role. */
export const can = (role: Role, permission: Permission) => BUILT_IN[role].includes(permission);

/** Every permission a built-in role has. */
export const permissionsOf = (role: Role) => [...BUILT_IN[role]];

// The same three roles for Better Auth's organization plugin (its own invite/member checks).
export const orgAccessControl = createAccessControl(defaultStatements);
export const orgRoles = {
  owner: orgAccessControl.newRole(ownerAc.statements),
  admin: orgAccessControl.newRole(adminAc.statements),
  staff: orgAccessControl.newRole(memberAc.statements),
};

/** @ClientRoute needs for the events routes (all in the Bookings app). */
export const EVENT_ROUTES = {
  view: { app: 'bookings', permission: 'events.view' },
  attendees: { app: 'bookings', permission: 'events.attendees' },
  payments: { app: 'bookings', permission: 'events.payments' },
  promotions: { app: 'bookings', permission: 'events.promotions' },
  scanners: { app: 'bookings', permission: 'events.scanners' },
  manage: { app: 'bookings', permission: 'events.manage' },
} as const;
