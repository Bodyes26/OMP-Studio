// Catalogo dei comandi slash gestiti nativamente da OMP Studio (guscio GUI).
// Questi comandi vengono intercettati localmente da `handleGuiSlashCommand`
// in routes/+page.svelte e non vengono inoltrati a omp come prompt.

import type { AvailableCommand } from './wire';

export const STUDIO_SLASH_COMMANDS: AvailableCommand[] = [
	{
		name: 'new',
		description: 'Avvia una nuova sessione pulita',
		aliases: ['clear'],
		source: 'studio'
	},
	{
		name: 'resume',
		description: 'Riprende una sessione precedente o apre lo storico',
		aliases: [],
		source: 'studio',
		input: { hint: '[id]' }
	},
	{
		name: 'compact',
		description: 'Compatta la cronologia e il contesto della sessione',
		source: 'studio',
		input: { hint: '[istruzioni]' }
	},
	{
		name: 'handoff',
		description: 'Passa il riassunto a una nuova sessione pulita',
		source: 'studio',
		input: { hint: '[istruzioni]' }
	},
	{
		name: 'thinking',
		description: 'Imposta il livello di ragionamento del modello',
		aliases: ['reasoning'],
		source: 'studio',
		input: { hint: '<livello>' },
		subcommands: [
			{ name: 'off', description: 'Disattiva il reasoning' },
			{ name: 'minimal', description: 'Reasoning minimo' },
			{ name: 'low', description: 'Reasoning basso' },
			{ name: 'medium', description: 'Reasoning medio' },
			{ name: 'high', description: 'Reasoning alto' },
			{ name: 'xhigh', description: 'Reasoning molto alto' },
			{ name: 'max', description: 'Reasoning massimo' }
		]
	},
	{
		name: 'model',
		description: 'Apre la configurazione modelli o passa al successivo',
		source: 'studio',
		input: { hint: '[next]' },
		subcommands: [
			{ name: 'next', description: 'Passa al modello successivo configurato' }
		]
	},
	{
		name: 'role',
		description: 'Apre la configurazione ruoli o imposta un ruolo specifico',
		aliases: ['roles'],
		source: 'studio',
		input: { hint: '[default|plan|smol|slow|vision|task|commit|advisor]' },
		subcommands: [
			{ name: 'default', description: 'Imposta il ruolo Default / Chat' },
			{ name: 'plan', description: 'Imposta il ruolo Architectural Plan' },
			{ name: 'smol', description: 'Imposta il ruolo Smol (Fast)' },
			{ name: 'slow', description: 'Imposta il ruolo Slow (Reasoning)' },
			{ name: 'vision', description: 'Imposta il ruolo Vision / Images' },
			{ name: 'task', description: 'Imposta il ruolo Task Subagents' },
			{ name: 'commit', description: 'Imposta il ruolo Git Commit' },
			{ name: 'advisor', description: 'Imposta il ruolo Advisor (Reviewer)' },
			{ name: 'next', description: 'Passa al ruolo successivo nella sequenza' }
		]
	},
	{
		name: 'name',
		description: 'Rinomina la sessione corrente',
		aliases: ['rename'],
		source: 'studio',
		input: { hint: '<titolo>' }
	},
	{
		name: 'cost',
		description: 'Mostra token, chiamate a strumenti e costi della sessione',
		aliases: ['stats', 'status'],
		source: 'studio'
	},
	{
		name: 'git',
		description: 'Apre il pannello Git nella barra laterale',
		aliases: ['branch'],
		source: 'studio'
	},
	{
		name: 'settings',
		description: 'Apre la configurazione dei modelli',
		aliases: ['setup', 'models'],
		source: 'studio'
	},
	{
		name: 'usage',
		description: 'Apre il pannello delle quote e consumi',
		aliases: ['quota'],
		source: 'studio'
	},
	{
		name: 'switch',
		description: 'Apre il selettore rapido dei progetti',
		source: 'studio'
	},
	{
		name: 'terminal',
		description: 'Passa alla visualizzazione terminale TUI',
		source: 'studio'
	},
	{
		name: 'help',
		description: 'Mostra i comandi disponibili nella superficie GUI',
		source: 'studio'
	},
	{
		name: 'login',
		description: 'Apre la configurazione dei provider di modelli e credenziali',
		aliases: ['logout'],
		source: 'studio'
	},
	{
		name: 'copy',
		description: 'Copia l\'intera trascrizione della sessione corrente negli appunti',
		source: 'studio'
	},
	{
		name: 'tree',
		description: 'Mostra l\'albero e lo storico delle sessioni del progetto',
		aliases: ['sessions'],
		source: 'studio'
	},
	{
		name: 'fork',
		description: 'Crea una nuova diramazione (fork) della sessione corrente',
		source: 'studio'
	},
	{
		name: 'drop',
		description: 'Apre lo storico per gestire ed eliminare rami di sessione',
		source: 'studio'
	},
	{
		name: 'quit',
		description: 'Azzera la vista attiva e avvia una nuova sessione pulita',
		aliases: ['exit'],
		source: 'studio'
	}
];

