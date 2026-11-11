import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSpendRoute } from './host/spend-route.mjs'

/**
 * Skill provider for `accountant`.
 *
 * The skill body lives next to this plugin as a normal `SKILL.md`, so the file
 * a model reads is the file a person edits. The body is re-read on every
 * lookup: no cache to invalidate while tuning the instructions.
 *
 * @module dsh-accountant
 */

const PROVIDER = 'accountant'
const SKILL_BODY_URL = new URL('./skills/accountant/SKILL.md', import.meta.url)
const SKILL_DIR = dirname(fileURLToPath(SKILL_BODY_URL))
// Bundled-skill rank. Outranks user and project skill roots so this provider
// wins a name collision, and matches BUNDLED_SKILL_RANK from @deepseek-ai/dsh-skill.
const RANK = 600
const FALLBACK_DESCRIPTION =
  'Count token use per day, week and month, price it in US dollars and Philippine pesos, and forecast the rest of the week or month. Use when asked what the token spend is, what it costs, or what the projected bill will be.'

const RESOURCE_BASE = { kind: 'directory', path: SKILL_DIR }

/** Split leading YAML frontmatter into scalar fields plus the remaining body. */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text)
  if (match === null) return { data: {}, body: text }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    if (quoted) value = value.slice(1, -1)
    data[key] = value
  }
  return { data, body: text.slice(match[0].length) }
}

async function readSkill() {
  const raw = await readFile(SKILL_BODY_URL, 'utf8')
  const { data, body } = parseFrontmatter(raw)
  return {
    name: typeof data.name === 'string' && data.name !== '' ? data.name : 'accountant',
    description: typeof data.description === 'string' && data.description !== ''
      ? data.description
      : FALLBACK_DESCRIPTION,
    whenToUse: typeof data.whenToUse === 'string' && data.whenToUse !== '' ? data.whenToUse : undefined,
    invocation: { modelInvocable: true, userInvocable: true },
    body: body.replace(/^\s*\n/, ''),
  }
}

const provider = {
  name: PROVIDER,
  async list() {
    const skill = await readSkill()
    return [{
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      provider: PROVIDER,
      source: 'bundled',
      rank: RANK,
      resourceBase: RESOURCE_BASE,
      locator: SKILL_BODY_URL,
    }]
  },
  async get() {
    const skill = await readSkill()
    return {
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      provider: PROVIDER,
      source: 'bundled',
      resourceBase: RESOURCE_BASE,
      content: skill.body,
    }
  },
}

/** Cordis plugin name. */
export const name = 'accountant'
/** Service required by the provider. */
export const inject = ['skills']

/**
 * Register the bundled `accountant` provider on `ctx.skills`, and, when a Web
 * server is composed, the read-only endpoint the header readout polls.
 */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)

  // `webServer` is not in `inject` above: it only exists in a browser-facing
  // profile, and requiring it would leave the skill pending in a headless one.
  // A deferred inject scope activates only where the service actually mounts.
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => registerSpendRoute(scope), 'accountant: spend route')
  })
}
