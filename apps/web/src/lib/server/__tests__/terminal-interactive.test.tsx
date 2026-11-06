import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  createOrUpdateProject,
  createTaskForProject,
  execTerminalCommandForProject,
  execAgyCommandForProject,
  autocompleteTerminalForProject,
  loadStore,
  saveStore,
} from "@/lib/server/task-engine";

// Mock xterm and addons for JSDOM rendering of TerminalPanel
vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class MockSerializeAddon {},
}));
vi.mock("@/lib/webgl-context-manager", () => ({
  webglContextManager: {
    register: vi.fn(),
    acquire: vi.fn(),
    unregister: vi.fn(),
  },
}));

describe("Interactive Terminal Engine & Direct Terminal Actions", () => {
  let tmpDir: string;
  let projectId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aperant-term-interactive-"));
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Project\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "Program.cs"), "// C# entrypoint\n", "utf-8");
    const project = createOrUpdateProject(tmpDir, "InteractiveTermTestProj");
    projectId = project.id;
  });

  afterEach(() => {
    if (projectId) {
      const store = loadStore();
      store.projects = store.projects.filter(
        (p) => p.id !== projectId && p.name !== "InteractiveTermTestProj",
      );
      saveStore(store);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("supports multi-step interactive ssh-keygen with empty Enter defaults and overwrite confirmation", () => {
    const sessId = "term-ssh-test";
    const keyPath = path.join(tmpDir, "test_id_rsa");

    // Step 1: Start ssh-keygen without -f / -N
    const step1 = execTerminalCommandForProject(
      projectId,
      sessId,
      'ssh-keygen -t rsa -b 2048 -C "test@aperant.local"',
      tmpDir,
    );
    expect(step1.interactiveState).toBeTruthy();
    expect(step1.interactiveState.kind).toBe("ssh-keygen");
    expect(step1.interactiveState.step).toBe("file");
    expect(step1.output).toContain("Enter file in which to save the key");

    // Step 2: Provide custom keyPath inside tmpDir
    const step2 = execTerminalCommandForProject(
      projectId,
      sessId,
      keyPath,
      tmpDir,
    );
    expect(step2.interactiveState?.step).toBe("passphrase1");
    expect(step2.output).toContain("Enter passphrase (empty for no passphrase):");

    // Step 3: Press empty Enter for no passphrase
    const step3 = execTerminalCommandForProject(
      projectId,
      sessId,
      "__enter__",
      tmpDir,
    );
    expect(step3.interactiveState?.step).toBe("passphrase2");
    expect(step3.output).toContain("Enter same passphrase again:");

    // Step 4: Press empty Enter to confirm passphrase and generate real key pair
    const step4 = execTerminalCommandForProject(
      projectId,
      sessId,
      "__enter__",
      tmpDir,
    );
    expect(step4.interactiveState).toBeNull();
    expect(step4.exitCode).toBe(0);
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.existsSync(`${keyPath}.pub`)).toBe(true);
    expect(step4.output).toContain("ssh-rsa ");

    // Step 5: Re-run ssh-keygen on the same file to test Overwrite (y/n)? with Up/Down navigation
    execTerminalCommandForProject(
      projectId,
      sessId,
      'ssh-keygen -t rsa -b 2048 -C "test2@aperant.local"',
      tmpDir,
    );
    const overwriteStep = execTerminalCommandForProject(
      projectId,
      sessId,
      keyPath,
      tmpDir,
    );
    expect(overwriteStep.interactiveState?.step).toBe("overwrite");
    expect(overwriteStep.output).toContain("Overwrite (y/n)?");

    // Press Down Arrow (`__key:down__`) to select "No (n)" and press Enter (`__enter__`)
    const navDown = execTerminalCommandForProject(
      projectId,
      sessId,
      "__key:down__",
      tmpDir,
    );
    expect(navDown.interactiveState?.selectedIndex).toBe(1);

    const abortOverwrite = execTerminalCommandForProject(
      projectId,
      sessId,
      "__enter__",
      tmpDir,
    );
    expect(abortOverwrite.interactiveState).toBeNull();
    expect(abortOverwrite.output).toContain("Not overwriting");
  });

  it("supports interactive /resume, /model, and /mode menus with Up/Down navigation and Enter selection in AGY & Shell modes", async () => {
    const sessId = "term-menu-test";
    const task = createTaskForProject(projectId, {
      title: "Fix SSH key flow",
      description: "Ensure interactive prompts work",
    });

    // Trigger `/resume` in AGY mode
    const resumeMenu = await execAgyCommandForProject(
      projectId,
      sessId,
      "/resume",
      tmpDir,
    );
    expect(resumeMenu.interactiveState).toBeTruthy();
    expect(resumeMenu.interactiveState.kind).toBe("menu");
    expect(resumeMenu.interactiveState.step).toBe("resume");
    expect(resumeMenu.interactiveState.options.length).toBeGreaterThanOrEqual(2);
    expect(resumeMenu.output).toContain(task.title);

    // Press Enter (`__enter__`) to select the first item (the task worktree)
    const selectedResume = await execAgyCommandForProject(
      projectId,
      sessId,
      "__enter__",
      tmpDir,
    );
    expect(selectedResume.interactiveState).toBeNull();
    expect(selectedResume.output).toContain("Resumed task worktree");
    expect(selectedResume.cwd).toContain(task.id);

    // Trigger `/model` menu, navigate Down (`__key:down__`), and press Enter
    const modelMenu = execTerminalCommandForProject(
      projectId,
      sessId,
      "/model",
      tmpDir,
    );
    expect(modelMenu.interactiveState?.step).toBe("model");
    expect(modelMenu.interactiveState?.selectedIndex).toBe(0);

    const modelDown = execTerminalCommandForProject(
      projectId,
      sessId,
      "__key:down__",
      tmpDir,
    );
    expect(modelDown.interactiveState?.selectedIndex).toBe(1);

    const modelConfirm = execTerminalCommandForProject(
      projectId,
      sessId,
      "__enter__",
      tmpDir,
    );
    expect(modelConfirm.interactiveState).toBeNull();
    expect(modelConfirm.activeModel).toBe("qwen2.5-coder:14b");
    expect(modelConfirm.output).toContain("qwen2.5-coder:14b");
  });

  it("supports interactive read prompt and Tab autocompletion", () => {
    const sessId = "term-read-test";

    // Start `read -p` with chained echo
    const readStart = execTerminalCommandForProject(
      projectId,
      sessId,
      'read -p "Enter target env: " DEPLOY_ENV && echo "Deploying to $DEPLOY_ENV"',
      tmpDir,
    );
    expect(readStart.interactiveState?.kind).toBe("prompt");
    expect(readStart.interactiveState?.step).toBe("read");
    expect(readStart.output).toContain("Enter target env:");

    // Supply direct input "production"
    const readFinish = execTerminalCommandForProject(
      projectId,
      sessId,
      "production",
      tmpDir,
    );
    expect(readFinish.interactiveState).toBeNull();
    expect(readFinish.output).toContain("Deploying to production");

    // Test Tab autocomplete on slash command and file path
    const slashComplete = autocompleteTerminalForProject(
      projectId,
      sessId,
      "/res",
      tmpDir,
    );
    expect(slashComplete.completedInput).toBe("/resume ");

    const fileComplete = autocompleteTerminalForProject(
      projectId,
      sessId,
      "cat Prog",
      tmpDir,
    );
    expect(fileComplete.completedInput).toBe("cat Program.cs");
  });

  it("renders TerminalPanel with direct viewport typing, Up/Down history & menu controls, and interactive widget", async () => {
    const { TerminalPanel } = await import(
      "@/components/terminal/TerminalPanel"
    );
    const { apiClient } = await import("@/lib/data/api-client");

    const execSpy = vi
      .spyOn(apiClient, "execTerminalCommand")
      .mockImplementation(async (_projId, sessId, cmd, cwd) => {
        return execTerminalCommandForProject(projectId, sessId, cmd, cwd);
      });

    render(
      <TerminalPanel
        sessionId="ui-interactive-sess"
        projectId={projectId}
        cwd={tmpDir}
      />,
    );

    const outputPre = screen.getByTestId(
      "terminal-output-log-ui-interactive-sess",
    );
    const cmdInput = screen.getByTestId(
      "terminal-command-input-ui-interactive-sess",
    ) as HTMLInputElement;

    // 1. Type directly on the <pre> terminal output viewport
    fireEvent.keyDown(outputPre, { key: "/" });
    fireEvent.keyDown(outputPre, { key: "m" });
    fireEvent.keyDown(outputPre, { key: "o" });
    fireEvent.keyDown(outputPre, { key: "d" });
    fireEvent.keyDown(outputPre, { key: "e" });
    fireEvent.keyDown(outputPre, { key: "l" });
    expect(cmdInput.value).toBe("/model");

    // 2. Press Enter directly on the <pre> terminal viewport to open the interactive /model menu
    fireEvent.keyDown(outputPre, { key: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByTestId("terminal-interactive-widget-ui-interactive-sess"),
      ).toBeTruthy();
    });

    // 3. Press ArrowDown and Enter to choose the second model option
    fireEvent.keyDown(cmdInput, { key: "ArrowDown" });
    fireEvent.keyDown(cmdInput, { key: "Enter" });

    await waitFor(() => {
      expect(outputPre.textContent).toContain(
        "Active AI model set to: qwen2.5-coder:14b",
      );
    });

    // 4. Press ArrowUp to recall "/model" from command history
    fireEvent.keyDown(cmdInput, { key: "ArrowUp" });
    expect(cmdInput.value).toBe("/model");

    execSpy.mockRestore();
  });

  it("starts terminal in PowerShell 7 (pwsh) by default and supports PSReadLine history auto-suggestion (InlineView ghost text + RightArrow/End accept + F2 ListView)", async () => {
    const { TerminalPanel } = await import(
      "@/components/terminal/TerminalPanel"
    );
    const { apiClient } = await import("@/lib/data/api-client");

    const autocompleteSpy = vi
      .spyOn(apiClient, "autocompleteTerminal")
      .mockImplementation(async (_projId, sessId, input, cwd) => {
        return autocompleteTerminalForProject(projectId, sessId, input, cwd);
      });
    const execSpy = vi
      .spyOn(apiClient, "execTerminalCommand")
      .mockImplementation(async (_projId, sessId, cmd, cwd) => {
        return execTerminalCommandForProject(projectId, sessId, cmd, cwd);
      });

    render(
      <TerminalPanel
        sessionId="ps-autosuggest-sess"
        projectId={projectId}
        cwd={tmpDir}
      />,
    );

    const outputPre = screen.getByTestId(
      "terminal-output-log-ps-autosuggest-sess",
    );
    const cmdInput = screen.getByTestId(
      "terminal-command-input-ps-autosuggest-sess",
    ) as HTMLInputElement;
    const shellBadge = screen.getByTestId(
      "terminal-shell-badge-ps-autosuggest-sess",
    );

    // 1. Verify terminal starts in PowerShell 7.6 (`PS <cwd>>` and `PS 7.6 (pwsh)` badge)
    expect(shellBadge.textContent).toContain("PS 7.6 (pwsh)");
    expect(outputPre.textContent).toContain("PowerShell 7.6.7");
    expect(outputPre.textContent).toContain(`PS ${tmpDir}>`);

    // 2. Type "git c" and verify PSReadLine inline ghost-text auto-suggestion appears from history
    fireEvent.change(cmdInput, { target: { value: "git c" } });
    const ghostEl = await waitFor(() =>
      screen.getByTestId("terminal-ghost-suggestion-ps-autosuggest-sess"),
    );
    expect(ghostEl.textContent).toContain("lone ");

    // 3. Press Ctrl+ArrowRight to accept only the next word ("lone")
    fireEvent.keyDown(cmdInput, { key: "ArrowRight", ctrlKey: true });
    expect(cmdInput.value.toLowerCase()).toBe("git clone");

    // 4. Press ArrowRight (`→`) at the end of input to accept the full PSReadLine history suggestion
    fireEvent.keyDown(cmdInput, { key: "ArrowRight" });
    expect(cmdInput.value).toContain("git clone ");
    expect(cmdInput.value.length).toBeGreaterThan(12);

    // 5. Type "Get-" and press F2 to toggle PSReadLine ListView history predictions
    fireEvent.change(cmdInput, { target: { value: "Get-" } });
    fireEvent.keyDown(cmdInput, { key: "F2" });

    const listWidget = await waitFor(() =>
      screen.getByTestId("terminal-psreadline-list-ps-autosuggest-sess"),
    );
    expect(listWidget.textContent).toContain("PSReadLine History Predictions");

    // Navigate Down in ListView and press Enter to fill the selected prediction into the input
    fireEvent.keyDown(cmdInput, { key: "ArrowDown" });
    fireEvent.keyDown(cmdInput, { key: "Enter" });
    expect(cmdInput.value.toLowerCase()).toContain("get-");

    // 6. Execute a real PowerShell command (`Get-History`) and verify `PS <cwd>>` prompt
    fireEvent.change(cmdInput, { target: { value: "Get-History" } });
    fireEvent.keyDown(cmdInput, { key: "Enter" });

    await waitFor(() => {
      expect(outputPre.textContent).toContain("CommandLine");
      expect(outputPre.textContent).toContain(`PS ${tmpDir}>`);
    });

    autocompleteSpy.mockRestore();
    execSpy.mockRestore();
  });

  it("opens local self-hosted VS Code Online IDE at the terminal's current working directory and toggles back without losing PowerShell session state", async () => {
    const { openVSCodeWebForProject } = await import(
      "@/lib/server/task-engine"
    );
    const { VSCodeWebPanel } = await import(
      "@/components/terminal/VSCodeWebPanel"
    );
    const { apiClient } = await import("@/lib/data/api-client");

    // Create a subdirectory and cd into it in the terminal session
    const subDir = path.join(tmpDir, "IR");
    fs.mkdirSync(subDir, { recursive: true });
    execTerminalCommandForProject(projectId, "vscode-sess-1", "cd IR", tmpDir);

    const vscodeRes = await openVSCodeWebForProject(projectId, {
      sessionId: "vscode-sess-1",
    });
    expect(vscodeRes.success).toBe(true);
    expect(vscodeRes.port).toBe(8443);
    expect(vscodeRes.folderPath).toBe(subDir);

    const openSpy = vi
      .spyOn(apiClient, "openVSCodeWeb")
      .mockResolvedValue(vscodeRes);
    const onBack = vi.fn();

    render(
      <VSCodeWebPanel
        sessionId="vscode-sess-1"
        projectId={projectId}
        cwd={subDir}
        onBackToTerminal={onBack}
      />,
    );

    const iframeEl = (await waitFor(() =>
      screen.getByTestId("vscode-web-iframe-vscode-sess-1"),
    )) as HTMLIFrameElement;

    expect(iframeEl.src).toContain("/vscode-web/?folder=");
    expect(decodeURIComponent(iframeEl.src)).toContain(subDir);

    const backBtn = screen.getByTestId(
      "vscode-web-back-terminal-vscode-sess-1",
    );
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);

    openSpy.mockRestore();
  });

  it("maintains interactive AGY mode across subsequent turns when user types 'agy', then 'hi', then asks a question, and exits via '/exit'", async () => {
    const { TerminalPanel } = await import(
      "@/components/terminal/TerminalPanel"
    );
    const { apiClient } = await import("@/lib/data/api-client");

    const autocompleteSpy = vi
      .spyOn(apiClient, "autocompleteTerminal")
      .mockImplementation(async (_projId, sessId, input, cwd) => {
        return autocompleteTerminalForProject(projectId, sessId, input, cwd);
      });
    const execTerminalSpy = vi
      .spyOn(apiClient, "execTerminalCommand")
      .mockImplementation(async (_projId, sessId, cmd, cwd) => {
        return await execTerminalCommandForProject(projectId, sessId, cmd, cwd);
      });
    const execAgySpy = vi
      .spyOn(apiClient, "execAgyCommand")
      .mockImplementation(async (_projId, sessId, prompt, cwd) => {
        return await execAgyCommandForProject(projectId, sessId, prompt, cwd);
      });

    // Render TerminalPanel WITHOUT passing isAgyMode prop (just like TaskTerminal)
    render(
      <TerminalPanel
        sessionId="term-task-agy-repl"
        projectId={projectId}
        cwd={tmpDir}
      />,
    );

    const outputPre = screen.getByTestId(
      "terminal-output-log-term-task-agy-repl",
    );
    const cmdInput = screen.getByTestId(
      "terminal-command-input-term-task-agy-repl",
    ) as HTMLInputElement;

    // 1. User types "agy" and presses Enter
    fireEvent.change(cmdInput, { target: { value: "agy" } });
    fireEvent.keyDown(cmdInput, { key: "Enter" });

    await waitFor(() => {
      expect(outputPre.textContent).toContain(
        "Google Antigravity CLI",
      );
      expect(
        screen.getByTestId("terminal-agy-badge-term-task-agy-repl"),
      ).toBeTruthy();
    });

    // 2. User types "hi" and presses Enter -> must interact with AGY, NOT PowerShell!
    fireEvent.change(cmdInput, { target: { value: "hi" } });
    fireEvent.keyDown(cmdInput, { key: "Enter" });

    await waitFor(() => {
      expect(outputPre.textContent).toContain("Hello! 👋 I'm Google Antigravity CLI");
      expect(outputPre.textContent).not.toContain(
        "is not recognized as a name of a cmdlet",
      );
    });

    // 3. Also verify that even if execTerminalCommandForProject is called directly while session.isAgyMode is true,
    // it delegates to AGY instead of running PowerShell!
    const directRes = await execTerminalCommandForProject(
      projectId,
      "term-task-agy-repl",
      "Summarize Program.cs",
      tmpDir,
    );
    expect(directRes.isAgyMode).toBe(true);
    expect(directRes.output).toContain("🤖 AGY:");
    expect(directRes.output).not.toContain("is not recognized as a name of a cmdlet");

    // 4. User types "/exit" to leave AGY Interactive Session and return to PowerShell
    fireEvent.change(cmdInput, { target: { value: "/exit" } });
    fireEvent.keyDown(cmdInput, { key: "Enter" });

    await waitFor(() => {
      expect(outputPre.textContent).toContain(
        "Exited AGY Interactive Session",
      );
      expect(
        screen.queryByTestId("terminal-agy-badge-term-task-agy-repl"),
      ).toBeNull();
    });

    autocompleteSpy.mockRestore();
    execTerminalSpy.mockRestore();
    execAgySpy.mockRestore();
  });
});


