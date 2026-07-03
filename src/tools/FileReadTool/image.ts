// 图片检测与元信息读取
//
// 读前按文件头魔数判断是否为常见图片格式（不依赖第三方图像解码库），
// 如是则返回格式、尺寸、大小等元信息——让模型能感知图片存在而无需解码像素。
//
// 格式支持：PNG / JPEG / GIF / WebP / BMP / TIFF / ICO / AVIF。

import type { ToolCallResult } from '../Tool'

// ── 图片格式注册表 ─────────────────────────────────────────────────────────

interface ImageFormat {
  name: string          // 显示名，如 "PNG"
  mimes: string[]       // 可能的 MIME，用于判等
  exts: string[]        // 扩展名，用于提示
  /** 解析尺寸：传入文件前 min(len, 48) 字节的 NUL-padded buffer，返回 [w, h] 或 null */
  readSize: (header: Uint8Array) => [number, number] | null
}

const FORMATS: ImageFormat[] = [
  // ── PNG (§5-#6: 魔数 8 字节 + IHDR chunk) ──
  {
    name: 'PNG',
    mimes: ['image/png'],
    exts: ['.png'],
    readSize(buf) {
      // PNG 魔数 + IHDR (4字节长度 + "IHDR" + 4宽 + 4高)
      if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null
      if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) return null
      return [readU32BE(buf, 16), readU32BE(buf, 20)]
    },
  },

  // ── JPEG ──
  {
    name: 'JPEG',
    mimes: ['image/jpeg'],
    exts: ['.jpg', '.jpeg'],
    readSize(buf) {
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null
      // 扫描 SOF0 / SOF1 / SOF2 marker (0xFF 0xC0/0xC1/0xC2)
      let i = 2
      while (i < buf.length - 1) {
        if (buf[i] !== 0xFF) break
        const marker = buf[i + 1]
        if (marker === undefined) break
        if (marker >= 0xC0 && marker <= 0xC3) {
          // SOFn: length(2) + precision(1) + height(2) + width(2)
          if (i + 9 <= buf.length) {
            return [readU16BE(buf, i + 7), readU16BE(buf, i + 5)]
          }
          break
        }
        const segLen = readU16BE(buf, i + 2)
        if (segLen < 2) break
        i += segLen + 2 // marker(2) + length(segLen)
      }
      return null
    },
  },

  // ── GIF ──
  {
    name: 'GIF',
    mimes: ['image/gif'],
    exts: ['.gif'],
    readSize(buf) {
      if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null
      // GIF87a / GIF89a → 偏移 6 宽、8 高
      return [readU16LE(buf, 6), readU16LE(buf, 8)]
    },
  },

  // ── WebP ──
  {
    name: 'WebP',
    mimes: ['image/webp'],
    exts: ['.webp'],
    readSize(buf) {
      // RIFF(4) + size(4) + WEBP(4)
      if (buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46) return null
      if (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) return null
      // VP8ℓ: lossy → 20字节处: signature(1) + ... + 宽高(2+2, 14bits)
      // VP8X: extended → 20字节处: flags(1) + size(3字节各24bit)
      // VP8L: lossless → 21字节处: signature(1) + size(4字节各28bit)
      const vp8Id = String.fromCharCode(byteAt(buf, 12), byteAt(buf, 13), byteAt(buf, 14), byteAt(buf, 15))
      if (vp8Id === 'VP8 ') {
        // VP8 lossy
        if (buf.length < 30) return null
        const w = (byteAt(buf, 26) & 0x3F) << 8 | byteAt(buf, 27)
        const h = (byteAt(buf, 28) & 0x3F) << 8 | byteAt(buf, 29)
        if (w === 0 || h === 0) return null
        return [w + 1, h + 1]
      }
      if (vp8Id === 'VP8L') {
        if (buf.length < 25) return null
        const bits = readU32LE(buf, 21)
        const w = (bits & 0x3FFF) + 1
        const h = ((bits >> 14) & 0x3FFF) + 1
        return [w, h]
      }
      if (vp8Id === 'VP8X') {
        if (buf.length < 30) return null
        const w = readU24LE(buf, 24) + 1
        const h = readU24LE(buf, 27) + 1
        return [w, h]
      }
      return null
    },
  },

  // ── BMP ──
  {
    name: 'BMP',
    mimes: ['image/bmp'],
    exts: ['.bmp'],
    readSize(buf) {
      if (buf[0] !== 0x42 || buf[1] !== 0x4D) return null
      // BMP header: 偏移 18 宽、22 高（有符号，可能有负值表示倒置）
      const w = buf.slice(18, 22)
      const h = buf.slice(22, 26)
      return [Math.abs(readI32LE(w, 0)), Math.abs(readI32LE(h, 0))]
    },
  },

  // ── TIFF ──
  {
    name: 'TIFF',
    mimes: ['image/tiff'],
    exts: ['.tiff', '.tif'],
    readSize(buf) {
      const littleEndian = buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A
      const bigEndian = buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x2A
      if (!littleEndian && !bigEndian) return null
      const le = littleEndian
      const ifdOffset = le ? readU32LE(buf, 4) : readU32BE(buf, 4)
      if (ifdOffset < 8 || ifdOffset + 2 > buf.length) return null
      const entryCount = le ? readU16LE(buf, ifdOffset) : readU16BE(buf, ifdOffset)
      for (let i = 0; i < entryCount && i < 20; i++) {
        const entryOff = ifdOffset + 2 + i * 12
        if (entryOff + 12 > buf.length) break
        const tag = le ? readU16LE(buf, entryOff) : readU16BE(buf, entryOff)
        if (tag === 0x0100) { // ImageWidth
          const type = le ? readU16LE(buf, entryOff + 2) : readU16BE(buf, entryOff + 2)
          const valOff = le ? readU32LE(buf, entryOff + 8) : readU32BE(buf, entryOff + 8)
          const w = parseTiffValue(type, valOff, le, buf)
          if (w === null) return null
          // Find ImageLength (height)
          for (let j = 0; j < entryCount && j < 20; j++) {
            const hOff = ifdOffset + 2 + j * 12
            if (hOff + 12 > buf.length) break
            const hTag = le ? readU16LE(buf, hOff) : readU16BE(buf, hOff)
            if (hTag === 0x0101) { // ImageLength
              const hType = le ? readU16LE(buf, hOff + 2) : readU16BE(buf, hOff + 2)
              const hValOff = le ? readU32LE(buf, hOff + 8) : readU32BE(buf, hOff + 8)
              const h = parseTiffValue(hType, hValOff, le, buf)
              if (h === null) return null
              return [w, h]
            }
          }
          return [w, 0]
        }
      }
      return null
    },
  },

  // ── ICO ──
  {
    name: 'ICO',
    mimes: ['image/x-icon', 'image/vnd.microsoft.icon'],
    exts: ['.ico'],
    readSize(buf) {
      if (buf[0] !== 0x00 || buf[1] !== 0x00 || buf[2] !== 0x01 || buf[3] !== 0x00) return null
      const count = readU16LE(buf, 4)
      if (count === 0) return null
      // 首个目录条目：宽(1)、高(1)、颜色数(1)、保留(1)、平面(2)、bpp(2)、size(4)、offset(4)
      const w = byteAt(buf, 6) === 0 ? 256 : byteAt(buf, 6)
      const h = byteAt(buf, 7) === 0 ? 256 : byteAt(buf, 7)
      return [w, h]
    },
  },

  // ── AVIF ──
  {
    name: 'AVIF',
    mimes: ['image/avif'],
    exts: ['.avif'],
    readSize(buf) {
      // AVIF 基于 ISOBMFF (ftyp box), 魔数: ftyp(4) + size(4) + "avif"/"avis"
      if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70) return null
      const majorBrand = String.fromCharCode(byteAt(buf, 8), byteAt(buf, 9), byteAt(buf, 10), byteAt(buf, 11))
      if (majorBrand !== 'avif' && majorBrand !== 'avis') return null
      // 简单实现：找到 av1C box (通常包含 width/height 信息)，近似取前几个 box
      // 精确解析需要完整的 ISOBMFF 解析器，这里取巧：读 meta box -> hdlr -> pitm -> iloc -> iprp -> ipco -> av1C
      // 简化方案：读取 ipco box 中的 av1C 的 width/height 或从 mdat box 取样本。
      // 暂不实现精确解析 AVIF 尺寸，返回 null 让调用方只显示格式和大小。
      // 如果能找到 av1C box 的序列号（0x81 0x12 00 xx），从这里读 seq_profile_idx
      for (let i = 12; i < buf.length - 4; i++) {
        if (buf[i] === 0x81 && buf[i + 1] === 0x12 && buf[i + 2] === 0x00) {
          // obu_sequence_header: frame_width/height 在 av1C 的 obu 数据里
          // 太深了，放弃
          break
        }
      }
      return null // 只回退到基本元信息
    },
  },
]

