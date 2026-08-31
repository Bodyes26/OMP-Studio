import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseWireEvent,
	isWireEvent,
	isWireResponse,
	isAnswerableUiMethod,
	formatWireCommand,
	type RpcCommand,
	type AgentSessionEvent
} from '../src/lib/agent/wire.ts';
import {
	STUDIO_SLASH_COMMANDS,
	mergeCommands,
	extractSlashQueryAtCursor,
	shouldOpenSlashPaletteAtCursor,
	insertSlashCommandAtCursor
} from '../src/lib/agent/commands.ts';
import { formatTokens } from '../src/lib/utils/format.ts';

describe('Wire OMP e comandi', () => {
	describe('parseWireEvent e validazione eventi', () => {
		it('parsa correttamente una riga JSON valida con tipo', () => {
			const raw = JSON.stringify({
				type: 'response',
				id: 's1',
				command: 'get_state',
				success: true,
				data: { sessionName: 'Sessione Test' }
			});

			const event = parseWireEvent(raw);
			assert.ok(event);
			assert.equal(event.type, 'response');
			assert.equal(event.id, 's1');
			assert.equal(isWireResponse(event), true);
		});

		it('rifiuta stringhe JSON malformate o non-oggetti', () => {
			assert.equal(parseWireEvent('{ broken json'), null);
			assert.equal(parseWireEvent('123'), null);
			assert.equal(parseWireEvent(''), null);
			assert.equal(parseWireEvent(null), null);
			assert.equal(parseWireEvent(undefined), null);
		});

		it('rifiuta payload privi del campo type', () => {
			assert.equal(parseWireEvent({}), null);
			assert.equal(parseWireEvent({ id: 's1' }), null);
			assert.equal(parseWireEvent(JSON.stringify({ id: 's1' })), null);
		});

		it('accetta frame di streaming e delta custom di Studio', () => {
			const deltaFrame = {
				type: 'studio_delta',
				kind: 'text',
				contentIndex: 0,
				delta: 'Ciao mondo'
			};
			assert.equal(isWireEvent(deltaFrame), true);
			const parsed = parseWireEvent(deltaFrame);
			assert.ok(parsed);
			assert.equal(parsed.kind, 'text');
			assert.equal(parsed.delta, 'Ciao mondo');
		});

		it('accetta frame di esito e ciclo di vita subagenti', () => {
			const subagentFrame = {
				type: 'subagent_progress',
				payload: {
					id: 'sub-1',
					agent: 'scout',
					status: 'running',
					task: 'Ricerca codice'
				}
			};
			const parsed = parseWireEvent(subagentFrame);
			assert.ok(parsed);
			assert.equal(parsed.type, 'subagent_progress');
		});

		it('tollera campi imprevisti o custom per versioni future di OMP', () => {
			const futureFrame = {
				type: 'future_omp_event_v99',
				newField: 12345,
				nested: { ok: true }
			};
			const parsed = parseWireEvent(futureFrame);
			assert.ok(parsed);
			assert.equal(parsed.type, 'future_omp_event_v99');
			assert.equal(parsed.newField, 12345);
		});
	});

	describe('isAnswerableUiMethod', () => {
		it('riconosce i metodi UI che richiedono risposta utente', () => {
			assert.equal(isAnswerableUiMethod('select'), true);
			assert.equal(isAnswerableUiMethod('confirm'), true);
			assert.equal(isAnswerableUiMethod('input'), true);
			assert.equal(isAnswerableUiMethod('editor'), true);
		});

		it('esclude i metodi UI notificazionali a una via', () => {
			assert.equal(isAnswerableUiMethod('notify'), false);
			assert.equal(isAnswerableUiMethod('setStatus'), false);
			assert.equal(isAnswerableUiMethod('setWidget'), false);
			assert.equal(isAnswerableUiMethod('open_url'), false);
		});
	});

	describe('formatWireCommand', () => {
		it('serializza comando prompt con id associato', () => {
			const cmd: RpcCommand = {
				type: 'prompt',
				message: 'Test prompt'
			};
			const formatted = formatWireCommand(cmd, 's42');
			const parsed = JSON.parse(formatted);
			assert.equal(parsed.id, 's42');
			assert.equal(parsed.type, 'prompt');
			assert.equal(parsed.message, 'Test prompt');
		});

		it('serializza comandi di stato e controllo', () => {
			const cmd: RpcCommand = { type: 'set_thinking_level', level: 'high' };
			const formatted = formatWireCommand(cmd, 's99');
			const parsed = JSON.parse(formatted);
			assert.equal(parsed.id, 's99');
			assert.equal(parsed.type, 'set_thinking_level');
			assert.equal(parsed.level, 'high');
		});

		it('serializza comandi compact e handoff con istruzioni opzionali', () => {
			const compactCmd: RpcCommand = { type: 'compact', customInstructions: 'mantieni i todo' };
			const parsedCompact = JSON.parse(formatWireCommand(compactCmd, 'c1'));
			assert.equal(parsedCompact.id, 'c1');
			assert.equal(parsedCompact.type, 'compact');
			assert.equal(parsedCompact.customInstructions, 'mantieni i todo');

			const handoffCmd: RpcCommand = { type: 'handoff' };
			const parsedHandoff = JSON.parse(formatWireCommand(handoffCmd, 'h1'));
			assert.equal(parsedHandoff.id, 'h1');
			assert.equal(parsedHandoff.type, 'handoff');
		});
	});

	describe('Comandi slash e cataloghi', () => {
		it('il catalogo STUDIO_SLASH_COMMANDS contiene i comandi essenziali', () => {
			const names = STUDIO_SLASH_COMMANDS.map((c) => c.name);
			assert.ok(names.includes('new'));
			assert.ok(names.includes('resume'));
			assert.ok(names.includes('compact'));
			assert.ok(names.includes('thinking'));
			assert.ok(names.includes('model'));
			assert.ok(names.includes('role'));
		});

		describe('mergeCommands', () => {
			it('dà precedenza ai comandi nativi di Studio su quelli di OMP', () => {
				const ompCmds = [
					{ name: 'new', description: 'OMP version', source: 'omp' },
					{ name: 'custom_tool', description: 'Tool extra', source: 'omp' }
				];
				const merged = mergeCommands(STUDIO_SLASH_COMMANDS, ompCmds);
				const newCmd = merged.find((c) => c.name === 'new');
				assert.equal(newCmd?.source, 'studio');
				const customCmd = merged.find((c) => c.name === 'custom_tool');
				assert.ok(customCmd);
				assert.equal(customCmd.source, 'omp');
			});

			it('ripulisce i prefissi skill: e imposta source: skill', () => {
				const ompCmds = [
					{ name: 'skill:review', description: 'Review skill' }
				];
				const merged = mergeCommands(STUDIO_SLASH_COMMANDS, ompCmds);
				const skillCmd = merged.find((c) => c.name === 'review');
				assert.ok(skillCmd);
				assert.equal(skillCmd.source, 'skill');
				assert.ok(skillCmd.aliases?.includes('skill:review'));
			});
		});

		describe('extractSlashQueryAtCursor', () => {
			it('estrae il comando a inizio riga', () => {
				const text = '/thin';
				const match = extractSlashQueryAtCursor(text, 5);
				assert.ok(match);
				assert.equal(match.query, 'thin');
				assert.equal(match.startIndex, 0);
				assert.equal(match.endIndex, 5);
			});

			it('estrae il comando preceduto da spazio', () => {
				const text = 'Esegui /mode';
				const match = extractSlashQueryAtCursor(text, 12);
				assert.ok(match);
				assert.equal(match.query, 'mode');
				assert.equal(match.startIndex, 7);
			});

			it('ignora slash all\'interno di URL o percorsi file', () => {
				assert.equal(extractSlashQueryAtCursor('https://github.com', 10), null);
				assert.equal(extractSlashQueryAtCursor('src/lib/agent', 8), null);
			});

			it('ignora slash se c\'è un ritorno a capo tra slash e cursore', () => {
				const text = '/test\naltro testo';
				assert.equal(extractSlashQueryAtCursor(text, 10), null);
			});
		});

		describe('shouldOpenSlashPaletteAtCursor', () => {
			it('apre la palette per match semplice senza spazio', () => {
				const match = { query: 'mod', startIndex: 0, endIndex: 4 };
				assert.equal(shouldOpenSlashPaletteAtCursor(match, STUDIO_SLASH_COMMANDS), true);
			});

			it('apre la palette con sottocomandi per comandi che li supportano', () => {
				const match = { query: 'thinking ', startIndex: 0, endIndex: 9 };
				assert.equal(shouldOpenSlashPaletteAtCursor(match, STUDIO_SLASH_COMMANDS), true);
			});

			it('non apre se il comando con spazio non ha sottocomandi', () => {
				const match = { query: 'new ', startIndex: 0, endIndex: 4 };
				assert.equal(shouldOpenSlashPaletteAtCursor(match, STUDIO_SLASH_COMMANDS), false);
			});
		});

		describe('insertSlashCommandAtCursor', () => {
			it('sostituisce il token e posiziona il cursore dopo il comando con spazio', () => {
				const text = 'Prima /thi dopo';
				const res = insertSlashCommandAtCursor(text, 6, 10, 'thinking');
				assert.equal(res.newText, 'Prima /thinking  dopo');
				assert.equal(res.newCursorPos, 16);
			});
		});
	});

	describe('Formattazione token (formatTokens)', () => {
		it('formatta numeri piccoli come stringa', () => {
			assert.equal(formatTokens(0), '0');
			assert.equal(formatTokens(450), '450');
			assert.equal(formatTokens(999), '999');
		});

		it('formatta migliaia con suffisso k', () => {
			assert.equal(formatTokens(1000), '1.0k');
			assert.equal(formatTokens(28877), '28.9k');
			assert.equal(formatTokens(25092), '25.1k');
		});

		it('formatta milioni con suffisso M', () => {
			assert.equal(formatTokens(1000000), '1.0M');
			assert.equal(formatTokens(2500000), '2.5M');
		});

		it('gestisce valori null o undefined', () => {
			assert.equal(formatTokens(undefined), '0');
		});
	});
});
