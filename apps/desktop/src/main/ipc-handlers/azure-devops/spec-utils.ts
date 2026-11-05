/**
 * Azure DevOps Work Item -> Spec / Task Utilities
 *
 * Fetches Azure DevOps Work Items via REST API (WIT v7.1) and creates
 * Aperant spec directories initialized in `queue` status for the
 * Queue -> In Progress -> Human Review -> AI Review -> Done workflow.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AzureDevOpsWorkItem } from '../../../shared/types/integrations';
import type { TaskCategory, TaskMetadata, TaskStatus } from '../../../shared/types/task';

export interface FetchAzureDevOpsWorkItemOptions {
  organization: string;
  project: string;
  workItemId: number;
  pat?: string;
  accessToken?: string;
  baseUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
}

export interface CreateAzureDevOpsSpecOptions {
  projectDir: string;
  workItem: AzureDevOpsWorkItem;
  initialStatus?: TaskStatus;
  skillId?: string;
  customPhases?: string[];
  requireReviewBeforeCoding?: boolean;
  planOnly?: boolean;
  provider?: string;
  phaseProviders?: Record<string, string>;
}

export interface CreatedAzureDevOpsSpec {
  specId: string;
  specDir: string;
  status: TaskStatus;
  taskDescription: string;
  metadata: TaskMetadata;
}

/**
 * Strip basic HTML tags often returned by Azure DevOps `System.Description`
 * and `Microsoft.VSTS.Common.AcceptanceCriteria` fields.
 */
export function stripAzureDevOpsHtml(input?: string): string {
  if (!input) return '';
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Slugify work item title for spec directory naming.
 */
export function slugifyAzureDevOpsTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'azure-devops-work-item'
  );
}

/**
 * Determine Aperant TaskCategory from Azure DevOps work item type and tags.
 */
export function determineCategoryFromWorkItem(
  workItemType: string,
  tags: string[] = []
): TaskCategory {
  const lowerType = workItemType.toLowerCase();
  const lowerTags = tags.map((t) => t.toLowerCase());

  if (lowerType === 'bug' || lowerTags.some((t) => t.includes('bug') || t.includes('defect'))) {
    return 'bug_fix';
  }
  if (lowerTags.some((t) => t.includes('security') || t.includes('vuln'))) {
    return 'security';
  }
  if (lowerTags.some((t) => t.includes('perf') || t.includes('performance'))) {
    return 'performance';
  }
  if (lowerTags.some((t) => t.includes('refactor') || t.includes('tech-debt'))) {
    return 'refactoring';
  }
  if (lowerTags.some((t) => t.includes('doc') || t.includes('documentation'))) {
    return 'documentation';
  }
  if (lowerTags.some((t) => t.includes('test') || t.includes('e2e') || t.includes('qa'))) {
    return 'testing';
  }
  return 'feature';
}

/**
 * Fetch an Azure DevOps Work Item via REST API v7.1.
 */
export async function fetchAzureDevOpsWorkItem(
  options: FetchAzureDevOpsWorkItemOptions
): Promise<AzureDevOpsWorkItem> {
  const {
    organization,
    project,
    workItemId,
    pat,
    accessToken,
    baseUrl = 'https://dev.azure.com',
    fetchImpl = globalThis.fetch,
  } = options;

  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const apiUrl = `${trimmedBase}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (pat) {
    const encoded = Buffer.from(`:${pat}`).toString('base64');
    headers.Authorization = `Basic ${encoded}`;
  }

  const response = await fetchImpl(apiUrl, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Azure DevOps API error (${response.status}): failed to fetch work item #${workItemId}`);
  }

  const raw = (await response.json()) as {
    id: number;
    rev?: number;
    url?: string;
    _links?: { html?: { href?: string } };
    fields?: Record<string, unknown>;
  };

  const fields = raw.fields ?? {};
  const rawTags = typeof fields['System.Tags'] === 'string' ? fields['System.Tags'] : '';
  const tags = rawTags
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

  const assignedToRaw = fields['System.AssignedTo'] as
    | { displayName?: string; uniqueName?: string }
    | string
    | undefined;

  const assignedTo =
    typeof assignedToRaw === 'string'
      ? { displayName: assignedToRaw }
      : assignedToRaw?.displayName
        ? { displayName: assignedToRaw.displayName, uniqueName: assignedToRaw.uniqueName }
        : undefined;

  const htmlUrl =
    raw._links?.html?.href ||
    `${trimmedBase}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_workitems/edit/${raw.id}`;

  return {
    id: raw.id,
    rev: raw.rev,
    title: String(fields['System.Title'] ?? `Work Item #${workItemId}`),
    description: stripAzureDevOpsHtml(fields['System.Description'] as string | undefined),
    acceptanceCriteria: stripAzureDevOpsHtml(
      fields['Microsoft.VSTS.Common.AcceptanceCriteria'] as string | undefined
    ),
    workItemType: String(fields['System.WorkItemType'] ?? 'User Story'),
    state: String(fields['System.State'] ?? 'New'),
    priority:
      typeof fields['Microsoft.VSTS.Common.Priority'] === 'number'
        ? (fields['Microsoft.VSTS.Common.Priority'] as number)
        : undefined,
    tags,
    assignedTo,
    organization,
    project,
    url: raw.url || apiUrl,
    htmlUrl,
    createdAt: fields['System.CreatedDate'] as string | undefined,
    updatedAt: fields['System.ChangedDate'] as string | undefined,
  };
}

