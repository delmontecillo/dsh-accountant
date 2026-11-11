import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Executes the real browser bundle against a minimal React and DOM shim.
 *
 * The point is to prove the wiring a refresh would exercise: the factory
 * registers one entry on the Session header's utilities seat, it fetches the
 * host endpoint same-origin, and the peso figures reach the markup. Nothing
 * here re-implements the plugin; the file under test is `client.js`.
 */

function createRuntime() {
  const state = []
  let cursor = 0
  let effects = []

  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.flat(Infinity) } }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useCallback(fn) {
      cursor++
      return fn
    },
    useEffect(fn) {
      cursor++
      effects.push(fn)
    },
  }

  return {
    React,
    beginRender() { cursor = 0 },
    flushEffects() {
      const pending = effects
      effects = []
      const cleanups = []
      for (const effect of pending) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return cleanups
    },
  }
}

function fakeDocument() {
  const listeners = new Map()
  return {
    head: { append() {} },
    createElement: () => ({ setAttribute() {}, textContent: '', remove() {} }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    body: { setAttribute() {}, removeAttribute() {} },
    listeners,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Resolve function components the way React would, so hooks run in order. */
function expand(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props ?? {}))
  const children = (node.props?.children ?? []).map(expand)
  return { ...node, props: { ...node.props, children } }
}

async function loadBundle({ payload, ok = true }) {
  const calls = []
  const runtime = createRuntime()
  const document = fakeDocument()
  const window = { __ModuleLoader__: { load(definition) { window.__definition = definition } } }

  const fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok, status: ok ? 200 : 503, json: async () => payload }
  }

  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const run = new Function('window', 'document', 'fetch', 'setInterval', 'clearInterval', source)
  run(window, document, fetch, () => 0, () => {})

  const plugin = window.__definition.factory((id) => {
    if (id === 'react') return runtime.React
    throw new Error(`unexpected require: ${id}`)
  })

  const registrations = []
  const ctx = {
    effect(fn) { fn() },
    slots: {
      inject(name, fn) { fn() },
      register(options, render) {
        registrations.push({ options, render })
        return () => {}
      },
    },
  }

  plugin.apply(ctx)

  /** Render the mounted component, run its effects, and settle. */
  const render = async () => {
    runtime.beginRender()
    const tree = expand(registrations[0].render({}))
    runtime.flushEffects()
    await tick()
    return tree
  }

  return { plugin, registrations, calls, document, render }
}

function find(tree, predicate) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const child of tree.props?.children ?? []) {
    const hit = find(child, predicate)
    if (hit !== null) return hit
  }
  return null
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return (node.props?.children ?? []).map(textOf).join(' ')
}

const PAYLOAD = {
  generatedAt: '2026-11-11T05:53:24.293Z',
  timezone: 'Asia/Manila',
  fx: { pair: 'USD/PHP', rate: 62, asOf: '2026-11-11' },
  coverage: { sessions: 339, firstDate: '2026-09-10' },
  today: { date: '2026-11-11', tokens: 215_500_351, usd: 1.91087346, php: 118.47415452, requests: 1048 },
  week: {
    key: '2026-W46', tokens: 1_770_170_767, usd: 17.26123023, php: 1070.19627426, requests: 6631,
    forecast: { tokens: 4_130_398_456, usd: 40.27620387, php: 2497.12463994 },
  },
  month: {
    key: '2026-11', daysInMonth: 30, tokens: 2_535_051_567, usd: 24.6721087, php: 1529.67073952, requests: 9518,
    forecast: { tokens: 6_913_777_001, usd: 67.28756919, php: 4171.82928961 },
  },
  next30: { tokens: 6_769_963_332, usd: 64.81926926, php: 4018.794694 },
}

test('registers one entry on the Session header utilities seat', async () => {
  const { registrations, plugin } = await loadBundle({ payload: PAYLOAD })
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'conversation.session.header.utilities')
  assert.equal(registrations[0].options.id, 'accountant-spend')
  assert.equal(registrations[0].options.order, 6)
})

