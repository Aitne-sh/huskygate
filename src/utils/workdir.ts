/** @module workdir — Safe session working-directory cleanup. */
import { rmSync } from 'node:fs';
import path from 'node:path';
export function cleanupWorkdir(workdirRoot: string, workdir: string | null): void {
  if (!workdir) return;
  const resolvedRoot = path.resolve(workdirRoot);
  const resolvedWorkdir = path.resolve(workdir);
  // Do not delete the root itself
  if (resolvedWorkdir === resolvedRoot) return;
  // Safety: only delete workdirs under the configured root
  if (!resolvedWorkdir.startsWith(resolvedRoot + path.sep)) return;
  rmSync(resolvedWorkdir, { recursive: true, force: true });
}
