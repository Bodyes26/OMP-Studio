import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	LOCK_FILE,
	SETUP_PACKAGE,
	buildFingerprint,
	compareFingerprints,
	parseSceneDefinition,
	parseSceneOrder,
	readTarEntries
} from '../scripts/check-setup-flow.mjs';

/** Wizard minimo nella forma pubblicata dalla 19.2.x: annotazione readonly + commenti. */
const WIZARD_SOURCE = `/** Ogni scena di onboarding, in ordine. */
export const ALL_SCENES: readonly SetupScene[] = [
	signInScene, // provider
	modelScene,
	glyphScene,
	composerScene,
	themeScene,
	updatesScene,
];
`;

const SCENE_FILES: Record<string, string> = {
	'src/ui/setup/scenes/sign-in.tsx': 'export const signInScene: SetupScene = { id: "providers", minVersion: 1 };',
	'src/ui/setup/scenes/model.tsx': 'export const modelScene: SetupScene = { id: "model", minVersion: 1 };',
	'src/ui/setup/scenes/glyph.tsx': 'export const glyphScene: SetupScene = { id: "glyph-mode", minVersion: 1 };',
	'src/ui/setup/scenes/composer.tsx':
		'export const composerScene: SetupScene = { id: "composer-shape", minVersion: 2 };',
	'src/ui/setup/scenes/theme.tsx': 'export const themeScene: SetupScene = { id: "theme", minVersion: 1 };',
	'src/ui/setup/scenes/updates.tsx': 'export const updatesScene: SetupScene = { id: "auto-update", minVersion: 3 };',
	'src/ui/setup/scenes/choice.tsx': 'export const CHOICES = [];'
};

function makeFiles(overrides: Record<string, string> = {}): Map<string, string> {
	const files = new Map<string, string>([
		['src/config/setup-version.ts', 'export const CURRENT_SETUP_VERSION = 3;'],
		['src/ui/setup/wizard.tsx', WIZARD_SOURCE]
	]);
	for (const [path, source] of Object.entries(SCENE_FILES)) files.set(path, source);
	for (const [path, source] of Object.entries(overrides)) files.set(path, source);
	return files;
}

describe('check-setup-flow: lettura dei sorgenti upstream', () => {
	it('parseSceneOrder legge ALL_SCENES con annotazione di tipo e commenti', () => {
		assert.deepEqual(parseSceneOrder(WIZARD_SOURCE), [
			'signInScene',
			'modelScene',
			'glyphScene',
			'composerScene',
			'themeScene',
			'updatesScene'
		]);
	});

	it('parseSceneOrder restituisce elenco vuoto senza ALL_SCENES', () => {
		assert.deepEqual(parseSceneOrder('export const NIENTE = 1;'), []);
	});

	it('parseSceneDefinition legge id e minVersion, null se export assente', () => {
		assert.deepEqual(parseSceneDefinition(SCENE_FILES['src/ui/setup/scenes/updates.tsx'], 'updatesScene'), {
			id: 'auto-update',
			minVersion: 3
		});
		assert.equal(parseSceneDefinition(SCENE_FILES['src/ui/setup/scenes/updates.tsx'], 'altraScene'), null);
	});

	it('buildFingerprint compone versione, scene ordinate e hash dei file', () => {
		const fingerprint = buildFingerprint(makeFiles());

		assert.equal(fingerprint.setupVersion, 3);
		assert.deepEqual(
			fingerprint.scenes.map((scene: { id: string; file: string | null }) => [scene.id, scene.file]),
			[
				['providers', 'src/ui/setup/scenes/sign-in.tsx'],
				['model', 'src/ui/setup/scenes/model.tsx'],
				['glyph-mode', 'src/ui/setup/scenes/glyph.tsx'],
				['composer-shape', 'src/ui/setup/scenes/composer.tsx'],
				['theme', 'src/ui/setup/scenes/theme.tsx'],
				['auto-update', 'src/ui/setup/scenes/updates.tsx']
			]
		);
		// setup-version.ts e wizard.tsx sono improntati come ogni altro file
		assert.match(fingerprint.files['src/config/setup-version.ts'], /^[0-9a-f]{64}$/);
		assert.match(fingerprint.files['src/ui/setup/wizard.tsx'], /^[0-9a-f]{64}$/);
		assert.equal(Object.keys(fingerprint.files).length, 9);
	});

	it('buildFingerprint segnala una scena elencata ma non risolvibile', () => {
		const files = makeFiles({
			'src/ui/setup/wizard.tsx': `export const ALL_SCENES: readonly SetupScene[] = [signInScene, scenaFantasma];`
		});
		const fingerprint = buildFingerprint(files);
		assert.deepEqual(fingerprint.scenes[1], {
			export: 'scenaFantasma',
			file: null,
			id: '<non risolta: scenaFantasma>',
			minVersion: null
		});
	});

	it('buildFingerprint fallisce esplicitamente se manca setup-version.ts o wizard.tsx', () => {
		const senzaVersione = makeFiles();
		senzaVersione.delete('src/config/setup-version.ts');
		assert.throws(() => buildFingerprint(senzaVersione), /setup-version\.ts assente/);

		const senzaWizard = makeFiles();
		senzaWizard.delete('src/ui/setup/wizard.tsx');
		assert.throws(() => buildFingerprint(senzaWizard), /wizard\.tsx assente/);
	});
});

