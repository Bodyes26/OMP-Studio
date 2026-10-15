import { existsSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDependencies = resolve(relayRoot, '../node_modules');

// I sorgenti condivisi risolvono i pacchetti dalla radice anche nel clone relay-only.
// Su Windows una junction di directory non richiede i privilegi dei symlink.
if (!existsSync(workspaceDependencies)) {
	symlinkSync(join(relayRoot, 'node_modules'), workspaceDependencies, process.platform === 'win32' ? 'junction' : 'dir');
}

const result = spawnSync(process.execPath, [
	join(relayRoot, 'node_modules/@inlang/paraglide-js/bin/run.js'),
	'compile',
	'--project', '../project.inlang',
	'--outdir', '../src/lib/paraglide',
	'--strategy', 'baseLocale',
	'--emit-ts-declarations',
	'--disable-async-local-storage'
], { cwd: relayRoot, stdio: 'inherit' });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
