// Prospecting API (admin). Every route is under /api/admin, so AdminSessionGuard protects it.
// Results live in memory for 30 minutes (prospects.service.ts); saving: saved-prospects.controller.ts.
import { Body, Controller, Get, Header, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as yup from 'yup';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { ProspectsService } from './prospects.service';

// Letters (any language), numbers, spaces and simple punctuation: "Dental clinic", "Quezon City",
// "Saint-Étienne", "Coeur d'Alene". Mirrored by frontend/src/lib/adminSchemas.js (prospectSearchSchema).
const TEXT = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,()/-]*$/u;
const searchSchema = yup.object({
  industry: yup
    .string()
    .trim()
    .required('Enter an industry, like "dentist" or "hair salon".')
    .min(2, 'Enter at least 2 characters.')
    .max(80, 'Industry is too long (80 characters max).')
    .matches(TEXT, 'Use letters, numbers and spaces only.'),
  location: yup
    .string()
    .trim()
    .required('Enter a city or a country, like "Makati" or "Philippines".')
    .min(2, 'Enter at least 2 characters.')
    .max(120, 'Location is too long (120 characters max).')
    .matches(TEXT, 'Use letters, numbers and spaces only.'),
  refresh: yup.boolean().default(false),
});

@Controller('admin/prospects')
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  // GET /api/admin/prospects/meta -> data source, and whether ratings/reviews are available
  @Get('meta')
  @Header('Cache-Control', 'no-store')
  meta() {
    return this.prospects.meta();
  }

  // POST /api/admin/prospects/search { industry, location, refresh? } -> { search, items (ranked), reused }
  @Post('search')
  @HttpCode(200)
  search(@Body(new YupValidationPipe(searchSchema)) body: yup.InferType<typeof searchSchema>, @Req() req: Request) {
    return this.prospects.search(body, { email: req.admin!.user.email });
  }

  // GET /api/admin/prospects/searches/:id -> the current results (404 once expired)
  @Get('searches/:id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prospects.get(id);
  }

  // POST /api/admin/prospects/searches/:id/items/:itemId/check-website -> the results, with that website checked again
  @Post('searches/:id/items/:itemId/check-website')
  @HttpCode(200)
  recheck(@Param('id', new ParseUUIDPipe()) id: string, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.prospects.recheck(id, itemId);
  }
}
