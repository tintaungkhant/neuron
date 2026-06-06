import {
  CORE,
  STAGE_BLOCKS,
  STAGE_OPTIONS,
  buildSystemPrompt,
  type Stage,
} from './prompt';

describe('buildSystemPrompt', () => {
  it('composes CORE followed by the requested stage block', () => {
    const out = buildSystemPrompt('recommend');
    expect(out.startsWith(CORE)).toBe(true);
    expect(out).toContain(STAGE_BLOCKS.recommend);
  });

  it('falls back to the discovery block for an unknown stage', () => {
    const out = buildSystemPrompt('nonsense');
    expect(out).toContain(STAGE_BLOCKS.discovery);
  });

  it('every STAGE_OPTIONS label has a matching block, discovery first', () => {
    expect(STAGE_OPTIONS[0].label).toBe('discovery');
    for (const opt of STAGE_OPTIONS) {
      expect(STAGE_BLOCKS[opt.label as Stage]).toBeDefined();
    }
  });

  it('CORE keeps the persona and the no-foreign-script rule', () => {
    expect(CORE).toContain('Better Solutions');
    expect(CORE).toMatch(/writing system/i);
  });
});