// ── 工具函数 ─────────────────────────────────────────────────────────────────

// 越界读一律按 0 处理：header 只有前 48 字节，截断处不能让 undefined 溜进位运算
// （undefined << 8 → NaN，尺寸会静默算错而不是解析失败）。
function byteAt(buf: Uint8Array, off: number): number {
  return buf[off] ?? 0
}

function readU16BE(buf: Uint8Array, off: number): number {
  return (byteAt(buf, off) << 8) | byteAt(buf, off + 1)
}

function readU16LE(buf: Uint8Array, off: number): number {
  return byteAt(buf, off) | (byteAt(buf, off + 1) << 8)
}

function readU32BE(buf: Uint8Array, off: number): number {
  return ((byteAt(buf, off) << 24) | (byteAt(buf, off + 1) << 16) | (byteAt(buf, off + 2) << 8) | byteAt(buf, off + 3)) >>> 0
}

function readU32LE(buf: Uint8Array, off: number): number {
  return ((byteAt(buf, off)) | (byteAt(buf, off + 1) << 8) | (byteAt(buf, off + 2) << 16) | (byteAt(buf, off + 3) << 24)) >>> 0
}

function readI32LE(buf: Uint8Array, off: number): number {
  const u = readU32LE(buf, off)
  return u > 0x7FFFFFFF ? u - 0x100000000 : u
}

