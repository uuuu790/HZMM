// @vitest-environment happy-dom
// The conflict dialog shows the game's real verdict, sent by the main process:
// paks load by their path under Content/Paks, so a pak in a later folder
// (~mods beats Paks/mods/) wins whatever the filenames — and "Make it win" is
// only offered where a rename can actually change the winner.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ConflictModal from '../../src/renderer/src/components/modals/ConflictModal.jsx'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return el
}

afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
})

const t = UI_TEXT.en
const rowOf = (el, filename) =>
  [...el.querySelectorAll('div.flex.items-center.gap-2')].find(r => r.textContent.includes(filename))

describe('ConflictModal', () => {
  it('trophies the reported winner, labels folders, and offers only renames that can win', () => {
    const onMakeWin = vi.fn()
    const el = mount(
      <ConflictModal
        isOpen onClose={() => {}} scanning={false} makingWin={null} onMakeWin={onMakeWin} t={t}
        conflicts={[{
          resource: 'Game/x.uasset',
          mods: ['A_P.pak', 'B_P.pak', 'Z_P.pak'],
          dirs: ['~mods', '~mods', 'mods'],
          winner: 'B_P.pak',
          canWin: ['A_P.pak'],
        }]}
      />
    )

    const winner = rowOf(el, 'B_P.pak')
    expect(winner.textContent).toContain(t.conflictWinner)
    expect(winner.textContent).toContain('Paks/~mods')

    const later = rowOf(el, 'Z_P.pak')
    expect(later.textContent).toContain('Paks/mods')
    expect(later.textContent).toContain(t.conflictFolderWins)
    expect(later.querySelector('button')).toBeNull()

    const renamable = rowOf(el, 'A_P.pak')
    const button = renamable.querySelector('button')
    expect(button.textContent).toContain(t.conflictMakeWin)
    act(() => button.click())
    expect(onMakeWin).toHaveBeenCalledWith('A_P.pak', ['B_P.pak', 'Z_P.pak'])
  })

  it('without a verdict (single folder) the alphabetically last pak wins and the rest can be made to', () => {
    const el = mount(
      <ConflictModal
        isOpen onClose={() => {}} scanning={false} makingWin={null} onMakeWin={() => {}} t={t}
        conflicts={[{ resource: 'Game/x.uasset', mods: ['A.pak', 'B.pak'] }]}
      />
    )
    expect(rowOf(el, 'B.pak').textContent).toContain(t.conflictWinner)
    expect(rowOf(el, 'A.pak').querySelector('button')).not.toBeNull()
    expect(el.textContent).not.toContain('Paks/')
  })
})
