/**
 * Empty-conversation brand banner. The artwork is a terminal-cell trace of the
 * official fish mark (`FISH_LOGO_PATH` in `@deepseek-ai/dsh-client-ui-primitives`).
 * @module @deepseek-ai/dsh-tui/components/Banner
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.ts'

/** Full mark, rendered when the terminal is at least 40 columns wide. */
const FULL_MARK = [
  '      ▁▂▃▂▂▂▄▅▆━    ▟▙',
  '   ▄▇██████████▂    ███▆▁▂▃▄▅█',
  ' ▗███████████████▄  ▝████████▘',
  '▗██████████████████▄▁▔▜███▀▀▔',
  '██▏  ▔▔▀▀███████▀▀███▆███▏',
  '██▍       ▝▜████▟▎ ▜████▋',
  '▐██▖        ▝████▇▅▅███▛',
  ' ▜██▖        ▝▜███████▛',
  '  ▜██▅▂  ▕█▆▃  ▀█████▛',
  '   ▝▜██▇▅▅████▅▃▂▜████▇▖',
  '      ▀▀▜██████▛▀▔  ▔▔▔',
] as const

/** Compact mark for narrow terminals. */
const COMPACT_MARK = [
  '  ▂▄▅▅▅▆▇▏  ▇▄▁▁▁▃',
  '▗▇████████▅▂▝████▘',
  '█▍▔▔▀▀███▛▀█▇██',
  '▜▙     ▀██▙▄██▘',
  ' ▜▙▃  ▅▂▝▜███▘',
  '  ▔▀▜▇███▆▝▀▀▀',
] as const

/**
 * Render the startup banner shown while the transcript is empty.
 * @param props.columns - terminal width used to choose the artwork size.
 */
export function Banner({ columns }: { readonly columns: number }) {
  const mark = columns >= 40 ? FULL_MARK : columns >= 22 ? COMPACT_MARK : undefined
  return (
    <Box flexDirection="column" alignItems="center" flexShrink={0} marginTop={1}>
      {mark === undefined ? null : (
        <Box flexDirection="column" flexShrink={0}>
          {mark.map((line, index) => (
            <Text key={index} color={theme.brand}>{line}</Text>
          ))}
        </Box>
      )}
      <Text bold color={theme.brand}>{columns >= 22 ? 'DEEPSEEK HARNESS' : 'DSH'}</Text>
      <Text color={theme.muted} wrap="truncate-end">
        Type a prompt and press Enter. /help lists commands; Ctrl+D exits.
      </Text>
    </Box>
  )
}
