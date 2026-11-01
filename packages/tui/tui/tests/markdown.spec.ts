import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../src/markdown.ts'

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, and fenced code', () => {
    const blocks = parseMarkdown('# Title\n\nHello\nworld\n\n```ts\nconst a = 1\n```')
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'Hello\nworld' },
      { type: 'code', lang: 'ts', text: 'const a = 1' },
    ])
  })

  it('parses lists, quotes, and rules', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      { type: 'list', ordered: false, items: ['one', 'two'] },
    ])
    expect(parseMarkdown('1. one\n2. two')).toEqual([
      { type: 'list', ordered: true, items: ['one', 'two'] },
    ])
    expect(parseMarkdown('> note\n> second')).toEqual([{ type: 'quote', text: 'note\nsecond' }])
    expect(parseMarkdown('---')).toEqual([{ type: 'rule' }])
  })

  it('keeps an unterminated fence as code', () => {
    expect(parseMarkdown('```sh\nls -la')).toEqual([{ type: 'code', lang: 'sh', text: 'ls -la' }])
  })

  it('nests indented list entries into their parent item', () => {
    expect(parseMarkdown('- parent\n  - child')).toEqual([
      { type: 'list', ordered: false, items: ['parent\n  child'] },
    ])
  })

  it('drops blank lines between blocks', () => {
    expect(parseMarkdown('\n\nA\n\nB\n\n')).toEqual([
      { type: 'paragraph', text: 'A' },
      { type: 'paragraph', text: 'B' },
    ])
  })
})

describe('parseInline', () => {
  it('splits emphasis, code, strike, and links', () => {
    expect(parseInline('a **b** _c_ `d` ~~e~~ [f](https://x)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'italic', text: 'c' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'strike', text: 'e' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'f', href: 'https://x' },
    ])
  })

  it('merges adjacent plain text and honors escapes', () => {
    expect(parseInline('a\\*b*c*')).toEqual([
      { type: 'text', text: 'a*b' },
      { type: 'italic', text: 'c' },
    ])
  })

  it('leaves unmatched markers as text', () => {
    expect(parseInline('a **b')).toEqual([{ type: 'text', text: 'a **b' }])
    expect(parseInline('a ~~b')).toEqual([{ type: 'text', text: 'a ~~b' }])
    expect(parseInline('a `b')).toEqual([{ type: 'text', text: 'a `b' }])
    expect(parseInline('a _b')).toEqual([{ type: 'text', text: 'a _b' }])
    expect(parseInline('a [b]')).toEqual([{ type: 'text', text: 'a [b]' }])
    expect(parseInline('a [b](c')).toEqual([{ type: 'text', text: 'a [b](c' }])
  })

  it('skips an escaped closing token and finds the next one', () => {
    expect(parseInline('**a\\**b**')).toEqual([{ type: 'bold', text: 'a\\**b' }])
  })

  it('accepts underscore emphasis and an empty emphasis body', () => {
    expect(parseInline('__bold__')).toEqual([{ type: 'bold', text: 'bold' }])
    expect(parseInline('a **')).toEqual([{ type: 'text', text: 'a **' }])
  })
})

describe('parseMarkdown edge branches', () => {
  it('handles a fence without a language and an empty heading body', () => {
    expect(parseMarkdown('```\nx\n```')).toEqual([{ type: 'code', lang: '', text: 'x' }])
    expect(parseMarkdown('~~~\ny\n~~~')).toEqual([{ type: 'code', lang: '', text: 'y' }])
    expect(parseMarkdown('# ')).toEqual([{ type: 'heading', level: 1, text: '' }])
  })

  it('ends a quote or list at a plain line', () => {
    expect(parseMarkdown('> a\nplain')).toEqual([
      { type: 'quote', text: 'a' },
      { type: 'paragraph', text: 'plain' },
    ])
    expect(parseMarkdown('- a\nplain')).toEqual([
      { type: 'list', ordered: false, items: ['a'] },
      { type: 'paragraph', text: 'plain' },
    ])
  })

  it('stops a list when a later entry dedents below its base', () => {
    expect(parseMarkdown('  - a\n- b')).toEqual([
      { type: 'list', ordered: false, items: ['a'] },
      { type: 'list', ordered: false, items: ['b'] },
    ])
  })

  it('keeps an empty quote and an empty paragraph separator', () => {
    expect(parseMarkdown('>')).toEqual([{ type: 'quote', text: '' }])
    expect(parseMarkdown('\n')).toEqual([])
  })
})
