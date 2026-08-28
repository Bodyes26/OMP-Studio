import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedExternalUrl } from '../src/lib/utils/externalUrl.ts';

describe('Allowlist dei protocolli per gli URL esterni', () => {
	it('ammette solo http, https e mailto', () => {
		assert.equal(isAllowedExternalUrl('https://github.com/can1357/oh-my-pi'), true);
		assert.equal(isAllowedExternalUrl('http://localhost:1420/'), true);
		assert.equal(isAllowedExternalUrl('mailto:qualcuno@example.com'), true);
	});

	it('rifiuta gli schemi che raggiungono risorse locali o eseguono codice', () => {
		// Sono gli indirizzi che un contenuto remoto potrebbe far arrivare
		// dentro un evento RPC o un risultato di tool.
		assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
		assert.equal(isAllowedExternalUrl('file://C:/Windows/System32/cmd.exe'), false);
		assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
		assert.equal(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>'), false);
		assert.equal(isAllowedExternalUrl('vscode://file/etc/hosts'), false);
		assert.equal(isAllowedExternalUrl('ms-msdt:/id PCWDiagnostic'), false);
		assert.equal(isAllowedExternalUrl('smb://server/share'), false);
	});

	it('rifiuta valori non stringa, vuoti, relativi o malformati', () => {
		assert.equal(isAllowedExternalUrl(null), false);
		assert.equal(isAllowedExternalUrl(undefined), false);
		assert.equal(isAllowedExternalUrl(42), false);
		assert.equal(isAllowedExternalUrl(''), false);
		assert.equal(isAllowedExternalUrl('   '), false);
		// Percorsi relativi: nel markdown sono file del progetto, non URL.
		assert.equal(isAllowedExternalUrl('src/lib/agent/session.svelte.ts'), false);
		assert.equal(isAllowedExternalUrl('/etc/hosts'), false);
		assert.equal(isAllowedExternalUrl('C:\\Windows\\System32'), false);
		assert.equal(isAllowedExternalUrl('http//esempio'), false);
	});

	it('non si fa ingannare dalla differenza di maiuscole nello schema', () => {
		assert.equal(isAllowedExternalUrl('HTTPS://example.com'), true);
		assert.equal(isAllowedExternalUrl('JavaScript:alert(1)'), false);
		assert.equal(isAllowedExternalUrl('FILE:///etc/passwd'), false);
	});
});
