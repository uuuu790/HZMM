// @vitest-environment happy-dom
// The report dialog as a player uses it: everything that would be sent is on
// screen and readable, unticked parts are not sent, the note goes along, and
// a failed send says so and offers to save the report instead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ReportModal from '../../src/renderer/src/components/modals/ReportModal.jsx'
import ToastContainer from '../../src/renderer/src/components/common/ToastContainer.jsx'
import { setReportOpener, reportToastOptions } from '../../src/renderer/src/utils/report-bridge.js'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t = UI_TEXT['zh-TW']

const SECTIONS = [
  { key: 'context', text: 'Install failed: boom' },
  { key: 'app', text: 'HZMM: 1.8.0 (portable)' },
  { key: 'log', text: '[INFO] started' },
]

const mounted = []
async function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(node))
  mounted.push({ root, el })
  return el
}

let api
beforeEach(() => {
  api = {
    collect: vi.fn(async () => ({ token: 'tok-1', sections: SECTIONS })),
    send: vi.fn(async () => ({ id: 'AB12-CD34' })),
    save: vi.fn(async () => 'C:\\Desktop\\HZMM-report.txt'),
  }
  window.api = { report: api }
})

afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  delete window.api
})

const buttonByText = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.includes(text))
const click = async (node) => { await act(async () => { node.click() }) }
const typeInto = async (node, value) => {
  const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  await act(async () => {
    setter.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ReportModal', () => {
  it('renders nothing until a report is requested', async () => {
    const el = await mount(<ReportModal request={null} onClose={() => {}} t={t} />)
    expect(el.innerHTML).toBe('')
    expect(api.collect).not.toHaveBeenCalled()
  })

  it('lists every part with its title, and shows its full text on request', async () => {
    const el = await mount(<ReportModal request={{ source: 'error-toast', context: 'Install failed: boom' }} onClose={() => {}} t={t} />)
    expect(api.collect).toHaveBeenCalledWith('error-toast', 'Install failed: boom')
    for (const title of [t.reportSectionContext, t.reportSectionApp, t.reportSectionLog]) expect(el.textContent).toContain(title)
    expect(el.textContent).not.toContain('HZMM: 1.8.0 (portable)')
    await click(buttonByText(el.querySelectorAll('[aria-expanded]')[1].parentElement, t.reportShowContent))
    expect(el.querySelector('pre').textContent).toBe('HZMM: 1.8.0 (portable)')
    expect(el.textContent).toContain(t.reportNeverSent)
  })

  it('sends only the ticked parts with the note and Nexus name, then shows the report id', async () => {
    const el = await mount(<ReportModal request={{ source: 'settings', context: null }} onClose={() => {}} t={t} />)
    const boxes = el.querySelectorAll('input[type="checkbox"]')
    expect([...boxes].every(b => b.checked)).toBe(true)
    await click(boxes[2]) // untick the log
    await typeInto(el.querySelector('#report-note'), '按下安裝沒有反應')
    await typeInto(el.querySelector('#report-nexus-name'), 'Jane')
    await click(buttonByText(el, t.reportSend))
    expect(api.send).toHaveBeenCalledWith('tok-1', ['context', 'app'], '按下安裝沒有反應', 'Jane')
    expect(el.textContent).toContain(t.reportSentTitle)
    expect(el.textContent).toContain('AB12-CD34')
    expect(el.textContent).toContain(t.reportSentHint)
  })

  it('will not send with nothing ticked and no note', async () => {
    const el = await mount(<ReportModal request={{ source: 'settings' }} onClose={() => {}} t={t} />)
    for (const box of el.querySelectorAll('input[type="checkbox"]')) await click(box)
    expect(buttonByText(el, t.reportSend).disabled).toBe(true)
    await typeInto(el.querySelector('#report-note'), 'only a note')
    expect(buttonByText(el, t.reportSend).disabled).toBe(false)
  })

  it('a failed send shows why, keeps everything, and can save the report as a file', async () => {
    api.send.mockRejectedValueOnce(new Error("Error invoking remote method 'report:send': Error: The report server answered HTTP 500"))
    const el = await mount(<ReportModal request={{ source: 'settings' }} onClose={() => {}} t={t} />)
    await typeInto(el.querySelector('#report-note'), 'note stays')
    await click(buttonByText(el, t.reportSend))
    expect(el.textContent).toContain(`${t.reportSendFailed} The report server answered HTTP 500`)
    expect(el.textContent).not.toContain('Error invoking remote method')
    expect(el.querySelector('#report-note').value).toBe('note stays')
    await click(buttonByText(el, t.reportSaveFile))
    expect(api.save).toHaveBeenCalledWith('tok-1', ['context', 'app', 'log'], 'note stays', '')
    expect(el.textContent).toContain('C:\\Desktop\\HZMM-report.txt')
    await click(buttonByText(el, t.retry))
    expect(el.textContent).toContain('AB12-CD34')
  })

  it('a failed collect offers a retry', async () => {
    api.collect.mockRejectedValueOnce(new Error('disk on fire'))
    const el = await mount(<ReportModal request={{ source: 'settings' }} onClose={() => {}} t={t} />)
    expect(el.textContent).toContain(t.reportCollectFailed)
    expect(el.textContent).toContain('disk on fire')
    await click(buttonByText(el, t.retry))
    expect(api.collect).toHaveBeenCalledTimes(2)
    expect(el.textContent).toContain(t.reportSectionApp)
  })
})

describe('error toast → report', () => {
  it('the toast button opens the report with the error as its context', async () => {
    const opened = []
    setReportOpener((req) => opened.push(req))
    const options = reportToastOptions(t, '安裝失敗：boom')
    const dismissed = []
    const el = await mount(
      <ToastContainer toasts={[{ id: 7, message: '安裝失敗：boom', type: 'error', action: options.action }]} onDismiss={(id) => dismissed.push(id)} />
    )
    await click(buttonByText(el, t.reportThisProblem))
    expect(opened).toEqual([{ source: 'error-toast', context: '安裝失敗：boom' }])
    expect(dismissed).toEqual([7])
    expect(options.duration).toBeGreaterThan(3000)
    setReportOpener(null)
  })
})
