import { expect, test } from 'bun:test'
import { inkRenderOptions } from './renderOptions'

test('Windows uses incremental rendering to avoid duplicated streaming frames', () => {
  expect(inkRenderOptions('win32')).toEqual({ incrementalRendering: true })
})

test('other platforms keep Ink standard rendering', () => {
  expect(inkRenderOptions('darwin')).toEqual({})
  expect(inkRenderOptions('linux')).toEqual({})
})
