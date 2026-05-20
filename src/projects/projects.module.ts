import { Module } from '@nestjs/common';
import { PROJECT_REGISTRATIONS, ProjectRegistry } from './project-registry';
import type { Project } from './project.types';

@Module({
  imports: [],
  providers: [
    ProjectRegistry,
    {
      provide: PROJECT_REGISTRATIONS,
      useFactory: (): Project<unknown>[] => [],
    },
  ],
  exports: [ProjectRegistry],
})
export class ProjectsModule {}
