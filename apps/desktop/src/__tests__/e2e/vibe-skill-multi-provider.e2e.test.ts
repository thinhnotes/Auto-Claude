/**
 * Vitest E2E Integration Tests for:
 * 1. Dynamic Skill Discovery & UseSkill Tool Execution
 * 2. SpecOrchestrator Dynamic Phase Pipeline (customPhases & requireAiReview -> self_critique)
 * 3. Multi-Provider Routing & Auth Resolution (Anthropic Claude, GitHub Copilot, Google Antigravity)
 * 4. Kanban State Machine Lifecycle:
 *    backlog -> planning (in_progress) -> qa_review (ai_review) -> plan_review (human_review) -> done (MARK_DONE)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createActor } from 'xstate';

import {
  discoverSkills,
  loadSkillById,
  formatSkillCatalogForPrompt,
  formatActiveSkillForPrompt,
} from '../../main/ai/prompts/skill-loader';
import { useSkillTool } from '../../main/ai/tools/builtin/use-skill';
import { buildToolRegistry } from '../../main/ai/tools/build-registry';
import { SpecOrchestrator, type SpecPhase } from '../../main/ai/orchestration/spec-orchestrator';
import { taskMachine } from '../../shared/state-machines/task-machine';
import { mapStateToLegacy } from '../../shared/state-machines/task-state-utils';
import { resolveAuth } from '../../main/ai/auth/resolver';
import { resolveModelEquivalent } from '../../shared/constants/models';
import {
  fetchAzureDevOpsWorkItem,
  createSpecForAzureDevOpsWorkItem,
} from '../../main/ipc-handlers/azure-devops/spec-utils';
import type { ToolContext } from '../../main/ai/tools/types';

let TEST_DIR: string;
let PROJECT_DIR: string;
let SPEC_DIR: string;

function setupDirs(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'vibe-e2e-test-'));
  PROJECT_DIR = path.join(TEST_DIR, 'project');
  SPEC_DIR = path.join(PROJECT_DIR, '.auto-claude', 'specs', '001-vibe-task');
  mkdirSync(SPEC_DIR, { recursive: true });
}

function cleanupDirs(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function createDummyToolContext(projectDir: string, specDir: string): ToolContext {
  return {
    cwd: projectDir,
    projectDir,
    specDir,
    securityProfile: {
      baseCommands: new Set(),
      stackCommands: new Set(),
      scriptCommands: new Set(),
      customCommands: new Set(),
      customScripts: { shellScripts: [] },
      getAllAllowedCommands: () => new Set(),
    },
  };
}

describe('E2E: Vibe Coding Skill + Multi-Provider + Review Flow', () => {
  beforeEach(() => {
    cleanupDirs();
    setupDirs();
  });

  afterEach(() => {
    cleanupDirs();
  });

  it('discovers skills dynamically and executes UseSkill tool (list and load by ID)', async () => {
    const skillDir = path.join(PROJECT_DIR, '.auto-claude', 'skills', 'vibe-security-plan');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: Vibe Security Plan
description: Security-first planning and AI review workflow
phases:
  - discovery
  - spec_writing
  - self_critique
  - validation
phaseProviders:
  spec: antigravity/gemini-2.5-pro
  qa: github-copilot/claude-sonnet-4
reviewChecklist:
  - Validate OAuth token scopes
  - Check path containment on all file tools
---

# Security Planning Workflow
Always threat-model before writing subtasks.`
    );

    const registry = buildToolRegistry();
    const registeredUseSkill = registry.getTool('UseSkill');
    expect(registeredUseSkill).toBeDefined();

    const ctx = createDummyToolContext(PROJECT_DIR, SPEC_DIR);

    // 1. List skills via UseSkill tool
    const listOutput = await useSkillTool.execute({ skill_name: 'list' }, ctx);
    expect(listOutput).toContain('vibe-security-plan');
    expect(listOutput).toContain('Vibe Security Plan');
    expect(listOutput).toContain('discovery -> spec_writing -> self_critique -> validation');

    // 2. Load specific skill via UseSkill tool
    const skillOutput = await useSkillTool.execute({ skill_name: 'vibe-security-plan' }, ctx);
    expect(skillOutput).toContain('### Skill: Vibe Security Plan (`vibe-security-plan`)');
    expect(skillOutput).toContain('Always threat-model before writing subtasks.');
    expect(skillOutput).toContain('### Skill Review Checklist');
    expect(skillOutput).toContain('- [ ] Validate OAuth token scopes');
  });

  it('runs SpecOrchestrator with dynamic skill phases and transitions XState through Plan -> AI Review -> Human Review -> Done', async () => {
    // 1. Create custom skill in project
    const skillDir = path.join(PROJECT_DIR, '.agents', 'skills', 'vibe-flow');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: Vibe Flow
description: Custom 3-phase plan + AI critique flow
phases:
  - quick_spec
  - self_critique
  - validation
reviewChecklist:
  - Ensure spec.md has Overview and Acceptance Criteria
---
Follow the 3-phase Vibe Flow.`
    );

    const activeSkill = await loadSkillById(PROJECT_DIR, 'vibe-flow');
    expect(activeSkill).not.toBeNull();

    // 2. Start XState taskMachine actor to track Kanban status transitions
    const actor = createActor(taskMachine);
    actor.start();
    const kanbanHistory: Array<{ state: string; status: string; reviewReason?: string }> = [];

    const recordKanban = () => {
      const snap = actor.getSnapshot();
      const legacy = mapStateToLegacy(snap);
      kanbanHistory.push({
        state: String(snap.value),
        status: legacy.status,
        reviewReason: legacy.reviewReason,
      });
    };

    recordKanban(); // backlog
    actor.send({ type: 'PLANNING_STARTED' });
    recordKanban(); // planning (in_progress)

    // 3. Run SpecOrchestrator with customPhases from skill & requireAiReview
    const executedPhases: SpecPhase[] = [];
    let aiReviewEmitted = false;

    const orchestrator = new SpecOrchestrator({
      specDir: SPEC_DIR,
      projectDir: PROJECT_DIR,
      taskDescription: 'Add multi-provider support for Claude, GitHub Copilot, and Antigravity',
      customPhases: activeSkill!.phases as SpecPhase[],
      requireAiReview: true,
      generatePrompt: async (_agentType, phase) => {
        const skills = await discoverSkills(PROJECT_DIR);
        return [
          `Phase: ${phase}`,
          formatSkillCatalogForPrompt(skills),
          formatActiveSkillForPrompt(activeSkill!),
        ].join('\n\n');
      },
      runSession: async (runConfig) => {
        executedPhases.push(runConfig.specPhase);

        // Simulate phase output generation
        if (runConfig.specPhase === 'quick_spec') {
          writeFileSync(
            path.join(SPEC_DIR, 'spec.md'),
            '# Multi-Provider Spec\n\n## Overview\nSupport Claude, Copilot, and Antigravity.\n'
          );
          writeFileSync(
            path.join(SPEC_DIR, 'implementation_plan.json'),
            JSON.stringify(
              {
                feature: 'Multi-Provider Support',
                workflow_type: 'feature',
                services_involved: ['desktop'],
                phases: [
                  {
                    id: 'phase-1',
                    name: 'Core Implementation',
                    type: 'implementation',
                    subtasks: [
                      {
                        id: 'subtask-1',
                        description: 'Add provider factory and skill loader',
                        status: 'pending',
                        files_to_modify: ['src/main/ai/providers/factory.ts'],
                        files_to_create: ['src/main/ai/prompts/skill-loader.ts'],
                        service: 'desktop',
                      },
                    ],
                  },
                ],
                final_acceptance: ['All unit and E2E tests pass'],
              },
              null,
              2
            )
          );
        } else if (runConfig.specPhase === 'self_critique') {
          // AI Review refines spec.md
          writeFileSync(
            path.join(SPEC_DIR, 'spec.md'),
            '# Multi-Provider Spec (AI Reviewed)\n\n## Overview\nSupport Claude, Copilot, and Antigravity.\n\n## AI Review Notes\nAll checklist items verified.\n'
          );
        }

        return {
          outcome: 'completed',
          stepsExecuted: 2,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          messages: [],
          toolCallCount: 2,
          durationMs: 10,
        };
      },
    });

    orchestrator.on('phase-start', (phase: SpecPhase) => {
      if (!aiReviewEmitted && (phase === 'self_critique' || phase === 'validation')) {
        aiReviewEmitted = true;
        actor.send({ type: 'QA_STARTED', iteration: 1, maxIterations: 1 });
        recordKanban(); // qa_review (ai_review)
      }
    });

    const outcome = await orchestrator.run();
    expect(outcome.success).toBe(true);
    expect(executedPhases).toEqual(['quick_spec', 'self_critique', 'validation']);

    // Emit PLANNING_COMPLETE with requireReviewBeforeCoding: true (moves to Human Review)
    actor.send({
      type: 'PLANNING_COMPLETE',
      hasSubtasks: true,
      subtaskCount: 1,
      requireReviewBeforeCoding: true,
    });
    recordKanban(); // plan_review (human_review)

    // Human reviewer approves plan-only workflow directly to Done
    actor.send({ type: 'MARK_DONE' });
    recordKanban(); // done

    expect(kanbanHistory).toEqual([
      { state: 'backlog', status: 'backlog', reviewReason: undefined },
      { state: 'planning', status: 'in_progress', reviewReason: undefined },
      { state: 'qa_review', status: 'ai_review', reviewReason: undefined },
      { state: 'plan_review', status: 'human_review', reviewReason: 'plan_review' },
      { state: 'done', status: 'done', reviewReason: undefined },
    ]);
  });

  it('resolves credentials and model equivalences dynamically for Claude, GitHub Copilot, and Antigravity', async () => {
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevCopilot = process.env.GITHUB_COPILOT_TOKEN;
    const prevAgy = process.env.ANTIGRAVITY_API_KEY;

    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-e2e-test';
    process.env.GITHUB_COPILOT_TOKEN = 'ghu_copilot_e2e_test';
    process.env.ANTIGRAVITY_API_KEY = 'AIzaSy_antigravity_e2e_test';

    try {
      const claudeAuth = await resolveAuth({ provider: 'anthropic' });
      const copilotAuth = await resolveAuth({ provider: 'github-copilot' });
      const agyAuth = await resolveAuth({ provider: 'antigravity' });

      expect(claudeAuth?.apiKey).toBe('sk-ant-api-e2e-test');
      expect(copilotAuth?.apiKey).toBe('ghu_copilot_e2e_test');
      expect(agyAuth?.apiKey).toBe('AIzaSy_antigravity_e2e_test');

      expect(resolveModelEquivalent('opus', 'anthropic')?.modelId).toBe('claude-opus-4-6');
      expect(resolveModelEquivalent('opus', 'github-copilot')?.modelId).toBe('claude-sonnet-4');
      expect(resolveModelEquivalent('opus', 'antigravity')?.modelId).toBe('gemini-2.5-pro');
    } finally {
      if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevAnthropic;
      if (prevCopilot === undefined) delete process.env.GITHUB_COPILOT_TOKEN;
      else process.env.GITHUB_COPILOT_TOKEN = prevCopilot;
      if (prevAgy === undefined) delete process.env.ANTIGRAVITY_API_KEY;
      else process.env.ANTIGRAVITY_API_KEY = prevAgy;
    }
  });

  it('fetches an Azure DevOps ticket and transitions through queue -> in_progress -> human_review -> ai_review -> done', async () => {
    // 1. Mock Azure DevOps REST API v7.1 response for Work Item AB#4821
    let requestedUrl = '';
    let requestedAuth = '';
    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedAuth = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(
        JSON.stringify({
          id: 4821,
          rev: 3,
          url: 'https://dev.azure.com/contoso/vibe-platform/_apis/wit/workItems/4821',
          _links: {
            html: {
              href: 'https://dev.azure.com/contoso/vibe-platform/_workitems/edit/4821',
            },
          },
          fields: {
            'System.Title': 'Integrate GitHub Copilot and Antigravity dynamic skill workflow',
            'System.Description':
              '<p>Enable dynamic skill loading for planning and multi-provider AI review.</p>',
            'Microsoft.VSTS.Common.AcceptanceCriteria':
              '<ul><li>Load SKILL.md dynamically</li><li>Transition through queue, in_progress, human_review, ai_review, done</li></ul>',
            'System.WorkItemType': 'User Story',
            'System.State': 'Active',
            'Microsoft.VSTS.Common.Priority': 1,
            'System.Tags': 'vibe-coding; multi-provider; e2e',
            'System.AssignedTo': {
              displayName: 'Vibe Engineer',
              uniqueName: 'vibe@contoso.com',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const workItem = await fetchAzureDevOpsWorkItem({
      organization: 'contoso',
      project: 'vibe-platform',
      workItemId: 4821,
      pat: 'ado-pat-secret-token',
      fetchImpl: mockFetch,
    });

    expect(requestedUrl).toBe(
      'https://dev.azure.com/contoso/vibe-platform/_apis/wit/workitems/4821?api-version=7.1'
    );
    expect(requestedAuth).toMatch(/^Basic /);
    expect(workItem.id).toBe(4821);
    expect(workItem.workItemType).toBe('User Story');
    expect(workItem.tags).toEqual(['vibe-coding', 'multi-provider', 'e2e']);

    // 2. Create task spec initialized in `queue` status from the Azure DevOps ticket
    const createdSpec = createSpecForAzureDevOpsWorkItem({
      projectDir: PROJECT_DIR,
      workItem,
      initialStatus: 'queue',
      skillId: 'vibe-plan-review',
      customPhases: ['discovery', 'spec_writing', 'self_critique', 'validation'],
      requireReviewBeforeCoding: true,
      planOnly: true,
      provider: 'anthropic',
      phaseProviders: {
        spec: 'anthropic',
        qa: 'github-copilot',
        planning: 'antigravity',
      },
    });

    expect(createdSpec.status).toBe('queue');
    expect(createdSpec.metadata.sourceType).toBe('azure_devops');
    expect(createdSpec.metadata.azureDevOpsWorkItemId).toBe(4821);
    expect(createdSpec.metadata.azureDevOpsOrganization).toBe('contoso');
    expect(createdSpec.metadata.azureDevOpsProject).toBe('vibe-platform');

    // 3. Drive the XState task machine through:
    //    queue -> in_progress -> human_review -> ai_review -> done
    const actor = createActor(taskMachine);
    actor.start();

    const statusTimeline: Array<{
      xstate: string;
      status: string;
      reviewReason?: string;
    }> = [];

    const recordStep = () => {
      const snap = actor.getSnapshot();
      const mapped = mapStateToLegacy(String(snap.value), snap.context.reviewReason);
      statusTimeline.push({
        xstate: String(snap.value),
        status: mapped.status,
        reviewReason: mapped.reviewReason,
      });
    };

    // Step 1: Ticket enters `queue`
    actor.send({ type: 'ENQUEUE' });
    recordStep();

    // Step 2: Ticket starts processing -> `in_progress` (planning)
    actor.send({ type: 'PLANNING_STARTED' });
    recordStep();

    // Step 3: Spec/plan generated, pauses for Human Review -> `human_review` (plan_review)
    actor.send({
      type: 'PLANNING_COMPLETE',
      hasSubtasks: true,
      subtaskCount: 2,
      requireReviewBeforeCoding: true,
    });
    recordStep();

    // Step 4: Human review triggers AI Review -> `ai_review` (qa_review)
    actor.send({ type: 'QA_STARTED', iteration: 1, maxIterations: 1 });
    recordStep();

    // Step 5: AI Review passes and task completes -> `done`
    actor.send({ type: 'MARK_DONE' });
    recordStep();

    expect(statusTimeline.map((s) => s.status)).toEqual([
      'queue',
      'in_progress',
      'human_review',
      'ai_review',
      'done',
    ]);

    expect(statusTimeline).toEqual([
      { xstate: 'queue', status: 'queue', reviewReason: undefined },
      { xstate: 'planning', status: 'in_progress', reviewReason: undefined },
      { xstate: 'plan_review', status: 'human_review', reviewReason: 'plan_review' },
      { xstate: 'qa_review', status: 'ai_review', reviewReason: undefined },
      { xstate: 'done', status: 'done', reviewReason: undefined },
    ]);
  });
});