/**
 * Unisce i comandi nativi del guscio con quelli dinamici ricevuti da omp.
 * I comandi locali di Studio hanno precedenza in caso di collisione di nome.
 */
export function mergeCommands(
	studioCommands: AvailableCommand[],
	ompCommands: AvailableCommand[]
): AvailableCommand[] {
	const result: AvailableCommand[] = [...studioCommands];
	const seen = new Set<string>();

	for (const cmd of studioCommands) {
		seen.add(cmd.name.toLowerCase());
		if (cmd.aliases) {
			for (const alias of cmd.aliases) {
				seen.add(alias.toLowerCase());
			}
		}
	}

	for (const cmd of ompCommands) {
		const isSkill = cmd.source === 'skill' || cmd.name.startsWith('skill:');
		const cleanName = isSkill ? cmd.name.replace(/^skill:/, '') : cmd.name;
		const lowerClean = cleanName.toLowerCase();
		const lowerRaw = cmd.name.toLowerCase();

		if (!seen.has(lowerClean)) {
			seen.add(lowerClean);
			if (isSkill) {
				seen.add(lowerRaw);
				const aliases = [...(cmd.aliases || [])];
				if (!aliases.includes(cmd.name) && cmd.name !== cleanName) {
					aliases.push(cmd.name);
				}
				result.push({
					...cmd,
					name: cleanName,
					aliases,
					source: 'skill',
					input: cmd.input || { hint: 'arguments' }
				});
			} else {
				result.push({
					...cmd,
					source: cmd.source || 'omp'
				});
			}
		}
	}

	return result;
}

export interface SlashCursorMatch {
	query: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Estrae il token del comando slash alla posizione corrente del cursore.
 * Riconosce '/' solo se all'inizio del testo o preceduto da spazio/a capo,
 * evitando falsi positivi su URL (http://) o percorsi di file (src/lib/...).
 */
export function extractSlashQueryAtCursor(text: string, cursorPos: number): SlashCursorMatch | null {
	if (cursorPos < 0 || cursorPos > text.length) return null;
	const beforeCursor = text.slice(0, cursorPos);
	const lastSlashIndex = beforeCursor.lastIndexOf('/');
	if (lastSlashIndex === -1) return null;

	// Verifica che '/' sia a inizio testo o preceduto da whitespace
	if (lastSlashIndex > 0) {
		const charBefore = text[lastSlashIndex - 1];
		if (!charBefore || !/\s/.test(charBefore)) {
			return null;
		}
	}

	// Non deve attraversare ritorni a capo tra lo slash e il cursore
	const betweenSlashAndCursor = beforeCursor.slice(lastSlashIndex);
	if (betweenSlashAndCursor.includes('\n') || betweenSlashAndCursor.includes('\r')) {
		return null;
	}

	const query = beforeCursor.slice(lastSlashIndex + 1);

	// Calcola l'indice di fine cercando la fine della parola corrente dopo il cursore
	let endIndex = cursorPos;
	while (endIndex < text.length && !/\s/.test(text[endIndex])) {
		endIndex++;
	}

	return {
		query,
		startIndex: lastSlashIndex,
		endIndex
	};
}

/**
 * Verifica se la palette deve aprirsi per il match slash alla posizione corrente del cursore.
 */
export function shouldOpenSlashPaletteAtCursor(
	match: SlashCursorMatch | null,
	commands: AvailableCommand[]
): boolean {
	if (!match) return false;
	const raw = match.query.trimStart();
	const space = raw.search(/\s/);
	if (space === -1) return true;
	const token = raw.slice(0, space).toLowerCase();
	const command = commands.find(
		(candidate: AvailableCommand) =>
			candidate.name.toLowerCase() === token
			|| candidate.aliases?.some((alias: string) => alias.toLowerCase() === token)
	);
	return Boolean(command?.subcommands?.length);
}

/**
 * Sostituisce chirurgicamente il token del comando slash alla posizione specificata.
 */
export function insertSlashCommandAtCursor(
	text: string,
	startIndex: number,
	endIndex: number,
	commandValue: string
): { newText: string; newCursorPos: number } {
	const before = text.slice(0, startIndex);
	const after = text.slice(endIndex);
	const insertText = `/${commandValue} `;
	const newText = before + insertText + after;
	const newCursorPos = before.length + insertText.length;
	return {
		newText,
		newCursorPos
	};
}
