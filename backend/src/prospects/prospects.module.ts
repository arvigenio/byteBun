import { Module } from '@nestjs/common';
import { MapTilesController } from './map-tiles.controller';
import { ProspectsController } from './prospects.controller';
import { ProspectsService } from './prospects.service';
import { SavedProspectsController } from './saved-prospects.controller';
import { SavedProspectsService } from './saved-prospects.service';

// Admin prospecting (/api/admin/prospects): find businesses by industry + location, rank them,
// and keep the ones worth pitching in groups.
@Module({
  controllers: [ProspectsController, SavedProspectsController, MapTilesController],
  providers: [ProspectsService, SavedProspectsService],
  exports: [ProspectsService],
})
export class ProspectsModule {}
