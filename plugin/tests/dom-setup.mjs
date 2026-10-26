/**
 * The jsdom environment for the UI tests.
 *
 * This module must be imported before `react-dom`, because React decides at
 * module load time whether a DOM exists; when it decides "no", it listens for
 * `change` instead of `input` and controlled inputs never react to typing.
 */
import { JSDOM } from 'jsdom'

export const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })

globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.HTMLInputElement = dom.window.HTMLInputElement
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement
globalThis.Node = dom.window.Node
globalThis.Element = dom.window.Element
globalThis.Event = dom.window.Event
globalThis.InputEvent = dom.window.InputEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true
