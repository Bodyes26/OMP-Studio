import { getContext, setContext } from 'svelte';
import { invoke, LOCAL_MACHINE, type MachineId } from './ipc.ts';
import { openExternalUrl } from '#lib/utils/openExternal.ts';

export interface PreviewSource {
	machine: MachineId;
	project: string;
	owner: string;
}

const CHAT_PREVIEW = Symbol('studio-remote-preview');
export const provideChatPreview = (source: () => PreviewSource) => setContext(CHAT_PREVIEW, source);
export const chatPreview = () => getContext<(() => PreviewSource) | undefined>(CHAT_PREVIEW);

export function loopbackUrl(input: string): URL | null {
	const text = input.trim();
	const match = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})(?=[/?#]|$)/i.exec(text);
	if (!match || Number(match[1]) === 0) return null;
	try { return new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`); }
	catch { return null; }
}

interface Request { source: PreviewSource; input: string; }

export const remotePreview = $state<{ request: Request | null; error: string | null; busy: boolean }>({ request: null, error: null, busy: false });

export function requestPreview(source: PreviewSource, input = ''): boolean {
	if (source.machine === LOCAL_MACHINE || !source.project || (input && !loopbackUrl(input))) return false;
	if (!remotePreview.busy) {
		remotePreview.error = null;
		remotePreview.request = { source, input };
	}
	return true;
}

export async function openPreview(input: string, external: boolean): Promise<void> {
	const request = remotePreview.request;
	const url = loopbackUrl(/^\d{1,5}$/.test(input.trim()) ? `localhost:${input.trim()}` : input);
	if (!request || !url || remotePreview.busy) return;
	const { source } = request;
	remotePreview.error = null;
	remotePreview.busy = true;
	let id: string | undefined;
	try {
		const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
		const forward = await invoke<{ id: string; localPort: number }>('link_forward_open', { ...source, port }, { machine: LOCAL_MACHINE });
		id = forward.id;
		if (remotePreview.request !== request) {
			await invoke('link_forward_close', { id }, { machine: LOCAL_MACHINE });
			return;
		}
		url.hostname = '127.0.0.1';
		url.port = String(forward.localPort);
		if (external) {
			if (!await openExternalUrl(url.href)) throw new Error('Could not open the system browser');
		} else {
			await invoke('link_forward_window', { id, url: url.href, title: request.input || input }, { machine: LOCAL_MACHINE });
		}
		remotePreview.request = null;
	} catch (error) {
		if (id) await invoke('link_forward_close', { id }, { machine: LOCAL_MACHINE }).catch(() => {});
		if (remotePreview.request === request) remotePreview.error = String(error);
	} finally {
		remotePreview.busy = false;
	}
}

export function closePreviews(owner: string): void {
	if (remotePreview.request?.source.owner === owner) remotePreview.request = null;
	void invoke('link_forward_close', { owner }, { machine: LOCAL_MACHINE }).catch(() => {});
}
