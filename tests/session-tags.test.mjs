import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadSessionTags, loadTagAliases, moveSessionTag, normalizeTag, resolveTag, saveSessionTag, sessionTagsPath } from '../skills/accountant/scripts/lib/session-tags.mjs'

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'accountant-tags-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a tag is trimmed and constrained to printable characters', () => {
  assert.equal(normalizeTag('  work  '), 'work')
  assert.equal(normalizeTag(''), null)
  assert.equal(normalizeTag('   '), null)
  assert.equal(normalizeTag('a\nb'), null)
  assert.equal(normalizeTag('x'.repeat(41)), null)
  assert.equal(normalizeTag(null), null)
})

test('session tags round-trip and can be cleared', () => withDir(async (dir) => {
  assert.deepEqual(await loadSessionTags(dir), {})
  assert.equal(await saveSessionTag(dir, 'session-a', 'work'), 'work')
  assert.equal(await saveSessionTag(dir, 'session-b', 'plugins'), 'plugins')
  assert.deepEqual(await loadSessionTags(dir), { 'session-a': 'work', 'session-b': 'plugins' })

  assert.equal(await saveSessionTag(dir, 'session-a', ''), null)
  assert.deepEqual(await loadSessionTags(dir), { 'session-b': 'plugins' })

  const written = JSON.parse(await readFile(sessionTagsPath(dir), 'utf8'))
  assert.equal(written.version, 1)
  assert.deepEqual(written.tags, { 'session-b': 'plugins' })
}))

test('a corrupt or foreign tags file is treated as empty', () => withDir(async (dir) => {
  await writeFile(sessionTagsPath(dir), '{ not json', 'utf8')
  assert.deepEqual(await loadSessionTags(dir), {})

  await writeFile(sessionTagsPath(dir), JSON.stringify({ version: 9, tags: { a: 'work' } }), 'utf8')
  assert.deepEqual(await loadSessionTags(dir), {})
}))

test('two saves at once keep both tags', () => withDir(async (dir) => {
  await Promise.all([
    saveSessionTag(dir, 'session-a', 'work'),
    saveSessionTag(dir, 'session-b', 'personal'),
  ])
  assert.deepEqual(await loadSessionTags(dir), { 'session-a': 'work', 'session-b': 'personal' })
}))

test('a save refuses to overwrite a file it cannot read', () => withDir(async (dir) => {
  await writeFile(sessionTagsPath(dir), '{ broken', 'utf8')
  await assert.rejects(() => saveSessionTag(dir, 'session-a', 'work'))
  assert.equal(await readFile(sessionTagsPath(dir), 'utf8'), '{ broken')
  assert.deepEqual(await loadSessionTags(dir), {})
}))

test('moving a tag remaps overrides and records an alias', () => withDir(async (dir) => {
  await saveSessionTag(dir, 'session-a', 'passion')
  await saveSessionTag(dir, 'session-b', 'work')
  const result = await moveSessionTag(dir, 'passion', 'personal')
  assert.deepEqual(result, { from: 'passion', to: 'personal', moved: 1 })
  assert.deepEqual(await loadSessionTags(dir), { 'session-a': 'personal', 'session-b': 'work' })
  assert.deepEqual(await loadTagAliases(dir), { passion: 'personal' })

  // A later save keeps the alias.
  await saveSessionTag(dir, 'session-c', 'plugins')
  assert.deepEqual(await loadTagAliases(dir), { passion: 'personal' })
}))

test('alias resolution follows chains and stops on a loop', () => {
  assert.equal(resolveTag('old', { old: 'middle', middle: 'new' }), 'new')
  assert.equal(resolveTag('plain', {}), 'plain')
  assert.equal(resolveTag('a', { a: 'b', b: 'a' }), 'a')
})