describe('check-setup-flow: confronto con il lock', () => {
	it('impronta identica tranne la versione di omp risulta allineata', () => {
		const current = buildFingerprint(makeFiles());
		const lock = { ...current, ompVersion: '19.0.0' };
		assert.equal(compareFingerprints(lock, current).ok, true);
	});

	it('rileva cambio di CURRENT_SETUP_VERSION, scene e ordine', () => {
		const lock = buildFingerprint(makeFiles());
		const current = buildFingerprint(makeFiles({
			'src/config/setup-version.ts': 'export const CURRENT_SETUP_VERSION = 4;',
			'src/ui/setup/scenes/updates.tsx': 'export const updatesScene: SetupScene = { id: "auto-update", minVersion: 4 };',
			'src/ui/setup/wizard.tsx': `export const ALL_SCENES: readonly SetupScene[] = [updatesScene, signInScene, modelScene, glyphScene, composerScene, themeScene];`
		}));
		const { ok, differences } = compareFingerprints(lock, current);

		assert.equal(ok, false);
		assert.deepEqual(differences.setupVersion, { from: 3, to: 4 });
		assert.deepEqual(differences.scenes, [
			{ kind: 'changed', id: 'auto-update', from: 3, to: 4 }
		]);
		assert.ok(differences.sceneOrder);
		assert.deepEqual(differences.files.changed.map((entry: { path: string }) => entry.path).sort(), [
			'src/config/setup-version.ts',
			'src/ui/setup/scenes/updates.tsx',
			'src/ui/setup/wizard.tsx'
		]);
	});

	it('rileva scene aggiunte/rimosse e file aggiunti/rimossi', () => {
		const lock = buildFingerprint(makeFiles());
		const files = makeFiles({
			'src/ui/setup/wizard.tsx': `export const ALL_SCENES: readonly SetupScene[] = [signInScene, modelScene, glyphScene, composerScene, themeScene];`,
			'src/ui/setup/scenes/extra.tsx': 'export const extraScene: SetupScene = { id: "extra", minVersion: 4 };'
		});
		files.delete('src/ui/setup/scenes/updates.tsx');
		const current = buildFingerprint(files);
		const { differences } = compareFingerprints(lock, current);

		assert.deepEqual(differences.scenes, [{ kind: 'removed', id: 'auto-update', minVersion: 3 }]);
		assert.deepEqual(differences.files.added, ['src/ui/setup/scenes/extra.tsx']);
		assert.deepEqual(differences.files.removed, ['src/ui/setup/scenes/updates.tsx']);
	});
});

describe('check-setup-flow: lock versionato', () => {
	it('punta al pacchetto e ai percorsi della 19.2.x', () => {
		const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));

		assert.equal(SETUP_PACKAGE, '@oh-my-pi/pi-coding-agent');
		assert.equal(lock.package, SETUP_PACKAGE);
		assert.equal(lock.schemaVersion, 1);
		assert.equal(lock.setupVersion, 3);
		assert.deepEqual(
			lock.scenes.map((scene: { id: string }) => scene.id),
			['providers', 'model', 'glyph-mode', 'composer-shape', 'theme', 'auto-update']
		);
		for (const path of Object.keys(lock.files)) {
			assert.ok(
				path.startsWith('src/ui/setup/') || path === 'src/config/setup-version.ts',
				`percorso inatteso nel lock: ${path}`
			);
		}
	});

	it('readTarEntries legge un archivio minimo', () => {
		const name = 'package/src/ui/setup/wizard.tsx';
		const content = 'export const X = 1;';
		const header = Buffer.alloc(512);
		header.write(name, 0, 'utf8');
		header.write('0000644', 100, 'utf8');
		header.write(content.length.toString(8).padStart(11, '0'), 124, 'utf8');
		header.write('0', 156, 'utf8');
		const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
		body.write(content, 0, 'utf8');
		const trailer = Buffer.alloc(1024);
		const archive = Buffer.concat([header, body, trailer]);

		const entries = readTarEntries(archive);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].name, name);
		assert.equal(Buffer.from(entries[0].content).toString('utf8'), content);
	});
});
