import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	detectStack,
	type ScanManifest,
	type UntrackedCandidate,
	type WorktreeProfileScan
} from '../src/lib/lanes/stackDetector.ts';

function manifest(overrides: Partial<ScanManifest> & Pick<ScanManifest, 'relativePath' | 'kind'>): ScanManifest {
	const directory =
		overrides.directory ??
		(overrides.relativePath.includes('/')
			? overrides.relativePath.slice(0, overrides.relativePath.lastIndexOf('/'))
			: '');
	return {
		directory,
		targetFrameworks: [],
		dependencies: [],
		...overrides
	};
}

function scan(overrides: Partial<WorktreeProfileScan> = {}): WorktreeProfileScan {
	return {
		repositoryRoot: 'C:/repos/app',
		manifests: [],
		untrackedCandidates: [],
		generatedDirectories: [],
		packagesDirectories: [],
		nativeCaches: [{ kind: 'nuget', path: 'C:/Users/tizio/.nuget/packages', available: true }],
		truncated: false,
		...overrides
	};
}

const parametri: UntrackedCandidate = {
	relativePath: 'Parametri.ini',
	bytes: 240,
	ignored: false,
	rule: 'ini_file'
};

describe('rilevamento stack del profilo worktree', () => {
	it('classifica per sottoprogetto ASP.NET legacy e frontend Vite con la loro evidenza', () => {
		const detection = detectStack(
			scan({
				manifests: [
					manifest({ relativePath: 'Portalino.sln', kind: 'solution' }),
					manifest({
						relativePath: 'Quote/Quote.vbproj',
						kind: 'vb_project',
						sdkStyle: false,
						packageReference: false,
						targetFrameworks: ['v4.6.2']
					}),
					manifest({ relativePath: 'Quote/packages.config', kind: 'packages_config' }),
					manifest({ relativePath: 'Quote/Web.config', kind: 'web_config' }),
					manifest({
						relativePath: 'frontend/package.json',
						kind: 'package_json',
						dependencies: ['svelte', 'vite']
					}),
					manifest({ relativePath: 'frontend/vite.config.ts', kind: 'vite_config' })
				],
				packagesDirectories: [
					{ relativePath: 'packages', bytes: 512 * 1024 * 1024, fileCount: 1200, truncated: false }
				],
				generatedDirectories: ['Quote/bin', 'Quote/obj', 'frontend/node_modules', 'packages'],
				untrackedCandidates: [parametri]
			})
		);

		assert.deepEqual(detection.stacks, ['aspnet', 'node', 'vite', 'svelte']);
		assert.equal(detection.restoreMode, 'packages_config');

		const quote = detection.subprojects.find((entry) => entry.directory === 'Quote');
		assert.ok(quote);
		assert.deepEqual(quote.stacks, ['aspnet']);
		assert.equal(quote.restoreMode, 'packages_config');
		assert.deepEqual(
			quote.evidence.map((entry) => entry.kind),
			['legacy_project', 'packages_config', 'web_config']
		);
		assert.equal(quote.evidence[0].detail, 'v4.6.2');

		const frontend = detection.subprojects.find((entry) => entry.directory === 'frontend');
		assert.deepEqual(frontend?.stacks, ['node', 'vite', 'svelte']);
		assert.equal(frontend?.restoreMode, 'none');

		const warning = detection.warnings.find((entry) => entry.kind === 'packages_config_restore');
		assert.equal(warning?.estimatedBytes, 512 * 1024 * 1024);
		assert.deepEqual(detection.candidates, [parametri]);
	});

	it('segnala restore misto quando lo stesso progetto ha packages.config e PackageReference', () => {
		const detection = detectStack(
			scan({
				manifests: [
					manifest({
						relativePath: 'Legacy/Legacy.csproj',
						kind: 'cs_project',
						sdkStyle: false,
						packageReference: true,
						targetFrameworks: ['v4.8']
					}),
					manifest({ relativePath: 'Legacy/packages.config', kind: 'packages_config' })
				]
			})
		);

		assert.equal(detection.restoreMode, 'mixed');
		assert.deepEqual(detection.stacks, ['aspnet']);
	});

	it('distingue SDK-style da .NET Framework e avvisa se manca la cache NuGet', () => {
		const detection = detectStack(
			scan({
				manifests: [
					manifest({
						relativePath: 'Api/Api.csproj',
						kind: 'cs_project',
						sdkStyle: true,
						packageReference: false,
						targetFrameworks: ['net8.0']
					})
				],
				nativeCaches: [{ kind: 'nuget', path: 'C:/Users/tizio/.nuget/packages', available: false }]
			})
		);

		assert.deepEqual(detection.stacks, ['dotnet']);
		// Un progetto SDK-style senza dipendenze usa comunque la cache globale.
		assert.equal(detection.restoreMode, 'package_reference');
		assert.deepEqual(
			detection.warnings.map((entry) => entry.kind),
			['nuget_cache_missing']
		);
	});

	it('riconosce un frontend statico solo senza manifesti applicativi', () => {
		const statico = detectStack(
			scan({ manifests: [manifest({ relativePath: 'index.html', kind: 'index_html' })] })
		);
		assert.deepEqual(statico.stacks, ['static']);

		const conNode = detectStack(
			scan({
				manifests: [
					manifest({ relativePath: 'index.html', kind: 'index_html' }),
					manifest({ relativePath: 'package.json', kind: 'package_json', dependencies: ['vite'] })
				]
			})
		);
		assert.deepEqual(conNode.stacks, ['node', 'vite']);
	});

	it('segnala un rilevamento parziale su repository troppo grandi', () => {
		const detection = detectStack(scan({ truncated: true }));
		assert.deepEqual(
			detection.warnings.map((entry) => entry.kind),
			['scan_truncated']
		);
		assert.deepEqual(detection.stacks, []);
		assert.equal(detection.restoreMode, 'none');
	});
});
