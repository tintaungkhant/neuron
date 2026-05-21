import { Global, Module } from '@nestjs/common';
import { DbConnection } from './client';

@Global()
@Module({
  providers: [DbConnection],
  exports: [DbConnection],
})
export class DbModule {}
