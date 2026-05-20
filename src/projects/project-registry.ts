import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Project, ProjectId } from './project.types';

export const PROJECT_REGISTRATIONS = Symbol('PROJECT_REGISTRATIONS');

@Injectable()
export class ProjectRegistry {
  private readonly projects: Map<ProjectId, Project<unknown>>;

  constructor(
    @Inject(PROJECT_REGISTRATIONS)
    registrations: Project<unknown>[],
  ) {
    this.projects = new Map(registrations.map((p) => [p.id, p]));
  }

  get(id: ProjectId): Project<unknown> | undefined {
    return this.projects.get(id);
  }

  require(id: ProjectId): Project<unknown> {
    const p = this.get(id);
    if (!p) throw new NotFoundException(`project '${id}' not found`);
    return p;
  }
}