function readU24LE(buf: Uint8Array, off: number): number {
  return byteAt(buf, off) | (byteAt(buf, off + 1) << 8) | (byteAt(buf, off + 2) << 16)
}

function parseTiffValue(
  type: number,
  valOff: number,
  le: boolean,
  buf: Uint8Array,
): number | null {
  // TIFF type: 1=BYTE, 2=ASCII, 3=SHORT(u16), 4=LONG(u32), 5=RATIONAL
  switch (type) {
    case 3: // SHORT
      return le ? readU16LE(buf, valOff) : readU16BE(buf, valOff)
    case 4: // LONG
      return le ? readU32LE(buf, valOff) : readU32BE(buf, valOff)
    default:
      return valOff
  }
}

// ── 导出 ─────────────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.ico', '.avif',
])

const IMAGE_MIME_PREFIXES = ['image/']

/** 尝试识别并读取图片元信息；非图片或读取失败返回 null。 */
export async function readImageInfo(
  filePath: string,
  file: import('bun').BunFile,
): Promise<ToolCallResult | null> {
  const lowPath = filePath.toLowerCase()
  const isKnownExt = IMAGE_EXTENSIONS.has(
    lowPath.includes('.') ? `.${lowPath.split('.').pop()}` : '',
  )

  if (!isKnownExt) {
    // 非已知图片扩展名 — 不干预；让文件走正常文本读取流程
    return null
  }

  // 读前 48 字节检测魔数
  const stream = file.stream()
  const reader = stream.getReader()
  let header: Uint8Array
  try {
    const { value, done } = await reader.read()
    if (done || !value) return null
    header = value
  } finally {
    reader.releaseLock()
  }

  // 取前 min(48, header.length) 字节
  const head = header.slice(0, Math.min(48, header.length))
  if (head.length < 4) return null // 任何格式至少需要 4 字节

  for (const fmt of FORMATS) {
    const dims = fmt.readSize(head)
    if (dims) {
      const [w, h] = dims
      const sizeKB = Math.round(file.size / 1024)
      const sizeStr = sizeKB >= 1024
        ? `${(sizeKB / 1024).toFixed(1)} MB`
        : `${sizeKB} KB`

      const dimStr = (w > 0 && h > 0) ? `${w}×${h}` : 'unknown'
      return {
        output: `📷 ${filePath.split('/').pop() || filePath}\n`
          + `  Format: ${fmt.name}\n`
          + `  Size:   ${dimStr} px\n`
          + `  File:   ${sizeStr} (${file.size} bytes)\n`,
        isError: false, // 不是错误——正常返回元信息
      }
    }
  }

  // 魔数不匹配——不是标准图片格式或文件损坏
  return {
    output: `File ${filePath} has a known image extension but does not appear to be a valid image (magic bytes don't match any supported format).`,
    isError: false,
  }
}
