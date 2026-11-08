// npm run seed:admins
// Creates (or repairs) the admin accounts in src/auth/admins.ts. Safe to run any number of times.
// The API also creates missing admins by itself on every start (see src/auth/seed-admins.ts);
// this command additionally repairs existing accounts:
//  - existing admins: role admin and emailVerified are restored; the authenticator is left alone
//  - any password ("credential") account a user might have is deleted: sign-in is passwordless
import { ensureAdmins } from '../auth/seed-admins';
import { prepareDatabase } from '../database/startup';
import { createCliContext, runCli } from './cli-context';

runCli(async () => {
  await prepareDatabase(); // makes sure the database and tables exist (applies pending migrations)
  const { auth, prisma } = createCliContext();
  try {
    const results = await ensureAdmins(auth, prisma, { repair: true });
    for (const r of results) {
      const state = r.action === 'created' ? 'created ' : r.action === 'repaired' ? 'repaired' : 'ok      ';
      const note = r.action === 'created' ? '' : r.authenticator ? ' (authenticator set up)' : ' (authenticator not set up yet)';
      console.log(`${state} ${r.email}${note}`);
      if (r.removedPassword) console.log(`         removed a password account for ${r.email}`);
    }
    console.log(`Done: ${results.length} admins. Sign in at your LOGIN_PATH.`);
  } finally {
    await prisma.$disconnect();
  }
});
