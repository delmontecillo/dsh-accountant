/**
 * Per-session tag overrides and tag aliases, kept beside the config so a
 * person can label any session — not just every session in a folder — and
 * retire a tag by moving its sessions to another one.
 *
 * The file is `<dataDir>/accountant.session-tags.json`:
 * `{ version: 1, tags: { "<sessionId>": "work" }, aliases: { "old": "new" } }`.
 * A missing file means no overrides. An unreadable file is reported to writes
 * (so a save never wipes content it could not read) and treated as empty by
 * reads. Writes are serialized and atomic, and an empty tag clears the
 * override rather than storing a blank one.
 *
 * @module accountant/session-tags
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const VERSION = 1
const MAX_TAG_LENGTH = 40
const MAX_ALIAS_HOPS = 10

/** Where the overrides live. */
export function sessionTagsPath(dataDir) {
  return join(dataDir, 'accountant.session-tags.json')
}

/** Trim a tag and reject the empty or unprintable forms; null means "no tag". */
export function normalizeTag(raw) {
  if (typeof raw !== 'string') return null
  const tag = raw.trim()
  if (tag === '' || tag.length > MAX_TAG_LENGTH) return null
  return /[\u0000-\u001f\u007f]/.test(tag) ? null : tag
}

/** Follow `old → new` aliases, stopping on a loop or a missing link. */
export function resolveTag(tag, aliases = {}) {
  let current = tag
  for (let hops = 0; hops < MAX_ALIAS_HOPS; hops += 1) {
    const next = aliases[current]
    if (next === undefined || next === current) return current
    current = next
  }
  return current
}

/** Read the whole document. A corrupt or unsupported file throws. */
async function readTagDoc(dataDir) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(sessionTagsPath(dataDir), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { version: VERSION, tags: {}, aliases: {} }
    throw error
  }
  if (parsed?.version !== VERSION) throw new Error('unsupported session-tags document')

  const tags = {}
  if (parsed.tags !== null && typeof parsed.tags === 'object' && !Array.isArray(parsed.tags)) {
    for (const [id, value] of Object.entries(parsed.tags)) {
      const tag = normalizeTag(value)
      if (typeof id === 'string' && id !== '' && tag !== null) tags[id] = tag
    }
  }
  const aliases = {}
  if (parsed.aliases !== null && typeof parsed.aliases === 'object' && !Array.isArray(parsed.aliases)) {
    for (const [from, to] of Object.entries(parsed.aliases)) {
      const source = normalizeTag(from)
      const target = normalizeTag(to)
      if (source !== null && target !== null && source !== target) aliases[source] = target
    }
  }
  return { version: VERSION, tags, aliases }
}

/** Load the overrides; a missing or unreadable file is empty. */
export async function loadSessionTags(dataDir) {
  try {
    return (await readTagDoc(dataDir)).tags
  } catch {
    return {}
  }
}

/** Load the tag aliases; a missing or unreadable file is empty. */
export async function loadTagAliases(dataDir) {
  try {
    return (await readTagDoc(dataDir)).aliases
  } catch {
    return {}
  }
}

let writeChain = Promise.resolve()

/** Serialize writes: read-modify-write must not interleave between saves. */
function enqueue(task) {
  const run = writeChain.then(task, task)
  writeChain = run.then(() => {}, () => {})
  return run
}

async function writeTagDoc(dataDir, doc) {
  const path = sessionTagsPath(dataDir)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: VERSION, tags: doc.tags, aliases: doc.aliases }, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * Set or clear one session's tag. Refuses to write over an unreadable file.
 *
 * @returns {Promise<string|null>} the stored tag, or null when cleared
 */
export async function saveSessionTag(dataDir, sessionId, rawTag) {
  return enqueue(async () => {
    const doc = await readTagDoc(dataDir)
    const tag = normalizeTag(rawTag)
    if (tag === null) delete doc.tags[sessionId]
    else doc.tags[sessionId] = tag
    await writeTagDoc(dataDir, doc)
    return tag
  })
}

/**
 * Retire a tag: move its explicit overrides to `to` and record an alias so
 * folder-derived sessions resolve to `to` as well.
 *
 * @returns {Promise<{from: string, to: string, moved: number}>}
 */
export async function moveSessionTag(dataDir, from, to) {
  return enqueue(async () => {
    const doc = await readTagDoc(dataDir)
    const destination = resolveTag(to, doc.aliases)
    let moved = 0
    for (const [id, tag] of Object.entries(doc.tags)) {
      if (tag === from) {
        doc.tags[id] = destination
        moved += 1
      }
    }
    doc.aliases[from] = destination
    await writeTagDoc(dataDir, doc)
    return { from, to: destination, moved }
  })
}
