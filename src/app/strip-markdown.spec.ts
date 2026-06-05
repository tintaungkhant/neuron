import { stripMarkdown } from './strip-markdown';

describe('stripMarkdown', () => {
  it('removes bold and italic markers', () => {
    expect(
      stripMarkdown('a **bold** and *italic* and __b__ and _i_ word'),
    ).toBe('a bold and italic and b and i word');
  });

  it('removes inline code and fenced code blocks', () => {
    expect(stripMarkdown('use `npm` now')).toBe('use npm now');
    expect(stripMarkdown('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips heading and blockquote markers at line start', () => {
    expect(stripMarkdown('# Title\n> quote')).toBe('Title\nquote');
  });

  it('converts links to text (url) and images to alt', () => {
    expect(stripMarkdown('see [our site](https://x.io)')).toBe(
      'see our site (https://x.io)',
    );
    expect(stripMarkdown('![logo](https://x.io/a.png)')).toBe('logo');
  });

  it('removes bullet markers but keeps numbered lists intact', () => {
    expect(stripMarkdown('- one\n* two\n1. three')).toBe('one\ntwo\n1. three');
  });

  it('removes strikethrough', () => {
    expect(stripMarkdown('~~gone~~ here')).toBe('gone here');
  });

  it('leaves plain text and prices/account numbers untouched', () => {
    expect(stripMarkdown('Pay 50000 MMK to KBZ 123-456-789')).toBe(
      'Pay 50000 MMK to KBZ 123-456-789',
    );
  });

  it('leaves Burmese text untouched', () => {
    expect(stripMarkdown('မင်္ဂလာပါ ၁ ၂ ၃')).toBe('မင်္ဂလာပါ ၁ ၂ ၃');
  });
});
