import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { EngineModule } from '../../engine';
import { DevController } from './dev.controller';

@Module({
  imports: [EngineModule],
  controllers: [DevController],
})
export class DevModule {}

// Returns the module to register only when the dev UI is enabled, so the routes
// don't exist at all in production. Spread into AppModule's `imports`.
export function devUiImports(enabled: boolean): (Type | DynamicModule)[] {
  return enabled ? [DevModule] : [];
}
