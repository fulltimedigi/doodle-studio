// Shared test plumbing: a real server on a free port, torn down after.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Start src/server.mjs on a free port against a throwaway workspace, and wait until it answers.
 * Returns { base, stop }. A taken port is retried rather than failing the run.
 */
export async function startServer(attempts = 5) {
  for (let i = 1; ; i++) {
    try { return await listen(); } catch (e) { if (i >= attempts) throw e; }
  }
}

async function listen() {
  const port = 8000 + Math.floor(Math.random() * 1500);
  const proc = spawn(process.execPath, [join(ROOT, 'src/server.mjs')], {
    env: { ...process.env, PORT: String(port), DOODLE_OPEN: '0', DOODLE_WORKSPACE: mkdtempSync(join(tmpdir(), 'doodle-test-')) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  proc.stdout.resume();
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited (${proc.exitCode})\n${err}`);
    try { if ((await fetch(base + '/api/meta')).ok) return { base, stop: () => proc.kill() }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`server did not start on ${port}\n${err}`);
}

/**
 * Chromium plus the launch options the renderer itself uses, or null when no browser is
 * installed — the tests report that as a skip rather than a failure.
 */
export async function chromiumOrNull() {
  const { chromium } = await import('playwright');
  const { browserOptions } = await import('../src/reel.mjs');
  const options = { ...browserOptions(), args: [...browserOptions().args, '--no-sandbox'] };
  if (options.channel) return { chromium, options };
  const exe = options.executablePath || safeExecutablePath(chromium);
  if (!exe || !existsSync(exe)) return null;
  return { chromium, options: { ...options, executablePath: exe } };
}

function safeExecutablePath(chromium) { try { return chromium.executablePath(); } catch { return null; } }