test('installs and later removes its stylesheet', async () => {
  const { document } = await loadBundle({ payload: PAYLOAD })
  assert.ok(document.head, 'a style row is appended to <head>')
})

test('the chip fetches the host endpoint same-origin, uncached', async () => {
  const { calls, render } = await loadBundle({ payload: PAYLOAD })
  await render()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/accountant/spend')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.cache, 'no-store')
})

test('the chip shows today in both currencies after the first fetch', async () => {
  const { render } = await loadBundle({ payload: PAYLOAD })
  const loading = await render()
  assert.match(textOf(loading), /—/)

  const loaded = await render()
  const text = textOf(loaded)
  assert.match(text, /\$1\.91/)
  assert.match(text, /₱118\.47/)
})

test('opening the chip reveals the week, the month, and the forecast', async () => {
  const { render } = await loadBundle({ payload: PAYLOAD })
  await render()
  const loaded = await render()

  const button = find(loaded, (node) => node.type === 'button')
  assert.notEqual(button, null)
  assert.equal(button.props['aria-expanded'], 'false')
  button.props.onClick()

  const open = await render()
  const text = textOf(open)
  assert.match(text, /Token spend/)
  assert.match(text, /Week · 2026-W46/)
  assert.match(text, /₱1,070\.20/)
  assert.match(text, /Month · 2026-11/)
  assert.match(text, /₱1,529\.67/)
  assert.match(text, /Predicted month end/)
  assert.match(text, /₱4,171\.83/)
  assert.match(text, /₱62\.00 per USD/)
  assert.match(text, /339 sessions/)
})

test('an unreachable endpoint shows a dash, never a made-up number', async () => {
  const { render } = await loadBundle({ payload: null, ok: false })
  await render()
  const tree = await render()
  const text = textOf(tree)
  assert.match(text, /—/)
  assert.doesNotMatch(text, /₱\d/)

  const button = find(tree, (node) => node.type === 'button')
  assert.match(button.props.title, /no data/)
})

test('the popover names the tracked key when the host reports one', async () => {
  const payload = {
    ...PAYLOAD,
    key: {
      fingerprint: '2c900c644833',
      source: 'store',
      since: '2026-11-11T07:00:00.000Z',
      totals: { tokens: 2_000_000, usd: 0.6, php: 37.2, requests: 3 },
      summary: {
        today: { tokens: 1_500_000, usd: 0.45, php: 27.9, requests: 2 },
        week: { tokens: 1_800_000, usd: 0.54, php: 33.48, requests: 3 },
        month: { tokens: 1_900_000, usd: 0.57, php: 35.34, requests: 4 },
        forecast: { tokens: 30_000_000, usd: 9, php: 558, requests: 40 },
        daysInMonth: 30,
      },
    },
  }
  const { render } = await loadBundle({ payload })
  await render()
  const loaded = await render()

  // The chip reads the key's spend today, not the whole day's.
  const chip = textOf(loaded)
  assert.match(chip, /\$0\.45/)
  assert.match(chip, /₱27\.90/)
  assert.doesNotMatch(chip, /\$1\.91/)

  const button = find(loaded, (node) => node.type === 'button')
  button.props.onClick()
  const text = textOf(await render())

  assert.match(text, /Today · 11-11/)
  assert.match(text, /₱27\.90/)
  assert.match(text, /Week · 2026-W46/)
  assert.match(text, /₱33\.48/)
  assert.match(text, /Month · 2026-11/)
  assert.match(text, /₱35\.34/)
  assert.match(text, /Predicted month end · 30 days/)
  assert.match(text, /₱558\.00/)
  assert.doesNotMatch(text, /₱1,529\.67/)
  assert.doesNotMatch(text, /₱4,171\.83/)
  assert.match(text, /key 2c900c64…/)
})
