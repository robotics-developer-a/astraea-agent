import { appendFileSync, chmodSync, writeFileSync } from 'node:fs'

export function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

export function appendPrivateFile(path: string, content: string): void {
  appendFileSync(path, content, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}
