/**
 * Anteprime visuali dei tool per la PWA del controllo remoto.
 *
 * Studio le mostra al centro (diagrammi, SVG, prototipi) o sotto la card del
 * file scritto; la PWA riceve lo stesso contenuto dentro `RemoteToolCall.artifact`
 * e lo disegna in una superficie propria. Il contenuto si legge dagli argomenti
 * del tool, gli stessi che usa la GUI: niente accesso al disco, quindi nessun
 * percorso arrivato da un dispositivo viene mai aperto.
 */

import {
	ARTIFACT_INLINE_MAX_BYTES,
	ARTIFACT_MAX_BYTES,
	type RemoteArtifact,
	type RemoteArtifactKind
} from '$remote-protocol';
import type { ToolEntry } from '$lib/agent/session.svelte';
import { asRecord, str } from '$lib/agent/tools/types';
import { isSvgContent, isSvgFileName } from '$lib/editor/svgSandbox';
import { RemoteCommandFailure } from './commands';

const encoder = new TextEncoder();

/**
 * Stessa regola di `isMermaidFileName` (`$lib/mermaidSvg`), che qui non si puo'
 * importare: `mermaidSvg` tira dentro `$lib/theme`, che usa `import.meta.glob`
 * e non gira nei test su Node.
 */
function isMermaidPath(path: string): boolean {
	const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
	return ext === 'mmd' || ext === 'mermaid';
}
function basename(path: string): string {
	return path.split(/[\\/]/).pop() || path;
}

interface RawArtifact {
	kind: RemoteArtifactKind;
	title: string;
	content: string;
}

function rawArtifact(entry: ToolEntry): RawArtifact | null {
	// Un tool ancora in corso o fallito non ha prodotto niente da mostrare.
	if (entry.running || entry.result?.isError === true) return null;
	const args = entry.args ?? {};

	if (entry.toolName === 'studio_diagram') {
		const mermaid = str(args.mermaid);
		if (!mermaid) return null;
		return { kind: 'mermaid', title: str(args.title) ?? 'Diagramma', content: mermaid };
	}

	if (entry.toolName === 'studio_preview') {
		const code = str(args.code);
		if (!code) return null;
		const target = str(args.targetFile);
		const kind: RemoteArtifactKind = isSvgFileName(target) || isSvgContent(code) ? 'svg' : 'html';
		return { kind, title: str(args.title) ?? (target ? basename(target) : 'Anteprima'), content: code };
	}

	if (entry.toolName === 'write') {
		const content = str(args.content);
		const path =
			str(asRecord(entry.result?.details)?.resolvedPath) ?? str(args.path) ?? str(args.file);
		if (!content || !path) return null;
		if (isSvgFileName(path)) return { kind: 'svg', title: basename(path), content };
		if (isMermaidPath(path)) return { kind: 'mermaid', title: basename(path), content };
	}
	return null;
}

/**
 * Anteprima per il messaggio del transcript: il contenuto viaggia solo se resta
 * sotto `ARTIFACT_INLINE_MAX_BYTES`, per non gonfiare le pagine di storico
 * (tetto di 200 KB a pagina); oltre, la PWA lo chiede con `get_artifact`.
 */
export function artifactForToolEntry(entry: ToolEntry): RemoteArtifact | null {
	const raw = rawArtifact(entry);
	if (!raw) return null;
	const bytes = encoder.encode(raw.content).length;
	return {
		kind: raw.kind,
		title: raw.title,
		bytes,
		content: bytes <= ARTIFACT_INLINE_MAX_BYTES ? raw.content : null
	};
}

/** Anteprima completa per `get_artifact`; rifiuta i contenuti che non entrerebbero in un frame. */
export function fullArtifactForToolEntry(entry: ToolEntry): RemoteArtifact {
	const raw = rawArtifact(entry);
	if (!raw) {
		throw new RemoteCommandFailure('not_found', 'Il messaggio non ha un\'anteprima disponibile');
	}
	const bytes = encoder.encode(raw.content).length;
	// JSON raddoppia virgolette e barre e puo' espandere i caratteri di controllo:
	// il solo conteggio UTF-8 non garantisce il tetto del frame WebSocket.
	const serializedBytes = encoder.encode(JSON.stringify(raw)).length;
	if (bytes > ARTIFACT_MAX_BYTES || serializedBytes > 480 * 1024) {
		throw new RemoteCommandFailure(
			'rejected',
			`Anteprima troppo grande per il controllo remoto (${Math.ceil(bytes / 1024)} KB)`
		);
	}
	return { kind: raw.kind, title: raw.title, bytes, content: raw.content };
}
