import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const SRC_DIR = join(ROOT_DIR, 'src');
const ICONS_REGISTRY_FILE = join(SRC_DIR, 'lib', 'icons.ts');

test('Registro Icone Studio — Validita e Architettura', async (t) => {
	await t.test('tutte le icone esportate da icons.ts esistono in @lucide/svelte', () => {
		const content = readFileSync(ICONS_REGISTRY_FILE, 'utf-8');
		const exportRegex = /export\s*\{\s*default\s+as\s+([A-Za-z0-9_]+)\s*\}\s*from\s*['"]@lucide\/svelte\/icons\/([^'"]+)['"]/g;

		let match: RegExpExecArray | null;
		let count = 0;
		const invalidIcons: string[] = [];

		while ((match = exportRegex.exec(content)) !== null) {
			count++;
			const [_, name, glyph] = match;
			const glyphPath = join(ROOT_DIR, 'node_modules', '@lucide', 'svelte', 'dist', 'icons', `${glyph}.svelte`);
			const glyphDts = join(ROOT_DIR, 'node_modules', '@lucide', 'svelte', 'dist', 'icons', `${glyph}.d.ts`);
			if (!existsSync(glyphPath) && !existsSync(glyphDts)) {
				invalidIcons.push(`${name} (${glyph})`);
			}
		}

		assert.ok(count >= 80, `Attese almeno 80 icone registrate, trovate ${count}`);
		assert.deepEqual(invalidIcons, [], `Trovate icone non valide in icons.ts: ${invalidIcons.join(', ')}`);
	});

	await t.test('nessun componente in src/ importa direttamente da @lucide/svelte', () => {
		function walk(dir: string): string[] {
			let results: string[] = [];
			const list = readdirSync(dir);
			for (const file of list) {
				const full = join(dir, file);
				const stat = statSync(full);
				if (stat.isDirectory()) {
					results = results.concat(walk(full));
				} else if (file.endsWith('.svelte') || file.endsWith('.ts')) {
					results.push(full);
				}
			}
			return results;
		}

		const files = walk(SRC_DIR);
		const violations: string[] = [];

		for (const file of files) {
			const rel = relative(ROOT_DIR, file).replace(/\\/g, '/');
			if (rel === 'src/lib/icons.ts') continue;
			const content = readFileSync(file, 'utf-8');
			if (content.includes('@lucide/svelte')) {
				violations.push(rel);
			}
		}

		assert.deepEqual(violations, [], `Trovati import diretti da @lucide/svelte nei file: ${violations.join(', ')}`);
	});

	await t.test('IconBrain e registrata in icons.ts ed utilizzata in ReasoningSlider.svelte', () => {
		const iconsContent = readFileSync(ICONS_REGISTRY_FILE, 'utf-8');
		assert.ok(
			iconsContent.includes('IconBrain') && iconsContent.includes('@lucide/svelte/icons/brain'),
			'IconBrain deve essere registrata ed esportata da icons.ts con @lucide/svelte/icons/brain'
		);

		const sliderPath = join(SRC_DIR, 'lib', 'components', 'models', 'ReasoningSlider.svelte');
		const sliderContent = readFileSync(sliderPath, 'utf-8');
		assert.ok(
			sliderContent.includes('IconBrain'),
			'ReasoningSlider.svelte deve importare ed utilizzare IconBrain'
		);
		assert.ok(
			!sliderContent.includes('d="M4.5 9.5a2.5 2.5 0 0 1-2.5-2.5'),
			'ReasoningSlider.svelte non deve contenere il vecchio SVG inline grezzo per il cervello'
		);
	});
});