/**
 * Format an Azure DevOps Work Item into markdown context for planning & review agents.
 */
export function buildAzureDevOpsWorkItemContext(workItem: AzureDevOpsWorkItem): string {
  const sections: string[] = [
    `# Azure DevOps ${workItem.workItemType} AB#${workItem.id}: ${workItem.title}`,
    '',
    `**Organization / Project:** ${workItem.organization}/${workItem.project}`,
    `**Work Item Type:** ${workItem.workItemType}`,
    `**Azure DevOps State:** ${workItem.state}`,
    `**Tags:** ${workItem.tags.length > 0 ? workItem.tags.join(', ') : 'None'}`,
    `**URL:** ${workItem.htmlUrl}`,
    '',
    '## Description',
    workItem.description || 'No description provided.',
  ];

  if (workItem.acceptanceCriteria) {
    sections.push('', '## Acceptance Criteria', workItem.acceptanceCriteria);
  }

  return sections.join('\n');
}

/**
 * Create a spec directory and initial files (`implementation_plan.json`,
 * `requirements.json`, `task_metadata.json`) from an Azure DevOps Work Item.
 * Defaults to `queue` status so the imported ticket enters the Queue column first.
 */
export function createSpecForAzureDevOpsWorkItem(
  options: CreateAzureDevOpsSpecOptions
): CreatedAzureDevOpsSpec {
  const {
    projectDir,
    workItem,
    initialStatus = 'queue',
    skillId,
    customPhases,
    requireReviewBeforeCoding = true,
    planOnly = false,
    provider,
    phaseProviders,
  } = options;

  const specsDir = path.join(projectDir, '.auto-claude', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });

  // Determine next spec number
  const existing = fs
    .readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const match = /^(\d+)-/.exec(d.name);
      return match ? parseInt(match[1], 10) : 0;
    });
  const nextNumber = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  const specId = `${String(nextNumber).padStart(3, '0')}-ab-${workItem.id}-${slugifyAzureDevOpsTitle(workItem.title)}`;
  const specDir = path.join(specsDir, specId);
  fs.mkdirSync(specDir, { recursive: true });

  const now = new Date().toISOString();
  const taskDescription = buildAzureDevOpsWorkItemContext(workItem);
  const category = determineCategoryFromWorkItem(workItem.workItemType, workItem.tags);

  const implementationPlan = {
    feature: `AB#${workItem.id}: ${workItem.title}`,
    description: taskDescription,
    created_at: now,
    updated_at: now,
    status: initialStatus,
    xstateState: initialStatus === 'queue' ? 'queue' : 'backlog',
    phases: [],
  };

  fs.writeFileSync(
    path.join(specDir, 'implementation_plan.json'),
    JSON.stringify(implementationPlan, null, 2),
    'utf-8'
  );

  const requirements = {
    task_description: taskDescription,
    workflow_type: category === 'bug_fix' ? 'bug_fix' : 'feature',
    external_source: {
      provider: 'azure_devops',
      work_item_id: workItem.id,
      work_item_type: workItem.workItemType,
      url: workItem.htmlUrl,
    },
  };

  fs.writeFileSync(
    path.join(specDir, 'requirements.json'),
    JSON.stringify(requirements, null, 2),
    'utf-8'
  );

  const metadata: TaskMetadata = {
    sourceType: 'azure_devops',
    azureDevOpsWorkItemId: workItem.id,
    azureDevOpsWorkItemType: workItem.workItemType,
    azureDevOpsUrl: workItem.htmlUrl,
    azureDevOpsOrganization: workItem.organization,
    azureDevOpsProject: workItem.project,
    category,
    requireReviewBeforeCoding,
    planOnly,
    ...(skillId && { skillId }),
    ...(customPhases && { customPhases }),
    ...(provider && { provider }),
    ...(phaseProviders && { phaseProviders }),
  };

  fs.writeFileSync(
    path.join(specDir, 'task_metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  return {
    specId,
    specDir,
    status: initialStatus,
    taskDescription,
    metadata,
  };
}
