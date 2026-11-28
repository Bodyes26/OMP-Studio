import { describe, expect, it } from 'bun:test';
import { InboundWatchdog, type WatchdogClock } from '../src/watchdog.ts';

/** Orologio finto: i timer scattano solo quando il test avanza il tempo. */
function fakeClock() {
	let now = 1_000;
	let nextHandle = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();

	const clock: WatchdogClock = {
		now: () => now,
		set: (fn, ms) => {
			const handle = nextHandle++;
			timers.set(handle, { at: now + ms, fn });
			return handle;
		},
		clear: (handle) => {
			timers.delete(handle);
		}
	};

	/** Avanza il tempo facendo scattare i timer in ordine, come farebbe il browser. */
	function advance(ms: number): void {
		const target = now + ms;
		for (;;) {
			let due: { handle: number; at: number; fn: () => void } | null = null;
			for (const [handle, timer] of timers) {
				if (timer.at <= target && (!due || timer.at < due.at)) due = { handle, ...timer };
			}
			if (!due) break;
			timers.delete(due.handle);
			now = due.at;
			due.fn();
		}
		now = target;
	}

	return { clock, advance, get armedCount() { return timers.size; } };
}

function setup(options: { hidden?: () => boolean } = {}) {
	const fake = fakeClock();
	let timeouts = 0;
	let hidden = options.hidden ?? (() => false);
	const watchdog = new InboundWatchdog({
		timeoutMs: 70_000,
		isSuspended: () => hidden(),
		onTimeout: () => {
			timeouts += 1;
		},
		clock: fake.clock
	});
	return {
		watchdog,
		advance: fake.advance,
		get timeouts() {
			return timeouts;
		},
		setHidden(value: boolean) {
			hidden = () => value;
		},
		get armed() {
			return watchdog.armed;
		}
	};
}

describe('Watchdog dell\'attesa in ingresso (S10-09)', () => {
	it('chiude quando nessun frame arriva entro il timeout', () => {
		const t = setup();
		t.watchdog.touch();
		t.advance(69_999);
		expect(t.timeouts).toBe(0);
		t.advance(1);
		expect(t.timeouts).toBe(1);
	});

	it('un frame in arrivo rimanda la scadenza di una finestra piena', () => {
		const t = setup();
		t.watchdog.touch();
		t.advance(60_000);
		t.watchdog.touch();
		t.advance(60_000);
		expect(t.timeouts).toBe(0);
		t.advance(10_000);
		expect(t.timeouts).toBe(1);
	});

	it('con la pagina nascosta non chiude e decide al ritorno', () => {
		const t = setup({ hidden: () => true });
		t.watchdog.touch();
		// Mezz'ora nascosta: il relay puo' aver trattenuto i frame.
		t.advance(30 * 60_000);
		expect(t.timeouts).toBe(0);

		// Al ritorno il conteggio riparte: nessuna chiusura immediata...
		t.setHidden(false);
		t.watchdog.resume();
		t.advance(69_999);
		expect(t.timeouts).toBe(0);
		// ...e la finestra piena vale di nuovo.
		t.advance(1);
		expect(t.timeouts).toBe(1);
	});

	it('un timer scattato durante la sospensione non chiude un socket sano', () => {
		const t = setup();
		t.watchdog.touch();
		// La pagina va in background senza che il gestore di visibilitychange
		// sia ancora passato sul DOM: il timer scade comunque.
		t.watchdog.suspend();
		t.advance(70_000);
		expect(t.timeouts).toBe(0);
	});

	it('stop ferma ogni decisione pendente', () => {
		const t = setup();
		t.watchdog.touch();
		t.watchdog.stop();
		expect(t.armed).toBe(false);
		t.advance(10 * 60_000);
		expect(t.timeouts).toBe(0);
	});
});
