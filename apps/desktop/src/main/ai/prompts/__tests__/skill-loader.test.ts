import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  parseSkillMarkdown,
  discoverSkills,
  loadSkillById,
  formatSkillCatalogForPrompt,
  formatActiveSkillForPrompt,
} from '../skill-loader';
import { injectContext } from '../prompt-loader';
import { taskMachine } from '../../../../shared/state-machines/task-machine';
import { mapStateToLegacy } from '../../../../shared/state-machines/task-state-utils';
import { createActor } from 'xstate';
import { resolveModelEquivalent } from '../../../../shared/constants/models';
import { createProvider } from '../../providers/factory';
import { SupportedProvider } from '../../providers/types';

describe('Dynamic Skill Loader & Prompt Injection', () => {
  it('parses SKILL.md frontmatter including phases, phaseProviders, and reviewChecklist', () => {
    const raw = `---
name: Vibe Plan Skill
description: Plan with skill, AI review, human review, then done
phases:
  - discovery
  - spec_writing
  - self_critique
  - validation
phaseProviders:
  spec: antigravity/gemini-2.5-pro
  qa: github-copilot/claude-sonnet-4
reviewChecklist:
  - Check architecture boundaries
  - Check security edge cases
---

# Custom Instructions
Always verify types first.`;

    const parsed = parseSkillMarkdown(raw, 'vibe-plan', '/repo/.auto-claude/skills/vibe-plan/SKILL.md');
    expect(parsed.id).toBe('vibe-plan');
    expect(parsed.name).toBe('Vibe Plan Skill');
    expect(parsed.phases).toEqual(['discovery', 'spec_writing', 'self_critique', 'validation']);
    expect(parsed.phaseProviders).toEqual({
      spec: 'antigravity/gemini-2.5-pro',
      qa: 'github-copilot/claude-sonnet-4',
    });
    expect(parsed.reviewChecklist).toEqual([
      'Check architecture boundaries',
      'Check security edge cases',
    ]);
    expect(parsed.content).toContain('# Custom Instructions');
  });

  it('discovers skills from repo .auto-claude/skills directory', async () => {
    const repoRoot = path.resolve(__dirname, '../../../../../../..');
    const skills = await discoverSkills(repoRoot);
    const vibeSkill = skills.find((s) => s.id === 'vibe-plan-review');
    expect(vibeSkill).toBeDefined();
    expect(vibeSkill?.name).toBe('Vibe Plan & Review');

    const loaded = await loadSkillById(repoRoot, 'vibe-plan-review');
    expect(loaded?.id).toBe('vibe-plan-review');

    const catalog = formatSkillCatalogForPrompt(skills);
    expect(catalog).toContain('vibe-plan-review');

    const formatted = formatActiveSkillForPrompt(loaded!);
    expect(formatted).toContain('### Skill Review Checklist');
  });

  it('injects availableSkillsCatalog and activeSkillContent into prompt context', () => {
    const output = injectContext('Base prompt content', {
      specDir: '/repo/specs/001',
      projectDir: '/repo',
      availableSkillsCatalog: '- **vibe-plan-review**: Custom workflow',
      activeSkillContent: '### Skill: Vibe Plan & Review\nFollow checklist.',
    });
    expect(output).toContain('## AVAILABLE SKILLS');
    expect(output).toContain('## ACTIVE SKILL INSTRUCTIONS');
    expect(output).toContain('Base prompt content');
  });
});

describe('Dynamic Status Flow: Plan -> AI Review -> Human Review -> Done', () => {
  it('transitions from backlog -> planning -> qa_review (ai_review) -> plan_review (human_review) -> done', () => {
    const actor = createActor(taskMachine);
    actor.start();

    expect(mapStateToLegacy(actor.getSnapshot()).status).toBe('backlog');

    // 1. Start planning
    actor.send({ type: 'PLANNING_STARTED' });
    expect(mapStateToLegacy(actor.getSnapshot()).status).toBe('in_progress');

    // 2. Enter AI Review (self_critique / validation phase emits QA_STARTED)
    actor.send({ type: 'QA_STARTED', iteration: 1, maxIterations: 1 });
    expect(actor.getSnapshot().value).toBe('qa_review');
    expect(mapStateToLegacy(actor.getSnapshot()).status).toBe('ai_review');

    // 3. Complete Planning & AI Review -> transitions to Human Review (plan_review)
    actor.send({
      type: 'PLANNING_COMPLETE',
      hasSubtasks: true,
      subtaskCount: 1,
      requireReviewBeforeCoding: true,
    });
    expect(actor.getSnapshot().value).toBe('plan_review');
    expect(mapStateToLegacy(actor.getSnapshot())).toEqual({
      status: 'human_review',
      reviewReason: 'plan_review',
    });

    // 4. Human Reviewer marks Done directly (or approves to coding)
    actor.send({ type: 'MARK_DONE' });
    expect(actor.getSnapshot().value).toBe('done');
    expect(mapStateToLegacy(actor.getSnapshot()).status).toBe('done');
  });
});

describe('Dynamic Multi-Provider Integration: Claude, GitHub Copilot, and Google Antigravity', () => {
  it('resolves model equivalences across anthropic, github-copilot, and antigravity', () => {
    const copilotOpus = resolveModelEquivalent('opus', 'github-copilot');
    expect(copilotOpus?.modelId).toBe('claude-sonnet-4');

    const copilotSonnet = resolveModelEquivalent('sonnet', 'github-copilot');
    expect(copilotSonnet?.modelId).toBe('gpt-4.1');

    const agyOpus = resolveModelEquivalent('opus', 'antigravity');
    expect(agyOpus?.modelId).toBe('gemini-2.5-pro');

    const agySonnet = resolveModelEquivalent('sonnet', 'antigravity');
    expect(agySonnet?.modelId).toBe('gemini-2.5-flash');
  });

  it('instantiates GitHub Copilot and Antigravity language models via createProvider', () => {
    const copilotModel = createProvider({
      config: {
        provider: SupportedProvider.GitHubCopilot,
        apiKey: 'test-copilot-token',
      },
      modelId: 'claude-sonnet-4',
    });
    expect(copilotModel).toBeDefined();

    const agyModel = createProvider({
      config: {
        provider: SupportedProvider.Antigravity,
        apiKey: 'test-agy-key',
      },
      modelId: 'gemini-2.5-pro',
    });
    expect(agyModel).toBeDefined();
  });
});
