// Classificazione dello stack di un progetto a partire dalle evidenze raccolte
// dal comando Rust `worktree_profile_scan` (Gate R27 / PLAN W10).
//
// Il modulo e' puro: non tocca il filesystem e non invoca Tauri. Riceve lo scan
// gia' fatto e produce il profilo tecnico con l'evidenza che lo giustifica,
// cosi' la classificazione e' verificabile su fixture.

import type { NativeCacheRecord, ProjectStack, RestoreMode } from '$lib/types/lanes';

export type ManifestKind =
	| 'solution'
	| 'cs_project'
	| 'vb_project'
	| 'fs_project'
	| 'packages_config'
	| 'package_json'
	| 'vite_config'
	| 'svelte_config'
	| 'web_config'
	| 'global_json'
	| 'nuget_config'
	| 'directory_packages_props'
	| 'index_html';

export interface ScanManifest {
	relativePath: string;
	/** Cartella del manifesto relativa alla radice; stringa vuota per la radice. */
	directory: string;
	kind: ManifestKind;
	/** Progetti MSBuild: `true` con attributo `Sdk`, `false` in formato legacy. */
	sdkStyle?: boolean;
	packageReference?: boolean;
	targetFrameworks: string[];
	dependencies: string[];
}

export type CandidateRule = 'dot_env' | 'ini_file' | 'local_settings';

export interface UntrackedCandidate {
	relativePath: string;
	bytes: number;
	ignored: boolean;
	rule: CandidateRule;
}

export interface PackagesDirectory {
	relativePath: string;
	bytes: number;
	fileCount: number;
	truncated: boolean;
}

/** DTO restituito dal comando Rust `worktree_profile_scan`. */
export interface WorktreeProfileScan {
	repositoryRoot: string;
	manifests: ScanManifest[];
	untrackedCandidates: UntrackedCandidate[];
	generatedDirectories: string[];
	packagesDirectories: PackagesDirectory[];
	nativeCaches: NativeCacheRecord[];
	truncated: boolean;
}

export type EvidenceKind =
	| 'solution'
	| 'legacy_project'
	| 'sdk_project'
	| 'packages_config'
	| 'package_reference'
	| 'web_config'
	| 'node_manifest'
	| 'vite_config'
	| 'svelte_config'
	| 'static_html';

/** Perche' un sottoprogetto e' stato classificato cosi': manifesto + dettaglio. */
export interface StackEvidence {
	kind: EvidenceKind;
	manifest: string;
	detail?: string;
}

export interface DetectedSubproject {
	/** Cartella relativa alla radice; stringa vuota per la radice stessa. */
	directory: string;
	stacks: ProjectStack[];
	restoreMode: RestoreMode;
	manifests: string[];
	evidence: StackEvidence[];
}

export type ProfileWarningKind =
	| 'packages_config_restore'
	| 'nuget_cache_missing'
	| 'scan_truncated';

export interface ProfileWarning {
	kind: ProfileWarningKind;
	/** Stima su disco della cartella `packages/` gia' presente, in byte. */
	estimatedBytes?: number;
	path?: string;
}

export interface StackDetection {
	stacks: ProjectStack[];
	restoreMode: RestoreMode;
	subprojects: DetectedSubproject[];
	manifests: string[];
	generatedDirectories: string[];
	nativeCaches: NativeCacheRecord[];
	warnings: ProfileWarning[];
	candidates: UntrackedCandidate[];
}

const PROJECT_KINDS: ManifestKind[] = ['cs_project', 'vb_project', 'fs_project'];
const STACK_ORDER: ProjectStack[] = ['aspnet', 'dotnet', 'node', 'vite', 'svelte', 'static'];

/** `net48`, `v4.6.2`, `net472` sono .NET Framework; `net8.0`/`netstandard` no. */
function isFrameworkTarget(target: string): boolean {
	const value = target.trim().toLowerCase();
	if (value.startsWith('v4') || value.startsWith('v3') || value.startsWith('v2')) return true;
	return /^net[1-4]\d*$/.test(value);
}

function sortStacks(stacks: Iterable<ProjectStack>): ProjectStack[] {
	const unique = new Set(stacks);
	return STACK_ORDER.filter((stack) => unique.has(stack));
}

function mergeRestoreModes(modes: Iterable<RestoreMode>): RestoreMode {
	let packagesConfig = false;
	let packageReference = false;
	for (const mode of modes) {
		if (mode === 'packages_config' || mode === 'mixed') packagesConfig = true;
		if (mode === 'package_reference' || mode === 'mixed') packageReference = true;
	}
	if (packagesConfig && packageReference) return 'mixed';
	if (packagesConfig) return 'packages_config';
	if (packageReference) return 'package_reference';
	return 'none';
}

