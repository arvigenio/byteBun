// Makes sure the admin accounts in admins.ts exist. Used in two places:
//  - every API start, after the migrations (main.ts): creates any admin that is MISSING, and
//    leaves existing accounts exactly as they are (authenticator, sessions, role)
//  - `npm run seed:admins` (repair: true): also restores role admin / verified email on existing
//    accounts and removes any password account
//
// New admins get emailVerified true, role admin and NO password. They are created through Better
// Auth's internal adapter (the admin plugin's createUser requires a password); that path still runs
// Better Auth's database hooks and ID generation, and it can't be reached over HTTP.
// To add or remove an admin for good, change admins.ts (a removed admin is not deleted, but no
// longer re-created; delete their row or ban them as well).
import type { PrismaClient } from '@prisma/client';
import { ADMINS } from './admins';
import type { Auth } from './auth';

export type SeedResult = { email: string; action: 'created' | 'repaired' | 'ok'; authenticator: boolean; removedPassword: boolean };

export async function ensureAdmins(auth: Auth, prisma: PrismaClient, { repair = false } = {}): Promise<SeedResult[]> {
  const ctx = await auth.$context;
  const results: SeedResult[] = [];

  for (const admin of ADMINS) {
    const email = admin.email.toLowerCase();
    const found = await ctx.internalAdapter.findUserByEmail(email);

    if (!found) {
      try {
        const user = await ctx.internalAdapter.createUser({ email, name: admin.name, emailVerified: true, role: 'admin' }, { method: 'admin' });
        if (!user) throw new Error(`Could not create ${email}`);
        // In case a hook set a default role.
        await prisma.user.updateMany({ where: { id: user.id, NOT: { role: 'admin' } }, data: { role: 'admin' } });
        results.push({ email, action: 'created', authenticator: false, removedPassword: false });
      } catch (err) {
        // Another API instance starting at the same moment created it first: fine.
        if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
          results.push({ email, action: 'ok', authenticator: false, removedPassword: false });
          continue;
        }
        throw err;
      }
      continue;
    }

    const userId = found.user.id;
    const authenticator = !!(found.user as { twoFactorEnabled?: boolean }).twoFactorEnabled;
    if (!repair) {
      results.push({ email, action: 'ok', authenticator, removedPassword: false });
      continue;
    }
    const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, emailVerified: true, name: true } });
    const needsRepair = current.role !== 'admin' || !current.emailVerified || !current.name;
    if (needsRepair) await prisma.user.update({ where: { id: userId }, data: { role: 'admin', emailVerified: true, name: current.name || admin.name } });
    const { count } = await prisma.account.deleteMany({ where: { userId, providerId: 'credential' } });
    results.push({ email, action: needsRepair ? 'repaired' : 'ok', authenticator, removedPassword: count > 0 });
  }
  return results;
}
