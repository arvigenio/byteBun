// HTTP routes for Byte Bun's affiliate program and plan payments (affiliates.service.ts).
//
// Admin site (/api/admin: fully signed-in Byte Bun admins only):
//   GET    /api/admin/affiliates?sort=referrals|earnings|newest   ranked list
//   POST   /api/admin/affiliates                 { firstName, lastName, email, phone, discountPercent, commissionPercent, promoCode?, note? }
//   GET    /api/admin/affiliates/:id
//   PATCH  /api/admin/affiliates/:id             partial, + status active|disabled
//   POST   /api/admin/affiliates/:id/resend
//   DELETE /api/admin/affiliates/:id
//   POST   /api/admin/affiliates/:id/payout      { commissionIds?, reference? }  earned -> paid
//   GET    /api/admin/plan-payments?status=review|approved|rejected|cancelled|all
//   GET    /api/admin/plan-payments/:id/proof
//   POST   /api/admin/plan-payments/:id/approve  { note? }
//   POST   /api/admin/plan-payments/:id/reject   { reason }
//   GET|POST /api/admin/plan-payment-channels, PATCH|DELETE /api/admin/plan-payment-channels/:id (multipart: file = QR)
// The business (Bookings Plan page):
//   GET  /api/client/billing/checkout
//   POST /api/client/billing/promo               { planCode, cycle, promoCode }   a quote
//   POST /api/client/billing/payments            multipart: planCode, cycle, promoCode?, reference?, file
//   POST /api/client/billing/payments/:id/cancel
// Public:
//   GET  /api/public/plan-files/qr/:file         Byte Bun's payment QR images
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { UPLOAD_OPTIONS, type UploadedFileLike } from '../booking/payment-files';
import { ClientRoute, type ClientContext } from '../client-context';
import { normCode } from './affiliate-common';
import { AffiliatesService, type AffiliateSort } from './affiliates.service';

const actor = (req: Request) => ({ email: req.admin!.user.email });
const ctx = (req: Request) => req.client as ClientContext;
const OWNER = { permission: 'account.manage' } as const;
const MEMBER = {} as const;

const optional = (max: number) =>
  yup
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .nullable()
    .transform((v) => (v === '' ? null : v));
const name = () => yup.string().trim().min(1, 'Required.').max(60, 'At most 60 characters.');
const phone = () => yup.string().trim().matches(/^[0-9+()\-.\s]{5,40}$/, 'Please enter a phone number.');
const percent = (max: number) => yup.number().typeError('Please enter a number.').min(0, 'At least 0.').max(max, `At most ${max}.`);
const promoCode = () =>
  yup
    .string()
    .trim()
    .transform((v) => (typeof v === 'string' ? normCode(v) : v))
    .nullable()
    .transform((v) => (v === '' ? null : v))
    .matches(/^[A-Z0-9]{4,20}$/, { message: 'Use 4-20 letters and numbers.', excludeEmptyString: true });

const affiliateSchema = yup.object({
  firstName: name().required('Required.'),
  lastName: name().required('Required.'),
  email: yup.string().trim().lowercase().email('Please enter a valid email.').max(254).required('Required.'),
  phone: phone().required('Required.'),
  discountPercent: percent(99).required('Required.'),
  commissionPercent: percent(100).required('Required.'),
  promoCode: promoCode(),
  note: optional(500),
});
const affiliatePatchSchema = yup.object({
  firstName: name(),
  lastName: name(),
  email: yup.string().trim().lowercase().email('Please enter a valid email.').max(254),
  phone: phone(),
  discountPercent: percent(99),
  commissionPercent: percent(100),
  promoCode: promoCode(),
  note: optional(500),
  status: yup.string().oneOf(['active', 'disabled']),
});
const payoutSchema = yup.object({ commissionIds: yup.array(yup.number().integer().required()).max(500).nullable(), reference: optional(120) });
const approveSchema = yup.object({ note: optional(500) });
const rejectSchema = yup.object({ reason: yup.string().trim().min(3, 'Please give a reason.').max(500).required('Please give a reason.') });
const channelSchema = yup.object({
  type: yup.string().oneOf(['qr', 'bank'], 'Choose QR code or bank.').required('Choose QR code or bank.'),
  label: yup.string().trim().min(1, 'Please name it, e.g. GCash.').max(60).required('Please name it, e.g. GCash.'),
  bankName: optional(80),
  accountName: optional(120),
  accountNumber: optional(60),
});
const channelPatchSchema = channelSchema.partial();
const cycle = () => yup.string().oneOf(['monthly', 'yearly'], 'Choose monthly or yearly.').required('Choose monthly or yearly.');
const quoteSchema = yup.object({ planCode: yup.string().trim().max(40).required('Choose a plan.'), cycle: cycle(), promoCode: yup.string().trim().max(40).required('Enter a promo code.') });
const submitSchema = yup.object({ planCode: yup.string().trim().max(40).required('Choose a plan.'), cycle: cycle(), promoCode: optional(40), reference: optional(120) });

