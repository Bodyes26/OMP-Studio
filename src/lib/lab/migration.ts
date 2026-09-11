// Gestione del passaggio dal vecchio comportamento:
// 1. I vecchi prototipi `proto/<slug>.html` generati da studio_preview restano
//    leggibili e apribili senza perdita; nessuna ricostruzione viene spacciata
//    per conversione fedele;
// 2. La regola `proto/` inserita automaticamente in .gitignore viene distinta
//    dalle scelte dell'utente;
// 3. I nuovi prototipi in `proto/<id>/` diventano versionabili in Git tramite
//    un'operazione esplicita e reversibile;
// 4. Nessuna riga scritta dall'utente viene cancellata alla cieca;
// 5. Nessun file esterno a `proto/` viene modificato dal tool confinato del Laboratorio.

import {
	labStoreContainer,
	slugifyPrototypeTitle,
	type LabStorageHost,
	type LabStore
} from './storage.ts';
import {
	LAB_PROTOTYPE_DIRECTORY,
	type GitignoreInspectionResult,
	type GitignoreMigrationResult,
	type GitignoreRollbackResult,
	type LabLegacyPrototype,
	type LabLegacyPrototypeContent,
	type LabLegacyReconstruction,
	type LabPrototypeId
} from './contracts.ts';
import { m as msg } from '$lib/paraglide/messages.js';

/**
 * Avviso vincolante da includere in ogni brief o proposta di ricostruzione.
 * Invariante (ricerca/laboratorio-prototipi-piano.md § 10.E): non spacciare
 * una ricostruzione per conversione fedele.
 *
 * E' una funzione e non una costante: valutata all'import congelerebbe la
 * lingua scelta all'avvio dell'app, e un cambio di lingua lascerebbe l'avviso
 * nell'idioma precedente.
 */
export function labLegacyReconstructionNotice(): string {
	return msg.lab_legacy_reconstruction_notice();
}

/**
 * Estrae un titolo leggibile dal file HTML legacy (tag <title> o slug formattato).
 */
