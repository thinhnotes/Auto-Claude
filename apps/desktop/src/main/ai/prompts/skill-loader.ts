import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Definition of a dynamically loaded Skill (SKILL.md).
 * Supports Vibe Coding / Antigravity / Claude / GitHub Copilot skill formats.
 */
export interface SkillDefinition {
  /** Skill identifier (directory name or frontmatter name) */
  id: string
  /** Display name of the skill */
  name: string
  /** Brief description of when and how to use the skill */
  description: string
  /** Optional custom phase pipeline defined by this skill (e.g. ['discovery', 'spec_writing', 'self_critique', 'validate']) */
  phases?: string[]
  /** Optional per-phase provider/model routing overrides (e.g. { planning: 'antigravity/gemini-2.5-pro', ai_review: 'github-copilot/gpt-4.1' }) */
  phaseProviders?: Record<string, string>
  /** Optional extra tools enabled when this skill is active */
  tools?: string[]
  /** Optional AI review checklist items for self_critique / qa_review */
  reviewChecklist?: string[]
  /** Raw markdown body of the skill (excluding YAML frontmatter) */
  content: string
  /** Absolute path to the SKILL.md file */
  sourcePath: string
  /** Absolute path to the skill directory */
  skillDir: string
  /** Optional list of helper files found in scripts/, references/, examples/, resources/ */
  resources?: string[]
}

/**
 * Relative project directories searched in priority order for project-level skills.
 */
export const PROJECT_SKILL_DIRS = [
  '.auto-claude/skills',
  '.agents/skills',
  '.claude/skills',
  '.github/skills',
] as const

/**
 * Global user skill directories searched after project-level skills.
 */
export function getGlobalSkillDirs(): string[] {
  const home = os.homedir()
  if (!home) return []
  return [
    path.join(home, '.gemini', 'antigravity-cli', 'skills'),
    path.join(home, '.agents', 'skills'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.github', 'skills'),
  ]
}

/**
 * Parse YAML-like frontmatter from a SKILL.md file without external dependencies.
 */
export function parseSkillMarkdown(
  rawContent: string,
  fallbackId: string,
  sourcePath: string
): SkillDefinition {
  const skillDir = path.dirname(sourcePath)
  const trimmed = rawContent.trimStart()

  let name = fallbackId
  let description = ''
  let phases: string[] | undefined
  let phaseProviders: Record<string, string> | undefined
  let tools: string[] | undefined
  let reviewChecklist: string[] | undefined
  let body = rawContent

  if (trimmed.startsWith('---')) {
    const endIdx = trimmed.indexOf('\n---', 3)
    if (endIdx !== -1) {
      const frontmatterRaw = trimmed.slice(3, endIdx).trim()
      body = trimmed.slice(endIdx + 4).trim()

      const parsed = parseSimpleYamlFrontmatter(frontmatterRaw)
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        name = parsed.name.trim()
      }
      if (typeof parsed.description === 'string' && parsed.description.trim()) {
        description = parsed.description.trim()
      }
      if (Array.isArray(parsed.phases)) {
        phases = parsed.phases.map(String).filter(Boolean)
      }
      if (parsed.phaseProviders && typeof parsed.phaseProviders === 'object' && !Array.isArray(parsed.phaseProviders)) {
        phaseProviders = parsed.phaseProviders as Record<string, string>
      }
      if (Array.isArray(parsed.tools)) {
        tools = parsed.tools.map(String).filter(Boolean)
      }
      if (Array.isArray(parsed.reviewChecklist)) {
        reviewChecklist = parsed.reviewChecklist.map(String).filter(Boolean)
      }
    }
  }

  return {
    id: fallbackId,
    name,
    description,
    phases,
    phaseProviders,
    tools,
    reviewChecklist,
    content: body,
    sourcePath,
    skillDir,
  }
}

/**
 * Lightweight parser for YAML frontmatter supporting scalar strings, inline arrays `[a, b]`,
 * multi-line `- item` lists, and 1-level nested `key: value` maps.
 */
