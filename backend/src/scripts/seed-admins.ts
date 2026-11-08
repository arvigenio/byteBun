// npm run seed:admins
// Creates (or repairs) the admin accounts in src/auth/admins.ts. Safe to run any number of times.
//  - new admins: created with emailVerified true, role admin, and NO password
//  - existing admins: role admin and emailVerified are restored; the authenticator is left alone
//  - any password ("credential") account a user might have is deleted: sign-in is passwordless
//
// Uses Better Auth's internal adapter (auth.$context.internalAdapter.createUser), because the
// admin plugin's createUser API requires a password. That path still runs Better Auth's own
// database hooks and ID generation, and it can't be reached over HTTP.
import { ADMINS } from '../auth/admins';
import { prepareDatabase } from '../database/startup';
import { createCliContext, runCli } from './cli-context';

runCli(async () => {
  await prepareDatabase(); // makes sure the database and tables exist (applies pending migrations)
  const { auth, prisma } = createCliContext();
  const ctx = await auth.$context;
  try {
    for (const admin of ADMINS) {
      const email = admin.email.toLowerCase();
      const found = await ctx.internalAdapter.findUserByEmail(email);
      let userId: string;
      if (!found) {
        const user = await ctx.internalAdapter.createUser({ email, name: admin.name, emailVerified: true, role: 'admin' }, { method: 'admin' });
        if (!user) throw new Error(`Could not create ${email}`);
        userId = user.id;
        console.log(`created  ${email}`);
      } else {
        userId = found.user.id;
        await prisma.user.update({ where: { id: userId }, data: { role: 'admin', emailVerified: true, name: found.user.name || admin.name } });
        console.log(`ok       ${email} (already existed${(found.user as { twoFactorEnabled?: boolean }).twoFactorEnabled ? ', authenticator set up' : ', authenticator not set up yet'})`);
      }
      // The role is checked after creating too, in case a hook set a default.
      const check = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
      if (check.role !== 'admin') await prisma.user.update({ where: { id: userId }, data: { role: 'admin' } });
      const { count } = await prisma.account.deleteMany({ where: { userId, providerId: 'credential' } });
      if (count) console.log(`         removed a password account for ${email}`);
    }
    console.log(`Done: ${ADMINS.length} admins. Sign in at your LOGIN_PATH.`);
  } finally {
    await prisma.$disconnect();
  }
});
