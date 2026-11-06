import { test, expect } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";

const PUBLISHED_URL =
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3782";

const MOCK_PORT = 19876;
const MOCK_ORG_URL = `http://127.0.0.1:${MOCK_PORT}/mock-org`;
const MOCK_PROJECT = "Live-E2E-Project";
const VALID_PAT = "valid_live_pat_888";
const INVALID_PAT = "invalid_pat_bad_token";

test.describe("Azure DevOps Refresh & Test Connection E2E Verification", () => {
  let mockServer: http.Server;

  let mockWorkItems: Array<{ id: number; fields: Record<string, any> }> = [];

  const resetMockWorkItems = () => {
    mockWorkItems = [
      {
        id: 701,
        fields: {
          "System.Id": 701,
          "System.WorkItemType": "Bug",
          "System.Title": "Fresh Azure DevOps Bug: Payment Gateway Timeout",
          "System.State": "Active",
          "Microsoft.VSTS.Common.Priority": 1,
          "System.AssignedTo": { displayName: "Azure SRE Team" },
          "System.Tags": "live-pat; production; refreshed",
          "System.Description":
            "Current ticket retrieved live from Azure DevOps after refresh.",
        },
      },
      {
        id: 702,
        fields: {
          "System.Id": 702,
          "System.WorkItemType": "User Story",
          "System.Title":
            "Fresh Azure DevOps User Story: Biometric Authentication",
          "System.State": "New",
          "Microsoft.VSTS.Common.Priority": 2,
          "System.AssignedTo": { displayName: "Security Team" },
          "System.Tags": "auth; biometric; azure-devops",
          "System.Description":
            "Current user story fetched live via WIQL and batch API.",
        },
      },
    ];
  };

  test.beforeAll(async () => {
    resetMockWorkItems();
    // Spin up mock Azure DevOps HTTP server
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://127.0.0.1:${MOCK_PORT}`);
      const authHeader = req.headers.authorization || "";
      const isAuthValid = authHeader.includes(
        Buffer.from(`:${VALID_PAT}`).toString("base64"),
      );

      // Connection Validation Endpoint
      // e.g. /mock-org/_apis/projects/Live-E2E-Project or /projects/Live-E2E-Project
      if (url.pathname.includes("/_apis/projects") || url.pathname.includes("/projects/")) {
        if (!isAuthValid) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              message:
                "TF400813: The user is not authorized to access this resource. Invalid or expired Personal Access Token (PAT).",
              errorCode: "TF400813",
            }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "proj-live-888-guid",
            name: MOCK_PROJECT,
            description: "Live Azure DevOps Project for E2E Verification",
            state: "wellFormed",
          }),
        );
        return;
      }

      // WIQL Query Endpoint
      if (url.pathname.includes("/_apis/wit/wiql")) {
        if (!isAuthValid) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "TF400813: Unauthorized" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            queryType: "flat",
            workItems: mockWorkItems.map((w) => ({ id: w.id })),
          }),
        );
        return;
      }

      // Batch Work Items Endpoint
      if (url.pathname.includes("/_apis/wit/workitemsbatch")) {
        if (!isAuthValid) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "TF400813: Unauthorized" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            count: mockWorkItems.length,
            value: mockWorkItems,
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Endpoint not found" }));
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(MOCK_PORT, "127.0.0.1", () => resolve());
    });
  });

  const statePath =
    "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/csharp-e2e-project/.auto-claude/azure-devops/state.json";
  const defaultState = {
    config: {
      organizationUrl: "https://dev.azure.com/auto-claude-org",
      project: "CSharp-Process-E2E",
      personalAccessToken: "",
      useMock: true,
      connected: true,
      updatedAt: new Date().toISOString(),
    },
    workItems: [
      {
        id: 101,
        type: "Bug",
        title: "Fix authentication crash on expired PAT token",
        state: "Active",
        priority: 1,
        assignedTo: "Auto Claude Bot",
        tags: ["auth", "security", "azure-devops"],
        description: "When an expired Personal Access Token is used against Azure DevOps REST API v7.1, handle HTTP 401 TF400813 and 203 HTML redirect gracefully without crashing the worker.",
        url: "https://dev.azure.com/auto-claude-org/CSharp-Process-E2E/_workitems/edit/101",
        comments: [],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 102,
        type: "User Story",
        title: "Implement two-way Work Item status & comment sync",
        state: "New",
        priority: 2,
        assignedTo: "Auto Claude Bot",
        tags: ["sync", "kanban", "webhook"],
        description: "Synchronize Auto Claude Kanban task transitions (In Progress -> AI Review -> Human Review -> Done) back to Azure DevOps Work Item state (Active -> Resolved -> Done) with automated QA & Git diff comments.",
        url: "https://dev.azure.com/auto-claude-org/CSharp-Process-E2E/_workitems/edit/102",
        comments: [],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 103,
        type: "Task",
        title: "Add batch WIQL query & fault-isolated worktree runner",
        state: "Active",
        priority: 2,
        assignedTo: "Auto Claude Bot",
        tags: ["wiql", "runner", "worktree"],
        description: "Support querying Bugs, Tasks, and User Stories via WIQL with 200-item batch chunking and isolated per-ticket execution.",
        url: "https://dev.azure.com/auto-claude-org/CSharp-Process-E2E/_workitems/edit/103",
        comments: [],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 104,
        type: "Bug",
        title: "Sanitize HTML description & ReproSteps into Markdown spec",
        state: "New",
        priority: 3,
        assignedTo: "Auto Claude Bot",
        tags: ["mapper", "markdown"],
        description: "Convert Azure DevOps System.Description and Microsoft.VSTS.TCM.ReproSteps HTML into clean Markdown spec.md and requirements.json.",
        url: "https://dev.azure.com/auto-claude-org/CSharp-Process-E2E/_workitems/edit/104",
        comments: [],
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  test.afterAll(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
    try {
      fs.writeFileSync(statePath, JSON.stringify(defaultState, null, 2), "utf8");
    } catch {
      // Ignore
    }
  });

  test.beforeEach(async () => {
    try {
      fs.writeFileSync(statePath, JSON.stringify(defaultState, null, 2), "utf8");
    } catch {
      // Ignore
    }
  });

  test("R1, R2, R3: Validates connection before saving & fetches fresh tickets on refresh", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // 1. Navigate to application & select CSharp Process E2E project
    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByText("CSharp Process E2E").first().click();

    // 2. Open Azure DevOps modal and verify initial stale/default work items
    const adoBtn = page.getByTestId("kanban-azure-devops-btn");
    await expect(adoBtn).toBeVisible({ timeout: 10000 });
    await adoBtn.click();

    const adoModal = page.getByTestId("azure-devops-modal");
    await expect(adoModal).toBeVisible({ timeout: 8000 });

    // Verify initial work items exist
    await expect(page.getByTestId("ado-ticket-row-101")).toBeVisible();

    // Close the modal
    await page.getByTestId("ado-modal-close-btn").click();
    await expect(adoModal).toHaveCount(0);

    // 3. Navigate to Settings -> Integrations view
    await page.getByRole("button", { name: /^Settings$/i }).click();
    await expect(page.getByTestId("settings-view")).toBeVisible({ timeout: 8000 });

    const integrationsNav = page.getByTestId("settings-nav-integrations");
    await expect(integrationsNav).toBeVisible();
    await integrationsNav.click();

    const adoCard = page.getByTestId("integration-card-azure-devops");
    await expect(adoCard).toBeVisible();

    // 4. Verify "Test Connection" button is present before saving (R3)
    const testConnBtn = page.getByTestId("integration-test-azure-devops");
    await expect(testConnBtn).toBeVisible();
    await expect(testConnBtn).toHaveText(/Test Connection/i);

    // 5. Test failure flow: Enter invalid PAT and click "Test Connection"
    const orgInput = page.getByTestId("integration-azure-devops-organizationUrl");
    const projInput = page.getByTestId("integration-azure-devops-project");
    const tokenInput = page.getByTestId("integration-azure-devops-token");

    await orgInput.fill(MOCK_ORG_URL);
    await projInput.fill(MOCK_PROJECT);
    await tokenInput.fill(INVALID_PAT);

    await testConnBtn.click();

    // Verify clear visual failure feedback is displayed
    const testFeedback = page.getByTestId("integration-ado-test-feedback");
    await expect(testFeedback).toBeVisible({ timeout: 8000 });
    await expect(testFeedback).toContainText("Connection Failed");
    await expect(testFeedback).toContainText(/401|invalid|unauthorized/i);
    await page.screenshot({ path: "/tmp/ado_test_connection_failed.png" });

    // 6. Test success flow: Enter valid credentials and click "Test Connection"
    await tokenInput.fill(VALID_PAT);
    await testConnBtn.click();

    // Verify clear visual success feedback is displayed
    await expect(testFeedback).toBeVisible({ timeout: 8000 });
    await expect(testFeedback).toContainText("Connection Succeeded");
    await expect(testFeedback).toContainText(/successfully/i);
    await page.screenshot({ path: "/tmp/ado_test_connection_succeeded.png" });

    // 7. Save configuration after connection validation
    const saveBtn = page.getByTestId("integration-save-azure-devops");
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const savedMsg = page.getByTestId("integration-ado-saved-msg");
    await expect(savedMsg).toBeVisible({ timeout: 8000 });

    // 8. Navigate back to Kanban board
    await page.getByTestId("sidebar-nav-kanban").click();
    await expect(adoBtn).toBeVisible({ timeout: 8000 });

    // 9. Open Azure DevOps modal and trigger Refresh (R1 & R2)
    await adoBtn.click();
    await expect(adoModal).toBeVisible({ timeout: 8000 });

    const refreshBtn = page.getByTestId("ado-refresh-btn");
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // 10. Verify that refreshing retrieves current ticket data from Azure DevOps
    // Ticket #701 (Bug) and #702 (User Story) should now be displayed
    await expect(
      page.getByText("Fresh Azure DevOps Bug: Payment Gateway Timeout"),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Fresh Azure DevOps User Story: Biometric Authentication"),
    ).toBeVisible({ timeout: 10000 });

    // Verify stale tickets #101..#104 are no longer the primary items
    await expect(page.getByTestId("ado-ticket-row-701")).toBeVisible();
    await expect(page.getByTestId("ado-ticket-row-702")).toBeVisible();
    expect(await page.getByTestId("ado-ticket-row-703").count()).toBe(0);

    // Dynamic Live Ticket Injection: simulate a new ticket arriving in Azure DevOps
    mockWorkItems.push({
      id: 703,
      fields: {
        "System.Id": 703,
        "System.WorkItemType": "Bug",
        "System.Title": "Fresh Azure DevOps Bug: Production Redis Latency Spike",
        "System.State": "Active",
        "Microsoft.VSTS.Common.Priority": 1,
        "System.AssignedTo": { displayName: "Azure SRE Team" },
        "System.Tags": "live-refresh; dynamic-sync",
        "System.Description":
          "Retrieved dynamically on live refresh after configuration update.",
      },
    });

    // Trigger refresh again — verifies that refresh fetches newly updated tickets
    await refreshBtn.click();
    await expect(page.getByTestId("ado-ticket-row-703")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Fresh Azure DevOps Bug: Production Redis Latency Spike"),
    ).toBeVisible({ timeout: 10000 });

    // 11. Verify Test Connection button inside Azure DevOps Modal config form as well (R3)
    const toggleConfigBtn = page.getByTestId("ado-toggle-config-btn");
    await expect(toggleConfigBtn).toBeVisible();
    await toggleConfigBtn.click();

    const modalConfigForm = page.getByTestId("ado-config-form");
    await expect(modalConfigForm).toBeVisible();

    const modalTestConnBtn = page.getByTestId("ado-config-test-btn");
    await expect(modalTestConnBtn).toBeVisible();

    const modalPatInput = page.getByTestId("ado-config-pat-input");
    await modalPatInput.fill("unauthorized_modal_pat_401");
    await modalTestConnBtn.click();

    const modalTestFeedback = page.getByTestId("ado-config-test-feedback");
    await expect(modalTestFeedback).toBeVisible({ timeout: 8000 });
    await expect(modalTestFeedback).toContainText("Connection Failed");

    // Enter valid PAT in modal and test connection
    await modalPatInput.fill(VALID_PAT);
    await modalTestConnBtn.click();
    await expect(modalTestFeedback).toContainText("Connection Succeeded");

    // Save and verify connection badge displays Connected
    const modalSaveBtn = page.getByTestId("ado-config-save-btn");
    await modalSaveBtn.click();
    const connBadge = page.getByTestId("ado-connection-badge");
    await expect(connBadge).toBeVisible();
    await expect(connBadge).toContainText("Connected");

    expect(pageErrors).toEqual([]);
  });
});
