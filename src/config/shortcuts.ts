// One shortcut registry: drives the keydown dispatcher in app/sumi.tsx, the
// Kbd labels in tooltips and the ? cheat sheet. Keys are matched by
// KeyboardEvent.code (so ⌥-letter combos work on macOS, where Option
// remaps the printed character) and an exact modifier set.
//
// "mod" is ⌘ on Mac and Ctrl elsewhere. Browser-reserved combos (⌘R, ⌘W,
// ⌘T, ⌘N, ⌘Q, ⌘L) are never bound.

export type Mod = 'mod' | 'shift' | 'alt' | 'ctrl'
export type Group = 'Core' | 'Arrange' | 'View' | 'Sumi'

export interface KeyCombo {
  code: string // KeyboardEvent.code, e.g. 'KeyZ', 'BracketRight', 'ArrowUp'
  mods?: Mod[]
  platform?: 'mac' | 'win' // only bound on that platform
  label?: string // display override for the main key (defaults from code)
}

export interface Shortcut {
  id: string
  group: Group
  label: string
  combos: KeyCombo[] // first combo is the one shown in tooltips
  needsSelection?: boolean
  hint?: string // extra note in the cheat sheet
}

const S = (id: string, group: Group, label: string, combos: KeyCombo[], extra: Partial<Shortcut> = {}): Shortcut => ({ id, group, label, combos, ...extra })

export const SHORTCUTS: Shortcut[] = [
  // ── Core ──
  S('undo', 'Core', 'Undo', [{ code: 'KeyZ', mods: ['mod'] }]),
  S('redo', 'Core', 'Redo', [{ code: 'KeyZ', mods: ['mod', 'shift'] }, { code: 'KeyY', mods: ['ctrl'], platform: 'win' }]),
  S('copy', 'Core', 'Copy', [{ code: 'KeyC', mods: ['mod'] }], { needsSelection: true }),
  S('cut', 'Core', 'Cut', [{ code: 'KeyX', mods: ['mod'] }], { needsSelection: true }),
  S('paste', 'Core', 'Paste', [{ code: 'KeyV', mods: ['mod'] }], { hint: 'offset' }),
  S('pasteInPlace', 'Core', 'Paste in place', [{ code: 'KeyV', mods: ['mod', 'shift'] }]),
  S('duplicate', 'Core', 'Duplicate', [{ code: 'KeyD', mods: ['mod'] }], { needsSelection: true }),
  S('delete', 'Core', 'Delete', [{ code: 'Backspace', label: '⌫' }, { code: 'Delete', label: 'Del' }], { needsSelection: true }),
  S('selectAll', 'Core', 'Select all', [{ code: 'KeyA', mods: ['mod'] }]),
  S('escape', 'Core', 'Deselect · close · cancel', [{ code: 'Escape', label: 'Esc' }]),
  S('nudge', 'Core', 'Nudge 0.5%', [{ code: 'ArrowUp', label: '↑' }, { code: 'ArrowDown', label: '↓' }, { code: 'ArrowLeft', label: '←' }, { code: 'ArrowRight', label: '→' }], { needsSelection: true }),
  S('nudgeBig', 'Core', 'Nudge 5%', [{ code: 'ArrowUp', mods: ['shift'], label: '↑' }, { code: 'ArrowDown', mods: ['shift'], label: '↓' }, { code: 'ArrowLeft', mods: ['shift'], label: '←' }, { code: 'ArrowRight', mods: ['shift'], label: '→' }], { needsSelection: true }),
  S('save', 'Core', 'Save page', [{ code: 'KeyS', mods: ['mod'] }]),
  // ── Arrange ──
  S('forward', 'Arrange', 'Bring forward', [{ code: 'BracketRight', mods: ['mod'], label: ']' }], { needsSelection: true }),
  S('backward', 'Arrange', 'Send backward', [{ code: 'BracketLeft', mods: ['mod'], label: '[' }], { needsSelection: true }),
  S('front', 'Arrange', 'Bring to front', [{ code: 'BracketRight', mods: ['mod', 'shift'], label: ']' }], { needsSelection: true }),
  S('back', 'Arrange', 'Send to back', [{ code: 'BracketLeft', mods: ['mod', 'shift'], label: '[' }], { needsSelection: true }),
  S('alignLeft', 'Arrange', 'Align left', [{ code: 'KeyA', mods: ['alt'] }], { needsSelection: true }),
  S('alignRight', 'Arrange', 'Align right', [{ code: 'KeyD', mods: ['alt'] }], { needsSelection: true }),
  S('alignCenterX', 'Arrange', 'Align centre (x)', [{ code: 'KeyH', mods: ['alt'] }], { needsSelection: true }),
  S('alignTop', 'Arrange', 'Align top', [{ code: 'KeyW', mods: ['alt'] }], { needsSelection: true }),
  S('alignBottom', 'Arrange', 'Align bottom', [{ code: 'KeyS', mods: ['alt'] }], { needsSelection: true }),
  S('alignCenterY', 'Arrange', 'Align centre (y)', [{ code: 'KeyV', mods: ['alt'] }], { needsSelection: true }),
  S('distributeH', 'Arrange', 'Distribute (x)', [{ code: 'KeyH', mods: ['ctrl', 'alt'] }], { needsSelection: true }),
  S('distributeV', 'Arrange', 'Distribute (y)', [{ code: 'KeyV', mods: ['ctrl', 'alt'] }], { needsSelection: true }),
  S('hide', 'Arrange', 'Hide / show', [{ code: 'KeyH', mods: ['mod', 'shift'] }], { needsSelection: true }),
  S('lock', 'Arrange', 'Lock / unlock', [{ code: 'KeyL', mods: ['mod', 'shift'] }], { needsSelection: true }),
  // ── View ──
  S('zoomFit', 'View', 'Zoom to fit', [{ code: 'Digit1', mods: ['shift'], label: '1' }]),
  S('zoom100', 'View', 'Zoom 100%', [{ code: 'Digit0', mods: ['shift'], label: '0' }]),
  S('zoomIn', 'View', 'Zoom in', [{ code: 'Equal', mods: ['mod'], label: '+' }, { code: 'NumpadAdd', mods: ['mod'], label: '+' }]),
  S('zoomOut', 'View', 'Zoom out', [{ code: 'Minus', mods: ['mod'], label: '−' }, { code: 'NumpadSubtract', mods: ['mod'], label: '−' }]),
  S('pan', 'View', 'Pan', [{ code: 'Space', label: 'Space' }], { hint: 'hold + drag' }),
  S('toggleUI', 'View', 'Toggle panels', [{ code: 'Backslash', mods: ['mod'], label: '\\' }]),
  // ── Sumi ──
  S('addShape', 'Sumi', 'Add shape', [{ code: 'KeyS' }]),
  S('addDots', 'Sumi', 'Add dots', [{ code: 'KeyD' }]),
  S('addText', 'Sumi', 'Add text', [{ code: 'KeyT' }]),
  S('addTexture', 'Sumi', 'Add texture', [{ code: 'KeyX' }]),
  S('addAscii', 'Sumi', 'Add ascii', [{ code: 'KeyA' }]),
  S('addImage', 'Sumi', 'Add image', [{ code: 'KeyI' }]),
  S('addSubject', 'Sumi', 'Add subject', [{ code: 'KeyK' }]),
  S('inspo', 'Sumi', 'Inspo', [{ code: 'KeyR' }], { hint: 'toggle' }),
  S('inspoMore', 'Sumi', 'More Inspo', [{ code: 'KeyM' }], { hint: 'while open' }),
  S('export', 'Sumi', 'Export', [{ code: 'KeyE', mods: ['mod'] }]),
  S('cheatSheet', 'Sumi', 'Keyboard shortcuts', [{ code: 'Slash', mods: ['shift'], label: '?' }]),
]

