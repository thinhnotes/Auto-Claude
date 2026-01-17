/**
 * Unit tests for Azure DevOps environment variable parsing and generation
 * Tests the Azure DevOps integration in env-handlers.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Test data directory
const TEST_DIR = mkdtempSync(path.join(tmpdir(), "azure-devops-env-test-"));
const TEST_PROJECT_PATH = path.join(TEST_DIR, "test-project");

// Mock electron-updater before importing
vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
  },
}));

// Mock @electron-toolkit/utils before importing
vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true,
    windows: process.platform === "win32",
    macos: process.platform === "darwin",
    linux: process.platform === "linux",
  },
  electronApp: {
    setAppUserModelId: vi.fn(),
  },
  optimizer: {
    watchWindowShortcuts: vi.fn(),
  },
}));

// Mock version-manager to return a predictable version
vi.mock("../updater/version-manager", () => ({
  getEffectiveVersion: vi.fn(() => "0.1.0"),
  getBundledVersion: vi.fn(() => "0.1.0"),
  parseVersionFromTag: vi.fn((tag: string) => tag.replace("v", "")),
  compareVersions: vi.fn(() => 0),
}));

vi.mock("../notification-service", () => ({
  notificationService: {
    initialize: vi.fn(),
    notifyReviewNeeded: vi.fn(),
    notifyTaskFailed: vi.fn(),
  },
}));

// Mock electron-log to prevent Electron binary dependency
vi.mock("electron-log/main.js", () => ({
  default: {
    initialize: vi.fn(),
    transports: {
      file: {
        maxSize: 10 * 1024 * 1024,
        format: "",
        fileName: "main.log",
        level: "info",
        getFile: vi.fn(() => ({ path: "/tmp/test.log" })),
      },
      console: {
        level: "warn",
        format: "",
      },
    },
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock cli-tool-manager to avoid blocking tool detection on Windows
vi.mock("../cli-tool-manager", () => ({
  getToolInfo: vi.fn(() => ({ found: false, path: null, source: "mock" })),
  getToolPath: vi.fn((tool: string) => tool),
  deriveGitBashPath: vi.fn(() => null),
  clearCache: vi.fn(),
  clearToolCache: vi.fn(),
  configureTools: vi.fn(),
  preWarmToolCache: vi.fn(() => Promise.resolve()),
  getToolPathAsync: vi.fn((tool: string) => Promise.resolve(tool)),
}));

// Mock modules before importing
vi.mock("electron", () => {
  const mockIpcMain = new (class extends EventEmitter {
    private handlers: Map<string, Function> = new Map();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    removeHandler(channel: string): void {
      this.handlers.delete(channel);
    }

    async invokeHandler(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (handler) {
        return handler(event, ...args);
      }
      throw new Error(`No handler for channel: ${channel}`);
    }

    getHandler(channel: string): Function | undefined {
      return this.handlers.get(channel);
    }
  })();

  return {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === "userData") return path.join(TEST_DIR, "userData");
        return TEST_DIR;
      }),
      getAppPath: vi.fn(() => TEST_DIR),
      getVersion: vi.fn(() => "0.1.0"),
      isPackaged: false,
    },
    ipcMain: mockIpcMain,
    dialog: {
      showOpenDialog: vi.fn(() =>
        Promise.resolve({ canceled: false, filePaths: [TEST_PROJECT_PATH] })
      ),
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() };
    },
  };
});

// Setup test project structure
function setupTestProject(): void {
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_PATH, ".auto-claude", "specs"), { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Increase timeout for all tests in this file due to dynamic imports and setup overhead
describe("Azure DevOps Environment Handlers", { timeout: 15000 }, () => {
  let ipcMain: EventEmitter & {
    handlers: Map<string, Function>;
    invokeHandler: (channel: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
    getHandler: (channel: string) => Function | undefined;
  };
  let mockMainWindow: { webContents: { send: ReturnType<typeof vi.fn> } };
  let mockAgentManager: EventEmitter & {
    startSpecCreation: ReturnType<typeof vi.fn>;
    startTaskExecution: ReturnType<typeof vi.fn>;
    startQAProcess: ReturnType<typeof vi.fn>;
    killTask: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
  };
  let mockTerminalManager: {
    create: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    invokeClaude: ReturnType<typeof vi.fn>;
    killAll: ReturnType<typeof vi.fn>;
  };
  let mockPythonEnvManager: {
    on: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
  let projectId: string;

  beforeEach(async () => {
    cleanupTestDirs();
    setupTestProject();
    mkdirSync(path.join(TEST_DIR, "userData", "store"), { recursive: true });

    // Get mocked ipcMain
    const electron = await import("electron");
    ipcMain = electron.ipcMain as unknown as typeof ipcMain;

    // Create mock window with isDestroyed methods for safeSendToRenderer
    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
      },
    } as { webContents: { send: ReturnType<typeof vi.fn> }; isDestroyed: () => boolean };

    // Create mock agent manager
    mockAgentManager = Object.assign(new EventEmitter(), {
      startSpecCreation: vi.fn(),
      startTaskExecution: vi.fn(),
      startQAProcess: vi.fn(),
      killTask: vi.fn(),
      configure: vi.fn(),
    });

    // Create mock terminal manager
    mockTerminalManager = {
      create: vi.fn(() => Promise.resolve({ success: true })),
      destroy: vi.fn(() => Promise.resolve({ success: true })),
      write: vi.fn(),
      resize: vi.fn(),
      invokeClaude: vi.fn(),
      killAll: vi.fn(() => Promise.resolve()),
    };

    mockPythonEnvManager = {
      on: vi.fn(),
      initialize: vi.fn(() =>
        Promise.resolve({
          ready: true,
          pythonPath: "/usr/bin/python3",
          venvExists: true,
          depsInstalled: true,
        })
      ),
      getStatus: vi.fn(() =>
        Promise.resolve({
          ready: true,
          pythonPath: "/usr/bin/python3",
          venvExists: true,
          depsInstalled: true,
        })
      ),
    };

    // Need to reset modules to re-register handlers
    vi.resetModules();

    // Setup IPC handlers and add a project
    const { setupIpcHandlers } = await import("../ipc-handlers");
    setupIpcHandlers(
      mockAgentManager as never,
      mockTerminalManager as never,
      () => mockMainWindow as never,
      mockPythonEnvManager as never
    );

    // Add a project first
    const addResult = await ipcMain.invokeHandler("project:add", {}, TEST_PROJECT_PATH);
    projectId = (addResult as { data: { id: string } }).data.id;
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe("Azure DevOps ENV_GET parsing", () => {
    it("should parse AZURE_DEVOPS_ENABLED=true correctly", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED=true
AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/testorg
AZURE_DEVOPS_PROJECT=TestProject
AZURE_DEVOPS_TEAM=TestTeam
AZURE_DEVOPS_PAT=test-pat-token
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { azureDevOpsEnabled: boolean } }).data;
      expect(data.azureDevOpsEnabled).toBe(true);
    });

    it("should set azureDevOpsEnabled=false when AZURE_DEVOPS_ENABLED is not set", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `# Some other config
LINEAR_API_KEY=test-key
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { azureDevOpsEnabled: boolean } }).data;
      expect(data.azureDevOpsEnabled).toBe(false);
    });

    it("should set azureDevOpsEnabled=false when AZURE_DEVOPS_ENABLED=false", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED=false
AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/testorg
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { azureDevOpsEnabled: boolean } }).data;
      expect(data.azureDevOpsEnabled).toBe(false);
    });

    it("should parse all Azure DevOps config fields from .env", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED=true
AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/myorganization
AZURE_DEVOPS_PROJECT=MyProject
AZURE_DEVOPS_TEAM=MyTeam
AZURE_DEVOPS_PAT=my-personal-access-token
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (
        result as {
          data: {
            azureDevOpsEnabled: boolean;
            azureDevOpsOrganizationUrl: string;
            azureDevOpsProject: string;
            azureDevOpsTeam: string;
            azureDevOpsPersonalAccessToken: string;
          };
        }
      ).data;
      expect(data.azureDevOpsEnabled).toBe(true);
      expect(data.azureDevOpsOrganizationUrl).toBe("https://dev.azure.com/myorganization");
      expect(data.azureDevOpsProject).toBe("MyProject");
      expect(data.azureDevOpsTeam).toBe("MyTeam");
      expect(data.azureDevOpsPersonalAccessToken).toBe("my-personal-access-token");
    });

    it("should handle case-insensitive AZURE_DEVOPS_ENABLED value", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED=TRUE
AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/testorg
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { azureDevOpsEnabled: boolean } }).data;
      expect(data.azureDevOpsEnabled).toBe(true);
    });
  });

  describe("Azure DevOps ENV_UPDATE generation", () => {
    it("should generate Azure DevOps section in .env output", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      // Create initial empty .env
      writeFileSync(envPath, "");

      await ipcMain.invokeHandler("env:update", {}, projectId, {
        azureDevOpsEnabled: true,
        azureDevOpsOrganizationUrl: "https://dev.azure.com/testorg",
        azureDevOpsProject: "TestProject",
        azureDevOpsTeam: "TestTeam",
        azureDevOpsPersonalAccessToken: "test-pat",
      });

      // Read the generated .env file
      const content = readFileSync(envPath, "utf-8");

      // Check that Azure DevOps section is generated
      expect(content).toContain("AZURE DEVOPS INTEGRATION");
      expect(content).toContain("AZURE_DEVOPS_ENABLED=true");
      expect(content).toContain("AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/testorg");
      expect(content).toContain("AZURE_DEVOPS_PROJECT=TestProject");
      expect(content).toContain("AZURE_DEVOPS_TEAM=TestTeam");
      expect(content).toContain("AZURE_DEVOPS_PAT=test-pat");
    });

    it("should generate commented Azure DevOps section when disabled", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(envPath, "");

      await ipcMain.invokeHandler("env:update", {}, projectId, {
        azureDevOpsEnabled: false,
      });

      const content = readFileSync(envPath, "utf-8");

      expect(content).toContain("AZURE DEVOPS INTEGRATION");
      expect(content).toContain("AZURE_DEVOPS_ENABLED=false");
      // Other fields should be commented out
      expect(content).toContain("# AZURE_DEVOPS_ORGANIZATION_URL=");
    });

    it("should preserve Azure DevOps settings when updating other config", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      // First, set Azure DevOps config
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED=true
AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/myorg
AZURE_DEVOPS_PROJECT=MyProject
AZURE_DEVOPS_TEAM=MyTeam
AZURE_DEVOPS_PAT=my-pat
`
      );

      // Update a different config (Linear)
      await ipcMain.invokeHandler("env:update", {}, projectId, {
        linearApiKey: "lin_test_key",
      });

      // Verify Azure DevOps settings are preserved
      const result = await ipcMain.invokeHandler("env:get", {}, projectId);
      const data = (
        result as {
          data: {
            azureDevOpsEnabled: boolean;
            azureDevOpsOrganizationUrl: string;
            azureDevOpsProject: string;
            azureDevOpsTeam: string;
            azureDevOpsPersonalAccessToken: string;
            linearApiKey: string;
          };
        }
      ).data;

      // Azure DevOps settings should be preserved
      expect(data.azureDevOpsEnabled).toBe(true);
      expect(data.azureDevOpsOrganizationUrl).toBe("https://dev.azure.com/myorg");
      expect(data.azureDevOpsProject).toBe("MyProject");
      expect(data.azureDevOpsTeam).toBe("MyTeam");
      expect(data.azureDevOpsPersonalAccessToken).toBe("my-pat");

      // Linear setting should be updated
      expect(data.linearApiKey).toBe("lin_test_key");
    });

    it("should update Azure DevOps settings correctly", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      // Initial config
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED=false
AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/oldorg
`
      );

      // Update Azure DevOps settings
      await ipcMain.invokeHandler("env:update", {}, projectId, {
        azureDevOpsEnabled: true,
        azureDevOpsOrganizationUrl: "https://dev.azure.com/neworg",
        azureDevOpsProject: "NewProject",
      });

      // Verify the update
      const result = await ipcMain.invokeHandler("env:get", {}, projectId);
      const data = (
        result as {
          data: {
            azureDevOpsEnabled: boolean;
            azureDevOpsOrganizationUrl: string;
            azureDevOpsProject: string;
          };
        }
      ).data;

      expect(data.azureDevOpsEnabled).toBe(true);
      expect(data.azureDevOpsOrganizationUrl).toBe("https://dev.azure.com/neworg");
      expect(data.azureDevOpsProject).toBe("NewProject");
    });
  });

  describe("Azure DevOps edge cases", () => {
    it("should handle empty .env file", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(envPath, "");

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { azureDevOpsEnabled: boolean } }).data;
      expect(data.azureDevOpsEnabled).toBe(false);
    });

    it("should handle missing .env file", async () => {
      // Don't create the .env file at all
      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (result as { data: { azureDevOpsEnabled: boolean } }).data;
      expect(data.azureDevOpsEnabled).toBe(false);
    });

    it("should handle quoted values in .env file", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `AZURE_DEVOPS_ENABLED="true"
AZURE_DEVOPS_ORGANIZATION_URL="https://dev.azure.com/myorg"
AZURE_DEVOPS_PROJECT='MyProject'
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (
        result as {
          data: {
            azureDevOpsEnabled: boolean;
            azureDevOpsOrganizationUrl: string;
            azureDevOpsProject: string;
          };
        }
      ).data;
      expect(data.azureDevOpsEnabled).toBe(true);
      expect(data.azureDevOpsOrganizationUrl).toBe("https://dev.azure.com/myorg");
      expect(data.azureDevOpsProject).toBe("MyProject");
    });

    it("should ignore commented Azure DevOps lines", async () => {
      const envPath = path.join(TEST_PROJECT_PATH, ".auto-claude", ".env");
      writeFileSync(
        envPath,
        `# AZURE_DEVOPS_ENABLED=true
# AZURE_DEVOPS_ORGANIZATION_URL=https://dev.azure.com/commented
AZURE_DEVOPS_ENABLED=false
`
      );

      const result = await ipcMain.invokeHandler("env:get", {}, projectId);

      expect(result).toHaveProperty("success", true);
      const data = (
        result as {
          data: {
            azureDevOpsEnabled: boolean;
            azureDevOpsOrganizationUrl?: string;
          };
        }
      ).data;
      expect(data.azureDevOpsEnabled).toBe(false);
      expect(data.azureDevOpsOrganizationUrl).toBeUndefined();
    });
  });
});
