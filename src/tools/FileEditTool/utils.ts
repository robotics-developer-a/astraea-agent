// FileEditTool 工具函数
// 参考: astraea-trace-and-build / FileEditTool 教学文档 Step 3

/** 将弯引号规范化为直引号，用于 LLM 输出与文件内容的模糊匹配 */
function normalizeQuotes(s: string): string {
  return s
    .replace(/“|”/g, '"') // " " → "
    .replace(/‘|’/g, "'") // ' ' → '
}

/**
 * 在 fileContent 中查找 searchString。
 * 先精确匹配，失败则做引号规范化后再试。
 * 返回文件中实际存在的文本片段（保留原始引号），或 null。
 */
export function findActualString(fileContent: string, searchString: string): string | null {
  if (searchString === '') return ''
  if (fileContent.includes(searchString)) return searchString

  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const idx = normalizedFile.indexOf(normalizedSearch)
  if (idx === -1) return null

  // 返回文件中的原始片段（长度与 searchString 相同）
  return fileContent.substring(idx, idx + searchString.length)
}

/**
 * 若文件中的实际字符串含有弯引号（LLM 输出的是直引号，匹配时被规范化），
 * 则对 newString 中的直引号做相同转换，保持文件排版风格。
 */
export function preserveQuoteStyle(
  originalOld: string,
  actualOld: string,
  newString: string,
): string {
  if (originalOld === actualOld) return newString

  const hasCurlyDouble = /“|”/.test(actualOld)
  const hasCurlySingle = /‘|’/.test(actualOld)
  if (!hasCurlyDouble && !hasCurlySingle) return newString

  let result = newString
  if (hasCurlyDouble) {
    let open = true
    result = result.replace(/"/g, () => {
      const q = open ? '“' : '”'
      open = !open
      return q
    })
  }
  if (hasCurlySingle) {
    let open = true
    result = result.replace(/'/g, () => {
      const q = open ? '‘' : '’'
      open = !open
      return q
    })
  }
  return result
}

/**
 * 在 fileContents 中将 oldString 替换为 newString。
 * replaceAll=true 时替换全部匹配；否则只替换第一处。
 * old_string 为空表示创建新文件，直接返回 newString。
 */
export function applyEdit(
  fileContents: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (oldString === '') return newString

  if (replaceAll) {
    return fileContents.split(oldString).join(newString)
  }

  const idx = fileContents.indexOf(oldString)
  if (idx === -1) return fileContents
  return fileContents.substring(0, idx) + newString + fileContents.substring(idx + oldString.length)
}

/** 生成简易 unified-diff 风格的差异字符串（用于 ToolCallResult 输出展示） */
export function formatDiff(oldString: string, newString: string): string {
  const removed = oldString.split('\n').map((l) => `- ${l}`).join('\n')
  const added = newString.split('\n').map((l) => `+ ${l}`).join('\n')
  return `${removed}\n${added}`
}
