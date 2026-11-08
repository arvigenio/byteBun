import { Global, Module } from '@nestjs/common';
import { AdminEvents } from './admin-events';
import { AdminRealtimeGateway } from './admin-realtime.gateway';
import { MemoryCache } from './memory-cache';

// Memory cache + live admin updates, available everywhere.
@Global()
@Module({
  providers: [MemoryCache, AdminRealtimeGateway, AdminEvents],
  exports: [MemoryCache, AdminEvents],
})
export class RealtimeModule {}
