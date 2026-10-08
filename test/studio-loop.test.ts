import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	LoopEngine,
	conditionVerdict,
	findSavedLoop,
	formatLoopCommand,
	matchLoopCommand,
	parseControl,
	parseLoopArgs,
	quoteShellWord,
	readShellWord,
	resolveConditionShell,
	summarizeOutput,
	type ConditionRun,
	type LoopSnapshot,
	type LoopState
} from '../extensions/studio-loop.ts';

describe('studio-loop: parser compatibile con /loop di omp', () => {
	it('limite, condizione e prompt come la TUI', () => {
		assert.deepEqual(parseLoopArgs("6 --until 'npm test' correggi il primo test"), {
			limit: { kind: 'iterations', iterations: 6 },
			condition: { command: 'npm test', until: true },
			prompt: 'correggi il primo test'
		});
		assert.deepEqual(parseLoopArgs('10m'), { limit: { kind: 'duration', durationMs: 600_000 } });
		assert.deepEqual(parseLoopArgs('1h30m vai'), { limit: { kind: 'duration', durationMs: 5_400_000 }, prompt: 'vai' });
		assert.deepEqual(parseLoopArgs('10 minutes ciao'), { limit: { kind: 'duration', durationMs: 600_000 }, prompt: 'ciao' });
		assert.deepEqual(parseLoopArgs('--while "git diff --quiet"'), {
			condition: { command: 'git diff --quiet', until: false }
		});
		assert.deepEqual(parseLoopArgs('continua a lavorare'), { prompt: 'continua a lavorare' });
		assert.deepEqual(parseLoopArgs(''), {});
	});

	it('--between solo Studio', () => {
		assert.deepEqual(parseLoopArgs('3 --between compact fai'), {
			limit: { kind: 'iterations', iterations: 3 },
			between: 'compact',
			prompt: 'fai'
		});
		assert.equal(typeof parseLoopArgs('--between boh x'), 'string');
	});

	it('errori: un refuso non diventa prompt', () => {
		assert.equal(typeof parseLoopArgs('-1 x'), 'string');
		assert.equal(typeof parseLoopArgs('1.5h x'), 'string');
		assert.equal(typeof parseLoopArgs('--until'), 'string');
		assert.equal(typeof parseLoopArgs("--until 'npm test"), 'string');
		assert.equal(typeof parseLoopArgs("--until a --while b"), 'string');
		assert.equal(typeof parseLoopArgs('--forever x'), 'string');
		assert.equal(typeof parseLoopArgs('5q x'), 'string');
	});

	it('readShellWord e quote fanno andata e ritorno', () => {
		assert.deepEqual(readShellWord(`'a b' resto`), { value: 'a b', rest: 'resto' });
		assert.deepEqual(readShellWord(`"x \\"y\\"" z`), { value: 'x "y"', rest: 'z' });
		assert.equal(readShellWord('   '), undefined);
		for (const cmd of ['npm test', "grep -q 'ok' log.txt", 'test -f a && echo "b"', 'bun']) {
			const word = readShellWord(quoteShellWord(cmd));
			assert.ok(word && word !== 'unterminated');
			assert.equal(word.value, cmd);
		}
	});

	it('formatLoopCommand e parseLoopArgs coincidono', () => {
		const args = {
			limit: { kind: 'iterations' as const, iterations: 6 },
			condition: { command: "grep -q 'x' f", until: true },
			between: 'compact' as const,
			prompt: 'Lancia npm test e correggi'
		};
		const line = formatLoopCommand(args);
		assert.ok(line.startsWith('/loop 6 --until '));
		assert.deepEqual(parseLoopArgs(matchLoopCommand(line)!), args);
		assert.equal(formatLoopCommand({ limit: { kind: 'duration', durationMs: 5_400_000 }, prompt: 'p' }), '/loop 1h30m p');
		assert.equal(formatLoopCommand({ between: 'prompt', prompt: 'p' }), '/loop p');
	});

	it('riconosce i comandi della GUI', () => {
		assert.equal(matchLoopCommand('/loop'), '');
		assert.equal(matchLoopCommand('/LOOP 3 x'), '3 x');
		assert.equal(matchLoopCommand('/loopy'), null);
		assert.deepEqual(parseControl('/studio-loop pause'), { op: 'pause', arg: '' });
		assert.deepEqual(parseControl("/studio-loop probe npm test"), { op: 'probe', arg: 'npm test' });
		assert.deepEqual(parseControl('/studio-loop'), { op: 'status', arg: '' });
		assert.equal(parseControl('/studio-loopx'), null);
	});
});

