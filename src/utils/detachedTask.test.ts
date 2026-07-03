import { expect, test } from 'bun:test'
import { runDetached } from './detachedTask'

test('detached task routes rejection to its local error boundary', async () => {
  const errors: unknown[] = []

  runDetached(Promise.reject(new Error('export failed')), error => {
    errors.push(error)
  })
  await Bun.sleep(0)

  expect(errors).toHaveLength(1)
  expect((errors[0] as Error).message).toBe('export failed')
})

test('detached task does not invoke the error boundary on success', async () => {
  const errors: unknown[] = []

  runDetached(Promise.resolve(), error => {
    errors.push(error)
  })
  await Bun.sleep(0)

  expect(errors).toHaveLength(0)
})