export function extractTitleFromHtml(html: string, fallbackSlug: string): string {
	const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	if (titleMatch && titleMatch[1]?.trim()) {
		return titleMatch[1].trim();
	}
	return (
		fallbackSlug
			.split(/[-_]+/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ') || 'Prototipo Legacy'
	);
}

/**
 * Trova ed elenca tutti i vecchi prototipi HTML presenti nella cartella `proto/` del progetto.
 * I file non vengono alterati né eliminati.
 */
export async function listLegacyPrototypes(
	host: LabStorageHost,
	store?: LabStore
): Promise<LabLegacyPrototype[]> {
	const container = store ? labStoreContainer(store) : LAB_PROTOTYPE_DIRECTORY;
	const entries = (await host.listDirectory(container)) ?? [];
	const htmlFiles = entries
		.filter((entry) => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.html'))
		.map((entry) => entry.name)
		.sort();

	const result: LabLegacyPrototype[] = [];
	for (const fileName of htmlFiles) {
		const id = fileName.replace(/\.html$/i, '');
		const relativePath = `${container}/${fileName}`;
		const content = await host.readTextFile(relativePath);
		const title = content ? extractTitleFromHtml(content, id) : extractTitleFromHtml('', id);
		result.push({
			id,
			fileName,
			relativePath,
			title,
			kind: 'legacy-html',
			isFaithfulConversion: false
		});
	}
	return result;
}

/**
 * Legge il contenuto completo di un prototipo HTML legacy.
 */
export async function readLegacyPrototype(
	host: LabStorageHost,
	fileNameOrId: string,
	store?: LabStore
): Promise<LabLegacyPrototypeContent | null> {
	const container = store ? labStoreContainer(store) : LAB_PROTOTYPE_DIRECTORY;
	const fileName = fileNameOrId.toLowerCase().endsWith('.html') ? fileNameOrId : `${fileNameOrId}.html`;
	const id = fileName.replace(/\.html$/i, '');
	const relativePath = `${container}/${fileName}`;
	const rawHtml = await host.readTextFile(relativePath);
	if (rawHtml === null) return null;

	const title = extractTitleFromHtml(rawHtml, id);
	return {
		id,
		fileName,
		relativePath,
		title,
		kind: 'legacy-html',
		isFaithfulConversion: false,
		rawHtml
	};
}

/**
 * Prepara il brief per una ricostruzione del vecchio prototipo HTML come nuovo esperimento
 * React + Tailwind v4 del Laboratorio.
 *
 * Invariante: `isFaithfulConversion` è categoricamente `false`.
 */
export function reconstructLegacyPrototypeBrief(
	legacy: LabLegacyPrototype,
	_rawHtml?: string
): LabLegacyReconstruction {
	const suggestedPrototypeId = (slugifyPrototypeTitle(legacy.title) ?? legacy.id) as LabPrototypeId;
	const suggestedPrototypeTitle = `${legacy.title} (Ricostruzione React)`;

	const briefLines = [
		`# Ricostruzione React: ${legacy.title}`,
		'',
		`> **${labLegacyReconstructionNotice()}**`,
		'',
		msg.ui_ts_migration_questo_prototipo_ricostruisce_l_interfaccia_dell_originale_2494({ value1: legacy.fileName }),
		'- Framework: React con Tailwind CSS v4 e componenti accessibili.',
		'- Dati e flussi: interamente simulati con mock realistici nel client (nessun backend operativo).',
		'- Scopo: esplorazione interattiva e iterazione visuale con selezione di elementi e annotazioni.',
		'',
		'## Linee guida per l\'autore:',
		`1. Cattura gli elementi chiave della UX/UI del vecchio file HTML ('${legacy.fileName}') ma riscrivili con componenti React modulari e puliti.`,
		msg.ui_ts_migration_2_non_copiare_codice_babel_umd_ne_95f4(),
		'3. Struttura il codice su file separati (`src/App.tsx`, `src/mockData.ts`, eventuali varianti o schermate collegate).'
	];

	return {
		legacyId: legacy.id,
		legacyFileName: legacy.fileName,
		suggestedPrototypeTitle,
		suggestedPrototypeId,
		isFaithfulConversion: false,
		notice: labLegacyReconstructionNotice(),
		brief: briefLines.join('\n')
	};
}

/* ---------------------------------------------------- gestione .gitignore */

export const STUDIO_GITIGNORE_HEADER = '# OMP Studio prototypes';
export const STUDIO_LEGACY_GITIGNORE_RULE = 'proto/';
export const STUDIO_MIGRATED_GITIGNORE_RULE = 'proto/*.html';
export const STUDIO_MIGRATED_GITIGNORE_HEADER =
	'# OMP Studio prototypes (legacy HTML files only; proto/<id> is versioned)';

function detectEol(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Genera un diff unificato chiaro e compatto relativo al solo file .gitignore.
 */
export function generateGitignoreDiff(
	oldContent: string,
	newContent: string,
	filePath: string = '.gitignore'
): string {
	if (oldContent === newContent) return '';
	const oldLines = oldContent.split(/\r?\n/);
	const newLines = newContent.split(/\r?\n/);

	let start = 0;
	while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
		start++;
	}

	let oldEnd = oldLines.length - 1;
	let newEnd = newLines.length - 1;
	while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
		oldEnd--;
		newEnd--;
	}

	const ctxBefore = Math.max(0, start - 2);
	const ctxAfterOld = Math.min(oldLines.length, oldEnd + 3);
	const ctxAfterNew = Math.min(newLines.length, newEnd + 3);

	const oldCount = ctxAfterOld - ctxBefore;
	const newCount = ctxAfterNew - ctxBefore;

	const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -${ctxBefore + 1},${oldCount} +${ctxBefore + 1},${newCount} @@\n`;
	const diffLines: string[] = [];

	for (let i = ctxBefore; i < start; i++) {
		diffLines.push(` ${oldLines[i]}`);
	}
	for (let i = start; i <= oldEnd; i++) {
		diffLines.push(`-${oldLines[i]}`);
	}
	for (let i = start; i <= newEnd; i++) {
		diffLines.push(`+${newLines[i]}`);
	}
	for (let i = oldEnd + 1; i < ctxAfterOld; i++) {
		diffLines.push(` ${oldLines[i]}`);
	}

	return header + diffLines.join('\n');
}

/**
 * Ispeziona il contenuto di un file .gitignore per determinare lo stato della regola `proto/`.
 * Distingue rigorosamente:
 * - la regola automatica inserita da Studio (`# OMP Studio prototypes\nproto/`);
 * - la regola migrata per il Laboratorio (`# OMP Studio prototypes (legacy)...\nproto/*.html`);
 * - regole scritte dall'utente (es. `proto/` senza marcatore Studio);
 * - assenza di regole relative a proto.
 */
export function inspectGitignoreContent(content: string): GitignoreInspectionResult {
	if (!content || content.trim().length === 0) {
		return {
			hasGitignore: true,
			status: 'none',
			matchedRule: null,
			lineIndex: -1,
			userLinesCount: 0,
			explanation: msg.ui_ts_migration_il_file_gitignore_e_vuoto_o_non_6d68()
		};
	}

	const lines = content.split(/\r?\n/);
	let studioHeaderIndex = -1;
	let automatedRuleIndex = -1;
	let isMigrated = false;
	let userDefinedIndex = -1;
	let userDefinedRule: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// Rileva header Studio
		if (/^#\s*OMP\s+Studio\s+prototypes/i.test(line)) {
			studioHeaderIndex = i;
			// Cerca la regola nelle righe immediatamente successive
			for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
				const nextTrim = lines[j].trim();
				if (/^\/?proto\/\*\.html$/i.test(nextTrim)) {
					automatedRuleIndex = j;
					isMigrated = true;
					break;
				} else if (/^\/?proto\/?$/i.test(nextTrim)) {
					automatedRuleIndex = j;
					isMigrated = false;
					break;
				}
			}
			continue;
		}

		// Se non è dentro il blocco Studio appena esaminato, controlla se è una regola scritta dall'utente
		const isInsideStudioBlock =
			studioHeaderIndex !== -1 && i >= studioHeaderIndex && i <= studioHeaderIndex + 3;

		if (!isInsideStudioBlock) {
			if (/^\/?proto\/?$/i.test(line) || /^\/?proto\/\*\.html$/i.test(line)) {
				userDefinedIndex = i;
				userDefinedRule = line;
			}
		}
	}

	if (studioHeaderIndex !== -1 && automatedRuleIndex !== -1) {
		const blockLength = automatedRuleIndex - studioHeaderIndex + 1;
		if (isMigrated) {
			return {
				hasGitignore: true,
				status: 'migrated_versionable',
				matchedRule: lines[automatedRuleIndex].trim(),
				lineIndex: studioHeaderIndex,
				userLinesCount: lines.length - blockLength,
				explanation:
					'Regola Studio migrata: i nuovi prototipi in proto/<id>/ sono versionabili in Git, mentre i vecchi HTML restano esclusi.'
			};
		}
		return {
			hasGitignore: true,
			status: 'automated_legacy',
			matchedRule: lines[automatedRuleIndex].trim(),
			lineIndex: studioHeaderIndex,
			userLinesCount: lines.length - blockLength,
			explanation:
				msg.ui_ts_migration_regola_studio_legacy_rilevata_l_intera_cartella_6664()
		};
	}

	if (userDefinedIndex !== -1 && userDefinedRule) {
		return {
			hasGitignore: true,
			status: 'user_defined',
			matchedRule: userDefinedRule,
			lineIndex: userDefinedIndex,
			userLinesCount: lines.length,
			explanation: `Regola '${userDefinedRule}' definita dall'utente rilevata senza marcatore Studio. Non viene modificata alla cieca.`
		};
	}

	return {
		hasGitignore: true,
		status: 'none',
		matchedRule: null,
		lineIndex: -1,
		userLinesCount: lines.length,
		explanation: 'Nessuna regola relativa a proto/ presente in .gitignore.'
	};
}

