/**
 * UseSkill Tool
 * =============
 *
 * Dynamically loads a specialized Skill (`SKILL.md`) by ID or name from
 * `.auto-claude/skills/`, `.agents/skills/`, `.claude/skills/`, `.github/skills/`,
 * or global user skill directories (`~/.gemini/antigravity-cli/skills/`, etc.).
 */

import { z } from 'zod/v3';

import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';
import type { ToolContext } from '../types';
import {
  discoverSkills,
  formatActiveSkillForPrompt,
  loadSkillById,
} from '../../prompts/skill-loader';

const UseSkillInputSchema = z.object({
  skill_name: z
    .string()
    .describe(
      'The ID or name of the skill to load (e.g., "vibe-plan", "antigravity-guide", "security-review"). Pass "list" to list all available skills.'
    ),
});

export type UseSkillInput = z.infer<typeof UseSkillInputSchema>;

export const useSkillTool = Tool.define({
  metadata: {
    name: 'UseSkill',
    description:
      'Load specialized domain instructions, planning templates, and review checklists from a Skill (SKILL.md). ' +
      'Call this tool when a task matches one of the available skills or pass skill_name="list" to inspect available skills.',
    permission: ToolPermission.Auto,
    executionOptions: {
      ...DEFAULT_EXECUTION_OPTIONS,
    },
  },
  inputSchema: UseSkillInputSchema,
  execute: async (input: UseSkillInput, context: ToolContext): Promise<string> => {
    const query = input.skill_name.trim();

    if (query.toLowerCase() === 'list') {
      const skills = await discoverSkills(context.projectDir);
      if (skills.length === 0) {
        return 'No skills found in .auto-claude/skills, .agents/skills, .claude/skills, .github/skills, or global skill directories.';
      }

      const listOutput = skills
        .map(
          (s) =>
            `- ${s.id} (${s.name}): ${s.description || 'No description'}` +
            (s.phases?.length ? ` [phases: ${s.phases.join(' -> ')}]` : '')
        )
        .join('\n');

      return `Available skills (${skills.length}):\n${listOutput}`;
    }

    const skill = await loadSkillById(context.projectDir, query);
    if (!skill) {
      const available = await discoverSkills(context.projectDir);
      const availableNames = available.map((s) => s.id).join(', ') || 'none';
      return `Skill "${query}" was not found. Available skills: ${availableNames}`;
    }

    return formatActiveSkillForPrompt(skill);
  },
});
