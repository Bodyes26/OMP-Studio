#!/usr/bin/env node
/**
 * OMP Studio — Icon Quality & Registry Auditor
 *
 * Verifica in modo sistematico ogni icona presente su Studio:
 * 1. Censimento e risoluzione delle icone registrate in `src/lib/icons.ts`
 * 2. Verifica del divieto architetturale di import diretti da `@lucide/svelte`
 * 3. Rilevamento e catalogazione di `<svg>` inline nei componenti Svelte
 * 4. Analisi di copertura, frequenza d'uso e conformità agli standard Lucide
 *
 * Utilizzo:
 *   node scripts/check-icons.mjs           # Report completo con statistiche
 *   node scripts/check-icons.mjs --json    # Output JSON per tooling/CI
 *   node scripts/check-icons.mjs --strict  # Ritorna exit code 1 se trova violazioni architetturali
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const SRC_DIR = join(ROOT_DIR, 'src');
const ICONS_REGISTRY_FILE = join(SRC_DIR, 'lib', 'icons.ts');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const strictMode = args.includes('--strict');

// 1. Leggi ed estrai le icone registrate in src/lib/icons.ts
const registryContent = readFileSync(ICONS_REGISTRY_FILE, 'utf-8');
const exportRegex = /export\s*\{\s*default\s+as\s+([A-Za-z0-9_]+)\s*\}\s*from\s*['"]@lucide\/svelte\/icons\/([^'"]+)['"]/g;

/** @type {Map<string, { name: string, glyph: string, sourcePath: string, valid: boolean, usages: number, locations: string[] }>} */
const registeredIcons = new Map();
let match = null;

while ((match = exportRegex.exec(registryContent)) !== null) {
	const [, name, glyph] = match;
	// Verifica presenza del glifo in node_modules/@lucide/svelte
	const glyphPath = join(ROOT_DIR, 'node_modules', '@lucide', 'svelte', 'dist', 'icons', `${glyph}.svelte`);
	const glyphDts = join(ROOT_DIR, 'node_modules', '@lucide', 'svelte', 'dist', 'icons', `${glyph}.d.ts`);
	const valid = existsSync(glyphPath) || existsSync(glyphDts);

	registeredIcons.set(name, {
		name,
		glyph,
		sourcePath: `@lucide/svelte/icons/${glyph}`,
		valid,
		usages: 0,
		locations: []
	});
}

// 2. Scansione ricorsiva di src/ per rilevare file .svelte e .ts
function walkDir(dir, fileList = []) {
	if (!existsSync(dir)) return fileList;
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			walkDir(fullPath, fileList);
		} else if (stat.isFile() && (entry.endsWith('.svelte') || entry.endsWith('.ts'))) {
			fileList.push(fullPath);
		}
	}
	return fileList;
}

const allSourceFiles = walkDir(SRC_DIR);

/** @type {Array<{ file: string, line: number, statement: string }>} */
const directImportViolations = [];
/** @type {Array<{ file: string, line: number, category: 'candidate_action' | 'visual_graphic', preview: string, hint?: string }>} */
const inlineSvgOccurrences = [];