describe('studio-loop: condizione e shell', () => {
	const run = (exit: number | null, extra: Partial<ConditionRun> = {}): ConditionRun => ({
		exit,
		out: '',
		timedOut: false,
		aborted: false,
		...extra
	});
	it('exit 0/1 sono risposte, il resto e\' una condizione rotta', () => {
		const until = { command: 'x', until: true };
		const whileCond = { command: 'x', until: false };
		assert.equal(conditionVerdict(until, run(0)).kind, 'halt');
		assert.equal(conditionVerdict(until, run(1)).kind, 'continue');
		assert.equal(conditionVerdict(whileCond, run(0)).kind, 'continue');
		assert.equal(conditionVerdict(whileCond, run(1)).kind, 'halt');
		assert.deepEqual(conditionVerdict(until, run(127)), { kind: 'error', reason: 'condition-error' });
		assert.deepEqual(conditionVerdict(until, run(null, { timedOut: true })), {
			kind: 'error',
			reason: 'condition-timeout'
		});
		assert.equal(conditionVerdict(until, run(null, { aborted: true })).kind, 'aborted');
		assert.equal(conditionVerdict(until, run(null, { error: 'spawn' })).kind, 'error');
	});

	it('riassume l\'ultima riga senza ANSI', () => {
		assert.equal(summarizeOutput('\u001b[32mok\u001b[0m\n\n# fail 3\n'), '# fail 3');
		assert.equal(summarizeOutput('x'.repeat(300), 10).length, 10);
	});

	it('Windows: Git Bash come omp, poi PATH, poi cmd', () => {
		const env = { ProgramFiles: 'C:\\Program Files', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
		const git = resolveConditionShell('win32', env, (p) => p === 'C:\\Program Files\\Git\\bin\\bash.exe', () => null);
		assert.equal(git.shell, 'C:\\Program Files\\Git\\bin\\bash.exe');
		assert.deepEqual(git.args('npm test'), ['-c', 'npm test']);
		const onPath = resolveConditionShell('win32', env, () => false, (n) => (n === 'bash.exe' ? 'D:\\tools\\bash.exe' : null));
		assert.equal(onPath.shell, 'D:\\tools\\bash.exe');
		const cmd = resolveConditionShell('win32', env, () => false, () => null);
		assert.equal(cmd.shell, 'C:\\Windows\\system32\\cmd.exe');
		assert.deepEqual(cmd.args('npm test'), ['/d', '/s', '/c', 'npm test']);
		const posix = resolveConditionShell('linux', { SHELL: '/usr/bin/zsh' }, () => true, () => null);
		assert.equal(posix.shell, '/usr/bin/zsh');
	});
});

/** Motore guidato a mano: orologio, timer e condizione finti. */
function harness(conditionExits: number[] = []) {
	let now = 1_000;
	let idle = true;
	const timers: Array<{ cb: () => void; at: number; id: number }> = [];
	let nextId = 1;
	const sent: string[] = [];
	const published: LoopSnapshot[] = [];
	const persisted: (LoopState | null)[] = [];
	const conditionCalls: string[] = [];
	let aborts = 0;
	let compacts = 0;
	const engine = new LoopEngine({
		now: () => now,
		setTimer: (cb, ms) => {
			const id = nextId++;
			timers.push({ cb, at: now + ms, id });
			return id;
		},
		clearTimer: (h) => {
			const i = timers.findIndex((t) => t.id === h);
			if (i !== -1) timers.splice(i, 1);
		},
		newId: () => 'loop-1',
		isIdle: () => idle,
		abort: () => {
			aborts++;
		},
		sendPrompt: (t) => {
			sent.push(t);
		},
		compact: async () => {
			compacts++;
		},
		runCondition: async (cmd) => {
			conditionCalls.push(cmd);
			const exit = conditionExits.shift() ?? 1;
			return { exit, out: exit ? `${exit} falliti` : 'ok', timedOut: false, aborted: false };
		},
		publish: (s) => published.push(JSON.parse(JSON.stringify(s))),
		persist: (l) => persisted.push(l ? JSON.parse(JSON.stringify(l)) : null)
	});
	const flush = async () => {
		for (let i = 0; i < 10; i++) await Promise.resolve();
	};
	return {
		engine,
		sent,
		published,
		persisted,
		conditionCalls,
		get aborts() {
			return aborts;
		},
		get compacts() {
			return compacts;
		},
		setIdle: (v: boolean) => (idle = v),
		advance: async (ms: number) => {
			now += ms;
			const due = timers.filter((t) => t.at <= now);
			for (const t of due) {
				timers.splice(timers.indexOf(t), 1);
				t.cb();
			}
			await flush();
		},
		flush
	};
}

describe('studio-loop: motore', () => {
	it('limite di giri: tre prompt, poi conclusa', async () => {
		const h = harness();
		h.engine.start({ limit: { kind: 'iterations', iterations: 3 }, prompt: 'fai' });
		assert.equal(h.engine.loop?.status, 'running');
		assert.deepEqual(h.sent, ['fai']);
		for (let i = 0; i < 3; i++) {
			h.engine.onAgentEnd(false);
			assert.equal(h.engine.loop?.status, 'waiting');
			await h.advance(800);
		}
		assert.equal(h.sent.length, 3);
		assert.equal(h.engine.loop?.status, 'done');
		assert.equal(h.engine.loop?.end?.reason, 'limit');
		assert.ok(h.persisted.length > 0);
	});

	it('--until: il controllo parte dal secondo giro e ferma con exit 0', async () => {
		const h = harness([1, 0]);
		h.engine.start({
			limit: { kind: 'iterations', iterations: 6 },
			condition: { command: 'npm test', until: true },
			prompt: 'correggi'
		});
		assert.equal(h.conditionCalls.length, 0);
		h.engine.onAgentEnd(false);
		await h.advance(800);
		assert.equal(h.conditionCalls.length, 1);
		assert.equal(h.engine.loop?.giro, 2);
		assert.equal(h.engine.loop?.giri[0].check?.exit, 1);
		h.engine.onAgentEnd(false);
		await h.advance(800);
		assert.equal(h.engine.loop?.status, 'done');
		assert.equal(h.engine.loop?.end?.reason, 'condition');
		assert.equal(h.engine.loop?.giri[1].check?.exit, 0);
		assert.equal(h.sent.length, 2);
	});

	it('il limite esaurito ferma prima di eseguire la condizione', async () => {
		const h = harness([1]);
		h.engine.start({ limit: { kind: 'iterations', iterations: 1 }, condition: { command: 'x', until: true }, prompt: 'p' });
		h.engine.onAgentEnd(false);
		await h.advance(800);
		assert.equal(h.conditionCalls.length, 0);
		assert.equal(h.engine.loop?.end?.reason, 'limit');
	});

	it('condizione rotta (exit 127): errore con spiegazione', async () => {
		const h = harness([127]);
		h.engine.start({ condition: { command: 'nonesiste', until: true }, prompt: 'p' });
		h.engine.onAgentEnd(false);
		await h.advance(800);
		assert.equal(h.engine.loop?.status, 'error');
		assert.equal(h.engine.loop?.end?.reason, 'condition-error');
		assert.equal(h.engine.loop?.end?.exit, 127);
	});

	it('durata: scade e conclude', async () => {
		const h = harness();
		h.engine.start({ limit: { kind: 'duration', durationMs: 1000 }, prompt: 'p' });
		h.engine.onAgentEnd(false);
		await h.advance(1500);
		assert.equal(h.engine.loop?.end?.reason, 'duration');
	});

	it('Pausa durante un giro scatta a fine giro; Riprendi rifa\' il controllo', async () => {
		const h = harness([1, 1]);
		h.engine.start({ condition: { command: 'npm test', until: true }, prompt: 'p' });
		h.engine.pause();
		assert.equal(h.engine.loop?.status, 'running');
		assert.equal(h.engine.loop?.pauseRequested, true);
		h.engine.onAgentEnd(false);
		assert.equal(h.engine.loop?.status, 'paused');
		await h.advance(5000);
		assert.equal(h.sent.length, 1);
		h.engine.resume();
		await h.flush();
		assert.equal(h.conditionCalls.length, 1);
		assert.equal(h.engine.loop?.status, 'running');
		assert.equal(h.sent.length, 2);
	});

	it('Pausa due volte durante il giro la annulla', () => {
		const h = harness();
		h.engine.start({ prompt: 'p' });
		h.engine.pause();
		h.engine.pause();
		assert.equal(h.engine.loop?.pauseRequested, false);
	});

	it('Stop interrompe subito il turno in corso', () => {
		const h = harness();
		h.engine.start({ limit: { kind: 'iterations', iterations: 6 }, prompt: 'p' });
		h.setIdle(false);
		h.engine.stop();
		assert.equal(h.aborts, 1);
		assert.equal(h.engine.loop?.status, 'stopped');
		assert.equal(h.engine.loop?.giri[0].aborted, true);
		// L'agent_end dell'abort non riapre nulla.
		h.engine.onAgentEnd(true);
		assert.equal(h.engine.loop?.status, 'stopped');
		assert.equal(h.engine.active, false);
	});

	it('un abort esterno (Esc) mette in pausa come la TUI', () => {
		const h = harness();
		h.engine.start({ prompt: 'p' });
		h.engine.onAgentEnd(true);
		assert.equal(h.engine.loop?.status, 'paused');
	});

	it('agente occupato fra i giri: aspetta e riprova', async () => {
		const h = harness();
		h.engine.start({ prompt: 'p' });
		h.engine.onAgentEnd(false);
		h.setIdle(false);
		await h.advance(800);
		assert.equal(h.sent.length, 1);
		h.setIdle(true);
		await h.advance(800);
		assert.equal(h.sent.length, 2);
	});

	it('--between compact compatta prima del giro; reset aspetta la sessione nuova', async () => {
		const h = harness();
		h.engine.start({ between: 'compact', prompt: 'p' });
		h.engine.onAgentEnd(false);
		await h.advance(800);
		assert.equal(h.compacts, 1);
		assert.equal(h.sent.length, 2);

		const r = harness();
		r.engine.start({ between: 'reset', prompt: 'p' });
		r.engine.onAgentEnd(false);
		await r.advance(800);
		assert.equal(r.engine.loop?.status, 'resetting');
		assert.equal(r.sent.length, 1);
		r.engine.onResetDone();
		assert.equal(r.sent.length, 2);
	});

	it('/loop senza prompt resta armato e adotta il messaggio successivo', () => {
		const h = harness();
		h.engine.start({ limit: { kind: 'iterations', iterations: 2 } });
		assert.equal(h.engine.loop?.status, 'armed');
		assert.equal(h.engine.adoptPrompt('scrivi i test'), true);
		assert.equal(h.engine.loop?.status, 'running');
		assert.equal(h.engine.loop?.giro, 1);
		// Il messaggio passa da solo: il motore non lo rimanda.
		assert.equal(h.sent.length, 0);
	});

	it('non parte a turno in corso: il primo giro sarebbe uno steer', () => {
		const h = harness();
		h.setIdle(false);
		assert.equal(h.engine.start({ prompt: 'p' }).ok, false);
		assert.equal(h.sent.length, 0);
		assert.equal(h.engine.loop, null);
	});

	it('un secondo avvio con loop attivo e\' rifiutato', () => {
		const h = harness();
		h.engine.start({ prompt: 'p' });
		assert.equal(h.engine.start({ prompt: 'q' }).ok, false);
	});

	it('resume: un loop salvato vivo torna in pausa, mai in corsa', () => {
		const h = harness();
		h.engine.start({ limit: { kind: 'iterations', iterations: 5 }, prompt: 'p' });
		const saved = h.persisted[h.persisted.length - 1];
		const entries = [
			{ type: 'message' },
			{ type: 'custom', customType: 'studio-loop', data: { loop: saved } },
			{ type: 'custom', customType: 'altro', data: {} }
		];
		const found = findSavedLoop(entries);
		assert.equal(found?.id, 'loop-1');
		const other = harness();
		other.engine.restore(found);
		assert.equal(other.engine.loop?.status, 'paused');
		assert.equal(other.engine.loop?.restored, true);
		assert.equal(other.engine.loop?.giri[0].aborted, true);
		assert.equal(other.sent.length, 0);
		assert.equal(findSavedLoop([{ type: 'custom', customType: 'studio-loop', data: { loop: null } }]), null);
	});

	it('Prova ora riporta exit e output senza toccare il loop', async () => {
		const h = harness([1]);
		await h.engine.runProbe('npm test');
		assert.equal(h.engine.probe?.running, false);
		assert.equal(h.engine.probe?.exit, 1);
		assert.equal(h.engine.probe?.out, '1 falliti');
		assert.equal(h.engine.loop, null);
		assert.ok(h.published.some((s) => s.probe?.running === true));
	});

	it('Chiudi toglie un loop finito, non uno vivo', () => {
		const h = harness();
		h.engine.start({ prompt: 'p' });
		assert.equal(h.engine.dismiss().ok, false);
		h.engine.stop();
		assert.equal(h.engine.dismiss().ok, true);
		assert.equal(h.engine.loop, null);
		assert.equal(h.persisted[h.persisted.length - 1], null);
	});
});

describe('studio-loop: solo nella chat GUI', () => {
	it('riconosce omp --mode rpc-ui, non la TUI', async () => {
		const { isGuiProcess } = await import('../extensions/studio-loop.ts');
		assert.equal(isGuiProcess(['bun', 'omp', '--mode', 'rpc-ui', '--cwd', 'x']), true);
		assert.equal(isGuiProcess(['omp', '--mode=rpc-ui']), true);
		assert.equal(isGuiProcess(['omp', '--config', 'a.yml', '-e', 'x.ts']), false);
	});
});
