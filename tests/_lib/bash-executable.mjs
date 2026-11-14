import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

/** Locate real Bash; deployment tests must execute the production shell script. */
export function resolveBashExecutable() {
  const windows = process.platform === 'win32';
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    .map((entry) => entry.replace(/^"|"$/g, ''));
  const override = process.env.WM_TEST_BASH;
  if (override) {
    const names = windows && !override.toLowerCase().endsWith('.exe')
      ? [override, `${override}.exe`] : [override];
    const candidates = names.flatMap((name) => [resolve(name), ...pathDirs.map((dir) => join(dir, name))]);
    const executable = candidates.find(existsSync);
    if (!executable) throw new Error('WM_TEST_BASH must name an existing Bash executable.');
    return executable;
  }
  if (!windows) {
    const executable = ['/bin/bash', ...pathDirs.map((dir) => join(dir, 'bash'))].find(existsSync);
    if (executable) return executable;
    throw new Error('Bash is required for deployment script tests. Set WM_TEST_BASH to its executable.');
  }

  // Git for Windows may expose cmd/, bin/, or mingw64/bin/ on PATH. Walk
  // those installation roots instead of accidentally selecting Windows' WSL
  // bash.exe, which cannot execute a native Windows fixture path directly.
  const candidates = [];
  for (const directory of pathDirs.filter((dir) => existsSync(join(dir, 'git.exe')))) {
    for (const root of [directory, dirname(directory), dirname(dirname(directory))]) {
      candidates.push(join(root, 'bin', 'bash.exe'), join(root, 'usr', 'bin', 'bash.exe'));
    }
  }
  for (const root of [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    candidates.push(join(root, 'Git', 'bin', 'bash.exe'));
  }
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  const executable = candidates.find(existsSync);
  if (executable) return executable;
  throw new Error('Git Bash is required for deployment script tests on Windows. Install Git for Windows or set WM_TEST_BASH.');
}
