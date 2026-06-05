/**
 * Strip Markdown formatting to plain text. Telegram messages are sent without a
 * parse_mode, so any markdown the model emits shows as literal symbols (`**`,
 * backticks, …). The system prompt asks for plain text; this enforces it.
 *
 * Numbered lists (`1.`, `1.a`) are preserved — only decorative markers go.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // fenced code blocks ```lang\n...\n``` → inner content
      .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
      // inline code `x` → x
      .replace(/`([^`]+)`/g, '$1')
      // images ![alt](url) → alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // links [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      // bold/italic — double markers before single
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      // italic _x_ only when underscores bound a word (not inside snake_case)
      .replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?=[^A-Za-z0-9_]|$)/g, '$1$2')
      // strikethrough ~~x~~ → x
      .replace(/~~([^~]+)~~/g, '$1')
      // heading markers at line start
      .replace(/^#{1,6}\s+/gm, '')
      // blockquote markers
      .replace(/^>\s?/gm, '')
      // horizontal rules (---, ***, ___ on their own line)
      .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
      // bullet markers (-, *, +) at line start — numbered lists are untouched
      .replace(/^[ \t]*[-*+]\s+/gm, '')
      .trim()
  );
}
