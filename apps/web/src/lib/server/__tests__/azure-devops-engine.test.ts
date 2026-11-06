import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadStore,
  saveStore,
  createOrUpdateProject,
  getAzureDevOpsForProject,
  refreshAzureDevOpsForProject,
  saveAzureDevOpsConfigForProject,
  testAzureDevOpsConnectionForProject,
  createAzureDevOpsTicketForProject,
  importAzureDevOpsTicketsForProject,
  approveTaskForProject,
  rejectTaskForProject,
  updateTaskStatusForProject,
  normalizeAzureDevOpsUrl,
} from "../task-engine";

describe("Azure DevOps Work Items & Two-Way Kanban Sync Engine", () => {
  let tempProjectDir: string;
  let project: any;
  let snapshotStore: { projects: any[]; settings: Record<string, any> };

  beforeEach(() => {
    snapshotStore = loadStore();
    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aperant-ado-test-"));
    project = createOrUpdateProject(tempProjectDir, "ADO Sync Test Project");
  });

  afterEach(() => {
    saveStore(snapshotStore);
    try {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("normalizes Azure DevOps organization URLs and extracts project names correctly", () => {
    // 1. Plain organization name
    const res1 = normalizeAzureDevOpsUrl("my-company-org");
    expect(res1.organizationUrl).toBe("https://dev.azure.com/my-company-org");

    // 2. Plain organization name with embedded project
    const res2 = normalizeAzureDevOpsUrl("my-company-org/Sprint-Project");
    expect(res2.organizationUrl).toBe("https://dev.azure.com/my-company-org");
    expect(res2.project).toBe("Sprint-Project");

    // 3. dev.azure.com URL with embedded project
    const res3 = normalizeAzureDevOpsUrl("https://dev.azure.com/enterprise/Core-Team");
    expect(res3.organizationUrl).toBe("https://dev.azure.com/enterprise");
    expect(res3.project).toBe("Core-Team");

    // 4. visualstudio.com legacy URL with embedded project
    const res4 = normalizeAzureDevOpsUrl("https://legacy-org.visualstudio.com/Backlog");
    expect(res4.organizationUrl).toBe("https://legacy-org.visualstudio.com");
    expect(res4.project).toBe("Backlog");

    // 5. Trailing slashes and spaces
    const res5 = normalizeAzureDevOpsUrl("   https://dev.azure.com/trailing-slashes///   ");
    expect(res5.organizationUrl).toBe("https://dev.azure.com/trailing-slashes");

    // 6. Browser-copied URLs with trailing subpaths like /_workitems or /_boards
    const res6 = normalizeAzureDevOpsUrl(
      "https://dev.azure.com/my-enterprise-org/Core-App/_workitems/recentlyupdated/",
    );
    expect(res6.organizationUrl).toBe("https://dev.azure.com/my-enterprise-org");
    expect(res6.project).toBe("Core-App");

    const res7 = normalizeAzureDevOpsUrl(
      "https://my-corp.visualstudio.com/Finance-Service/_boards/board/",
    );
    expect(res7.organizationUrl).toBe("https://my-corp.visualstudio.com");
    expect(res7.project).toBe("Finance-Service");
  });

  it("initializes 4 default Azure DevOps Work Items (#101..#104)", () => {
    const res = getAzureDevOpsForProject(project.id);
    expect(res.success).toBe(true);
    expect(res.config.connected).toBe(true);
    expect(res.workItems.map((w: any) => w.id)).toEqual([101, 102, 103, 104]);
    expect(res.workItems[0].title).toContain("Fix authentication crash on expired PAT token");
  });

  it("saves Azure DevOps connection configuration", async () => {
    const res = await saveAzureDevOpsConfigForProject(project.id, {
      organizationUrl: "https://dev.azure.com/enterprise-org",
      project: "Core-Platform",
      personalAccessToken: "pat-secret-123",
      useMock: true,
    });
    expect(res.config.organizationUrl).toBe("https://dev.azure.com/enterprise-org");
    expect(res.config.project).toBe("Core-Platform");
    expect(res.config.connected).toBe(true);
  });

  it("creates a new Azure DevOps ticket (#105) and imports + syncs status/comments two-way", () => {
    const created = createAzureDevOpsTicketForProject(project.id, {
      title: "Support custom WIQL area path filtering",
      description: "Filter work items by System.AreaPath",
      type: "User Story",
      priority: 1,
      tags: ["wiql", "area-path"],
    });
    expect(created.ticket.id).toBe(105);

    const imported = importAzureDevOpsTicketsForProject(project.id, [105], false);
    expect(imported.importedTasks).toHaveLength(1);
    const task = imported.importedTasks[0];
    expect(task.title).toBe("[ADO #105] Support custom WIQL area path filtering");
    expect(task.metadata.azureDevOpsId).toBe(105);

    // Move task to human_review -> should sync Work Item #105 state to Resolved
    updateTaskStatusForProject(project.id, task.id, "human_review");
    let stateAfterReview = getAzureDevOpsForProject(project.id);
    let item105 = stateAfterReview.workItems.find((w: any) => w.id === 105);
    expect(item105.state).toBe("Resolved");

    // Approve task -> should sync Work Item #105 state to Done with approval comment
    approveTaskForProject(project.id, task.id, "LGTM shipped");
    const stateAfterApprove = getAzureDevOpsForProject(project.id);
    item105 = stateAfterApprove.workItems.find((w: any) => w.id === 105);
    expect(item105.state).toBe("Done");
    expect(
      item105.comments.some((c: any) =>
        c.text.includes("Work Item state synchronized to Done"),
      ),
    ).toBe(true);

    // Reject task -> should revert Work Item #105 state to Active with feedback comment
    rejectTaskForProject(project.id, task.id, "Add retry backoff test");
    const stateAfterReject = getAzureDevOpsForProject(project.id);
    item105 = stateAfterReject.workItems.find((w: any) => w.id === 105);
    expect(item105.state).toBe("Active");
  });

  it("validates Azure DevOps connection credentials prior to saving (Test Connection)", async () => {
    // 1. Missing fields should fail validation
    const missingRes = await testAzureDevOpsConnectionForProject(project.id, {
      organizationUrl: "",
      project: "",
      personalAccessToken: "",
    });
    expect(missingRes.valid).toBe(false);
    expect(missingRes.message).toContain("required");

    // 2. Invalid PAT token should fail validation with 401 error message in mock mode
    const invalidRes = await testAzureDevOpsConnectionForProject(project.id, {
      organizationUrl: "https://dev.azure.com/auto-claude-org",
      project: "Aperant-Platform",
      personalAccessToken: "invalid_pat_test",
      useMock: true,
    });
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.message).toContain("401");
    expect(invalidRes.error).toContain("TF400813");

    // 3. Valid credentials in mock mode should succeed
    const validRes = await testAzureDevOpsConnectionForProject(project.id, {
      organizationUrl: "https://dev.azure.com/auto-claude-org",
      project: "Aperant-Platform",
      personalAccessToken: "azd_pat_valid_token_123",
      useMock: true,
    });
    expect(validRes.valid).toBe(true);
    expect(validRes.message).toContain("verified successfully");
  });

  it("does not falsely bypass live validation when PAT is provided without explicit useMock", async () => {
    // On a default project (which starts with state.config.useMock === true),
    // entering a PAT without useMock must test live credentials and NOT falsely return mock success.
    const res = await testAzureDevOpsConnectionForProject(project.id, {
      organizationUrl: "https://dev.azure.com/nonexistent-org-xyz-9999",
      project: "NonexistentProject",
      personalAccessToken: "real_token_format_abc123",
      // useMock omitted — should automatically disable mock to test live API
    });
    // Should NOT say "Connected to sandbox project"
    expect(res.valid).toBe(false);
    expect(res.message).not.toContain("sandbox");
  });

  it("preserves empty backlog state and does not wipe configuration when workItems is empty", async () => {
    // Save configuration with custom project name
    await saveAzureDevOpsConfigForProject(project.id, {
      organizationUrl: "https://dev.azure.com/my-corp",
      project: "EmptyBacklogProject",
      personalAccessToken: "pat_999",
      useMock: true,
    });

    // Manually set workItems to empty array to simulate an empty backlog in Azure DevOps
    const stateFile = path.join(tempProjectDir, ".auto-claude", "azure-devops", "state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    state.workItems = [];
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");

    // Read back state — must preserve empty workItems and not wipe config
    const retrieved = getAzureDevOpsForProject(project.id);
    expect(retrieved.success).toBe(true);
    expect(retrieved.config.project).toBe("EmptyBacklogProject");
    expect(retrieved.workItems).toEqual([]);
  });

  it("re-reads updated configuration and retrieves fresh tickets on refresh", async () => {
    // Save configuration with new project name and token
    await saveAzureDevOpsConfigForProject(project.id, {
      organizationUrl: "https://dev.azure.com/auto-claude-org",
      project: "Live-Sprint-Board",
      personalAccessToken: "azd_pat_refreshed_999",
      useMock: true,
    });

    const refreshed = await refreshAzureDevOpsForProject(project.id);
    expect(refreshed.success).toBe(true);
    expect(refreshed.config.project).toBe("Live-Sprint-Board");
    expect(refreshed.config.personalAccessToken).toBe("azd_pat_refreshed_999");
    expect(refreshed.workItems.length).toBeGreaterThan(0);
  });

  it("tries alternative fallback endpoint when first endpoint returns 404", async () => {
    const originalFetch = globalThis.fetch;
    const requestedEndpoints: string[] = [];
    try {
      // Mock fetch: first endpoint returns 404, second endpoint returns 200
      globalThis.fetch = (async (input: any) => {
        const urlStr = String(input);
        requestedEndpoints.push(urlStr);
        if (urlStr.includes("/_apis/projects/")) {
          return new Response(JSON.stringify({ message: "Not found on _apis" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/projects/Fallback-Project")) {
          return new Response(
            JSON.stringify({ id: "proj-123", name: "Fallback-Project" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      const res = await testAzureDevOpsConnectionForProject(project.id, {
        organizationUrl: "http://127.0.0.1:29999/fallback-org",
        project: "Fallback-Project",
        personalAccessToken: "live_test_pat",
        useMock: false,
      });

      expect(requestedEndpoints.length).toBe(2);
      expect(res.valid).toBe(true);
      expect(res.message).toContain("Fallback-Project");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes embedded project URLs in testAzureDevOpsConnectionForProject without duplicating paths", async () => {
    const originalFetch = globalThis.fetch;
    let contactedUrl = "";
    try {
      globalThis.fetch = (async (input: any) => {
        contactedUrl = String(input);
        return new Response(JSON.stringify({ id: "proj-abc", name: "Core-Service" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as any;

      const res = await testAzureDevOpsConnectionForProject(project.id, {
        organizationUrl: "https://dev.azure.com/my-enterprise/Core-Service/_workitems",
        personalAccessToken: "valid_pat_xyz",
        useMock: false,
      });

      expect(res.valid).toBe(true);
      // Ensure the URL does not contain duplicated /Core-Service/Core-Service
      expect(contactedUrl).toContain("https://dev.azure.com/my-enterprise/_apis/projects/Core-Service");
      expect(contactedUrl).not.toContain("Core-Service/Core-Service");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("safely handles batch work item responses containing null or malformed entries", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: any, init: any) => {
        const urlStr = String(input);
        if (urlStr.includes("/wit/wiql")) {
          return new Response(JSON.stringify({ workItems: [{ id: 501 }, { id: 502 }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/wit/workitemsbatch")) {
          return new Response(
            JSON.stringify({
              value: [
                null, // Malformed null entry from API
                {
                  id: 501,
                  fields: {
                    "System.Id": 501,
                    "System.Title": "Valid work item 501",
                    "System.State": "Active",
                  },
                },
                { id: undefined }, // Missing id entry
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      // Save live config
      await saveAzureDevOpsConfigForProject(project.id, {
        organizationUrl: "https://dev.azure.com/live-corp",
        project: "Resilience-Project",
        personalAccessToken: "valid_live_pat",
        useMock: false,
      });

      const refreshed = await refreshAzureDevOpsForProject(project.id);
      expect(refreshed.success).toBe(true);
      const item501 = refreshed.workItems.find((w: any) => w.id === 501);
      expect(item501).toBeDefined();
      expect(item501.title).toBe("Valid work item 501");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