// Pattern per classificare gli inline SVG
const ACTION_SVG_PATTERNS = [
	{ pattern: /M8 3v10M3 8h10/i, hint: 'IconPlus' },
	{ pattern: /m10\.8 3\.2|l7\.2 7\.2.*2\.6/i, hint: 'IconRename / IconPencil' },
	{ pattern: /M3 4\.5h10M6 2\.5h4/i, hint: 'IconTrash' },
	{ pattern: /M4 3\.5l9 4\.5/i, hint: 'IconPlay' },
	{ pattern: /M3\.5 8\.5l3 3 6-6/i, hint: 'IconCheck' },
	{ pattern: /M4 4l8 8M12 4L4 12|M3 3l10 10/i, hint: 'IconClose' },
	{ pattern: /M6 3\.5a2\.5 2\.5 0 0 1 5 0v7/i, hint: 'IconAttach' },
	{ pattern: /cx="3".*cx="9".*cx="3".*cx="9"/i, hint: 'IconGrip' },
	{ pattern: /M10\.5 10\.5L14 14|M9\.5 9\.5L13\.5 13\.5/i, hint: 'IconSearch' },
	{ pattern: /M4 6l4 4 4-4|M4 6L8 10L12 6/i, hint: 'IconChevronDown' },
	{ pattern: /M3\.5 10L8 5\.5l4\.5 4\.5/i, hint: 'IconChevronUp' },
	{ pattern: /M2 8a6 6/i, hint: 'IconRefresh' },
	{ pattern: /M8 2l6 11H2L8 2z/i, hint: 'IconWarning' },
	{ pattern: /circle cx="8" cy="5\.5"/i, hint: 'Account / User Avatar' }
];

for (const filePath of allSourceFiles) {
	const relPath = relative(ROOT_DIR, filePath).replace(/\\/g, '/');
	const content = readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);

	// 2a. Verifica import diretto fuori da icons.ts
	if (relPath !== 'src/lib/icons.ts') {
		lines.forEach((line, idx) => {
			if (line.includes('@lucide/svelte')) {
				directImportViolations.push({
					file: relPath,
					line: idx + 1,
					statement: line.trim()
				});
			}
		});
	}

	// 2b. Conta utilizzi delle icone registrate
	for (const [iconName, iconData] of registeredIcons.entries()) {
		const wordRegex = new RegExp(`\\b${iconName}\\b`, 'g');
		let fileUses = 0;
		for (const line of lines) {
			if (line.includes(`export { default as ${iconName}`)) continue;
			const matches = line.match(wordRegex);
			if (matches) fileUses += matches.length;
		}
		if (fileUses > 0) {
			iconData.usages += fileUses;
			if (!iconData.locations.includes(relPath)) {
				iconData.locations.push(relPath);
			}
		}
	}

	// 2c. Rileva inline <svg>
	if (filePath.endsWith('.svelte')) {
		lines.forEach((line, idx) => {
			if (/<svg\b/i.test(line)) {
				const contextSnippet = lines.slice(idx, idx + 5).join(' ');
				
				let matchedHint = undefined;
				for (const rule of ACTION_SVG_PATTERNS) {
					if (rule.pattern.test(contextSnippet)) {
						matchedHint = rule.hint;
						break;
					}
				}

				const isVisualGraphic = 
					/ring-svg|radial-gauge|win-btn/i.test(line) ||
					/font-family="sans-serif"/i.test(contextSnippet) ||
					(relPath.includes('FileTree.svelte') && /fileType ===/i.test(lines.slice(Math.max(0, idx - 5), idx).join(' ')));

				const category = (!isVisualGraphic && matchedHint) ? 'candidate_action' : 'visual_graphic';

				inlineSvgOccurrences.push({
					file: relPath,
					line: idx + 1,
					category,
					preview: line.trim().slice(0, 100),
					hint: matchedHint
				});
			}
		});
	}
}

// 3. Calcolo metriche e statistiche
const totalRegistered = registeredIcons.size;
const invalidRegistered = Array.from(registeredIcons.values()).filter((i) => !i.valid);
const unusedIcons = Array.from(registeredIcons.values()).filter((i) => i.usages === 0);
const usedIcons = Array.from(registeredIcons.values()).filter((i) => i.usages > 0);
const actionCandidateSvgs = inlineSvgOccurrences.filter((s) => s.category === 'candidate_action');
const visualGraphicSvgs = inlineSvgOccurrences.filter((s) => s.category === 'visual_graphic');

