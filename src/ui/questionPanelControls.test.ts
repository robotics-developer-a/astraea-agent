import { expect, test } from 'bun:test'
import { navigateQuestionPanel } from './questionPanelControls'

test('left and right arrows switch questions without moving option cursor', () => {
  const state = { questionsLength: 3, qIndex: 1, optCursor: [0, 2, 1], optionCount: 4 }

  expect(navigateQuestionPanel(state, { leftArrow: true })).toEqual({
    qIndex: 0,
    optCursor: [0, 2, 1],
  })
  expect(navigateQuestionPanel(state, { rightArrow: true })).toEqual({
    qIndex: 2,
    optCursor: [0, 2, 1],
  })
})

test('up and down arrows move the current question cursor without switching questions', () => {
  const state = { questionsLength: 2, qIndex: 1, optCursor: [0, 1], optionCount: 3 }

  expect(navigateQuestionPanel(state, { upArrow: true })).toEqual({
    qIndex: 1,
    optCursor: [0, 0],
  })
  expect(navigateQuestionPanel(state, { downArrow: true })).toEqual({
    qIndex: 1,
    optCursor: [0, 2],
  })
})

test('question and option navigation clamps at panel bounds', () => {
  expect(navigateQuestionPanel({ questionsLength: 2, qIndex: 0, optCursor: [0], optionCount: 2 }, { leftArrow: true })?.qIndex).toBe(0)
  expect(navigateQuestionPanel({ questionsLength: 2, qIndex: 1, optCursor: [0, 2], optionCount: 2 }, { rightArrow: true })?.qIndex).toBe(1)
  expect(navigateQuestionPanel({ questionsLength: 1, qIndex: 0, optCursor: [0], optionCount: 2 }, { upArrow: true })?.optCursor).toEqual([0])
  expect(navigateQuestionPanel({ questionsLength: 1, qIndex: 0, optCursor: [2], optionCount: 2 }, { downArrow: true })?.optCursor).toEqual([2])
})
