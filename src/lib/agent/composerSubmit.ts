// Decisioni pure dell'invio dal composer della chat: estratte dal componente
// perche' i test girano senza DOM e senza rune.

import type { AvailableCommand } from './wire';
import { STUDIO_SLASH_COMMANDS } from './commands';

export type ComposerSubmitRoute =
	| { kind: 'studio'; raw: string }
	| { kind: 'omp' };

/**
 * Un messaggio che inizia con `/` passa prima dal guscio: i comandi di Studio
 * (`/new`, `/compact`, `/role`...) non sono comandi di omp e, inoltrati come
 * prompt, finirebbero al modello come testo. Se il guscio non lo riconosce il
 * messaggio va a omp, che serve skill e comandi delle estensioni.
 * `/skill:nome` e' sintassi di omp e non tocca mai il guscio.
 * Un comando di Studio senza argomenti seguito da altro testo e' una frase
 * («/help non funziona il login»): va a omp intera invece di sparire.
 */
export function routeComposerSubmit(
	messageText: string,
	catalog: readonly AvailableCommand[] = STUDIO_SLASH_COMMANDS
): ComposerSubmitRoute {
	const raw = messageText.trim();
	if (!raw.startsWith('/') || raw.length < 2) return { kind: 'omp' };
	if (/^\/skill:/i.test(raw)) return { kind: 'omp' };
	// `/ testo` o `//commento` non sono comandi.
	if (!/^\/[A-Za-z0-9_-]/.test(raw)) return { kind: 'omp' };
	const command = findSlashCommand(raw, catalog);
	const hasArguments = /\s/.test(raw);
	if (command && hasArguments && !command.input && !command.subcommands) return { kind: 'omp' };
	return { kind: 'studio', raw };
}

/** Il comando del catalogo che il primo token di `raw` nomina (nome o alias). */
export function findSlashCommand(raw: string, catalog: readonly AvailableCommand[]): AvailableCommand | null {
	const token = raw.trim().slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
	if (!token) return null;
	return (
		catalog.find(
			(command) =>
				command.name.toLowerCase() === token ||
				command.aliases?.some((alias) => alias.toLowerCase() === token)
		) ?? null
	);
}

/**
 * Cosa usare di un incolla. Il testo vince sui file: Word, Excel e Outlook
 * mettono negli appunti anche un'immagine della selezione, e incollare un
 * paragrafo diventava un allegato. I file contano solo senza testo
 * (screenshot, file copiati da Esplora risorse o dal Finder).
 */
export function choosePasteContent(text: string, fileCount: number): 'text' | 'files' | 'none' {
	if (text.trim().length > 0) return 'text';
	if (fileCount > 0) return 'files';
	return text.length > 0 ? 'text' : 'none';
}

/**
 * Allegati da togliere dal composer dopo un invio riuscito: solo quelli che
 * sono partiti. Uno aggiunto mentre la richiesta era in volo resta per il
 * messaggio successivo invece di sparire senza essere mai stato inviato.
 */
export function remainingAfterSend<T extends { id: string | number }>(
	current: readonly T[],
	sent: readonly T[]
): T[] {
	const sentIds = new Set(sent.map((item) => item.id));
	return current.filter((item) => !sentIds.has(item.id));
}
