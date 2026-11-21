import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BackendRouteError, invoke, type InvokeArgs } from '../src/lib/backend/ipc.ts';

// Confine IPC reale di Tauri, come nei test del ciclo di vita RPC. Nessun
// backend remoto finto: una destinazione remota non deve toccare il disco locale.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let calls: Array<{ command: string; args?: InvokeArgs; options?: unknown }>;
let handler: (command: string, args?: InvokeArgs) => Promise<unknown>;

beforeEach(() => {
	calls = [];
	handler = async () => undefined;
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			__TAURI_INTERNALS__: {
				invoke(command: string, args?: InvokeArgs, options?: unknown) {
					calls.push({ command, args, options });
					return handler(command, args);
				}
			}
		}
	});
});

afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
});

describe('Destinazione delle operazioni di progetto', () => {
	it('non salva un file sul disco locale quando la macchina richiesta non e raggiungibile', async () => {
		await assert.rejects(
			invoke('file_write', { projectPath: 'C:/work/site', rel: 'index.html', content: 'nuovo' }, { machine: 'windows' }),
			(error: unknown) => error instanceof BackendRouteError && error.reason === 'machine_unreachable'
		);
		assert.deepEqual(calls, []);
	});

	it('non apre processi locali o aggiorna Studio per una destinazione remota', async () => {
		for (const [command, reason] of [
			['rpc_open', 'machine_unreachable'],
			['install_studio_update_and_restart', 'local_only'],
			['studio_update_remote_start', 'machine_unreachable']
		] as const) {
			await assert.rejects(invoke(command, undefined, { machine: 'mac' }), (error: unknown) =>
				error instanceof BackendRouteError && error.command === command &&
				error.machine === 'mac' && error.reason === reason
			);
		}
		assert.deepEqual(calls, []);
	});

	it('conserva i byte e gli header degli allegati binari locali', async () => {
		const bytes = Uint8Array.of(0, 255, 128, 10);
		const headers = { 'x-session-key': 'chat-1', 'x-file-name': 'image.png' };
		handler = async (_command, args) => {
			assert.strictEqual(args, bytes);
			assert.deepEqual(calls[0].options, { headers });
			return { path: '/tmp/chat-1/image.png', size: bytes.byteLength };
		};
		const staged = await invoke<{ path: string; size: number }>('stage_chat_attachment', bytes, {
			machine: 'local', headers
		});
		assert.equal(staged.path, '/tmp/chat-1/image.png');
		assert.equal(staged.size, 4);
	});

	it('mantiene gli errori strutturati di Git per le conferme di perdita di lavoro', async () => {
		const refusal = { code: 'confirmation_required', message: 'Unintegrated work' };
		handler = async () => { throw refusal; };
		await assert.rejects(
			invoke('worktree_delete_lane_branch', { projectPath: '/work/site', laneId: 'feature' }),
			(error: unknown) => error === refusal
		);
	});
});
