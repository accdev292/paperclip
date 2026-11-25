import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { prepareCommandManagedRuntime } from "./command-managed-runtime.js";
import {
  createSandboxCallbackBridgeAsset,
  createSandboxCallbackBridgeToken,
  sandboxCallbackBridgeDirectories,
  startSandboxCallbackBridgeServer,
} from "./sandbox-callback-bridge.js";
import type { RunProcessResult } from "./server-utils.js";

const execFile = promisify(execFileCallback);

// The bridge is started with a real shell and a real `node`, as in a sandbox;
// each case swaps `node` for a wrapper that is slow, never ready, or dead.
describe("sandbox callback bridge readiness", () => {
  const cleanupDirs: string[] = [];
  const cleanupFns: Array<() => Promise<void>> = [];

  const runner = {
    execute: async (input: {
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      stdin?: string;
      timeoutMs?: number;
    }): Promise<RunProcessResult> => {
      const startedAt = new Date().toISOString();
      const env: Record<string, string | undefined> = { ...process.env, ...input.env };
      const command = input.command === "sh" ? "/bin/sh" : input.command === "bash" ? "/bin/bash" : input.command;
      const args = [...(input.args ?? [])];
      if (
        input.stdin != null &&
        (input.command === "sh" || input.command === "bash") &&
        (args[0] === "-c" || args[0] === "-lc") &&
        typeof args[1] === "string"
      ) {
        env.PAPERCLIP_TEST_STDIN = input.stdin;
        args[1] = `printf '%s' \"$PAPERCLIP_TEST_STDIN\" | (${args[1]})`;
      }
      try {
        const result = await execFile(command, args, {
          cwd: input.cwd,
          env,
          maxBuffer: 32 * 1024 * 1024,
          timeout: input.timeoutMs,
        });
        return { exitCode: 0, signal: null, timedOut: false, stdout: result.stdout, stderr: result.stderr, pid: null, startedAt };
      } catch (error) {
        const err = error as NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
          code?: string | number | null;
          signal?: NodeJS.Signals | null;
          killed?: boolean;
        };
        return {
          exitCode: typeof err.code === "number" ? err.code : null,
          signal: err.signal ?? null,
          timedOut: Boolean(err.killed && input.timeoutMs),
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? "",
          pid: null,
          startedAt,
        };
      }
    },
  };

  async function prepareBridge(nodeWrapper: string) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-bridge-ready-"));
    cleanupDirs.push(rootDir);
    const localWorkspaceDir = path.join(rootDir, "local-workspace");
    const remoteWorkspaceDir = path.join(rootDir, "remote-workspace");
    await mkdir(localWorkspaceDir, { recursive: true });
    await mkdir(remoteWorkspaceDir, { recursive: true });
    const nodeCommand = path.join(rootDir, "node-wrapper.sh");
    await writeFile(nodeCommand, `#!/bin/sh\n${nodeWrapper}\n`, "utf8");
    await chmod(nodeCommand, 0o755);

    const bridgeAsset = await createSandboxCallbackBridgeAsset();
    cleanupFns.push(bridgeAsset.cleanup);
    const prepared = await prepareCommandManagedRuntime({
      runner,
      spec: { remoteCwd: remoteWorkspaceDir, timeoutMs: 30_000 },
      adapterKey: "codex",
      workspaceLocalDir: localWorkspaceDir,
      assets: [{ key: "bridge", localDir: bridgeAsset.localDir }],
    });
    const queueDir = path.posix.join(prepared.runtimeRootDir, "paperclip-bridge");
    const directories = sandboxCallbackBridgeDirectories(queueDir);
    // A wrapper that never becomes ready is still running when the wait gives up.
    cleanupFns.push(async () => {
      const pid = Number((await readFile(directories.pidFile, "utf8").catch(() => "")).trim());
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    });
    return {
      nodeCommand,
      start: (readyTimeoutMs?: number) =>
        startSandboxCallbackBridgeServer({
          runner,
          remoteCwd: remoteWorkspaceDir,
          assetRemoteDir: prepared.assetDirs.bridge,
          queueDir,
          bridgeToken: createSandboxCallbackBridgeToken(),
          timeoutMs: 30_000,
          readyTimeoutMs,
          nodeCommand,
        }),
    };
  }

  afterEach(async () => {
    while (cleanupFns.length > 0) {
      await cleanupFns.pop()?.().catch(() => undefined);
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  // 200 polls of 50 ms gave up after 10 s of sleeps, about 12 s of wall time.
  it("waits for a bridge that takes fifteen seconds to start", async () => {
    const bridge = await prepareBridge('sleep 15\nexec node "$@"');
    const startedAt = Date.now();
    const server = await bridge.start();
    cleanupFns.push(async () => {
      await server.stop();
    });

    expect(Date.now() - startedAt).toBeGreaterThan(14_000);
    expect(server.port).toBeGreaterThan(0);
    const response = await fetch(`${server.baseUrl}/api/agents/me`);
    // The bridge is up and answering: it refuses the request that carries no bridge token.
    expect(response.status).toBe(401);
  }, 40_000);

  it("says how long it waited and that the process is still running when the bridge never becomes ready", async () => {
    const bridge = await prepareBridge("exec sleep 30");
    await expect(bridge.start(400)).rejects.toThrow(
      /wait for sandbox callback bridge readiness failed with exit code 1: Timed out waiting for bridge readiness after 0\.4s; the bridge process is still running\./,
    );
  }, 20_000);

  it("fails at once with the bridge log when the process dies before it is ready", async () => {
    const bridge = await prepareBridge('echo "bridge boom" >&2\nexit 1');
    const startedAt = Date.now();
    await expect(bridge.start()).rejects.toThrow(/bridge boom/);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 20_000);
});
