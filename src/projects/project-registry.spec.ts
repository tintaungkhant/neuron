import { NotFoundException } from '@nestjs/common';
import { ProjectRegistry } from './project-registry';
import type { Project } from './project.types';

const acmeProject: Project<{ name: string }> = {
  id: 'acme',
  config: { name: 'Acme' },
  workflows: {},
};

const globexProject: Project<{ name: string }> = {
  id: 'globex',
  config: { name: 'Globex' },
  workflows: {},
};

describe('ProjectRegistry', () => {
  it('returns a registered project by id', () => {
    const reg = new ProjectRegistry([acmeProject, globexProject]);
    expect(reg.get('acme')).toBe(acmeProject);
    expect(reg.get('globex')).toBe(globexProject);
  });

  it('get returns undefined for unknown ids', () => {
    const reg = new ProjectRegistry([]);
    expect(reg.get('nope')).toBeUndefined();
  });

  it('require throws NotFoundException for unknown ids', () => {
    const reg = new ProjectRegistry([]);
    expect(() => reg.require('nope')).toThrow(NotFoundException);
    expect(() => reg.require('nope')).toThrow("project 'nope' not found");
  });

  it('require returns the project for a known id', () => {
    const reg = new ProjectRegistry([acmeProject]);
    expect(reg.require('acme')).toBe(acmeProject);
  });

  it('seeds an empty registry when no registrations are provided', () => {
    const reg = new ProjectRegistry([]);
    expect(reg.get('any')).toBeUndefined();
  });
});
