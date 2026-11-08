// The admin Security page: who am I, active sessions (sign out one / all others), backup codes
// remaining, and regenerating backup codes (needs a current authenticator code).
// Under /api/admin, so AdminSessionGuard has already checked the session.
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import type { Auth } from '../auth/auth';
import { AUTH, SECURITY_ALERTS } from '../auth/auth.module';
import { readRequestMeta } from '../auth/request-meta';
import type { SecurityAlerts } from '../auth/security-alerts';
import { hitCounter } from '../auth/security-counter';
import { ApiError } from '../common/api-error';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { PrismaService } from '../database/prisma.service';

const codeSchema = yup.object({
  code: yup
    .string()
    .trim()
    .required('Enter the 6-digit code from your authenticator app.')
    .matches(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});

const REGENERATE_LIMIT = { max: 5, windowMs: 5 * 60_000 };

@Controller('admin')
export class AdminSecurityController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(SECURITY_ALERTS) private readonly alerts: SecurityAlerts,
    private readonly prisma: PrismaService,
  ) {}

  // GET /api/admin/me -> the signed-in admin (the admin app calls this to check access)
  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() req: Request) {
    const { user } = req.admin!;
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }

  // GET /api/admin/security
  @Get('security')
  @Header('Cache-Control', 'no-store')
  async overview(@Req() req: Request) {
    const { user, session } = req.admin!;
    const sessions = await this.prisma.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, ipAddress: true, userAgent: true, secondFactorVerified: true },
    });
    const { backupCodes } = await this.auth.api.viewBackupCodes({ body: { userId: user.id } });
    return {
      user: { name: user.name, email: user.email },
      sessions: sessions.map((s) => ({
        ...s,
        current: s.id === session.id,
        // false = stopped after the email code (never finished the authenticator step)
        fullySignedIn: s.secondFactorVerified === true,
      })),
      backupCodesRemaining: backupCodes.length,
    };
  }

  // POST /api/admin/security/sessions/:id/revoke -> sign out that device
  @Post('security/sessions/:id/revoke')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Param('id') id: string) {
    const { user } = req.admin!;
    const { count } = await this.prisma.session.deleteMany({ where: { id, userId: user.id } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That session no longer exists.' });
    return { ok: true, signedOutCurrent: id === req.admin!.session.id };
  }

  // POST /api/admin/security/sessions/revoke-others -> sign out all other devices
  @Post('security/sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@Req() req: Request) {
    const { user, session } = req.admin!;
    const { count } = await this.prisma.session.deleteMany({ where: { userId: user.id, id: { not: session.id } } });
    return { ok: true, signedOut: count };
  }

  // POST /api/admin/security/backup-codes { code } -> { backupCodes } (shown once; old codes stop working)
  @Post('security/backup-codes')
  @HttpCode(200)
  async regenerate(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new YupValidationPipe(codeSchema)) body: { code: string }) {
    const { user } = req.admin!;
    const hit = await hitCounter(this.prisma as unknown as PrismaClient, `regen-backup:${user.id}`, REGENERATE_LIMIT.windowMs);
    if (hit.count > REGENERATE_LIMIT.max) {
      throw new ApiError(429, { error: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    const headers = fromNodeHeaders(req.headers);
    const meta = readRequestMeta(headers);
    try {
      // With a fully signed-in session this only checks the code; it creates no session.
      await this.auth.api.verifyTOTP({ headers, body: { code: body.code } });
    } catch {
      this.alerts.notify('wrong_authenticator_code', { email: user.email, ...meta, note: 'While regenerating backup codes' });
      throw new ApiError(400, { error: 'invalid_code', message: 'That code is not right. Check your authenticator app and try again.', fields: { code: 'That code is not right.' } });
    }
    const { backupCodes } = await this.auth.api.generateBackupCodes({ headers, body: {} });
    this.alerts.notify('backup_codes_regenerated', { email: user.email, ...meta });
    res.setHeader('Cache-Control', 'no-store');
    return { backupCodes };
  }
}
