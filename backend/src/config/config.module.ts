import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, config } from './config';

// Makes the validated config injectable everywhere: constructor(@Inject(APP_CONFIG) cfg: AppConfig).
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: config }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
