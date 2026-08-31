import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractToolErrorReason } from '../src/lib/agent/tools/types.ts';

describe('Estrazione motivi errore tool (extractToolErrorReason)', () => {
	it('estrae il messaggio da details quando è una stringa diretta', () => {
		const reason = extractToolErrorReason({
			toolName: 'bash',
			result: {
				isError: true,
				details: 'Processo interrotto per timeout di 30s'
			}
		});
		assert.equal(reason, 'Processo interrotto per timeout di 30s');
	});

	it('estrae il campo error o message da details strutturato', () => {
		const r1 = extractToolErrorReason({
			toolName: 'read',
			result: {
				isError: true,
				details: { error: 'File non trovato: C:/repos/app/missing.ts' }
			}
		});
		assert.equal(r1, 'File non trovato: C:/repos/app/missing.ts');

		const r2 = extractToolErrorReason({
			toolName: 'ast_edit',
			result: {
				isError: true,
				details: { message: 'Pattern AST non valido per il linguaggio target' }
			}
		});
		assert.equal(r2, 'Pattern AST non valido per il linguaggio target');

		const r3 = extractToolErrorReason({
			toolName: 'bash',
			result: {
				isError: true,
				details: { stderr: 'fatal: destination path already exists' }
			}
		});
		assert.equal(r3, 'fatal: destination path already exists');
	});

	it('estrae errore da args quando assente in details e presente negli argomenti', () => {
		const reason = extractToolErrorReason({
			toolName: 'yield',
			args: { error: 'Condizione di uscita non soddisfatta' },
			result: { isError: true }
		});
		assert.equal(reason, 'Condizione di uscita non soddisfatta');
	});

	it('estrae la prima riga utile dal testo di result.content', () => {
		const reason = extractToolErrorReason({
			toolName: 'bash',
			result: {
				isError: true,
				content: [
					{
						type: 'text',
						text: 'ENOENT: no such file or directory\n  at Object.openSync (fs.js:498:3)\n  at readFileSync (fs.js:394:35)'
					}
				]
			}
		});
		assert.equal(reason, 'ENOENT: no such file or directory');
	});

	it('unisce prefissi generici come Error: o Command failed: alla riga descrittiva successiva', () => {
		const reason = extractToolErrorReason({
			toolName: 'bash',
			result: {
				isError: true,
				content: [
					{
						type: 'text',
						text: 'Error:\n  Cannot find module "@sveltejs/kit"'
					}
				]
			}
		});
		assert.equal(reason, 'Error: Cannot find module "@sveltejs/kit"');
	});

	it('ripulisce sequenze di controllo ANSI e normalizza gli spazi', () => {
		const reason = extractToolErrorReason({
			toolName: 'bash',
			result: {
				isError: true,
				content: [
					{
						type: 'text',
						text: '\u001b[31merror[E0425]\u001b[0m: cannot find value `x` in this scope\n  --> src/main.rs:12:5'
					}
				]
			}
		});
		assert.equal(reason, 'error[E0425]: cannot find value `x` in this scope');
	});

	it('rimuove virgolette superflue che avvolgono l intero messaggio', () => {
		const reason = extractToolErrorReason({
			toolName: 'generic',
			result: {
				isError: true,
				details: '"Unrecognized option --invalid-flag"'
			}
		});
		assert.equal(reason, 'Unrecognized option --invalid-flag');
	});

	it('tronca messaggi eccezionalmente lunghi con ellissi', () => {
		const veryLong = 'A'.repeat(200);
		const reason = extractToolErrorReason({
			toolName: 'generic',
			result: {
				isError: true,
				details: veryLong
			}
		});
		assert.ok(reason.length <= 140);
		assert.ok(reason.endsWith('...'));
	});

	it('usa il ripiego generico quando non sono presenti dettagli o testo', () => {
		const reason = extractToolErrorReason({
			toolName: 'unknown',
			result: { isError: true }
		});
		assert.equal(reason, 'operazione non riuscita');
	});
});
