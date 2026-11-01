/**
 * A small Markdown block and inline parser sized for agent replies. It keeps
 * fenced code, headings, lists, quotes, and the inline emphasis an assistant
 * commonly emits, and deliberately ignores constructs a terminal cannot show
 * (images, tables, HTML).
 * @module @deepseek-ai/dsh-tui/markdown
 */

/** One display block parsed from Markdown source. */
export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: number; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'code'; readonly lang: string; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'quote'; readonly text: string }
  | { readonly type: 'rule' }

/** One styled span inside a paragraph, heading, list item, or quote. */
export type InlineSpan =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'bold'; readonly text: string }
  | { readonly type: 'italic'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'strike'; readonly text: string }
  | { readonly type: 'link'; readonly text: string; readonly href: string }

function lineAt(lines: readonly string[], index: number): string {
  /* v8 ignore next -- callers index within the array length */
  return lines[index] ?? ''
}

function charAt(text: string, index: number): string {
  /* v8 ignore next -- callers index within the string length */
  return text[index] ?? ''
}

function group(match: RegExpExecArray, index: number): string {
  /* v8 ignore next -- every capture group is present by construction */
  return match[index] ?? ''
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

/**
 * Split Markdown source into display blocks.
 * @param source - complete assistant text.
 * @returns ordered blocks with fenced code kept verbatim.
 */
export function parseMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lineAt(lines, index)
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = group(fence, 1)
      const lang = group(fence, 2)
      const body: string[] = []
      index++
      while (index < lines.length) {
        const candidate = lineAt(lines, index)
        if (candidate.trimStart().startsWith(marker)) {
          index++
          break
        }
        body.push(candidate)
        index++
      }
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }
    if (line.trim() === '') { index++; continue }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ type: 'heading', level: group(heading, 1).length, text: group(heading, 2) })
      index++
      continue
    }
    if (RULE.test(line)) { blocks.push({ type: 'rule' }); index++; continue }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      const body: string[] = [group(quote, 1)]
      index++
      while (index < lines.length) {
        const next = QUOTE.exec(lineAt(lines, index))
        if (next === null) break
        body.push(group(next, 1))
        index++
      }
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }
    const list = LIST.exec(line)
    if (list !== null) {
      const ordered = /^\d/.test(group(list, 2))
      const items: string[] = []
      const indent = group(list, 1).length
      while (index < lines.length) {
        const entry = LIST.exec(lineAt(lines, index))
        if (entry === null) break
        const entryIndent = group(entry, 1).length
        if (entryIndent > indent && items.length > 0) {
          const last = lineAt(items, items.length - 1)
          items[items.length - 1] = `${last}\n${' '.repeat(Math.min(entryIndent - indent, 8))}${group(entry, 3)}`
        } else {
          if (entryIndent !== indent) break
          items.push(group(entry, 3))
        }
        index++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    const paragraph: string[] = [line]
    index++
    while (index < lines.length) {
      const next = lineAt(lines, index)
      if (next.trim() === '' || FENCE.test(next) || HEADING.test(next) || RULE.test(next)
        || QUOTE.test(next) || LIST.test(next)) break
      paragraph.push(next)
      index++
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
  }
  return blocks
}

function starts(text: string, index: number, token: string): boolean {
  return text.startsWith(token, index)
}

function closing(text: string, from: number, token: string): number {
  let index = from
  while (index < text.length) {
    const found = text.indexOf(token, index)
    if (found === -1) return -1
    if (text[found - 1] !== '\\') return found
    index = found + token.length
  }
  return -1
}

function pushText(spans: InlineSpan[], text: string): void {
  if (text !== '') spans.push({ type: 'text', text })
}

/**
 * Split one line of inline Markdown into styled spans.
 * @param text - inline Markdown source.
 * @returns spans in source order.
 */
export function parseInline(text: string): readonly InlineSpan[] {
  const spans: InlineSpan[] = []
  let index = 0
  let plain = ''
  const flush = (): void => { pushText(spans, plain); plain = '' }
  while (index < text.length) {
    const char = charAt(text, index)
    if (char === '\\' && index + 1 < text.length) {
      plain += charAt(text, index + 1)
      index += 2
      continue
    }
    if (char === '`') {
      const end = text.indexOf('`', index + 1)
      if (end !== -1) {
        flush()
        spans.push({ type: 'code', text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }
    if (starts(text, index, '**') || starts(text, index, '__')) {
      const token = text.slice(index, index + 2)
      const end = closing(text, index + 2, token)
      if (end !== -1) {
        flush()
        spans.push({ type: 'bold', text: text.slice(index + 2, end) })
        index = end + 2
        continue
      }
    }
    if (starts(text, index, '~~')) {
      const end = closing(text, index + 2, '~~')
      if (end !== -1) {
        flush()
        spans.push({ type: 'strike', text: text.slice(index + 2, end) })
        index = end + 2
        continue
      }
    }
    if (char === '*' || char === '_') {
      const end = closing(text, index + 1, char)
      if (end !== -1 && end > index + 1) {
        flush()
        spans.push({ type: 'italic', text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }
    if (char === '[') {
      const close = text.indexOf(']', index + 1)
      if (close !== -1 && text[close + 1] === '(') {
        const end = text.indexOf(')', close + 2)
        if (end !== -1) {
          flush()
          spans.push({ type: 'link', text: text.slice(index + 1, close), href: text.slice(close + 2, end) })
          index = end + 1
          continue
        }
      }
    }
    plain += char
    index++
  }
  flush()
  return spans
}