/**
 * Esegue la migrazione esplicita della regola per rendere versionabili i nuovi prototipi.
 *
 * Invarianti:
 * - se la regola è già migrata, no-op;
 * - se la regola è scritta dall'utente (`user_defined`), rifiuta l'operazione a meno che
 *   non sia fornito esplicitamente `forceUserOverride: true`;
 * - se la regola è quella automatica legacy, sostituisce ESCLUSIVAMENTE il blocco automatico
 *   mantenendo tutte le righe utente prima e dopo inalterate byte-per-byte;
 * - preserva i terminatori di riga originali (CRLF o LF).
 */
export function migrateGitignoreContent(
	content: string,
	options?: { forceUserOverride?: boolean }
): GitignoreMigrationResult {
	const inspection = inspectGitignoreContent(content);
	const eol = detectEol(content);

	if (inspection.status === 'migrated_versionable') {
		return {
			success: true,
			migrated: false,
			status: 'migrated_versionable',
			content,
			diff: ''
		};
	}

	if (inspection.status === 'user_defined') {
		if (!options?.forceUserOverride) {
			return {
				success: false,
				migrated: false,
				status: 'user_defined',
				content,
				diff: '',
				error:
					"Trovata regola 'proto/' personalizzata dall'utente senza il marcatore automatico '# OMP Studio prototypes'. " +
					msg.ui_ts_migration_le_righe_scritte_dall_utente_non_vengono_cb8a() +
					msg.ui_ts_migration_per_applicare_comunque_la_migrazione_conferma_esplicitamente_056d()
			};
		}
		// Con override esplicito dell'utente: sostituisce la sola riga utente
		const lines = content.split(/\r?\n/);
		lines[inspection.lineIndex] = `${STUDIO_MIGRATED_GITIGNORE_HEADER}${eol}${STUDIO_MIGRATED_GITIGNORE_RULE}`;
		const newContent = lines.join(eol);
		const diff = generateGitignoreDiff(content, newContent);
		return {
			success: true,
			migrated: true,
			status: 'user_defined',
			content: newContent,
			diff
		};
	}

	if (inspection.status === 'none') {
		const prefix = content.length > 0 && !content.endsWith(eol) ? eol : '';
		const addition = `${prefix}${STUDIO_MIGRATED_GITIGNORE_HEADER}${eol}${STUDIO_MIGRATED_GITIGNORE_RULE}${eol}`;
		const newContent = content + addition;
		const diff = generateGitignoreDiff(content, newContent);
		return {
			success: true,
			migrated: true,
			status: 'none',
			content: newContent,
			diff
		};
	}

	// automated_legacy: sostituisce esclusivamente il blocco automatico
	const lines = content.split(/\r?\n/);
	const headerIdx = inspection.lineIndex;
	let ruleIdx = headerIdx + 1;
	while (ruleIdx < lines.length && !lines[ruleIdx].trim()) {
		ruleIdx++;
	}

	const before = lines.slice(0, headerIdx);
	const after = lines.slice(ruleIdx + 1);
	const replacement = [STUDIO_MIGRATED_GITIGNORE_HEADER, STUDIO_MIGRATED_GITIGNORE_RULE];
	const newLines = [...before, ...replacement, ...after];
	const newContent = newLines.join(eol);
	const diff = generateGitignoreDiff(content, newContent);

	return {
		success: true,
		migrated: true,
		status: 'automated_legacy',
		content: newContent,
		diff
	};
}

