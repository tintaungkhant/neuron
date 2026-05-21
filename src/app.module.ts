import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DemoModule } from './projects/demo/demo.module';
import { AllInOneDmModule } from './projects/allinonedm/allinonedm.module';

@Module({
  imports: [DemoModule, AllInOneDmModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
