import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chooseWorker, cloudPlatforms, mergeWorker, readWorkerManifest } from '../scripts/nightly-remote.mjs';

const BRIDGE = { url: 'http://127.0.0.1:1', token: 't' };

/** Bridge finto: risponde per verbo e registra le chiamate. */
function fakeBridge(replies: Record<string, (body: Record<string, unknown>) => unknown>) {
	const calls: { verb: string; body: Record<string, unknown> }[] = [];
	const fetchImpl = (async (url: string, init: { body: string }) => {
		const verb = String(url).split('/').pop() ?? '';
		const body = JSON.parse(init.body) as Record<string, unknown>;
		calls.push({ verb, body });
		const reply = replies[verb];
		if (!reply) throw new Error(`verbo inatteso ${verb}`);
		const details = reply(body);
		return details instanceof Error
			? { status: 400, json: async () => ({ ok: false, text: details.message }) }
			: { status: 200, json: async () => ({ ok: true, details }) };
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

const mac = { id: 'm', name: 'MacBook', online: true, platform: 'macos' };
const pc = { id: 'w', name: 'PC', online: true, platform: 'windows' };

describe('Build Nightly distribuita (R-MI-37)', () => {
	it('fuori da Studio o senza macchine abbinate resta la Nightly di prima', async () => {
		assert.equal((await chooseWorker({ bridge: null, localPlatform: 'macos' })).mode, 'none');
		const { fetchImpl } = fakeBridge({ elenco: () => ({ machines: [] }) });
		assert.equal((await chooseWorker({ bridge: BRIDGE, localPlatform: 'macos', fetchImpl })).mode, 'none');
		assert.equal((await chooseWorker({ bridge: BRIDGE, localPlatform: 'linux', fetchImpl })).mode, 'none');
	});

	it("affida l'altra piattaforma alla macchina in linea con quel sistema", async () => {
		const { fetchImpl, calls } = fakeBridge({ elenco: () => ({ machines: [mac, pc] }), pronta: () => ({}) });
		const choice = await chooseWorker({ bridge: BRIDGE, localPlatform: 'macos', fetchImpl });
		assert.equal(choice.mode, 'machine');
		assert.equal(choice.machine.id, 'w');
		assert.ok(!calls.some((call) => call.verb === 'chiedi'), 'nessuna domanda se la macchina c\'e\'');
	});

	it('con la macchina spenta chiede a Studio, e «attendi» aspetta finche\' torna', async () => {
		let round = 0;
		const offline = { ...pc, online: false, platform: null };
		const { fetchImpl, calls } = fakeBridge({
			elenco: () => ({ machines: round++ < 2 ? [offline] : [pc] }),
			pronta: () => ({}),
			chiedi: () => ({ scelta: 'attendi' })
		});
		const logs: string[] = [];
		const choice = await chooseWorker({ bridge: BRIDGE, localPlatform: 'macos', fetchImpl, pollMs: 1, log: (line: string) => logs.push(line) });
		assert.equal(choice.mode, 'machine');
		const asked = calls.find((call) => call.verb === 'chiedi');
		assert.deepEqual(asked?.body, { macchina: 'PC', piattaforma: 'windows', locale: 'macos' });
		assert.deepEqual(logs, ['In attesa di una macchina windows collegata...']);
	});

	it('mostra il motivo del Mac in linea e distingue i cambiamenti durante «attendi»', async () => {
		const motivo = 'The macOS signing identity is unavailable';
		const offline = { ...mac, id: 'm-offline', name: 'Mac spento', online: false };
		const macbook = { ...mac, name: 'MacBook Air' };
		const listing = [[offline, macbook], [offline, macbook], [offline], [offline, macbook]];
		let probes = 0;
		const logs: string[] = [];
		const { fetchImpl, calls } = fakeBridge({
			elenco: () => {
				const machines = listing.shift();
				assert.ok(machines, 'non deve interrogare il bridge dopo che il Mac è pronto');
				return { machines };
			},
			pronta: () => probes++ < 2 ? new Error(motivo) : {},
			chiedi: () => ({ scelta: 'attendi' })
		});
		const choice = await chooseWorker({ bridge: BRIDGE, localPlatform: 'windows', fetchImpl, pollMs: 1, log: (line: string) => logs.push(line) });
		assert.equal(choice.mode, 'machine');
		assert.equal(choice.machine.id, macbook.id);
		assert.deepEqual(calls.filter((call) => call.verb === 'chiedi').map((call) => call.body), [
			{ macchina: 'MacBook Air', piattaforma: 'macos', locale: 'windows', motivo }
		]);
		assert.deepEqual(logs, [
			`MacBook Air è in linea, ma non è pronta per la Nightly macos: ${motivo}`,
			`In attesa che MacBook Air sia pronta per la Nightly macos (è in linea): ${motivo}`,
			'In attesa di una macchina macos collegata...'
		]);
	});

	it('le scelte cloud e solo-locale decidono cosa compila il cloud; annulla interrompe', async () => {
		for (const [scelta, mode] of [['cloud', 'cloud'], ['locale', 'local']] as const) {
			const { fetchImpl } = fakeBridge({ elenco: () => ({ machines: [{ ...pc, online: false }] }), chiedi: () => ({ scelta }) });
			assert.equal((await chooseWorker({ bridge: BRIDGE, localPlatform: 'macos', fetchImpl })).mode, mode);
		}
		const { fetchImpl } = fakeBridge({ elenco: () => ({ machines: [{ ...pc, online: false }] }), chiedi: () => ({ scelta: 'annulla' }) });
		await assert.rejects(chooseWorker({ bridge: BRIDGE, localPlatform: 'macos', fetchImpl }), /annullata/);

		const all = ['windows', 'macos', 'linux'];
		assert.deepEqual(cloudPlatforms({ all, local: 'macos', remote: { mode: 'machine', platform: 'windows', ok: true } }), ['linux']);
		assert.deepEqual(cloudPlatforms({ all, local: 'macos', remote: { mode: 'machine', platform: 'windows', ok: false } }), ['windows', 'linux'], 'build remota fallita: ripiego sul cloud');
		assert.deepEqual(cloudPlatforms({ all, local: 'macos', remote: { mode: 'local', platform: 'windows' } }), ['linux']);
		assert.deepEqual(cloudPlatforms({ all, local: 'macos', remote: { mode: 'cloud', platform: 'windows' } }), ['windows', 'linux']);
		assert.deepEqual(cloudPlatforms({ all, local: 'windows', remote: null }), ['macos', 'linux']);
	});

	it('unisce gli installer remoti solo con la stessa versione e lo stesso commit', () => {
		const dir = mkdtempSync(join(tmpdir(), 'omp-nightly-remote-'));
		try {
			const remote = join(dir, 'remote');
			const staging = join(dir, 'staging');
			mkdirSync(remote);
			mkdirSync(staging);
			writeFileSync(join(remote, 'OMP.Studio_1.0.0-nightly.5_x64-setup.exe'), 'exe');
			const manifest = { platform: 'windows', version: '1.0.0-nightly.5', commit: 'abc',
				installers: [{ name: 'OMP.Studio_1.0.0-nightly.5_x64-setup.exe', size: 3, sha256: 'ff' }] };
			writeFileSync(join(remote, 'worker.json'), JSON.stringify(manifest));
			const read = readWorkerManifest(remote, [join(remote, 'worker.json'), join(remote, manifest.installers[0].name)]);
			const staged: { name: string }[] = [{ name: 'OMP.Studio_1.0.0-nightly.5_universal.dmg' }];
			const checksums: Record<string, string> = { 'OMP.Studio_1.0.0-nightly.5_universal.dmg': 'aa' };
			const sha256Lines: string[] = ['aa  OMP.Studio_1.0.0-nightly.5_universal.dmg'];
			assert.throws(() => mergeWorker({ manifest: read, version: '1.0.0-nightly.6', commit: 'abc', stagingDir: staging, staged, checksums, sha256Lines }), /Versione/);
			assert.throws(() => mergeWorker({ manifest: read, version: '1.0.0-nightly.5', commit: 'def', stagingDir: staging, staged, checksums, sha256Lines }), /Commit/);
			mergeWorker({ manifest: read, version: '1.0.0-nightly.5', commit: 'abc', stagingDir: staging, staged, checksums, sha256Lines });
			assert.deepEqual(Object.keys(checksums).sort(), ['OMP.Studio_1.0.0-nightly.5_universal.dmg', 'OMP.Studio_1.0.0-nightly.5_x64-setup.exe']);
			assert.equal(staged.length, 2);
			assert.equal(sha256Lines.length, 2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
