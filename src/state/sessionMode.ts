// 进程级会话模式单例
// 四种模式：
//   default — 标准权限提示
//   orbit   — 只读规划，禁止文件写操作
//   forge   — 自动接受所有变更，跳过权限确认
//   counsel — 执行前先向用户确认方向（AI 驱动问卷）

export type SessionMode = 'default' | 'orbit' | 'forge' | 'counsel'

let _mode: SessionMode = 'default'
// 进入 orbit 时保存上一个模式，ExitOrbitMode 恢复用
let _preModeRef: SessionMode = 'default'

export function getMode(): SessionMode {
  return _mode
}

export function setMode(mode: SessionMode): void {
  if (mode === 'orbit') {
    _preModeRef = _mode
  }
  _mode = mode
}

export function getPreMode(): SessionMode {
  return _preModeRef
}

export function restorePreMode(): void {
  _mode = _preModeRef
}