/**
 * Operazione reversibile: ripristina la vecchia regola automatica `# OMP Studio prototypes\nproto/`.
 */
export function rollbackGitignoreContent(content: string): GitignoreRollbackResult {
	const inspection = inspectGitignoreContent(content);
	const eol = detectEol(content);

	if (inspection.status !== 'migrated_versionable') {
		return {
			success: false,
			reverted: false,
			content,
			diff: '',
			error:
				msg.ui_ts_migration_il_file_gitignore_non_contiene_la_regola_7348()
		};
	}

	const lines = content.split(/\r?\n/);
	const headerIdx = inspection.lineIndex;
	let ruleIdx = headerIdx + 1;
	while (ruleIdx < lines.length && !lines[ruleIdx].trim()) {
		ruleIdx++;
	}

	const before = lines.slice(0, headerIdx);
	const after = lines.slice(ruleIdx + 1);
	const replacement = [STUDIO_GITIGNORE_HEADER, STUDIO_LEGACY_GITIGNORE_RULE];
	const newLines = [...before, ...replacement, ...after];
	const newContent = newLines.join(eol);
	const diff = generateGitignoreDiff(content, newContent);

	return {
		success: true,
		reverted: true,
		content: newContent,
		diff
	};
}

/* ------------------------------------------------ operazioni su host disco */

export async function inspectProjectGitignore(
	host: LabStorageHost,
	projectRootRel: string = ''
): Promise<GitignoreInspectionResult> {
	const gitignorePath = projectRootRel ? `${projectRootRel}/.gitignore` : '.gitignore';
	const text = await host.readTextFile(gitignorePath);
	if (text === null) {
		return {
			hasGitignore: false,
			status: 'none',
			matchedRule: null,
			lineIndex: -1,
			userLinesCount: 0,
			explanation: 'Nessun file .gitignore presente nella radice del progetto.'
		};
	}
	return inspectGitignoreContent(text);
}

/**
 * Esegue la migrazione atomica di .gitignore sul progetto indicato via host.
 */
export async function migrateProjectGitignore(
	host: LabStorageHost,
	options?: { forceUserOverride?: boolean; projectRootRel?: string }
): Promise<GitignoreMigrationResult> {
	const gitignorePath = options?.projectRootRel ? `${options.projectRootRel}/.gitignore` : '.gitignore';
	const text = (await host.readTextFile(gitignorePath)) ?? '';
	const result = migrateGitignoreContent(text, options);

	if (result.success && result.migrated) {
		const tempPath = `${gitignorePath}.tmp.${Date.now()}`;
		await host.createFile(tempPath, result.content);
		await host.replaceFile(tempPath, gitignorePath);
	}

	return result;
}

/**
 * Esegue il rollback atomico della regola in .gitignore sul progetto indicato via host.
 */
export async function rollbackProjectGitignore(
	host: LabStorageHost,
	projectRootRel: string = ''
): Promise<GitignoreRollbackResult> {
	const gitignorePath = projectRootRel ? `${projectRootRel}/.gitignore` : '.gitignore';
	const text = (await host.readTextFile(gitignorePath)) ?? '';
	const result = rollbackGitignoreContent(text);

	if (result.success && result.reverted) {
		const tempPath = `${gitignorePath}.tmp.${Date.now()}`;
		await host.createFile(tempPath, result.content);
		await host.replaceFile(tempPath, gitignorePath);
	}

	return result;
}