@Controller('admin/affiliates')
export class AffiliatesAdminController {
  constructor(private readonly svc: AffiliatesService) {}

  @Get()
  list(@Query('sort') sort?: string) {
    return this.svc.list((['referrals', 'earnings', 'newest'].includes(sort ?? '') ? sort : 'referrals') as AffiliateSort);
  }

  @Post()
  create(@Req() req: Request, @Body(new YupValidationPipe(affiliateSchema)) body: yup.InferType<typeof affiliateSchema>) {
    return this.svc.create(body, actor(req));
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(affiliatePatchSchema)) body: yup.InferType<typeof affiliatePatchSchema>) {
    return this.svc.update(id, body as never, actor(req));
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    return this.svc.resendInvite(id, actor(req));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id, actor(req));
  }

  @Post(':id/payout')
  @HttpCode(200)
  payout(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(payoutSchema)) body: yup.InferType<typeof payoutSchema>) {
    return this.svc.markPaid(id, { commissionIds: body.commissionIds ?? null, reference: body.reference ?? null }, actor(req));
  }
}

@Controller('admin/plan-payments')
export class PlanPaymentsAdminController {
  constructor(private readonly svc: AffiliatesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.svc.payments(status || 'review');
  }

  @Get(':id/proof')
  async proof(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.svc.proof(id);
    res
      .status(200)
      .set({ 'Content-Type': f.type, 'Content-Disposition': `inline; filename="${f.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      .send(f.body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(approveSchema)) body: yup.InferType<typeof approveSchema>) {
    return this.svc.approve(id, { note: body.note ?? null }, actor(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(rejectSchema)) body: yup.InferType<typeof rejectSchema>) {
    return this.svc.reject(id, body, actor(req));
  }
}

@Controller('admin/plan-payment-channels')
export class PlanChannelsAdminController {
  constructor(private readonly svc: AffiliatesService) {}

  @Get()
  list() {
    return this.svc.channels();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  add(@Body(new YupValidationPipe(channelSchema)) body: yup.InferType<typeof channelSchema>, @UploadedFile() file?: UploadedFileLike) {
    return this.svc.addChannel(body as never, file);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  update(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(channelPatchSchema)) body: yup.InferType<typeof channelPatchSchema>, @UploadedFile() file?: UploadedFileLike) {
    return this.svc.updateChannel(id, body as never, file);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteChannel(id);
  }
}

@Controller('client/billing')
export class ClientBillingController {
  constructor(private readonly svc: AffiliatesService) {}

  @Get('checkout')
  @ClientRoute(MEMBER)
  checkout(@Req() req: Request) {
    return this.svc.checkout(ctx(req).org.id);
  }

  @Post('promo')
  @HttpCode(200)
  @ClientRoute(OWNER)
  @StrictRateLimit()
  promo(@Req() req: Request, @Body(new YupValidationPipe(quoteSchema)) body: yup.InferType<typeof quoteSchema>) {
    return this.svc.quotePromo(body, ctx(req).user.email);
  }

  @Post('payments')
  @ClientRoute(OWNER)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  submit(@Req() req: Request, @Body(new YupValidationPipe(submitSchema)) body: yup.InferType<typeof submitSchema>, @UploadedFile() file?: UploadedFileLike) {
    const c = ctx(req);
    return this.svc.submit({ orgId: c.org.id, orgName: c.org.name, email: c.user.email }, body as never, file);
  }

  @Post('payments/:id/cancel')
  @HttpCode(200)
  @ClientRoute(OWNER)
  cancel(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    return this.svc.cancel(c.org.id, id, c.user.email);
  }
}

@Controller('public/plan-files')
export class PublicPlanFilesController {
  constructor(private readonly svc: AffiliatesService) {}

  @Get('qr/:file')
  async qr(@Param('file') name: string, @Res() res: Response) {
    const f = await this.svc.qrFile(name);
    res.status(200).set({ 'Content-Type': f.type, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' }).send(f.body);
  }
}
