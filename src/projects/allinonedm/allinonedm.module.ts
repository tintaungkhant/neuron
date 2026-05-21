import { Module } from '@nestjs/common';
import { AllInOneDmTelegramController } from './controllers/telegram.controller';

@Module({
  controllers: [AllInOneDmTelegramController],
})
export class AllInOneDmModule {}
