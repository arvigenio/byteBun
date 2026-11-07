import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from '../common/client-ip';
import { StrictRateLimit } from '../common/rate-limit';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { type LeadInput, leadSchema } from './lead.schema';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  // POST /api/leads -> 201 { ok: true, id }
  // 400 with per-field messages, 409 if the call time was just booked, 429 when rate limited.
  @Post()
  @HttpCode(201)
  @StrictRateLimit()
  async create(@Body(new YupValidationPipe(leadSchema)) body: LeadInput, @Req() req: Request) {
    const { id } = await this.leads.create(body, { ip: clientIp(req) });
    return id === undefined ? { ok: true } : { ok: true, id };
  }
}
