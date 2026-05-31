// MCP 连接类型
// 参考 claude-code-main/src/services/mcp/types.ts

export type MCPTool = {
  name: string
  description: string
}

export type MCPServerConnection =
  | { type: 'pending'; name: string }
  | { type: 'failed'; name: string; error: string }
  | ConnectedMCPServer

export type MCPResource = {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type ConnectedMCPServer = {
  type: 'connected'
  name: string
  instructions?: string
  tools: MCPTool[]
  /** Resources exposed by this MCP server (populated lazily). */
  resources?: MCPResource[]
}
