// plan slug 工具函数
// 格式：adjective-adjective-noun（如 "resilient-beaming-locket"）
// 懒生成、进程级缓存，/clear 时调 clearPlanSlug() 重置

import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const ADJECTIVES = [
  'amber', 'arctic', 'bold', 'bright', 'calm', 'clear', 'cold', 'crisp',
  'dark', 'deep', 'dim', 'dry', 'dusk', 'fast', 'firm', 'flat', 'free',
  'grand', 'grey', 'hard', 'high', 'hollow', 'iron', 'jade', 'keen',
  'light', 'lone', 'long', 'low', 'mild', 'mist', 'near', 'noble',
  'north', 'oak', 'open', 'pale', 'pure', 'quiet', 'rapid', 'raw',
  'red', 'rough', 'round', 'sharp', 'silent', 'sleek', 'slim', 'slow',
  'small', 'smart', 'smooth', 'soft', 'solid', 'still', 'stone', 'storm',
  'strong', 'swift', 'tall', 'terse', 'thin', 'true', 'vast', 'warm',
  'white', 'wide', 'wild', 'wise', 'wooden', 'young',
]

const NOUNS = [
  'anchor', 'arch', 'arrow', 'axe', 'beacon', 'blade', 'bloom', 'bolt',
  'bond', 'branch', 'bridge', 'brook', 'candle', 'canyon', 'chain',
  'cliff', 'cloud', 'comet', 'coral', 'crest', 'crown', 'dawn', 'delta',
  'dune', 'dust', 'echo', 'edge', 'ember', 'field', 'flame', 'flare',
  'fleet', 'flint', 'flow', 'foam', 'forge', 'frost', 'gale', 'gate',
  'glade', 'glow', 'grove', 'gulf', 'haze', 'hill', 'horizon', 'hull',
  'isle', 'jade', 'key', 'knot', 'lake', 'lance', 'leaf', 'ledge',
  'light', 'line', 'locket', 'mast', 'maze', 'mesa', 'mist', 'moon',
  'moss', 'mount', 'node', 'north', 'orbit', 'path', 'peak', 'pine',
  'plain', 'reef', 'ridge', 'ring', 'rise', 'river', 'rock', 'root',
  'sail', 'sand', 'shard', 'shore', 'signal', 'slate', 'slope', 'snow',
  'spark', 'spire', 'spring', 'star', 'stem', 'step', 'stone', 'storm',
  'strand', 'stream', 'tide', 'trail', 'tree', 'trench', 'vale', 'vault',
  'veil', 'vent', 'wave', 'well', 'wind', 'wing', 'wire', 'wood',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function generateWordSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`
}

// 进程级单例
let _slug: string | null = null

export function getPlanSlug(): string {
  if (!_slug) {
    const plansDir = getPlansDirectory()
    let candidate = generateWordSlug()
    for (let i = 0; i < 10; i++) {
      if (!existsSync(join(plansDir, `${candidate}.md`))) break
      candidate = generateWordSlug()
    }
    _slug = candidate
  }
  return _slug
}

export function clearPlanSlug(): void {
  _slug = null
}

export function getPlansDirectory(): string {
  const dir = join(homedir(), '.astraea', 'plans')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getPlanFilePath(): string {
  return join(getPlansDirectory(), `${getPlanSlug()}.md`)
}
