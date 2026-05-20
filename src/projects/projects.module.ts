import { Module } from '@nestjs/common';
import { PROJECT_REGISTRATIONS, ProjectRegistry } from './project-registry';
import type { Project } from './project.types';
import { DemoModule } from './demo/demo.module';
import { demoProject } from './demo/demo.registry';

@Module({
  imports: [DemoModule],
  providers: [
    ProjectRegistry,
    {
      provide: PROJECT_REGISTRATIONS,
      useFactory: (): Project<unknown>[] => [demoProject],
    },
  ],
  exports: [ProjectRegistry],
})
export class ProjectsModule {}
