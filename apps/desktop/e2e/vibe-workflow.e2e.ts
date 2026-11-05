/**
 * End-to-End tests for Vibe Coding Dynamic Skill & Multi-Provider Workflow:
 *   Skill Customization (SKILL.md) -> Plan -> AI Review (ai_review) -> Human Review (human_review) -> Done (done)
 *   with dynamic provider routing across Claude (Anthropic), GitHub Copilot, and Google Antigravity (agy).
 *
 * To run via Playwright:
 *   npx playwright test vibe-workflow --config=e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import {
  discoverSkills,
  loadSkillById,
  formatSkillCatalogForPrompt,
  formatActiveSkillForPrompt,
} from '../src/main/ai/prompts/skill-loader';
import { injectContext } from '../src/main/ai/prompts/prompt-loader';
import { loadTaskMetadata } from '../src/main/ai/config/phase-config';
import {
  ALL_AVAILABLE_MODELS,
  PROVIDER_PRESET_DEFINITIONS,
  resolveModelEquivalent,
} from '../src/shared/constants/models';
import { PROVIDER_REGISTRY } from '../src/shared/constants/providers';
import {
  PROVIDER_ENV_VARS,
  PROVIDER_SETTINGS_KEY,
  PROVIDER_BASE_URL_ENV,
} from '../src/main/ai/auth/types';
import {
  COPILOT_DEFAULT_HEADERS,
  createOAuthProviderFetch,
} from '../src/main/ai/providers/oauth-fetch';
import {
  fetchAzureDevOpsWorkItem,
  createSpecForAzureDevOpsWorkItem,
} from '../src/main/ipc-handlers/azure-devops/spec-utils';
import { mapStateToLegacy } from '../src/shared/state-machines/task-state-utils';

let TEST_DATA_DIR: string;
let TEST_PROJECT_DIR: string;
let SPECS_DIR: string;

function setupTestEnvironment(): void {
  TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'aperant-vibe-workflow-e2e-'));
  TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
  SPECS_DIR = path.join(TEST_PROJECT_DIR, '.auto-claude', 'specs');
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(SPECS_DIR, { recursive: true });
}

function cleanupTestEnvironment(): void {
  if (TEST_DATA_DIR && existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

test.describe('Vibe Coding Skill Customization & Multi-Provider E2E Flow', () => {
  test.beforeAll(() => {
    setupTestEnvironment();
  });

  test.afterAll(() => {
    cleanupTestEnvironment();
  });

  test('1. Discovers custom SKILL.md across project skill directories with priority order', async () => {
    const autoClaudeSkillDir = path.join(TEST_PROJECT_DIR, '.auto-claude', 'skills', 'vibe-architect');
    const githubSkillDir = path.join(TEST_PROJECT_DIR, '.github', 'skills', 'copilot-reviewer');
    const agentsSkillDir = path.join(TEST_PROJECT_DIR, '.agents', 'skills', 'agy-planner');

    mkdirSync(path.join(autoClaudeSkillDir, 'references'), { recursive: true });
    mkdirSync(githubSkillDir, { recursive: true });
    mkdirSync(agentsSkillDir, { recursive: true });

    writeFileSync(
      path.join(autoClaudeSkillDir, 'references', 'architecture-rules.md'),
      '# Architecture Rules\nNo circular dependencies.\n'
    );

    writeFileSync(
      path.join(autoClaudeSkillDir, 'SKILL.md'),
      `---
name: Vibe Architect
description: Plan with Antigravity, AI Review with GitHub Copilot, Human Review then Done
phases:
  - discovery
  - spec_writing
  - self_critique
  - validation
phaseProviders:
  spec: antigravity/gemini-2.5-pro
  planning: anthropic/opus
  qa: github-copilot/claude-sonnet-4
reviewChecklist:
  - Verify all affected files are listed
  - Check for security and auth boundary regressions
---

# Vibe Architect Instructions
Follow a strict Plan -> AI Review -> Human Review -> Done flow.`
    );

    writeFileSync(
      path.join(githubSkillDir, 'SKILL.md'),
      `---
name: Copilot Reviewer
description: GitHub Copilot specialized review skill
phases: [self_critique, validation]
---
Review code and plans using GitHub Copilot.`
    );

    writeFileSync(
      path.join(agentsSkillDir, 'SKILL.md'),
      `---
name: Antigravity Planner
description: Google Antigravity planning skill
---
Plan complex tasks with Gemini 2.5 Pro.`
    );

    const skills = await discoverSkills(TEST_PROJECT_DIR);
    const skillIds = skills.map((s) => s.id);

    expect(skillIds).toContain('vibe-architect');
    expect(skillIds).toContain('copilot-reviewer');
    expect(skillIds).toContain('agy-planner');

    const vibeSkill = await loadSkillById(TEST_PROJECT_DIR, 'vibe-architect');
    expect(vibeSkill).not.toBeNull();
    expect(vibeSkill?.name).toBe('Vibe Architect');
    expect(vibeSkill?.phases).toEqual(['discovery', 'spec_writing', 'self_critique', 'validation']);
    expect(vibeSkill?.phaseProviders).toEqual({
      spec: 'antigravity/gemini-2.5-pro',
      planning: 'anthropic/opus',
      qa: 'github-copilot/claude-sonnet-4',
    });
    expect(vibeSkill?.reviewChecklist).toHaveLength(2);
    expect(vibeSkill?.resources).toContain(path.join('references', 'architecture-rules.md'));

    // Verify prompt context injection includes both catalog and active skill
    const catalog = formatSkillCatalogForPrompt(skills);
    const activeFormatted = formatActiveSkillForPrompt(vibeSkill!);
    const assembledPrompt = injectContext('Base Spec Writer Prompt', {
      specDir: path.join(SPECS_DIR, '001-vibe-feature'),
      projectDir: TEST_PROJECT_DIR,
      availableSkillsCatalog: catalog,
      activeSkillContent: activeFormatted,
    });

    expect(assembledPrompt).toContain('## AVAILABLE SKILLS');
    expect(assembledPrompt).toContain('## ACTIVE SKILL INSTRUCTIONS (FOLLOW THIS WORKFLOW & CHECKLIST)');
    expect(assembledPrompt).toContain('### Skill Review Checklist');
    expect(assembledPrompt).toContain('- [ ] Verify all affected files are listed');
    expect(assembledPrompt).toContain('references/architecture-rules.md');
  });

  test('2. Dynamically resolves providers and models for Claude, GitHub Copilot, and Google Antigravity', () => {
    const providerIds = PROVIDER_REGISTRY.map((p) => p.id);
    expect(providerIds).toContain('anthropic');
    expect(providerIds).toContain('github-copilot');
    expect(providerIds).toContain('antigravity');

    // Verify environment variable and settings mappings
    expect(PROVIDER_ENV_VARS['github-copilot']).toBe('GITHUB_COPILOT_TOKEN');
    expect(PROVIDER_ENV_VARS['antigravity']).toBe('ANTIGRAVITY_API_KEY');
    expect(PROVIDER_SETTINGS_KEY['github-copilot']).toBe('globalGitHubCopilotApiKey');
    expect(PROVIDER_SETTINGS_KEY['antigravity']).toBe('globalAntigravityApiKey');
    expect(PROVIDER_BASE_URL_ENV['github-copilot']).toBe('GITHUB_COPILOT_BASE_URL');
    expect(PROVIDER_BASE_URL_ENV['antigravity']).toBe('ANTIGRAVITY_BASE_URL');

    // Verify presets exist for both new providers
    expect(PROVIDER_PRESET_DEFINITIONS['github-copilot']?.auto.primaryModel).toBe('claude-sonnet-4');
    expect(PROVIDER_PRESET_DEFINITIONS['antigravity']?.auto.primaryModel).toBe('gemini-2.5-pro');

    // Verify cross-provider shorthand equivalence resolution
    expect(resolveModelEquivalent('opus', 'anthropic')?.modelId).toBe('claude-opus-4-6');
    expect(resolveModelEquivalent('opus', 'github-copilot')?.modelId).toBe('claude-sonnet-4');
    expect(resolveModelEquivalent('opus', 'antigravity')?.modelId).toBe('gemini-2.5-pro');

    expect(resolveModelEquivalent('sonnet', 'github-copilot')?.modelId).toBe('gpt-4.1');
    expect(resolveModelEquivalent('sonnet', 'antigravity')?.modelId).toBe('gemini-2.5-flash');

    expect(resolveModelEquivalent('haiku', 'github-copilot')?.modelId).toBe('o3-mini');
    expect(resolveModelEquivalent('haiku', 'antigravity')?.modelId).toBe('gemini-2.5-flash-lite');

    // Verify models are registered in ALL_AVAILABLE_MODELS
    expect(ALL_AVAILABLE_MODELS.some((m) => m.provider === 'github-copilot' && m.value === 'claude-sonnet-4')).toBe(true);
    expect(ALL_AVAILABLE_MODELS.some((m) => m.provider === 'antigravity' && m.value === 'gemini-2.5-pro')).toBe(true);
  });

  test('3. OAuth fetch interceptor injects token and GitHub Copilot headers', async () => {
    const tokenFile = path.join(TEST_DATA_DIR, 'copilot-auth.json');
    writeFileSync(
      tokenFile,
      JSON.stringify({
        access_token: 'tid_copilot_session_token_123',
        refresh_token: 'ghu_github_oauth_token_456',
        expires_at: Date.now() + 3600_000,
      })
    );

    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers | undefined;
    let capturedUrl: string | undefined;

    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const copilotFetch = createOAuthProviderFetch(tokenFile, 'github-copilot');
      const res = await copilotFetch('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer dummy-placeholder' },
      });

      expect(res.status).toBe(200);
      expect(capturedUrl).toBe('https://api.githubcopilot.com/chat/completions');
      expect(capturedHeaders?.get('Authorization')).toBe('Bearer tid_copilot_session_token_123');
      expect(capturedHeaders?.get('Copilot-Integration-Id')).toBe(COPILOT_DEFAULT_HEADERS['Copilot-Integration-Id']);
      expect(capturedHeaders?.get('Editor-Version')).toBe(COPILOT_DEFAULT_HEADERS['Editor-Version']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('4. Full Task Metadata & Artifact E2E Flow: Plan (with Skill) -> AI Review -> Human Review -> Done', async () => {
    const specId = '001-vibe-plan-review-flow';
    const specDir = path.join(SPECS_DIR, specId);
    mkdirSync(specDir, { recursive: true });

    // Write task_metadata.json with skillId, customPhases, phaseProviders, requireReviewBeforeCoding, and planOnly
    const metadataInput = {
      skillId: 'vibe-architect',
      requireReviewBeforeCoding: true,
      planOnly: true,
      customPhases: ['discovery', 'spec_writing', 'self_critique', 'validation'],
      phaseProviders: {
        spec: 'antigravity',
        planning: 'anthropic',
        qa: 'github-copilot',
      },
      phaseModels: {
        spec: 'gemini-2.5-pro',
        planning: 'opus',
        qa: 'claude-sonnet-4',
      },
    };
    writeFileSync(path.join(specDir, 'task_metadata.json'), JSON.stringify(metadataInput, null, 2));

    const loadedMeta = await loadTaskMetadata(specDir);
    expect(loadedMeta?.skillId).toBe('vibe-architect');
    expect(loadedMeta?.requireReviewBeforeCoding).toBe(true);
    expect(loadedMeta?.planOnly).toBe(true);
    expect(loadedMeta?.customPhases).toEqual(['discovery', 'spec_writing', 'self_critique', 'validation']);
    expect(loadedMeta?.phaseProviders?.spec).toBe('antigravity');
    expect(loadedMeta?.phaseProviders?.qa).toBe('github-copilot');
  });

  test('5. Azure DevOps Ticket E2E Flow: Fetch Work Item -> Queue -> In Progress -> Human Review -> AI Review -> Done', async () => {
    // 1. Fetch Work Item AB#4821 from Azure DevOps REST API
    const mockAdoFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: 4821,
          rev: 1,
          url: 'https://dev.azure.com/contoso/vibe-platform/_apis/wit/workItems/4821',
          _links: {
            html: {
              href: 'https://dev.azure.com/contoso/vibe-platform/_workitems/edit/4821',
            },
          },
          fields: {
            'System.Title': 'Dynamic skill workflow with Claude, Copilot, and Antigravity',
            'System.Description': '<div>Implement dynamic skill workflow from Azure DevOps ticket.</div>',
            'Microsoft.VSTS.Common.AcceptanceCriteria':
              '<ul><li>Ticket starts in queue</li><li>Moves through in_progress, human_review, ai_review, done</li></ul>',
            'System.WorkItemType': 'User Story',
            'System.State': 'New',
            'System.Tags': 'azure-devops; vibe-skill; multi-provider',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const workItem = await fetchAzureDevOpsWorkItem({
      organization: 'contoso',
      project: 'vibe-platform',
      workItemId: 4821,
      pat: 'test-ado-pat',
      fetchImpl: mockAdoFetch,
    });

    expect(workItem.id).toBe(4821);
    expect(workItem.title).toBe('Dynamic skill workflow with Claude, Copilot, and Antigravity');

    // 2. Create Spec in `queue` status
    const createdSpec = createSpecForAzureDevOpsWorkItem({
      projectDir: TEST_PROJECT_DIR,
      workItem,
      initialStatus: 'queue',
      skillId: 'vibe-architect',
      requireReviewBeforeCoding: true,
      planOnly: true,
      phaseProviders: {
        spec: 'antigravity',
        planning: 'anthropic',
        qa: 'github-copilot',
      },
    });

    const planFilePath = path.join(createdSpec.specDir, 'implementation_plan.json');
    const transitionHistory: string[] = [];

    const readPersistedStatus = (): string => {
      const plan = JSON.parse(readFileSync(planFilePath, 'utf-8')) as { status: string };
      return plan.status;
    };

    const persistXStateTransition = (xstateState: string, reviewReason?: 'plan_review' | 'completed') => {
      const mapped = mapStateToLegacy(xstateState, reviewReason);
      const plan = JSON.parse(readFileSync(planFilePath, 'utf-8')) as Record<string, unknown>;
      plan.status = mapped.status;
      plan.xstateState = xstateState;
      if (mapped.reviewReason) {
        plan.reviewReason = mapped.reviewReason;
      } else {
        delete plan.reviewReason;
      }
      writeFileSync(planFilePath, JSON.stringify(plan, null, 2));
      transitionHistory.push(readPersistedStatus());
    };

    // Status 1: Queue ('queue') — initial status when imported from Azure DevOps
    transitionHistory.push(readPersistedStatus());
    expect(transitionHistory[0]).toBe('queue');

    // Status 2: In Progress ('in_progress') — planning starts with active skill
    persistXStateTransition('planning');

    // Status 3: Human Review ('human_review') — plan ready for human review (plan_review)
    persistXStateTransition('plan_review', 'plan_review');

    // Status 4: AI Review ('ai_review') — AI review / self-critique validates plan & checklist (qa_review)
    persistXStateTransition('qa_review');

    // Status 5: Done ('done') — ticket completed
    persistXStateTransition('done');

    expect(transitionHistory).toEqual([
      'queue',
      'in_progress',
      'human_review',
      'ai_review',
      'done',
    ]);
  });
});
