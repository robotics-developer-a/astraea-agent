export function expandPasteTokens(text: string, store: Map<string, string>): string {
  let out = text
  for (const [token, content] of store) {
    if (out.includes(token)) {
      out = out.split(token).join(content)
      store.delete(token)
    }
  }
  return out
}