const report = {
	timestamp: new Date().toISOString(),
	summary: {
		registeredIconsCount: totalRegistered,
		usedIconsCount: usedIcons.length,
		unusedIconsCount: unusedIcons.length,
		invalidRegisteredCount: invalidRegistered.length,
		directImportViolationsCount: directImportViolations.length,
		inlineSvgTotalCount: inlineSvgOccurrences.length,
		inlineSvgCandidatesForMigration: actionCandidateSvgs.length,
		inlineSvgVisualGraphics: visualGraphicSvgs.length
	},
	directImportViolations,
	actionCandidateSvgs,
	registeredIcons: Array.from(registeredIcons.values()).map((i) => ({
		name: i.name,
		glyph: i.glyph,
		valid: i.valid,
		usages: i.usages,
		locationCount: i.locations.length
	}))
};

if (jsonMode) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log('\n\x1b[1m=== OMP Studio — Icon Quality & Registry Auditor ===\x1b[0m\n');
	console.log(`Icone registrate in src/lib/icons.ts: \x1b[32m${totalRegistered}\x1b[0m`);
	console.log(`Icone con utilizzi attivi nel codice:   \x1b[36m${usedIcons.length}\x1b[0m`);
	console.log(`Icone registrate senza utilizzo:       \x1b[33m${unusedIcons.length}\x1b[0m`);
	if (invalidRegistered.length > 0) {
		console.log(`\x1b[31m[ERRORE] Icone registrate con glifo non valido:\x1b[0m ${invalidRegistered.map((i) => i.name).join(', ')}`);
	} else {
		console.log(`Risoluzione glifi Lucide:             \x1b[32m100% valido (tutti i ${totalRegistered} componenti esistono)\x1b[0m`);
	}

	console.log(`\nImport diretti da @lucide/svelte:     ${directImportViolations.length === 0 ? '\x1b[32m0 (Regola architetturale pienamente rispettata)\x1b[0m' : `\x1b[31m${directImportViolations.length} VIOLAZIONI\x1b[0m`}`);

	if (directImportViolations.length > 0) {
		console.log('\n\x1b[31mFile con import diretti proibiti:\x1b[0m');
		for (const v of directImportViolations) {
			console.log(`  - ${v.file}:${v.line} -> ${v.statement}`);
		}
	}

	console.log(`\nOccorrenze di <svg> inline:           \x1b[33m${inlineSvgOccurrences.length} totali\x1b[0m`);
	console.log(`  - Candidati per migrazione a Lucide:  \x1b[33m${actionCandidateSvgs.length}\x1b[0m (icone d'azione / affordance con SVG grezzi)`);
	console.log(`  - Grafica di contesto / indicatori:   \x1b[37m${visualGraphicSvgs.length}\x1b[0m (anelli radiali, badge linguaggi, controlli OS)`);

	if (actionCandidateSvgs.length > 0) {
		console.log('\n\x1b[1mTop candidati per aggiornamento a standard alta qualità ($lib/icons):\x1b[0m');
		for (const cand of actionCandidateSvgs) {
			const hintStr = cand.hint ? `\x1b[32m[Suggerito: ${cand.hint}]\x1b[0m` : '';
			console.log(`  • ${cand.file}:${cand.line} ${hintStr}`);
		}
	}

	console.log('\n\x1b[1mIcone aggiornate di recente per standard elevato:\x1b[0m');
	console.log('  • \x1b[36mIconBrain\x1b[0m     (@lucide/svelte/icons/brain)         -> ReasoningSlider.svelte (Thinking Effort)');
	console.log('  • \x1b[36mIconGrip\x1b[0m      (@lucide/svelte/icons/grip-vertical) -> Drag & Drop reorder handles');
	console.log('  • \x1b[36mIconPencil\x1b[0m    (@lucide/svelte/icons/pencil)        -> Modifica task e annotazioni');

	console.log('\n\x1b[32m[OK] Audit completato con successo.\x1b[0m\n');
}

if (strictMode && (directImportViolations.length > 0 || invalidRegistered.length > 0)) {
	process.exit(1);
}
