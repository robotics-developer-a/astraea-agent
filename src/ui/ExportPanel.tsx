// ExportPanel — /export interactive chooser.
// Lets users avoid typing command arguments and supports paste-a-path flow.

import React from 'react'
import { Box, Text } from 'ink'
import { INDIGO } from './theme'

export interface ExportAction {
  key: 'current' | 'path' | 'cancel'
  label: string
  description: string
}

export const EXPORT_ACTIONS: ExportAction[] = [
  {
    key: 'current',
    label: 'current folder',
    description: 'save with an automatic conversation timestamp filename',
  },
  {
    key: 'path',
    label: 'paste path',
    description: 'type or paste a file/folder path, then press Enter',
  },
  {
    key: 'cancel',
    label: 'cancel',
    description: 'close without exporting',
  },
]

export function ExportPanel({ selectedIndex, pathMode }: { selectedIndex: number; pathMode: boolean }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={INDIGO} paddingX={1} marginBottom={1}>
      <Text bold color={INDIGO}>Export conversation</Text>
      <Text color="gray" dimColor>
        {pathMode ? 'Paste a file or folder path below · Esc back' : '↑↓ move  Enter select  Esc cancel'}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {EXPORT_ACTIONS.map((action, i) => {
          const isSelected = i === selectedIndex
          return (
            <Box key={action.key}>
              <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                {isSelected ? ' ❯ ' : '   '}
              </Text>
              <Text color={isSelected ? INDIGO : 'gray'} bold={isSelected} dimColor={!isSelected}>
                {action.label.padEnd(16)}
              </Text>
              <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                {'— '}{action.description}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
