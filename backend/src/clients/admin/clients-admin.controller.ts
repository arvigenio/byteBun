// Admin site: client management. Under /api/admin, so only fully signed-in Byte Bun admins
// (AdminSessionGuard, auth/admin-session.ts), never client accounts.
//
//   GET  /api/admin/clients?q&status&plan          list
//   GET  /api/admin/clients/catalog                plans + add-ons
//   GET  /api/admin/clients/events?organizationId  audit log
//   GET  /api/admin/clients/:id                    details (plan, entitlements, members, stats, events)
//   GET  /api/admin/clients/:id/export.csv         all bookings (e.g. before deleting)
//   POST /api/admin/clients/:id/plan        { planCode, addons, reason }
//   POST /api/admin/clients/:id/deactivate  { reason, notifyOwner }
//   POST /api/admin/clients/:id/reactivate  { reason, notifyOwner }
//   POST /api/admin/clients/:id/delete      { confirmName, reason, notifyCustomers, notifyOwner }  owner-level admins
//   POST /api/admin/clients/:id/restore     { reason }
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { csvFor } from '../booking/csv';
import { type ClientsDb } from '../clients-db';
import { CLIENTS_ADMIN_DB, ClientsAdminService } from './clients-admin.service';

const requiredReason = () => yup.string().trim().min(3, 'Please give a reason.').max(500, 'At most 500 characters.').required('Please give a reason.');
const optionalReason = () =>
  yup
    .string()
    .trim()
    .max(500, 'At most 500 characters.')
    .nullable()
    .transform((v) => (v === '' ? null : v));
const planSchema = yup.object({ planCode: yup.string().trim().max(40).required('Choose a plan.'), addons: yup.array(yup.string().trim().max(40).required()).max(20).default([]), reason: optionalReason() });
const deactivateSchema = yup.object({ reason: requiredReason(), notifyOwner: yup.boolean().default(true) });
const reactivateSchema = yup.object({ reason: optionalReason(), notifyOwner: yup.boolean().default(true) });
const deleteSchema = yup.object({ confirmName: yup.string().trim().max(200).required('Type the business name.'), reason: requiredReason(), notifyCustomers: yup.boolean().default(false), notifyOwner: yup.boolean().default(true) });
const restoreSchema = yup.object({ reason: optionalReason() });

const actor = (req: Request) => ({ email: req.admin!.user.email });

@Controller('admin/clients')
export class ClientsAdminController {
  constructor(
    private readonly clients: ClientsAdminService,
    @Inject(CLIENTS_ADMIN_DB) private readonly db: ClientsDb,
  ) {}

  @Get()
  list(@Query('q') q?: string, @Query('status') status?: string, @Query('plan') plan?: string) {
    return this.clients.list({ q, status, plan });
  }

  @Get('catalog')
  async catalog(@Req() req: Request) {
    return { ...(await this.clients.catalog()), canDelete: this.clients.isOwnerAdmin(actor(req).email) };
  }

  @Get('events')
  events(@Query('organizationId') organizationId?: string, @Query('limit') limit?: string) {
    return this.clients.events(organizationId || undefined, Number(limit) || 200);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.clients.detail(id);
  }

  @Get(':id/export.csv')
  @Header('Cache-Control', 'no-store')
  async export(@Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await csvFor(this.db, id);
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` }).send(csv);
  }

  @Post(':id/plan')
  @HttpCode(200)
  plan(@Req() req: Request, @Param('id') id: string, @Body(new YupValidationPipe(planSchema)) body: yup.InferType<typeof planSchema>) {
    return this.clients.changePlan(id, { planCode: body.planCode, addons: body.addons ?? [], reason: body.reason ?? null }, actor(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Req() req: Request, @Param('id') id: string, @Body(new YupValidationPipe(deactivateSchema)) body: yup.InferType<typeof deactivateSchema>) {
    return this.clients.deactivate(id, { reason: body.reason, notifyOwner: body.notifyOwner }, actor(req));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Req() req: Request, @Param('id') id: string, @Body(new YupValidationPipe(reactivateSchema)) body: yup.InferType<typeof reactivateSchema>) {
    return this.clients.reactivate(id, { reason: body.reason ?? null, notifyOwner: body.notifyOwner }, actor(req));
  }

  @Post(':id/delete')
  @HttpCode(200)
  remove(@Req() req: Request, @Param('id') id: string, @Body(new YupValidationPipe(deleteSchema)) body: yup.InferType<typeof deleteSchema>) {
    return this.clients.remove(id, body, actor(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@Req() req: Request, @Param('id') id: string, @Body(new YupValidationPipe(restoreSchema)) body: yup.InferType<typeof restoreSchema>) {
    return this.clients.restore(id, { reason: body.reason ?? null }, actor(req));
  }
}
