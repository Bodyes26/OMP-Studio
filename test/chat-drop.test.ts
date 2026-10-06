/**
 * File trascinati dal sistema operativo nella chat: posizione, nomi, limiti,
 * header dell'IPC grezzo e menzione `@` con percorso assoluto.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_DROP_IMAGE_BYTES,
	MAX_STAGED_ATTACHMENT_BYTES,
	base64ToBlob,
	dropSummary,
	isPreviewableImagePath,
	pathBaseName,
	physicalToCssPoint,
	readImageErrorCode,
	readImageErrorMessage,
	stageAttachmentHeaders,
	uniquePaths
} from '../src/lib/agent/chatDrop.ts';
import { fileBadgeLabel, parsePlainTextToSegments, segmentsToWireText } from '../src/lib/agent/composerDoc.ts';
import { findFileMentions } from '../src/lib/agent/fileMentionSyntax.ts';

describe('Trascinamento nella chat', () => {
	it('converte la posizione fisica di Tauri in pixel CSS', () => {
		assert.deepEqual(physicalToCssPoint({ x: 300, y: 150 }, 1.5), { x: 200, y: 100 });
		assert.deepEqual(physicalToCssPoint({ x: 40, y: 20 }, 0), { x: 40, y: 20 });
		assert.deepEqual(physicalToCssPoint({ x: 40, y: 20 }, Number.NaN), { x: 40, y: 20 });
	});

	it('mostra il nome con separatori Windows e POSIX', () => {
		assert.equal(pathBaseName('C:\\Users\\Ada\\Documenti\\piano finale.docx'), 'piano finale.docx');
		assert.equal(pathBaseName('/home/ada/progetto/src/'), 'src');
		assert.equal(fileBadgeLabel('src/lib/agent/chatDrop.ts'), 'chatDrop.ts');
	});

	it('riconosce le immagini da allegare anche come anteprima', () => {
		for (const path of ['a.png', 'B.JPG', 'c.jpeg', 'd.gif', 'C:\\x\\e.webp']) {
			assert.equal(isPreviewableImagePath(path), true, path);
		}
		for (const path of ['a.svg', 'b.bmp', 'c.pdf', 'cartella', 'png']) {
			assert.equal(isPreviewableImagePath(path), false, path);
		}
		assert.equal(MAX_DROP_IMAGE_BYTES, 5 * 1024 * 1024);
		assert.equal(MAX_STAGED_ATTACHMENT_BYTES, 50 * 1024 * 1024);
	});

	it('scarta i doppioni e riassume i nomi', () => {
		assert.deepEqual(uniquePaths(['C:\\a\\b.ts', 'c:/a/B.ts', ' ', '/x/y']), ['C:\\a\\b.ts', '/x/y']);
		assert.equal(dropSummary(['/a/uno.ts', '/a/due.ts']), 'uno.ts, due.ts');
		assert.equal(dropSummary(['/1', '/2', '/3', '/4', '/5']), '1, 2, 3 +2');
	});

	it('il percorso assoluto diventa una menzione @ che omp e il composer rileggono', () => {
		const windows = 'C:\\Users\\Ada\\Dati condivisi\\report finale.pdf';
		const posix = '/home/ada/progetto/src/main.ts';
		const folder = 'D:\\Lavoro\\cartella';
		const wire = segmentsToWireText([
			{ t: 'text', s: 'Confronta' },
			{ t: 'file', path: windows },
			{ t: 'file', path: posix },
			{ t: 'file', path: folder }
		]);
		assert.equal(
			wire,
			'Confronta @"C:/Users/Ada/Dati condivisi/report finale.pdf" @/home/ada/progetto/src/main.ts @D:/Lavoro/cartella'
		);
		assert.deepEqual(
			findFileMentions(wire).map((mention) => mention.path),
			['C:/Users/Ada/Dati condivisi/report finale.pdf', posix, 'D:/Lavoro/cartella']
		);
		// Una bozza ripristinata ricrea i badge, non testo semplice.
		const segments = parsePlainTextToSegments(wire);
		assert.equal(segments.filter((seg) => seg.t === 'file').length, 3);
	});

	it('gli header dell\'IPC grezzo sono ASCII anche con nomi accentati', () => {
		const headers = stageAttachmentHeaders('lane:proj:main', 'nota è "finale".txt');
		assert.equal(headers['x-omp-session-key'], 'lane%3Aproj%3Amain');
		assert.equal(decodeURIComponent(headers['x-omp-file-name']), 'nota è "finale".txt');
		for (const value of Object.values(headers)) assert.match(value, /^[\x20-\x7e]*$/);
	});

	it('legge codice e messaggio degli errori di chat_attachment_read_image', () => {
		assert.equal(readImageErrorCode({ code: 'too_large', message: 'oltre' }), 'too_large');
		assert.equal(readImageErrorCode({ code: 'boh' }), null);
		assert.equal(readImageErrorCode('stringa'), null);
		assert.equal(readImageErrorMessage({ code: 'io', message: 'negato' }), 'negato');
		assert.equal(readImageErrorMessage(new Error('x')), 'x');
	});

	it('ricostruisce i byte dell\'immagine letta da Rust', async () => {
		const blob = base64ToBlob(Buffer.from([1, 2, 250]).toString('base64'), 'image/png');
		assert.equal(blob.type, 'image/png');
		assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 250]);
	});
});
