import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AskQuestion, PendingAsk } from '../src/lib/agent/session.svelte.ts';

// Funzioni logiche di supporto per AskCard e Ask renderer
function cleanOptionLabel(label: string): string {
	const recSuffix = ' (Recommended)';
	if (label.endsWith(recSuffix)) {
		return label.slice(0, -recSuffix.length);
	}
	return label;
}

function extractNoteFromLabel(label: string): { clean: string; note?: string } {
	const match = label.match(/^(.*?)\s*\((?:nota|note):\s*([^)]+)\)$/i);
	if (match) {
		return { clean: match[1].trim(), note: match[2].trim() };
	}
	return { clean: label };
}

function isDoneOption(label: string): boolean {
	const lower = label.toLowerCase();
	return lower.includes('done selecting') || lower.includes('fine selezione') || label.startsWith('✔');
}

function isOtherOption(label: string): boolean {
	const lower = label.toLowerCase();
	return (
		lower === 'other (type your own)' ||
		lower.startsWith('other (') ||
		lower === 'other' ||
		lower === 'altro (scrivi la tua risposta)' ||
		lower === 'altro'
	);
}

describe('Ask tool: parsing, note e formattazione risposte', () => {
	describe('cleanOptionLabel & isRecommended', () => {
		it('rimuove il suffisso (Recommended) per il matching pulito', () => {
			assert.equal(cleanOptionLabel('Modifica minima (Recommended)'), 'Modifica minima');
			assert.equal(cleanOptionLabel('Refactor completo'), 'Refactor completo');
		});
	});

	describe('extractNoteFromLabel', () => {
		it('estrae nota in italiano (nota: ...)', () => {
			const res = extractNoteFromLabel('SQLite (nota: solo per sviluppo locale)');
			assert.equal(res.clean, 'SQLite');
			assert.equal(res.note, 'solo per sviluppo locale');
		});

		it('estrae nota in inglese (note: ...)', () => {
			const res = extractNoteFromLabel('JWT (note: include refresh token)');
			assert.equal(res.clean, 'JWT');
			assert.equal(res.note, 'include refresh token');
		});

		it('preserva etichette prive di nota', () => {
			const res = extractNoteFromLabel('PostgreSQL');
			assert.equal(res.clean, 'PostgreSQL');
			assert.equal(res.note, undefined);
		});
	});

	describe('isDoneOption & isOtherOption', () => {
		it('riconosce sentinelle di completamento multi-select', () => {
			assert.equal(isDoneOption('✔ Done selecting'), true);
			assert.equal(isDoneOption('Done selecting'), true);
			assert.equal(isDoneOption('Fine selezione'), true);
			assert.equal(isDoneOption('Opzione normale'), false);
		});

		it('riconosce opzioni per risposta personalizzata', () => {
			assert.equal(isOtherOption('Other (type your own)'), true);
			assert.equal(isOtherOption('Altro (scrivi la tua risposta)'), true);
			assert.equal(isOtherOption('Other'), true);
			assert.equal(isOtherOption('OAuth2'), false);
		});
	});

	describe('Formattazione risposte wizard', () => {
		it('formatta risposta a scelta singola con nota', () => {
			const label = 'Modifica minima';
			const note = 'assicurati di non rompere la firma';
			const formatted = note.trim() ? `${cleanOptionLabel(label)} (nota: ${note.trim()})` : label;
			assert.equal(formatted, 'Modifica minima (nota: non rompere la firma)'.replace('non rompere', 'assicurati di non rompere'));
		});

		it('formatta risposta a scelta multipla con sentinella Done', () => {
			const selected = ['JWT', 'OAuth2'];
			const doneSentinel = '✔ Done selecting';
			const sequence = [...selected, doneSentinel];
			assert.deepEqual(sequence, ['JWT', 'OAuth2', '✔ Done selecting']);
		});

		it('formatta risposta personalizzata (Altro)', () => {
			const customInput = 'Usa una soluzione ibrida personalizzata';
			const note = 'vedi doc';
			const formatted = note ? `${customInput} (nota: ${note})` : customInput;
			assert.equal(formatted, 'Usa una soluzione ibrida personalizzata (nota: vedi doc)');
		});
	});

	describe('Struttura dati PendingAsk e Questions', () => {
		it('valida domande strutturate con raccomandazioni e multi-select', () => {
			const rawQuestion: AskQuestion = {
				id: 'storage_type',
				question: 'Quale storage backend utilizzare?',
				header: 'Storage',
				multi: false,
				recommended: 0,
				options: [
					{ label: 'SQLite (Recommended)', description: 'Leggero e zero configurazione' },
					{ label: 'PostgreSQL', description: 'Robusto per multi-utenza' }
				]
			};

			assert.equal(rawQuestion.id, 'storage_type');
			assert.equal(rawQuestion.multi, false);
			assert.equal(rawQuestion.options.length, 2);
			assert.equal(cleanOptionLabel(rawQuestion.options[0].label), 'SQLite');
		});
	});
});
