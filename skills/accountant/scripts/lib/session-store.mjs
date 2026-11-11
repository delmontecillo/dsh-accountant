/**
 * Reads token usage out of the DSH session store.
 *
 * A session log is an append-only file of concatenated zstd frames, one frame
 * per write, holding newline-delimited JSON records. `zstdDecompressSync`
 * decodes only the first frame, so frames are located by their magic number and
 * decoded one by one. The four-byte magic essentially never occurs inside a
 * compressed block, and a mis-split frame fails to decode and is skipped, so a
 * false match costs one record rather than the file.
 *
 * Records of interest:
 *   - `session`            header: id, cwd, agentPreset, delegationDepth
 *   - `assistant/message`  carries `usage` from the provider
 *
 * Usage is bucketed by UTC day, UTC hour, and model. Timezone and tariff
 * (peak/off-peak) are resolved at aggregation time, never here, so the cache
 * stays valid when the clock zone or holiday list changes.
 *
 * @module accountant/session-store
 */

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const SESSION_FILE = /^session\.v\d+\.jsonl(\.zstd)?$/
const CACHE_VERSION = 1
const TOKEN_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output']

/** Where DSH keeps its state: `--data-dir`, then `DSH_HOME`, then `~/.dsh`. */
export function resolveDataDir(explicit) {
  if (explicit) return explicit
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return join(homedir(), '.dsh')
}

/** Recursively list session log files under `<dataDir>/sessions`. */
export async function listSessionFiles(sessionsDir) {
  let entries
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true, recursive: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && SESSION_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath ?? sessionsDir, entry.name))
}

/** Decode every concatenated zstd frame in `buffer` to one UTF-8 string. */
export function decodeZstdFrames(buffer) {
  const offsets = []
  let from = 0
  while (from < buffer.length) {
    const at = buffer.indexOf(FRAME_MAGIC, from)
    if (at === -1) break
    offsets.push(at)
    from = at + FRAME_MAGIC.length
  }
  if (offsets.length === 0) throw new Error('no zstd frame found')

  const chunks = []
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index]
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length
    try {
      chunks.push(zstdDecompressSync(buffer.subarray(start, end)).toString('utf8'))
    } catch {
      // A frame still being written, or a mis-split segment: skip it.
    }
  }
  return chunks.join('')
}

function emptyBucket() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 }
}

/**
 * Parse decoded log text into a header plus usage buckets.
 *
 * @returns {{header: object|null, buckets: object}}
 */
export function parseSessionText(text) {
  const buckets = {}
  let header = null

  for (const line of text.split('\n')) {
    if (line === '') continue
    // Cheap reject before paying for JSON.parse on large tool-result records.
    const isHeader = header === null && line.startsWith('{"type":"session"')
    const isUsage = line.includes('"assistant/message"')
    if (!isHeader && !isUsage) continue

    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    if (record?.type === 'session' && header === null) {
      header = {
        sessionId: record.id ?? null,
        cwd: record.cwd ?? null,
        agentPreset: record.agentPreset ?? null,
        delegationDepth: Number.isFinite(record.delegationDepth) ? record.delegationDepth : 0,
        createdAt: Number.isFinite(record.createdAt) ? record.createdAt : null,
      }
      continue
    }

    if (record?.type !== 'assistant/message') continue
    const usage = record.data?.usage
    if (!usage) continue
    const time = Number(record.time)
    if (!Number.isFinite(time)) continue

    const source = record.data?.message?.source ?? {}
    const provider = typeof source.provider === 'string' ? source.provider : 'unknown'
    const model = typeof source.model === 'string' ? source.model : 'unknown'
    const modelKey = `${provider}/${model}`

    const when = new Date(time)
    const day = when.toISOString().slice(0, 10)
    const hour = String(when.getUTCHours())

    buckets[day] ??= {}
    buckets[day][hour] ??= {}
    const bucket = (buckets[day][hour][modelKey] ??= emptyBucket())

    bucket.input += Number(usage.inputTokens) || 0
    bucket.cacheRead += Number(usage.cacheReadTokens) || 0
    bucket.cacheWrite += Number(usage.cacheWriteTokens) || 0
    bucket.output += Number(usage.outputTokens) || 0
    bucket.requests += 1
  }

  return { header, buckets }
}

/** Read and bucket one session file. */
export async function scanSessionFile(path) {
  const info = await stat(path)
  if (info.size === 0) return null
  const buffer = await readFile(path)
  const text = path.endsWith('.zstd') ? decodeZstdFrames(buffer) : buffer.toString('utf8')
  const { header, buckets } = parseSessionText(text)
  const folder = basename(dirname(path))
  const fallbackId = /^session-(.+)$/.exec(folder)?.[1] ?? null
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sessionId: header?.sessionId ?? fallbackId,
    cwd: header?.cwd ?? null,
    agentPreset: header?.agentPreset ?? null,
    delegationDepth: header?.delegationDepth ?? 0,
    createdAt: header?.createdAt ?? null,
    buckets,
  }
}

/** Load the incremental cache, tolerating absence or corruption. */
export async function loadCache(cachePath) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'))
    if (parsed?.v === CACHE_VERSION && parsed.files && typeof parsed.files === 'object') return parsed
  } catch {
    // Missing or unreadable cache is not an error: scan from scratch.
  }
  return { v: CACHE_VERSION, files: {} }
}

/** Write the cache atomically so an interrupted run cannot corrupt it. */
export async function saveCache(cachePath, cache) {
  await mkdir(dirname(cachePath), { recursive: true })
  const temp = `${cachePath}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(cache), 'utf8')
  await rename(temp, cachePath)
}

/** Default cache location for the current profile. */
export function defaultCachePath(dataDir) {
  return join(dataDir, 'cache', 'accountant', 'usage-cache.json')
}

/**
 * Collect bucketed usage for every session log, reusing cached entries whose
 * size and mtime still match.
 *
 * @returns {Promise<{files: object[], stats: object}>}
 */
export async function collectUsage({ dataDir, cachePath, useCache = true } = {}) {
  const root = resolveDataDir(dataDir)
  const sessionsDir = join(root, 'sessions')
  const cacheFile = cachePath ?? defaultCachePath(root)
  const startedAt = Date.now()

  const cache = useCache ? await loadCache(cacheFile) : { v: CACHE_VERSION, files: {} }
  const paths = await listSessionFiles(sessionsDir)
  const next = { v: CACHE_VERSION, files: {} }

  let scanned = 0
  let reused = 0
  let failed = 0
  let bytes = 0

  for (const path of paths) {
    let info
    try {
      info = await stat(path)
    } catch {
      failed += 1
      continue
    }
    bytes += info.size

    const cached = cache.files[path]
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      next.files[path] = cached
      reused += 1
      continue
    }

    try {
      const record = await scanSessionFile(path)
      if (record !== null) {
        next.files[path] = record
        scanned += 1
      }
    } catch {
      failed += 1
    }
  }

  if (scanned > 0 || Object.keys(cache.files).length !== Object.keys(next.files).length) {
    await saveCache(cacheFile, next)
  }

  return {
    files: Object.entries(next.files).map(([path, record]) => ({ path, ...record })),
    stats: {
      sessionsDir,
      cacheFile,
      files: paths.length,
      scanned,
      reused,
      failed,
      bytes,
      ms: Date.now() - startedAt,
    },
  }
}

/** Remove a cache file; missing is success. */
export async function clearCache(cachePath) {
  try {
    await unlink(cachePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** Token fields, exported so aggregation and tests share one list. */
export { TOKEN_FIELDS }
