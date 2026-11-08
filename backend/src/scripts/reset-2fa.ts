// npm run admin:reset-2fa -- someone@bytebuntech.com
// For a lost phone with no backup codes left: removes that admin's authenticator and backup
// codes, signs them out everywhere, and cancels any half-finished sign-in. On their next sign-in
// they get the QR setup again (after the email code). Both admins get a security alert.
import { createCliContext, runCli } from './cli-context';

runCli(async () => {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run admin:reset-2fa -- name@bytebuntech.com');
    return 2;
  }
  const { prisma, alerts } = createCliContext();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No account for ${email}.`);
      return 1;
    }
    const [twoFactors, , sessions, pending] = await prisma.$transaction([
      prisma.twoFactor.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
      // Open second-step challenges for this user ("2fa-..." rows hold the user id).
      prisma.verification.deleteMany({ where: { value: user.id, identifier: { startsWith: '2fa-' } } }),
    ]);
    await alerts.deliver('authenticator_reset', {
      email,
      ip: 'server command line',
      note: `Reset with the admin:reset-2fa command. ${sessions.count} session(s) signed out. A new authenticator must be set up on the next sign-in.`,
    });
    console.log(`Reset ${email}: authenticator removed (${twoFactors.count}), ${sessions.count} session(s) signed out, ${pending.count} pending sign-in(s) cancelled.`);
    console.log('They will set up a new authenticator (QR code) on their next sign-in.');
  } finally {
    await prisma.$disconnect();
  }
});