export const SHORTCUT = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s])) as Record<string, Shortcut>

export const isMacPlatform = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

// ── Matching ──
function comboMatches(e: KeyboardEvent, c: KeyCombo, mac: boolean): boolean {
  if (c.platform && (c.platform === 'mac') !== mac) return false
  if (e.code !== c.code) return false
  const mods = new Set(c.mods ?? [])
  const wantMeta = mac ? mods.has('mod') : false
  const wantCtrl = mods.has('ctrl') || (!mac && mods.has('mod'))
  return e.metaKey === wantMeta && e.ctrlKey === wantCtrl && e.shiftKey === mods.has('shift') && e.altKey === mods.has('alt')
}

// First registry entry the event matches, in declaration order.
export function matchShortcut(e: KeyboardEvent, mac: boolean): Shortcut | null {
  for (const s of SHORTCUTS) if (s.combos.some((c) => comboMatches(e, c, mac))) return s
  return null
}

// ── Labels ──
const CODE_LABEL: Record<string, string> = {
  Space: 'Space', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Enter: '↵',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Equal: '=', Minus: '−', Period: '.', Comma: ',',
}
export function keyLabel(c: KeyCombo): string {
  if (c.label) return c.label
  if (CODE_LABEL[c.code]) return CODE_LABEL[c.code]
  const m = /^(Key|Digit)(.)$/.exec(c.code)
  return m ? m[2].toUpperCase() : c.code
}

// Chips for one combo, platform-aware: ['⌘','⇧','Z'] or ['Ctrl','Shift','Z'].
export function comboChips(c: KeyCombo, mac: boolean): string[] {
  const out: string[] = []
  const mods = c.mods ?? []
  if (mods.includes('ctrl')) out.push(mac ? '⌃' : 'Ctrl')
  if (mods.includes('alt')) out.push(mac ? '⌥' : 'Alt')
  if (mods.includes('shift')) out.push(mac ? '⇧' : 'Shift')
  if (mods.includes('mod')) out.push(mac ? '⌘' : 'Ctrl')
  out.push(keyLabel(c))
  return out
}

// The combo to show for a shortcut on this platform (first one bound here).
export function shortcutChips(id: string, mac: boolean): string[] {
  const s = SHORTCUT[id]
  if (!s) return []
  const c = s.combos.find((x) => !x.platform || (x.platform === 'mac') === mac) ?? s.combos[0]
  return comboChips(c, mac)
}

// Plain-text form for native title attributes / aria: "⌘⇧Z" or "Ctrl+Shift+Z".
export function shortcutText(id: string, mac: boolean): string {
  const chips = shortcutChips(id, mac)
  return mac ? chips.join('') : chips.join('+')
}
