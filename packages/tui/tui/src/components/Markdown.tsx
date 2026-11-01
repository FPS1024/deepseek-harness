/**
 * Markdown-to-Ink rendering for assistant text. Structure comes from
 * {@link parseMarkdown}; inline emphasis is rendered as nested Ink text spans.
 * @module @deepseek-ai/dsh-tui/components/Markdown
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { parseInline, parseMarkdown, type InlineSpan, type MarkdownBlock } from '../markdown.ts'
import { theme, symbols } from '../theme.ts'
import { CodeBlock } from './CodeBlock.tsx'

function Span({ span }: { readonly span: InlineSpan }) {
  switch (span.type) {
    case 'text': return <Text>{span.text}</Text>
    case 'bold': return <Text bold>{span.text}</Text>
    case 'italic': return <Text italic>{span.text}</Text>
    case 'strike': return <Text strikethrough>{span.text}</Text>
    case 'code': return <Text color={theme.accent}>{span.text}</Text>
    case 'link': return <Text color="blue" underline>{span.text}</Text>
    default: return assertNever(span, 'markdown inline span')
  }
}

function Inline({ text }: { readonly text: string }) {
  return <>{parseInline(text).map((span, index) => <Span key={index} span={span} />)}</>
}

function Block({ block }: { readonly block: MarkdownBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <Box marginTop={1}>
          <Text bold color={theme.accent}>{block.text}</Text>
        </Box>
      )
    case 'paragraph':
      return <Text><Inline text={block.text} /></Text>
    case 'code':
      return <CodeBlock lang={block.lang} text={block.text} />
    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, index) => (
            <Text key={index}>
              <Text color={theme.muted}>{block.ordered ? `${String(index + 1)}. ` : `${symbols.bullet} `}</Text>
              <Inline text={item} />
            </Text>
          ))}
        </Box>
      )
    case 'quote':
      return (
        <Text color={theme.muted}>
          {block.text.split('\n').map((line, index) => `${index === 0 ? '' : '\n'}${symbols.quote} ${line}`).join('')}
        </Text>
      )
    case 'rule':
      return <Text color={theme.muted}>{symbols.rule.repeat(40)}</Text>
    default:
      return assertNever(block, 'markdown block')
  }
}

/**
 * Render one Markdown document.
 * @param props.text - Markdown source.
 */
export function Markdown({ text }: { readonly text: string }) {
  return (
    <Box flexDirection="column">
      {parseMarkdown(text).map((block, index) => <Block key={index} block={block} />)}
    </Box>
  )
}
