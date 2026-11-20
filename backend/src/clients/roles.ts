// Roles inside a client account, and what each may do. Checked by the API on every request
// (client-context.ts), not only hidden in the UI.
//
//   owner  everything, including the plan and the account itself (one or more owners)
//   admin  settings, services, booking page, team (but can't touch owners)
//   staff  sees and manages bookings
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const ROLES = ['owner', 'admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const PERMISSIONS = {
  'bookings.view': ['owner', 'admin', 'staff'],
  'bookings.manage': ['owner', 'admin', 'staff'],
  'bookings.settings': ['owner', 'admin'],
  'team.view': ['owner', 'admin', 'staff'],
  'team.manage': ['owner', 'admin'],
  'account.manage': ['owner'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role, permission: Permission) => (PERMISSIONS[permission] as readonly Role[]).includes(role);

/** Every permission a role has (sent to the UI so it can hide what the API would refuse anyway). */
export const permissionsOf = (role: Role) => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));

// The same three roles for Better Auth's organization plugin (its own invite/member checks).
export const orgAccessControl = createAccessControl(defaultStatements);
export const orgRoles = {
  owner: orgAccessControl.newRole(ownerAc.statements),
  admin: orgAccessControl.newRole(adminAc.statements),
  staff: orgAccessControl.newRole(memberAc.statements),
};
