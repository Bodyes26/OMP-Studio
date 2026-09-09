import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseWireEvent,
	isWireEvent,
	isWireResponse,
	isAnswerableUiMethod,
	formatWireCommand,
	StreamBatcher,
	type RpcCommand,
	type AgentSessionEvent,
	type DeltaBatchItem
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
		it('serializza prompt con streamingBehavior steer e followUp', () => {
			const steerPrompt: RpcCommand = {
				type: 'prompt',
				message: 'Interrompi e fai X',
				streamingBehavior: 'steer'
			};
			const parsedSteer = JSON.parse(formatWireCommand(steerPrompt, 'p1'));
			assert.equal(parsedSteer.id, 'p1');
			assert.equal(parsedSteer.type, 'prompt');
			assert.equal(parsedSteer.streamingBehavior, 'steer');

			const followUpPrompt: RpcCommand = {
				type: 'prompt',
				message: 'Accoda per dopo',
				streamingBehavior: 'followUp'
			};
			const parsedFollowUp = JSON.parse(formatWireCommand(followUpPrompt, 'p2'));
			assert.equal(parsedFollowUp.id, 'p2');
			assert.equal(parsedFollowUp.type, 'prompt');
			assert.equal(parsedFollowUp.streamingBehavior, 'followUp');
		});

		it('serializza i comandi per le tre modalita di coda omp', () => {
			const steerCmd: RpcCommand = { type: 'set_steering_mode', mode: 'all' };
			const parsedSteer = JSON.parse(formatWireCommand(steerCmd, 'q1'));
			assert.equal(parsedSteer.type, 'set_steering_mode');
			assert.equal(parsedSteer.mode, 'all');

			const followUpCmd: RpcCommand = { type: 'set_follow_up_mode', mode: 'one-at-a-time' };
			const parsedFollowUp = JSON.parse(formatWireCommand(followUpCmd, 'q2'));
			assert.equal(parsedFollowUp.type, 'set_follow_up_mode');
			assert.equal(parsedFollowUp.mode, 'one-at-a-time');

			const interruptCmd: RpcCommand = { type: 'set_interrupt_mode', mode: 'wait' };
			const parsedInterrupt = JSON.parse(formatWireCommand(interruptCmd, 'q3'));
			assert.equal(parsedInterrupt.type, 'set_interrupt_mode');
			assert.equal(parsedInterrupt.mode, 'wait');
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

	describe('StreamBatcher e classificazione delta', () => {
		it('raggruppa delta consecutivi con la stessa chiave', () => {
			const flushed: DeltaBatchItem[][] = [];
			let rafCb: (() => void) | null = null;
			Reflect.set(globalThis, 'window', {
				requestAnimationFrame: (cb: () => void) => {
					rafCb = cb;
					return 1;
				},
				setTimeout: () => 1,
				clearTimeout: () => {},
				cancelAnimationFrame: () => {}
			});
			try {
				const batcher = new StreamBatcher((items) => flushed.push(items), 100);
				batcher.push('text', 0, 'Ciao ');
				batcher.push('text', 0, 'mondo');
				assert.equal(flushed.length, 0);
				rafCb?.();
				assert.equal(flushed.length, 1);
				assert.equal(flushed[0].length, 1);
				assert.equal(flushed[0][0].kind, 'text');
				assert.equal(flushed[0][0].contentIndex, 0);
				assert.equal(flushed[0][0].delta, 'Ciao mondo');
			} finally {
				Reflect.deleteProperty(globalThis, 'window');
			}
		});

		it('distingue indici e tipologie diverse nello stesso ciclo di batch', () => {
			const flushed: DeltaBatchItem[][] = [];
			let rafCb: (() => void) | null = null;
			Reflect.set(globalThis, 'window', {
				requestAnimationFrame: (cb: () => void) => {
					rafCb = cb;
					return 1;
				},
				setTimeout: () => 1,
				clearTimeout: () => {},
				cancelAnimationFrame: () => {}
			});
			try {
				const batcher = new StreamBatcher((items) => flushed.push(items), 1000);
				batcher.push('thinking', 0, 'Sto pensando...');
				batcher.push('text', 1, 'Risposta parziale');
				rafCb?.();
				assert.equal(flushed.length, 1);
				assert.equal(flushed[0].length, 2);
				assert.equal(flushed[0][0].kind, 'thinking');
				assert.equal(flushed[0][0].contentIndex, 0);
				assert.equal(flushed[0][1].kind, 'text');
				assert.equal(flushed[0][1].contentIndex, 1);
			} finally {
				Reflect.deleteProperty(globalThis, 'window');
			}
		});

		it('filtra delta di tipo toolcall evitando la creazione di falsi blocchi di ragionamento', () => {
			// Simula il comportamento di filtering adottato in session.svelte.ts:
			// solo 'text' e 'thinking' vengono propagati nei blocchi assistente.
			const assistantBlocks: Array<{ type: 'text' | 'thinking'; text: string }> = [];
			function applyDeltaFilter(kind: string, index: number, delta: string) {
				if (kind !== 'text' && kind !== 'thinking') return;
				const existing = assistantBlocks[index];
				if (existing && existing.type === kind) {
					existing.text += delta;
					return;
				}
				assistantBlocks[index] = { type: kind, text: delta };
			}

			// 1. Thinking delta
			applyDeltaFilter('thinking', 0, 'Analisi in corso...');
			// 2. Text delta
			applyDeltaFilter('text', 1, 'Risultato trovato.');
			// 3. Toolcall deltas (generati quando il modello emette gli argomenti JSON del tool)
			applyDeltaFilter('toolcall', 2, '{"command": "git status"}');
			applyDeltaFilter('toolcall', 3, '{"path": "foo.txt"}');

			// Verifichiamo che i toolcall non abbiano creato blocchi fantasma
			assert.equal(assistantBlocks.length, 2);
			assert.equal(assistantBlocks[0].type, 'thinking');
			assert.equal(assistantBlocks[0].text, 'Analisi in corso...');
			assert.equal(assistantBlocks[1].type, 'text');
			assert.equal(assistantBlocks[1].text, 'Risultato trovato.');
			assert.equal(assistantBlocks[2], undefined);
		});
	});
});
