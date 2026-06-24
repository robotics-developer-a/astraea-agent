#!/usr/bin/env bun

import { assertConfig } from '../config'
import { createLocalSelectionBridge } from './local-selection-bridge'

assertConfig()

const server = createLocalSelectionBridge()

console.error(`[selection-bridge] listening on http://${server.hostname}:${server.port}`)
console.error('[selection-bridge] POST /ask with { "instruction": "...", "selection": "..." }')
