export function inkRenderOptions(platform: NodeJS.Platform): { incrementalRendering?: boolean } {
  return platform === 'win32' ? { incrementalRendering: true } : {}
}