function parseSimpleYamlFrontmatter(
  yamlText: string
): Record<string, string | string[] | Record<string, string>> {
  const result: Record<string, string | string[] | Record<string, string>> = {}
  const lines = yamlText.split(/\r?\n/)

  let currentKey: string | null = null
  let currentList: string[] | null = null
  let currentMap: Record<string, string> | null = null

  const flushCollection = () => {
    if (currentKey) {
      if (currentList !== null) {
        result[currentKey] = currentList
      } else if (currentMap !== null) {
        result[currentKey] = currentMap
      }
    }
    currentKey = null
    currentList = null
    currentMap = null
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue

    // Indented list item or nested map entry
    if (/^\s+/.test(line) && currentKey) {
      const trimmedLine = line.trim()
      if (trimmedLine.startsWith('- ')) {
        if (!currentList) currentList = []
        currentList.push(unquoteYaml(trimmedLine.slice(2).trim()))
        continue
      }
      const nestedMatch = trimmedLine.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/)
      if (nestedMatch) {
        if (!currentMap) currentMap = {}
        currentMap[nestedMatch[1]] = unquoteYaml(nestedMatch[2].trim())
        continue
      }
    }

    flushCollection()

    const topMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!topMatch) continue

    const key = topMatch[1]
    const rawValue = topMatch[2].trim()

    if (!rawValue) {
      currentKey = key
      continue
    }

    // Inline array: [item1, item2]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim()
      result[key] = inner
        ? inner.split(',').map((item) => unquoteYaml(item.trim())).filter(Boolean)
        : []
      continue
    }

    result[key] = unquoteYaml(rawValue)
  }

  flushCollection()
  return result
}

function unquoteYaml(val: string): string {
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1)
  }
  return val
}

/**
 * List helper resources inside a skill directory (scripts/, references/, examples/, resources/).
 */
async function listSkillResources(skillDir: string): Promise<string[]> {
  const subdirs = ['scripts', 'references', 'examples', 'resources']
  const found: string[] = []

  for (const sub of subdirs) {
    const dirPath = path.join(skillDir, sub)
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile()) {
          found.push(path.join(sub, entry.name))
        }
      }
    } catch {
      // Directory doesn't exist — ignore
    }
  }

  return found
}

/**
 * Dynamically discover all available skills across project and global skill directories.
 * Earlier directories take precedence if two skills share the same ID.
 */
export async function discoverSkills(projectDir: string): Promise<SkillDefinition[]> {
  const searchDirs = [
    ...PROJECT_SKILL_DIRS.map((rel) => path.join(projectDir, rel)),
    ...getGlobalSkillDirs(),
  ]

  const discovered = new Map<string, SkillDefinition>()

  for (const baseDir of searchDirs) {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillId = entry.name
      if (discovered.has(skillId)) continue

      const skillFile = path.join(baseDir, skillId, 'SKILL.md')
      try {
        const raw = await fs.readFile(skillFile, 'utf-8')
        const parsed = parseSkillMarkdown(raw, skillId, skillFile)
        parsed.resources = await listSkillResources(parsed.skillDir)
        discovered.set(skillId, parsed)
      } catch {
        // No SKILL.md in this subdirectory — skip
      }
    }
  }

  return Array.from(discovered.values())
}

/**
 * Dynamically load a single skill by ID or name.
 */
export async function loadSkillById(
  projectDir: string,
  skillIdOrName: string
): Promise<SkillDefinition | null> {
  const normalized = skillIdOrName.trim().toLowerCase()
  if (!normalized) return null

  const skills = await discoverSkills(projectDir)
  return (
    skills.find(
      (s) =>
        s.id.toLowerCase() === normalized ||
        s.name.toLowerCase() === normalized
    ) ?? null
  )
}

/**
 * Format discovered skills as a concise markdown catalog for prompt injection.
 */
export function formatSkillCatalogForPrompt(skills: SkillDefinition[]): string | null {
  if (!skills.length) return null

  const lines = [
    'You have access to specialized skills that provide domain workflows, planning templates, and review checklists.',
    'Use the `UseSkill` tool (or `SpawnSubagent` with `skill_name`) to load a skill\'s full instructions when relevant:',
    '',
  ]

  for (const skill of skills) {
    const desc = skill.description ? `: ${skill.description}` : ''
    const phasesInfo = skill.phases?.length
      ? ` (workflow phases: ${skill.phases.join(' -> ')})`
      : ''
    lines.push(`- **${skill.id}** (${skill.name})${desc}${phasesInfo}`)
  }

  return lines.join('\n')
}

/**
 * Format an active skill's full content and review checklist for prompt injection.
 */
export function formatActiveSkillForPrompt(skill: SkillDefinition): string {
  const sections: string[] = [
    `### Skill: ${skill.name} (\`${skill.id}\`)`,
  ]

  if (skill.description) {
    sections.push(`*${skill.description}*`)
  }

  sections.push('', skill.content)

  if (skill.reviewChecklist?.length) {
    sections.push(
      '',
      '### Skill Review Checklist',
      ...skill.reviewChecklist.map((item) => `- [ ] ${item}`)
    )
  }

  if (skill.resources?.length) {
    sections.push(
      '',
      '### Skill Helper Resources',
      `Located in \`${skill.skillDir}\`:`,
      ...skill.resources.map((r) => `- \`${r}\``)
    )
  }

  return sections.join('\n')
}
