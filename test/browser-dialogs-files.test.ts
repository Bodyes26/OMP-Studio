/**
 * S45 — dialoghi, popup, file, capability e registrazione: contratto lato Studio.
 *
 * Qui si fissa il comportamento osservabile del mirror `browser-live-v1`: gli
 * stati che Studio deve saper disegnare, i messaggi che sa spedire e — soprattutto
 * — quelli che deve rifiutare. Il parsing severo e' meta' della sicurezza: uno
 * stato malformato che passa diventa un consenso mostrato per la cosa sbagliata.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	BROWSER_CAPABILITIES,
	BROWSER_LIVE_ERROR_CODES,
	type BrowserCapabilityState,
	type BrowserDialogState,
	type BrowserDownloadState,
	type BrowserFileChooserState,
	type BrowserLiveClientMessage,
	type BrowserRecordingState,
	type BrowserTabState,
	parseBrowserCapabilityState,
	parseBrowserDialogState,
	parseBrowserDownloadState,
	parseBrowserFileChooserState,
	normalizeBrowserLiveEvent,
	parseBrowserLiveClientMessage,
	parseBrowserLiveServerMessage,
	parseBrowserRecordingState,
	parseBrowserTabState
} from '../src/lib/agent/browser-live.ts';

const dialog: BrowserDialogState = {
	dialogId: 'dlg-1',
	tabId: 'chat-001::main',
	kind: 'confirm',
	message: 'Vuoi procedere?',
	defaultPrompt: '',
	url: 'https://example.test/app',
	openedAtMs: 1_700_000_000_000,
	status: 'open'
};

const download: BrowserDownloadState = {
	downloadId: 'guid-1',
	tabId: 'chat-001::main',
	url: 'https://cdn.example.test/report.pdf',
	suggestedFilename: 'report.pdf',
	origin: 'https://cdn.example.test',
	status: 'pending-consent',
	receivedBytes: 2048,
	totalBytes: 2048,
	startedAtMs: 1_700_000_000_000
};

const chooser: BrowserFileChooserState = {
	chooserId: 'fc-1',
	tabId: 'chat-001::main',
	mode: 'single',
	status: 'pending-choice',
	fileNames: [],
	openedAtMs: 1_700_000_000_000
};

const capability: BrowserCapabilityState = {
	capability: 'geolocation',
	origin: 'https://example.test',
	decision: 'denied',
	decidedAtMs: 1_700_000_000_000
};

const recording: BrowserRecordingState = {
	recordingId: 'rec-1',
	tabId: 'chat-001::main',
	status: 'recording',
	path: 'C:/artifacts/rec-1.avi',
	startedAtMs: 1_700_000_000_000,
	frameCount: 0,
	bytes: 224
};

describe('S45 — dialoghi, popup, file e registrazione', () => {
	describe('codici di errore del contratto', () => {
		it('espone i codici S45 senza perdere quelli precedenti', () => {
			for (const code of [
				'DIALOG_NOT_FOUND',
				'DIALOG_ALREADY_SETTLED',
				'DOWNLOAD_NOT_FOUND',
				'DOWNLOAD_NOT_ALLOWED',
				'FILE_CHOOSER_NOT_FOUND',
				'UPLOAD_NOT_AUTHORIZED',
				'CAPABILITY_NOT_GRANTED',
				'RECORDING_ALREADY_ACTIVE',
				'RECORDING_NOT_ACTIVE',
				'RECORDING_FAILED'
			]) {
				assert.ok(BROWSER_LIVE_ERROR_CODES.includes(code as never), `codice mancante: ${code}`);
			}
			assert.ok(BROWSER_LIVE_ERROR_CODES.includes('ORIGIN_NOT_ALLOWED'));
			assert.ok(BROWSER_LIVE_ERROR_CODES.includes('PRIVATE_TAKEOVER_ACTIVE'));
		});

		it('espone i codici diagnostici Relay senza perdere il fail-closed', () => {
			for (const code of [
				'RELAY_UNAVAILABLE',
				'RELAY_TARGET_NOT_FOUND',
				'RELAY_CAPABILITY_UNAVAILABLE',
				'RELAY_REVOKED'
			]) {
				assert.ok(BROWSER_LIVE_ERROR_CODES.includes(code as never), `codice mancante: ${code}`);
			}
		});
	});

	describe('stato dialogo', () => {
		it('accetta uno stato completo e ne conserva i campi', () => {
			assert.deepEqual(parseBrowserDialogState(dialog), dialog);
		});

		it('accetta la risposta con responder e testo del prompt', () => {
			const answered: BrowserDialogState = {
				...dialog,
				kind: 'prompt',
				status: 'accepted',
				responder: 'user',
				promptText: 'valore',
				settledAtMs: 1_700_000_000_500
			};
			assert.deepEqual(parseBrowserDialogState(answered), answered);
		});

		it('rifiuta tipo, stato e responder fuori enum', () => {
			assert.equal(parseBrowserDialogState({ ...dialog, kind: 'toast' }), null);
			assert.equal(parseBrowserDialogState({ ...dialog, status: 'chiuso' }), null);
			assert.equal(parseBrowserDialogState({ ...dialog, dialogId: '' }), null);
			assert.equal(parseBrowserDialogState({ ...dialog, openedAtMs: -1 }), null);
			assert.equal(parseBrowserDialogState(null), null);
		});

		it('ignora un responder non riconosciuto invece di inventarlo', () => {
			const parsed = parseBrowserDialogState({ ...dialog, responder: 'chatbot' });
			assert.ok(parsed);
			assert.equal(parsed.responder, undefined);
		});
	});

	describe('stato download', () => {
		it('accetta lo stato in attesa di consenso', () => {
			assert.deepEqual(parseBrowserDownloadState(download), download);
		});

		it('accetta lo stato concluso con il percorso dell artifact', () => {
			const completed: BrowserDownloadState = {
				...download,
				status: 'completed',
				artifactPath: 'C:/artifacts/report.pdf',
				settledAtMs: 1_700_000_001_000
			};
			assert.deepEqual(parseBrowserDownloadState(completed), completed);
		});

		it('rifiuta stati e contatori non validi', () => {
			assert.equal(parseBrowserDownloadState({ ...download, status: 'quarantena' }), null);
			assert.equal(parseBrowserDownloadState({ ...download, receivedBytes: -1 }), null);
			assert.equal(parseBrowserDownloadState({ ...download, suggestedFilename: 7 }), null);
		});
	});

	describe('stato selettore file', () => {
		it('accetta la scelta autorizzata con i soli nomi base', () => {
			const authorized: BrowserFileChooserState = {
				...chooser,
				status: 'authorized',
				fileNames: ['contratto.pdf'],
				settledAtMs: 1_700_000_001_000
			};
			assert.deepEqual(parseBrowserFileChooserState(authorized), authorized);
		});

		it('rifiuta modalita sconosciute e nomi non stringa', () => {
			assert.equal(parseBrowserFileChooserState({ ...chooser, mode: 'directory' }), null);
			assert.equal(parseBrowserFileChooserState({ ...chooser, fileNames: [1] }), null);
			assert.equal(parseBrowserFileChooserState({ ...chooser, fileNames: 'a.txt' }), null);
		});
	});

	describe('stato capability', () => {
		it('copre tutte e quattro le capability distinte', () => {
			assert.deepEqual([...BROWSER_CAPABILITIES], [
				'clipboard-read',
				'clipboard-write',
				'geolocation',
				'notifications'
			]);
			for (const name of BROWSER_CAPABILITIES) {
				const parsed = parseBrowserCapabilityState({ ...capability, capability: name });
				assert.ok(parsed, `capability non riconosciuta: ${name}`);
				assert.equal(parsed.capability, name);
			}
		});

		it('rifiuta capability e decisioni fuori contratto', () => {
			assert.equal(parseBrowserCapabilityState({ ...capability, capability: 'camera' }), null);
			assert.equal(parseBrowserCapabilityState({ ...capability, decision: 'forse' }), null);
			assert.equal(parseBrowserCapabilityState({ ...capability, origin: '' }), null);
		});
	});

	describe('stato registrazione', () => {
		it('accetta il ciclo di vita completo con percorso e contatori', () => {
			const completed: BrowserRecordingState = {
				...recording,
				status: 'completed',
				stoppedAtMs: 1_700_000_005_000,
				frameCount: 42,
				bytes: 384_000
			};
			assert.deepEqual(parseBrowserRecordingState(completed), completed);
		});

		it('accetta zero fotogrammi ma rifiuta contatori negativi', () => {
			assert.ok(parseBrowserRecordingState({ ...recording, frameCount: 0, bytes: 0 }));
			assert.equal(parseBrowserRecordingState({ ...recording, frameCount: -1 }), null);
			assert.equal(parseBrowserRecordingState({ ...recording, status: 'in-pausa' }), null);
		});
	});

	describe('tab popup', () => {
		const base: BrowserTabState = {
			projectId: 'proj-1f3a',
			chatSessionId: 'chat-001',
			browserSessionId: 'managed-proj-1f3a',
			tabId: 'chat-001::main#popup1',
			mode: 'managed',
			controller: 'agent',
			controlEpoch: 0,
			url: 'https://example.test/popup',
			title: 'Popup',
			loading: false,
			originPermission: 'granted',
			viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
			streamState: 'live'
		};

		it('conserva openerTabId quando la pagina ha aperto la tab', () => {
			const popup = { ...base, openerTabId: 'chat-001::main' };
			assert.deepEqual(parseBrowserTabState(popup), popup);
		});

		it('resta compatibile con una tab senza opener', () => {
			const parsed = parseBrowserTabState(base);
			assert.ok(parsed);
			assert.equal(parsed.openerTabId, undefined);
		});

		it('scarta un openerTabId vuoto invece di propagarlo', () => {
			const parsed = parseBrowserTabState({ ...base, openerTabId: '' });
			assert.ok(parsed);
			assert.equal(parsed.openerTabId, undefined);
		});
	});

	describe('messaggi client S45', () => {
		it('accetta le risposte ai dialoghi con e senza testo', () => {
			assert.deepEqual(parseBrowserLiveClientMessage({ type: 'dialog_respond', dialogId: 'dlg-1', accept: false }), {
				type: 'dialog_respond',
				dialogId: 'dlg-1',
				accept: false
			});
			assert.deepEqual(
				parseBrowserLiveClientMessage({
					type: 'dialog_respond',
					dialogId: 'dlg-1',
					accept: true,
					promptText: 'ciao'
				}),
				{ type: 'dialog_respond', dialogId: 'dlg-1', accept: true, promptText: 'ciao' }
			);
		});

		it('rifiuta una risposta senza esito booleano o senza id', () => {
			assert.equal(parseBrowserLiveClientMessage({ type: 'dialog_respond', dialogId: 'dlg-1' }), null);
			assert.equal(parseBrowserLiveClientMessage({ type: 'dialog_respond', dialogId: '', accept: true }), null);
			assert.equal(
				parseBrowserLiveClientMessage({ type: 'dialog_respond', dialogId: 'x', accept: true, promptText: 3 }),
				null
			);
		});

		it('accetta la decisione sul download e rifiuta quella senza esito', () => {
			assert.deepEqual(parseBrowserLiveClientMessage({ type: 'download_decide', downloadId: 'g', allow: true }), {
				type: 'download_decide',
				downloadId: 'g',
				allow: true
			});
			assert.equal(parseBrowserLiveClientMessage({ type: 'download_decide', downloadId: 'g' }), null);
		});

		it('rifiuta una autorizzazione upload senza percorsi', () => {
			assert.deepEqual(parseBrowserLiveClientMessage({ type: 'authorize_upload', chooserId: 'fc', paths: ['/a'] }), {
				type: 'authorize_upload',
				chooserId: 'fc',
				paths: ['/a']
			});
			assert.equal(parseBrowserLiveClientMessage({ type: 'authorize_upload', chooserId: 'fc', paths: [] }), null);
			assert.equal(parseBrowserLiveClientMessage({ type: 'authorize_upload', chooserId: 'fc', paths: [''] }), null);
			assert.equal(parseBrowserLiveClientMessage({ type: 'authorize_upload', chooserId: 'fc' }), null);
		});

		it('accetta solo capability e decisioni del contratto', () => {
			assert.deepEqual(
				parseBrowserLiveClientMessage({ type: 'set_capability', capability: 'clipboard-read', decision: 'granted' }),
				{ type: 'set_capability', capability: 'clipboard-read', decision: 'granted' }
			);
			assert.equal(
				parseBrowserLiveClientMessage({ type: 'set_capability', capability: 'midi', decision: 'granted' }),
				null
			);
		});

		it('accetta i comandi di registrazione', () => {
			assert.deepEqual(parseBrowserLiveClientMessage({ type: 'start_recording' }), { type: 'start_recording' });
			assert.deepEqual(parseBrowserLiveClientMessage({ type: 'stop_recording' }), { type: 'stop_recording' });
		});

		it('continua a rifiutare un tipo sconosciuto', () => {
			const unknown = { type: 'delete_everything' } as unknown as BrowserLiveClientMessage;
			assert.equal(parseBrowserLiveClientMessage(unknown), null);
		});
	});

	describe('messaggi server S45', () => {
		it('instrada ogni stato sul proprio messaggio', () => {
			assert.deepEqual(parseBrowserLiveServerMessage({ type: 'dialog_state', dialog }), {
				type: 'dialog_state',
				dialog
			});
			assert.deepEqual(parseBrowserLiveServerMessage({ type: 'download_state', download }), {
				type: 'download_state',
				download
			});
			assert.deepEqual(parseBrowserLiveServerMessage({ type: 'file_chooser_state', chooser }), {
				type: 'file_chooser_state',
				chooser
			});
			assert.deepEqual(parseBrowserLiveServerMessage({ type: 'capability_state', capability }), {
				type: 'capability_state',
				capability
			});
			assert.deepEqual(parseBrowserLiveServerMessage({ type: 'recording_state', recording }), {
				type: 'recording_state',
				recording
			});
		});

		it('scarta il messaggio quando il payload non e valido', () => {
			assert.equal(parseBrowserLiveServerMessage({ type: 'dialog_state', dialog: { ...dialog, kind: 'x' } }), null);
			assert.equal(parseBrowserLiveServerMessage({ type: 'download_state' }), null);
			assert.equal(
				parseBrowserLiveServerMessage({ type: 'recording_state', recording: { ...recording, status: 'x' } }),
				null
			);
		});
	});

	describe('eventi del backend Tauri', () => {
		it('scarta gli stati fuori contratto invece di disegnarli', () => {
			assert.equal(
				normalizeBrowserLiveEvent({ type: 'dialog_state', dialog: { ...dialog, kind: 'toast' } as never }),
				null
			);
			assert.equal(
				normalizeBrowserLiveEvent({
					type: 'download_state',
					download: { ...download, status: 'quasi' } as never
				}),
				null
			);
			assert.equal(
				normalizeBrowserLiveEvent({
					type: 'capability_state',
					capability: { ...capability, decision: 'forse' } as never
				}),
				null
			);
		});

		it('conserva gli stati validi e gli eventi senza payload annidato', () => {
			assert.deepEqual(normalizeBrowserLiveEvent({ type: 'dialog_state', dialog }), {
				type: 'dialog_state',
				dialog
			});
			assert.deepEqual(normalizeBrowserLiveEvent({ type: 'disconnected' }), { type: 'disconnected' });
			assert.deepEqual(
				normalizeBrowserLiveEvent({ type: 'error', code: 'DIALOG_ALREADY_SETTLED', message: 'x' }),
				{ type: 'error', code: 'DIALOG_ALREADY_SETTLED', message: 'x' }
			);
		});
	});
});
