import { expect, test } from 'bun:test'
import { handleProcessFailure } from './terminalGuard'

test('an unhandled background rejection is reported without terminating the REPL', () => {
  const reports: string[] = []
  let restored = 0
  let exitCode: number | undefined

  handleProcessFailure('unhandledRejection', new Error('background failed'), {
    restore: () => { restored++ },
    report: message => { reports.push(message) },
    exit: code => { exitCode = code },
  })

  expect(reports[0]).toContain('Unhandled rejection: Error: background failed')
  expect(restored).toBe(0)
  expect(exitCode).toBeUndefined()
})

test('an uncaught exception still restores the terminal and exits', () => {
  const reports: string[] = []
  let restored = 0
  let exitCode: number | undefined

  handleProcessFailure('uncaughtException', new Error('render failed'), {
    restore: () => { restored++ },
    report: message => { reports.push(message) },
    exit: code => { exitCode = code },
  })

  expect(reports[0]).toContain('Uncaught exception: Error: render failed')
  expect(restored).toBe(1)
  expect(exitCode).toBe(1)
})
