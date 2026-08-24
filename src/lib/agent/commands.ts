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
		const lowerName = cmd.name.toLowerCase();
		if (!seen.has(lowerName)) {
			seen.add(lowerName);
			result.push({
				...cmd,
				source: cmd.source || 'omp'
			});
		}
	}

	return result;
}
