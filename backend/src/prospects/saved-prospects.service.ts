// Saved prospects and their groups. Search results live in memory for 30 minutes
// (prospects.service.ts); an admin can keep any of them here, sorted into groups.
//
// What is saved is the server's own copy of the result (never data sent by the browser), as a
// snapshot: saving the same business again, or its website checkup finishing, refreshes it.
// One row per business (external_id), so a business is in at most one group.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { AdminEvents } from '../realtime/admin-events';
import { ProspectsService, snapshotOf } from './prospects.service';

type SavedRow = Prisma.SavedProspectGetPayload<object>;

/** A saved prospect for the admin site: the same shape as a search result, plus group and note. */
function present(r: SavedRow) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    address: r.address,
    city: r.city,
    country: r.country,
    lat: r.latitude,
    lng: r.longitude,
    phone: r.phone,
    email: r.email,
    website: r.website,
    websiteKind: r.websiteKind,
    socials: r.socials,
    mapsUrl: r.mapsUrl,
    rating: r.rating,
    reviewCount: r.reviewCount,
    score: r.score,
    tier: r.tier,
    reasons: r.reasons,
    pitch: r.pitch,
    checkup: r.checkup,
    groupId: r.groupId,
    note: r.note,
    industry: r.industry,
    location: r.location,
    source: r.source,
    savedBy: r.savedBy,
    savedAt: r.savedAt,
    updatedAt: r.updatedAt,
  };
}

const MAX_LIST = 2000;
const sameName = (name: string) => ({ name: { equals: name, mode: 'insensitive' as const } });
const groupTaken = () => new ApiError(409, { error: 'group_exists', message: 'There is already a group with that name.', fields: { name: 'There is already a group with that name.' } });

@Injectable()
export class SavedProspectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prospects: ProspectsService,
    private readonly events: AdminEvents,
  ) {}

  // ---------------------------------------------------------------- groups

  async groups() {
    const [groups, counts, total] = await Promise.all([
      this.prisma.prospectGroup.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.savedProspect.groupBy({ by: ['groupId'], _count: { _all: true } }),
      this.prisma.savedProspect.count(),
    ]);
    const count = new Map(counts.map((c) => [c.groupId, c._count._all]));
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, count: count.get(g.id) ?? 0, createdBy: g.createdBy, createdAt: g.createdAt })),
      total,
      ungrouped: count.get(null) ?? 0,
    };
  }

  private async assertGroup(id: number) {
    if (!(await this.prisma.prospectGroup.findUnique({ where: { id }, select: { id: true } }))) {
      throw new ApiError(400, { error: 'group_not_found', message: 'That group no longer exists.', fields: { groupId: 'That group no longer exists.' } });
    }
  }

  async createGroup(name: string, actor: { email: string }) {
    if (await this.prisma.prospectGroup.findFirst({ where: sameName(name) })) throw groupTaken();
    try {
      const g = await this.prisma.prospectGroup.create({ data: { name, createdBy: actor.email } });
      this.events.savedProspectsChanged();
      return { id: g.id, name: g.name, count: 0, createdBy: g.createdBy, createdAt: g.createdAt };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw groupTaken();
      throw err;
    }
  }

  async renameGroup(id: number, name: string) {
    await this.assertGroup(id);
    if (await this.prisma.prospectGroup.findFirst({ where: { ...sameName(name), NOT: { id } } })) throw groupTaken();
    try {
      await this.prisma.prospectGroup.update({ where: { id }, data: { name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw groupTaken();
      throw err;
    }
    this.events.savedProspectsChanged();
    return this.groups();
  }

  /** Deletes the group; its prospects stay saved, without a group. */
  async deleteGroup(id: number) {
    const { count } = await this.prisma.prospectGroup.deleteMany({ where: { id } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That group no longer exists.' });
    this.events.savedProspectsChanged();
    return this.groups();
  }

  // ---------------------------------------------------------------- saved prospects

  /** group: 'all', 'none' (no group) or a group id. Newest first. */
  async list(group: 'all' | 'none' | number) {
    const where: Prisma.SavedProspectWhereInput = group === 'all' ? {} : { groupId: group === 'none' ? null : group };
    const rows = await this.prisma.savedProspect.findMany({ where, orderBy: [{ savedAt: 'desc' }, { id: 'desc' }], take: MAX_LIST });
    return { items: rows.map(present) };
  }

  /**
   * Saves results of a (still in memory) search. groupId: a group, null for none, or left out to
   * keep the group of businesses that were already saved (new ones get none).
   */
  async save(input: { searchId: string; itemIds: number[]; groupId?: number | null }, actor: { email: string }) {
    if (typeof input.groupId === 'number') await this.assertGroup(input.groupId);
    const { search, items } = this.prospects.itemsForSaving(input.searchId, input.itemIds);
    const existing = new Set(
      (await this.prisma.savedProspect.findMany({ where: { externalId: { in: items.map((i) => i.externalId) } }, select: { externalId: true } })).map((r) => r.externalId),
    );
    const saved = await this.prisma.$transaction(
      items.map(({ externalId, item }) =>
        this.prisma.savedProspect.upsert({
          where: { externalId },
          create: {
            externalId,
            ...snapshotOf(item),
            groupId: input.groupId ?? null,
            industry: search.industry,
            location: search.location,
            source: search.source,
            savedBy: actor.email,
          },
          update: { ...snapshotOf(item), ...(input.groupId !== undefined && { groupId: input.groupId }) },
          select: { id: true, externalId: true, groupId: true },
        }),
      ),
    );
    this.events.savedProspectsChanged();
    const byExternal = new Map(saved.map((s) => [s.externalId, s]));
    return {
      saved: items.map(({ externalId, item }) => ({ itemId: item.id, id: byExternal.get(externalId)!.id, groupId: byExternal.get(externalId)!.groupId })),
      created: items.filter((i) => !existing.has(i.externalId)).length,
      updated: items.filter((i) => existing.has(i.externalId)).length,
    };
  }

  async update(id: number, input: { groupId?: number | null; note?: string | null }) {
    if (typeof input.groupId === 'number') await this.assertGroup(input.groupId);
    const data: Prisma.SavedProspectUncheckedUpdateInput = {};
    if (input.groupId !== undefined) data.groupId = input.groupId;
    if (input.note !== undefined) data.note = input.note?.trim() ? input.note.trim() : null;
    try {
      const row = await this.prisma.savedProspect.update({ where: { id }, data });
      this.events.savedProspectsChanged();
      return present(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new ApiError(404, { error: 'not_found', message: 'That prospect is no longer saved.' });
      throw err;
    }
  }

  async remove(id: number) {
    const { count } = await this.prisma.savedProspect.deleteMany({ where: { id } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That prospect is no longer saved.' });
    this.events.savedProspectsChanged();
    return { ok: true };
  }
}
