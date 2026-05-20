import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EngineModule } from './engine';
import { ProjectsModule } from './projects/projects.module';
import { TelegramController } from './triggers/telegram.controller';

@Module({
  imports: [EngineModule, ProjectsModule],
  controllers: [AppController, TelegramController],
  providers: [AppService],
})
export class AppModule {}
