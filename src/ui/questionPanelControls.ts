export interface QuestionPanelKey {
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
}

export interface QuestionPanelNavigationState {
  questionsLength: number
  qIndex: number
  optCursor: number[]
  optionCount: number
}

export interface QuestionPanelNavigationResult {
  qIndex: number
  optCursor: number[]
}

function setAt<T>(arr: T[], i: number, val: T): T[] {
  const next = arr.slice()
  next[i] = val
  return next
}

export function navigateQuestionPanel(
  state: QuestionPanelNavigationState,
  key: QuestionPanelKey,
): QuestionPanelNavigationResult | null {
  const lastQuestion = Math.max(0, state.questionsLength - 1)
  const currentCursor = state.optCursor[state.qIndex] ?? 0

  if (key.leftArrow) {
    return { qIndex: Math.max(0, state.qIndex - 1), optCursor: state.optCursor }
  }
  if (key.rightArrow) {
    return { qIndex: Math.min(lastQuestion, state.qIndex + 1), optCursor: state.optCursor }
  }
  if (key.upArrow) {
    return {
      qIndex: state.qIndex,
      optCursor: setAt(state.optCursor, state.qIndex, Math.max(0, currentCursor - 1)),
    }
  }
  if (key.downArrow) {
    return {
      qIndex: state.qIndex,
      optCursor: setAt(state.optCursor, state.qIndex, Math.min(state.optionCount, currentCursor + 1)),
    }
  }

  return null
}
