import './setup.ts';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import type { RemoteCommand } from '../../src/protocol.ts';
import {
	formatArtifactBytes,
	mapArtifactError,
	publishPrototype,
	PreviewStore,
	PROTOTYPE_MAX_BYTES
} from '../src/preview.svelte.ts';
import { connection } from '../src/connection.svelte.ts';
import { t } from '../src/i18n.ts';
describe('formatArtifactBytes', () => {
	it('formats byte numbers accurately', () => {
		expect(formatArtifactBytes(0)).toBe('0 B');
		expect(formatArtifactBytes(512)).toBe('512 B');
		expect(formatArtifactBytes(1024)).toBe('1.0 KB');
		expect(formatArtifactBytes(1536)).toBe('1.5 KB');
		expect(formatArtifactBytes(24 * 1024)).toBe('24 KB');
		expect(formatArtifactBytes(1024 * 1024)).toBe('1.0 MB');
		expect(formatArtifactBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
	});

	it('handles null, undefined and invalid numbers safely', () => {
		expect(formatArtifactBytes(undefined)).toBe('');
		expect(formatArtifactBytes(null)).toBe('');
		expect(formatArtifactBytes(-1)).toBe('');
		expect(formatArtifactBytes(NaN)).toBe('');
	});
});

describe('mapArtifactError', () => {
	it('maps CommandErrorCode values to localized descriptions', () => {
		expect(mapArtifactError({ code: 'rejected' })).toBe(t('previewErrorRejected'));
		expect(mapArtifactError({ code: 'not_found' })).toBe(t('previewErrorNotFound'));
		expect(mapArtifactError({ code: 'host_offline' })).toBe(t('chatMachineOffline'));
		expect(mapArtifactError({ code: 'timeout' })).toBe(t('previewErrorFetch'));
	});

	it('preserves specific error messages when distinct from code', () => {
		expect(mapArtifactError({ code: 'failed', message: 'Custom failure message' })).toBe(
			'Custom failure message'
		);
		expect(mapArtifactError('String error message')).toBe('String error message');
		expect(mapArtifactError(null)).toBe(t('previewError'));
	});
});

describe('publishPrototype', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('rejects prototypes exceeding max threshold client-side', async () => {
		const hugeCode = 'x'.repeat(PROTOTYPE_MAX_BYTES + 10);
		await expect(publishPrototype(hugeCode, 'Too big')).rejects.toThrow(t('previewErrorQuota'));
	});


	it('maps 413 HTTP status to quota error', async () => {
		globalThis.fetch = (async () => {
			return new Response('Payload too large', { status: 413 });
		}) as unknown as typeof fetch;

		await expect(publishPrototype('<div>Hello</div>')).rejects.toThrow(t('previewErrorQuota'));
	});

	it('extracts error message from structured { error: { code, message } } response', async () => {
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({ error: { code: 'compilation_failed', message: 'Syntax error' } }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as unknown as typeof fetch;

		await expect(publishPrototype('<div>Hello</div>')).rejects.toThrow('Syntax error');
	});

	it('extracts error message from 4xx string error response', async () => {
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({ error: 'Relay rejected prototype' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as unknown as typeof fetch;

		await expect(publishPrototype('<div>Hello</div>')).rejects.toThrow('Relay rejected prototype');
	});

	it('handles network fetch errors gracefully', async () => {
		globalThis.fetch = (async () => {
			throw new Error('Connection refused');
		}) as unknown as typeof fetch;

		await expect(publishPrototype('<div>Hello</div>')).rejects.toThrow(t('previewErrorPublish'));
	});
});

describe('PreviewStore state and caching', () => {
	let store: InstanceType<typeof PreviewStore>;
	let originalSendCommand: typeof connection.sendCommand;

	beforeEach(() => {
		store = new PreviewStore({
			hostId: 'host-1',
			projectId: 'proj-1',
			laneId: 'lane-1',
			isHistory: false
		});
		originalSendCommand = connection.sendCommand;
	});

	afterEach(() => {
		connection.sendCommand = originalSendCommand;
	});

	it('starts closed with empty state', () => {
		expect(store.isOpen).toBe(false);
		expect(store.current).toBeNull();
		expect(store.isLoading).toBe(false);
		expect(store.error).toBeNull();
	});

	it('opens artifact with inline content immediately without commands', async () => {
		let commandCalled = false;
		connection.sendCommand = async () => {
			commandCalled = true;
			return {};
		};

		await store.open({
			kind: 'mermaid',
			title: 'Inline Diagram',
			content: 'graph TD; A-->B;'
		});

		expect(store.isOpen).toBe(true);
		expect(store.isLoading).toBe(false);
		expect(store.error).toBeNull();
		expect(store.current?.kind).toBe('mermaid');
		expect(store.current?.content).toBe('graph TD; A-->B;');
		expect(commandCalled).toBe(false);
	});

	it('resolves content === null through get_artifact and caches by messageId', async () => {
		let commandCalls = 0;
		connection.sendCommand = (async (_hostId: string, cmd: RemoteCommand) => {
			commandCalls++;
			if (cmd.kind === 'get_artifact') {
				expect(cmd.kind).toBe('get_artifact');
				expect(cmd.messageId).toBe('msg-artifact-1');
			}
			return {
				artifact: {
					kind: 'svg',
					title: 'Cached Icon',
					bytes: 400,
					content: '<svg><circle cx="5" cy="5" r="5"/></svg>'
				}
			};
		}) as unknown as typeof connection.sendCommand;

		// Prima apertura: chiama get_artifact
		await store.open({
			kind: 'svg',
			title: 'Icon SVG',
			content: null,
			messageId: 'msg-artifact-1'
		});

		expect(store.isOpen).toBe(true);
		expect(store.error).toBeNull();
		expect(store.current?.content).toBe('<svg><circle cx="5" cy="5" r="5"/></svg>');
		expect(commandCalls).toBe(1);

		// Chiusura e seconda apertura dello stesso messageId: usa la cache
		store.close();
		expect(store.isOpen).toBe(false);

		await store.open({
			kind: 'svg',
			title: 'Icon SVG Again',
			content: null,
			messageId: 'msg-artifact-1'
		});

		expect(store.isOpen).toBe(true);
		expect(store.current?.content).toBe('<svg><circle cx="5" cy="5" r="5"/></svg>');
		expect(commandCalls).toBe(1); // Nessuna seconda chiamata remota!
	});

	it('shows previewErrorTooLarge in historical sessions without calling get_artifact', async () => {
		let commandCalled = false;
		connection.sendCommand = async () => {
			commandCalled = true;
			return {};
		};

		store.setRouteContext({
			hostId: 'host-1',
			projectId: 'proj-1',
			laneId: null,
			isHistory: true
		});

		await store.open({
			kind: 'mermaid',
			title: 'Old Diagram',
			content: null,
			messageId: 'msg-hist-1'
		});

		expect(store.isOpen).toBe(true);
		expect(store.isLoading).toBe(false);
		expect(store.error).toBe(t('previewErrorTooLarge'));
		expect(commandCalled).toBe(false);
	});

	it('maps CommandError rejected (artifact > 384 KiB) properly', async () => {
		connection.sendCommand = (async () => {
			throw { code: 'rejected', message: 'Payload too large' };
		}) as unknown as typeof connection.sendCommand;

		await store.open({
			kind: 'svg',
			title: 'Huge SVG',
			content: null,
			messageId: 'msg-too-large'
		});

		expect(store.isOpen).toBe(true);
		expect(store.error).toBe(t('previewErrorRejected'));
	});

	it('maps CommandError not_found properly', async () => {
		connection.sendCommand = (async () => {
			throw { code: 'not_found', message: 'Expired' };
		}) as unknown as typeof connection.sendCommand;

		await store.open({
			kind: 'mermaid',
			title: 'Gone Diagram',
			content: null,
			messageId: 'msg-gone'
		});

		expect(store.isOpen).toBe(true);
		expect(store.error).toBe(t('previewErrorNotFound'));
	});

	it('resets state completely on close', async () => {
		await store.open({
			kind: 'mermaid',
			title: 'Test',
			content: 'graph TD; A-->B;'
		});
		expect(store.isOpen).toBe(true);

		store.close();
		expect(store.isOpen).toBe(false);
		expect(store.current).toBeNull();
		expect(store.error).toBeNull();
		expect(store.isLoading).toBe(false);
		expect(store.previewUrl).toBeNull();
		expect(store.showSource).toBe(false);
	});

	it('ignores a failed request superseded by another preview', async () => {
		const { promise: pending, reject: rejectRequest } = Promise.withResolvers<never>();
		connection.sendCommand = (() => pending) as typeof connection.sendCommand;
		const obsolete = store.open({ kind: 'svg', title: 'Old', content: null, messageId: 'old' });
		await store.open({ kind: 'mermaid', title: 'New', content: 'graph TD; A-->B' });
		rejectRequest({ code: 'not_found' });
		await obsolete;
		expect(store.current?.title).toBe('New');
		expect(store.current?.content).toBe('graph TD; A-->B');
		expect(store.error).toBeNull();
		expect(store.isLoading).toBe(false);
	});

	it('does not install a published URL after closing or opening another artifact', async () => {
		const originalFetch = globalThis.fetch;
		const { promise: pending, resolve: resolveRequest } = Promise.withResolvers<Response>();
		globalThis.fetch = (() => pending) as unknown as typeof fetch;
		try {
			const obsolete = store.open({ kind: 'html', title: 'Old HTML', content: '<p>old</p>' });
			store.close();
			await store.open({ kind: 'svg', title: 'New SVG', content: '<svg/>' });
			resolveRequest(Response.json({ url: '/p/obsolete/' }));
			await obsolete;
			expect(store.current?.kind).toBe('svg');
			expect(store.previewUrl).toBeNull();
			expect(store.isLoading).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