function detectSubproject(directory: string, manifests: ScanManifest[]): DetectedSubproject {
	const stacks = new Set<ProjectStack>();
	const evidence: StackEvidence[] = [];
	const projects = manifests.filter((manifest) => PROJECT_KINDS.includes(manifest.kind));
	const has = (kind: ManifestKind) => manifests.some((manifest) => manifest.kind === kind);

	const packagesConfig = has('packages_config');
	let packageReference = false;

	for (const project of projects) {
		const frameworkTarget = project.targetFrameworks.some(isFrameworkTarget);
		const legacy = project.sdkStyle === false || frameworkTarget;
		if (legacy) {
			// `aspnet` e' il bucket .NET Framework classico dell'ADR R27:
			// include Web Forms, MVC 5 e le librerie che restano su v4.x.
			stacks.add('aspnet');
			evidence.push({
				kind: 'legacy_project',
				manifest: project.relativePath,
				detail: project.targetFrameworks[0]
			});
		} else {
			stacks.add('dotnet');
			evidence.push({
				kind: 'sdk_project',
				manifest: project.relativePath,
				detail: project.targetFrameworks[0]
			});
		}
		if (project.packageReference) {
			packageReference = true;
			evidence.push({ kind: 'package_reference', manifest: project.relativePath });
		} else if (project.sdkStyle === true) {
			// Un progetto SDK-style senza dipendenze dichiarate usa comunque il
			// restore moderno con cache globale NuGet.
			packageReference = true;
		}
	}

	if (packagesConfig) {
		const manifest = manifests.find((entry) => entry.kind === 'packages_config');
		evidence.push({ kind: 'packages_config', manifest: manifest?.relativePath ?? 'packages.config' });
		if (projects.length === 0) stacks.add('aspnet');
	}

	if (has('web_config')) {
		const manifest = manifests.find((entry) => entry.kind === 'web_config');
		evidence.push({ kind: 'web_config', manifest: manifest?.relativePath ?? 'Web.config' });
		if (projects.length === 0) stacks.add('aspnet');
	}

	const packageJson = manifests.find((manifest) => manifest.kind === 'package_json');
	if (packageJson) {
		stacks.add('node');
		evidence.push({ kind: 'node_manifest', manifest: packageJson.relativePath });
		if (packageJson.dependencies.includes('vite')) stacks.add('vite');
		if (
			packageJson.dependencies.includes('svelte') ||
			packageJson.dependencies.includes('@sveltejs/kit')
		) {
			stacks.add('svelte');
		}
	}

	const viteConfig = manifests.find((manifest) => manifest.kind === 'vite_config');
	if (viteConfig) {
		stacks.add('vite');
		evidence.push({ kind: 'vite_config', manifest: viteConfig.relativePath });
	}
	const svelteConfig = manifests.find((manifest) => manifest.kind === 'svelte_config');
	if (svelteConfig) {
		stacks.add('svelte');
		evidence.push({ kind: 'svelte_config', manifest: svelteConfig.relativePath });
	}

	const indexHtml = manifests.find((manifest) => manifest.kind === 'index_html');
	if (indexHtml && !packageJson && projects.length === 0 && !packagesConfig && !has('web_config')) {
		stacks.add('static');
		evidence.push({ kind: 'static_html', manifest: indexHtml.relativePath });
	}

	return {
		directory,
		stacks: sortStacks(stacks),
		restoreMode: mergeRestoreModes([
			packagesConfig ? 'packages_config' : 'none',
			packageReference ? 'package_reference' : 'none'
		]),
		manifests: manifests.map((manifest) => manifest.relativePath).sort(),
		evidence
	};
}

export function detectStack(scan: WorktreeProfileScan): StackDetection {
	const byDirectory = new Map<string, ScanManifest[]>();
	for (const manifest of scan.manifests) {
		const bucket = byDirectory.get(manifest.directory);
		if (bucket) bucket.push(manifest);
		else byDirectory.set(manifest.directory, [manifest]);
	}

	const subprojects = [...byDirectory.entries()]
		.map(([directory, manifests]) => detectSubproject(directory, manifests))
		.filter((subproject) => subproject.stacks.length > 0)
		.sort((left, right) => left.directory.localeCompare(right.directory));
	// Una soluzione senza progetti leggibili (filtrati dai limiti dello scan)
	// resta comunque evidenza di uno stack .NET.
	const solution = scan.manifests.find((manifest) => manifest.kind === 'solution');
	if (solution && !subprojects.some((entry) => entry.stacks.some((stack) => stack === 'aspnet' || stack === 'dotnet'))) {
		subprojects.push({
			directory: solution.directory,
			stacks: ['dotnet'],
			restoreMode: 'none',
			manifests: [solution.relativePath],
			evidence: [{ kind: 'solution', manifest: solution.relativePath }]
		});
	}

	const stacks = sortStacks(subprojects.flatMap((subproject) => subproject.stacks));
	const restoreMode = mergeRestoreModes(subprojects.map((subproject) => subproject.restoreMode));

	const warnings: ProfileWarning[] = [];
	if (restoreMode === 'packages_config' || restoreMode === 'mixed') {
		// Con `packages.config` NuGet copia i binari dentro la soluzione: il
		// worktree paga su disco quanto pesa gia' la cartella `packages/`.
		warnings.push({
			kind: 'packages_config_restore',
			estimatedBytes: scan.packagesDirectories.reduce((total, entry) => total + entry.bytes, 0)
		});
	}
	const nuget = scan.nativeCaches.find((cache) => cache.kind === 'nuget');
	const dotnetStack = stacks.includes('aspnet') || stacks.includes('dotnet');
	if (dotnetStack && nuget && !nuget.available) {
		warnings.push({ kind: 'nuget_cache_missing', path: nuget.path ?? undefined });
	}
	if (scan.truncated) warnings.push({ kind: 'scan_truncated' });

	return {
		stacks,
		restoreMode,
		subprojects,
		manifests: scan.manifests.map((manifest) => manifest.relativePath),
		generatedDirectories: [...scan.generatedDirectories],
		nativeCaches: scan.nativeCaches.map((cache) => ({ ...cache })),
		warnings,
		candidates: scan.untrackedCandidates.map((candidate) => ({ ...candidate }))
	};
}
