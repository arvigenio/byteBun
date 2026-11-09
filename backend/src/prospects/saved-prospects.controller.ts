// Saved prospects and groups (admin). Under /api/admin, so AdminSessionGuard protects every route.
import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as yup from 'yup';
import { ApiError } from '../common/api-error';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { SavedProspectsService } from './saved-prospects.service';

// Mirrored by frontend/src/lib/adminSchemas.js (prospectGroupSchema, savedProspectNoteSchema).
const groupSchema = yup.object({
  name: yup
    .string()
    .trim()
    .transform((v: string) => v.replace(/\s+/g, ' '))
    .required('Enter a name for the group.')
    .max(80, 'Group name is too long (80 characters max).')
    .matches(/^[^<>]*$/, 'Leave out < and >.'),
});
const groupId = yup.number().integer().positive().nullable().typeError('Pick a group.');
const saveSchema = yup.object({
  searchId: yup.string().required().uuid('Those results have expired. Please search again.'),
  itemIds: yup.array(yup.number().integer().positive().required()).required().min(1, 'Pick at least one business.').max(200, 'Save at most 200 at a time.'),
  groupId: groupId.optional(),
});
const updateSchema = yup.object({
  groupId: groupId.optional(),
  note: yup.string().trim().max(2000, 'Note is too long (2000 characters max).').nullable().optional(),
});

@Controller('admin/prospects')
export class SavedProspectsController {
  constructor(private readonly saved: SavedProspectsService) {}

  // GET /api/admin/prospects/groups -> { groups: [{ id, name, count }], total, ungrouped }
  @Get('groups')
  @Header('Cache-Control', 'no-store')
  groups() {
    return this.saved.groups();
  }

  // POST /api/admin/prospects/groups { name } -> the new group (409 if the name is taken)
  @Post('groups')
  createGroup(@Body(new YupValidationPipe(groupSchema)) body: yup.InferType<typeof groupSchema>, @Req() req: Request) {
    return this.saved.createGroup(body.name, { email: req.admin!.user.email });
  }

  // PATCH /api/admin/prospects/groups/:id { name } -> all groups
  @Patch('groups/:id')
  renameGroup(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(groupSchema)) body: yup.InferType<typeof groupSchema>) {
    return this.saved.renameGroup(id, body.name);
  }

  // DELETE /api/admin/prospects/groups/:id -> all groups (its prospects stay saved, ungrouped)
  @Delete('groups/:id')
  deleteGroup(@Param('id', ParseIntPipe) id: number) {
    return this.saved.deleteGroup(id);
  }

  // GET /api/admin/prospects/saved?group=all|none|<id> -> { items }, newest first
  @Get('saved')
  @Header('Cache-Control', 'no-store')
  list(@Query('group') group = 'all') {
    if (group === 'all' || group === 'none') return this.saved.list(group);
    if (!/^\d{1,9}$/.test(group)) throw new ApiError(400, { error: 'bad_group', message: 'Unknown group.' });
    return this.saved.list(Number(group));
  }

  // POST /api/admin/prospects/saved { searchId, itemIds, groupId? } -> { saved: [{ itemId, id, groupId }], created, updated }
  @Post('saved')
  @HttpCode(200)
  save(@Body(new YupValidationPipe(saveSchema)) body: yup.InferType<typeof saveSchema>, @Req() req: Request) {
    return this.saved.save(body, { email: req.admin!.user.email });
  }

  // PATCH /api/admin/prospects/saved/:id { groupId?, note? } -> the saved prospect
  @Patch('saved/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(updateSchema)) body: yup.InferType<typeof updateSchema>) {
    return this.saved.update(id, body);
  }

  // DELETE /api/admin/prospects/saved/:id
  @Delete('saved/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.saved.remove(id);
  }
}
