// Catalogo dei comandi slash gestiti nativamente da OMP Studio (guscio GUI).
// Questi comandi vengono intercettati localmente da `handleGuiSlashCommand`
// in routes/+page.svelte e non vengono inoltrati a omp come prompt.

import type { AvailableCommand } from './wire';
import { m as msg } from '$lib/paraglide/messages.js';

export const STUDIO_SLASH_COMMANDS: AvailableCommand[] = [
	{
		name: 'new',
		get description() { return msg.ui_ts_commands_avvia_una_nuova_sessione_pulita_fa61(); },
		aliases: ['clear'],
		source: 'studio'
	},
	{
		name: 'resume',
		get description() { return msg.ui_ts_commands_riprende_una_sessione_precedente_o_apre_lo_d684(); },
		aliases: [],
		source: 'studio',
		input: { hint: '[id]' }
	},
	{
		name: 'compact',
		get description() { return msg.ui_ts_commands_compatta_la_cronologia_e_il_contesto_della_2157(); },
		source: 'studio',
		input: { hint: '[istruzioni]' }
	},
	{
		name: 'handoff',
		get description() { return msg.ui_ts_commands_passa_il_riassunto_a_una_nuova_sessione_8ecf(); },
		source: 'studio',
		input: { hint: '[istruzioni]' }
	},
	{
		name: 'thinking',
		get description() { return msg.ui_ts_commands_imposta_il_livello_di_ragionamento_del_modello_7da6(); },
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
			{ name: 'next', get description() { return msg.ui_ts_commands_passa_al_modello_successivo_configurato_1c74(); } }
		]
	},
	{
		name: 'role',
		get description() { return msg.ui_ts_commands_apre_la_configurazione_ruoli_o_imposta_un_9162(); },
		aliases: ['roles'],
		source: 'studio',
		input: { hint: '[default|plan|smol|slow|vision|task|commit|advisor]' },
		subcommands: [
			{ name: 'default', get description() { return msg.ui_ts_commands_imposta_il_ruolo_default_chat_3385(); } },
			{ name: 'plan', get description() { return msg.ui_ts_commands_imposta_il_ruolo_architectural_plan_01f7(); } },
			{ name: 'smol', get description() { return msg.ui_ts_commands_imposta_il_ruolo_smol_fast_e7b1(); } },
			{ name: 'slow', get description() { return msg.ui_ts_commands_imposta_il_ruolo_slow_reasoning_a02e(); } },
			{ name: 'vision', get description() { return msg.ui_ts_commands_imposta_il_ruolo_vision_images_9f21(); } },
			{ name: 'task', get description() { return msg.ui_ts_commands_imposta_il_ruolo_task_subagents_20af(); } },
			{ name: 'commit', get description() { return msg.ui_ts_commands_imposta_il_ruolo_git_commit_2b53(); } },
			{ name: 'advisor', get description() { return msg.ui_ts_commands_imposta_il_ruolo_advisor_reviewer_d3fc(); } },
			{ name: 'next', description: 'Passa al ruolo successivo nella sequenza' }
		]
	},
	{
		name: 'name',
		get description() { return msg.ui_ts_commands_rinomina_la_sessione_corrente_9566(); },
		aliases: ['rename'],
		source: 'studio',
		input: { hint: '<titolo>' }
	},
	{
		name: 'cost',
		get description() { return msg.ui_ts_commands_mostra_token_chiamate_a_strumenti_e_costi_0ebf(); },
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
		get description() { return msg.ui_ts_commands_passa_alla_visualizzazione_terminale_tui_d812(); },
		source: 'studio'
	},
	{
		name: 'help',
		get description() { return msg.ui_ts_commands_mostra_i_comandi_disponibili_nella_superficie_gui_88cd(); },
		source: 'studio'
	},
	{
		name: 'login',
		description: 'Apre la configurazione dei provider di modelli e credenziali; con un argomento apre direttamente quel provider',
		aliases: ['logout'],
		input: { hint: '[provider]' },
		source: 'studio'
	},
	{
		name: 'copy',
		get description() { return msg.ui_ts_commands_copia_l_intera_trascrizione_della_sessione_corrente_e2a0(); },
		source: 'studio'
	},
	{
		name: 'tree',
		get description() { return msg.ui_ts_commands_mostra_l_albero_e_lo_storico_delle_0376(); },
		aliases: ['sessions'],
		source: 'studio'
	},
	{
		name: 'fork',
		get description() { return msg.ui_ts_commands_crea_una_nuova_diramazione_fork_della_sessione_8343(); },
		source: 'studio'
	},
	{
		name: 'drop',
		get description() { return msg.ui_ts_commands_apre_lo_storico_per_gestire_ed_eliminare_f7c8(); },
		source: 'studio'
	},
	{
		name: 'quit',
		get description() { return msg.ui_ts_commands_azzera_la_vista_attiva_e_avvia_una_1f33(); },
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
