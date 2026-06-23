export interface ToolEvidenceRecord {
  id: string
  tool: string
  output: string
  isError?: boolean
  recordedAt?: string
}

const _toolEvidence = new Map<string, Map<string, ToolEvidenceRecord>>()

export function recordToolEvidence(namespace: string, record: ToolEvidenceRecord): void {
  if (record.isError || record.tool === 'TodoWrite') return
  const scoped = _toolEvidence.get(namespace) ?? new Map<string, ToolEvidenceRecord>()
  scoped.set(record.id, { ...record, recordedAt: record.recordedAt ?? new Date().toISOString() })
  _toolEvidence.set(namespace, scoped)
}

export function hasToolEvidence(namespace: string, id: string): boolean {
  return _toolEvidence.get(namespace)?.has(id) ?? false
}

export function clearToolEvidence(namespace: string): void {
  _toolEvidence.delete(namespace)
}
