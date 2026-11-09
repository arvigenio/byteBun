import { Module } from '@nestjs/common';
import { MapTilesController } from './map-tiles.controller';
import { ProspectsController } from './prospects.controller';
import { ProspectsService } from './prospects.service';

// Admin prospecting (/api/admin/prospects): find businesses by industry + location, rank them.
@Module({
  controllers: [ProspectsController, MapTilesController],
  providers: [ProspectsService],
  exports: [ProspectsService],
})
export class ProspectsModule {}
