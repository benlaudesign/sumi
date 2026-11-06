'use client'
// ? — keyboard shortcut cheat sheet, grouped like the registry.
import { Kbd } from './Kbd'
import { comboChips, SHORTCUTS, type Group } from '../config/shortcuts'

const GROUPS: Group[] = ['Core', 'Arrange', 'View', 'Sumi']

export function CheatSheet({ mac, onClose, hidden = [] }: { mac: boolean; onClose: () => void; hidden?: string[] }) {
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/30 p-6" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-[min(960px,100%)] overflow-y-auto rounded-lg border border-neutral-300 bg-paper p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-sans text-[14px] font-medium text-ink">
            <span className="h-2.5 w-2.5 rounded-full bg-red" aria-hidden="true" />
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2 py-1 font-mono text-[11px] text-ink hover:border-neutral-500" aria-label="Close">
            Close <Kbd>Esc</Kbd>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-4">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{g}</h3>
              <ul className="space-y-1.5">
                {SHORTCUTS.filter((s) => s.group === g && !hidden.includes(s.id)).map((s) => {
                  const combos = s.combos.filter((c) => !c.platform || (c.platform === 'mac') === mac)
                  // Arrow clusters collapse to the modifiers once + one key of each arrow.
                  const arrows = s.id === 'nudge' || s.id === 'nudgeBig'
                  const show = arrows ? [{ ...combos[0], label: '↑ ↓ ← →' }] : combos.slice(0, 1)
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 font-mono text-[11px] text-ink">
                      <span className="truncate">
                        {s.label}
                        {s.hint && <span className="ml-1 text-neutral-700">· {s.hint}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        {show.map((c, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            {comboChips(c, mac).map((k, j) => (
                              <Kbd key={j}>{k}</Kbd>
                            ))}
                          </span>
                        ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
