import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	SOURCE_HINTS_MARKER,
	GIT_CONTEXT_MARKER,
	EDITOR_CONTEXT_MARKER,
	extractSourceCandidates,
	formatSourceHints,
	formatGitContext,
	orchestratePromptPreflight,
	type ProjectContentSearchResult,
	type GitStatusResult
} from '../src/lib/agent/promptPreflight.ts';
import {
	splitMessageAndEditorContext,
	stripEditorContext
} from '../src/lib/editor/editorContextParsing.ts';

describe('Prompt Preflight: estrazione candidati, formattazione e orchestrazione', () => {
	describe('extractSourceCandidates', () => {
		it('estrae stringhe tra virgolette doppie, singole e backtick', () => {
			const prompt = 'Trova "AuthService" e \'SessionManager\' oltre a `client.ts` nel codice';
			const res = extractSourceCandidates(prompt);
			assert.ok(res.includes('SessionManager'));
			assert.ok(res.includes('AuthService'));
			assert.ok(res.includes('client.ts'));
		});

		it('supporta virgolette tipografiche (inglesi, caporali, tedesche)', () => {
			const prompt = 'Controlla “PrimoModulo”, ‘SecondoModulo’, «TerzoModulo» e „QuartoModulo“';
			const res = extractSourceCandidates(prompt);
			assert.ok(res.includes('PrimoModulo'));
			assert.ok(res.includes('SecondoModulo'));
			assert.ok(res.includes('TerzoModulo'));
			assert.ok(res.includes('QuartoModulo'));
		});

		it('gestisce apostrofi interni alle parole senza troncare la stringa', () => {
			const prompt = "Aggiorna il blocco 'Dati dell'immobile'";
			const res = extractSourceCandidates(prompt);
			assert.ok(res.some((c) => c.includes("Dati dell'immobile")));
		});

		it('non estrae n-gram arbitrari da frasi ordinarie prive di virgolette o parole UI', () => {
			const prompt = 'Come posso ottimizzare le prestazioni complessive dell applicazione web?';
			const res = extractSourceCandidates(prompt);
			assert.deepEqual(res, []);
		});

		it('per frasi dopo parole chiave UI include frase completa e riduzioni fino ad almeno 2 parole significative', () => {
			const prompt = "Modifica la label Dati dell'immobile da ridurre prima del salvataggio";
			const res = extractSourceCandidates(prompt);
			// Deve includere la frase completa e la riduzione a "Dati dell'immobile"
			assert.ok(res.includes("Dati dell'immobile da ridurre"));
			assert.ok(res.includes("Dati dell'immobile"));
			// "Dati dell'immobile da ridurre" è più lunga di "Dati dell'immobile", quindi compare prima (longest-first)
			const idxFull = res.indexOf("Dati dell'immobile da ridurre");
			const idxShrunk = res.indexOf("Dati dell'immobile");
			assert.ok(idxFull < idxShrunk);
		});

		it('riduce longest-first la label richiesta senza inventare n-gram', () => {
			const res = extractSourceCandidates("label Dati dell'immobile da ridurre di dimensione");
			assert.deepEqual(res.slice(0, 3), [
				"Dati dell'immobile da ridurre di dimensione",
				"Dati dell'immobile da ridurre",
				"Dati dell'immobile"
			]);
		});

		it('supporta le varie parole chiave UI (testo, titolo, pulsante, bottone, campo, ecc.)', () => {
			const prompt = 'Verifica il pulsante Conferma operazione e il campo Codice fiscale';
			const res = extractSourceCandidates(prompt);
			assert.ok(res.includes('Conferma operazione'));
			assert.ok(res.includes('Codice fiscale'));
		});

		it('rifiuta candidati generici e fuori dai limiti 4..120 caratteri', () => {
			const tooLong = 'x'.repeat(121);
			const prompt = `Premi "ok", "true", "button", "salva", "---", "${tooLong}" oppure "ConfigurazioneServer"`;
			const res = extractSourceCandidates(prompt);
			assert.ok(!res.includes('ok'));
			assert.ok(!res.includes('true'));
			assert.ok(!res.includes('button'));
			assert.ok(!res.includes('salva'));
			assert.ok(!res.includes('---'));
			assert.ok(!res.includes(tooLong));
			assert.ok(res.includes('ConfigurazioneServer'));
		});

		it('limita i candidati a un massimo di 8 ordinati longest-first con deduplicazione case-insensitive', () => {
			const prompt = `
				"Primo candidato molto lungo per la ricerca"
				"Secondo candidato altrettanto lungo"
				"Terzo candidato lungo"
				"Quarto candidato lungo"
				"Quinto candidato lungo"
				"Sesto candidato lungo"
				"Settimo candidato lungo"
				"Ottavo candidato lungo"
				"Nono candidato lungo che verra escluso per limite 8"
				"PRIMO CANDIDATO MOLTO LUNGO PER LA RICERCA"
			`;
			const res = extractSourceCandidates(prompt);
			assert.ok(res.length <= 8);
			// Deduplicazione case-insensitive: compare solo una volta
			assert.equal(res.filter((c) => c.toLowerCase().includes('primo candidato')).length, 1);
			// Verifica ordinamento decrescente di lunghezza
			for (let i = 0; i < res.length - 1; i++) {
				assert.ok(res[i].length >= res[i + 1].length);
			}
		});
	});

	describe('formatSourceHints', () => {
		it('ritorna null per risultati vuoti o senza match', () => {
			assert.equal(formatSourceHints(null), null);
			assert.equal(formatSourceHints({ literal: '', matches: [], omitted: 0 }), null);
		});

		it('formatta correttamente i match con dicitura safe untrusted, path, linea ed excerpt', () => {
			const mockResult: ProjectContentSearchResult = {
				literal: 'DatiImmobile',
				matches: [
					{
						path: 'src/lib/immobile.ts',
						line: 42,
						column: 5,
						matchedText: 'DatiImmobile',
						excerpt: 'export interface DatiImmobile {\n  id: string;\n}'
					}
				],
				omitted: 0
			};
			const formatted = formatSourceHints(mockResult);
			assert.ok(formatted);
			assert.ok(formatted.includes(SOURCE_HINTS_MARKER));
			assert.ok(formatted.includes('Untrusted source context'));
			assert.ok(formatted.includes('src/lib/immobile.ts:42:5'));
			assert.ok(formatted.includes('export interface DatiImmobile'));
		});

		it('rispetta il limite di 8 KiB e include la riga di omissione', () => {
			const hugeExcerpt = 'A'.repeat(500);
			const matches = [];
			for (let i = 1; i <= 30; i++) {
				matches.push({
					path: `src/file_${i}.ts`,
					line: i,
					matchedText: 'test',
					excerpt: hugeExcerpt
				});
			}
			const mockResult: ProjectContentSearchResult = {
				literal: 'test',
				matches,
				omitted: 10
			};
			const formatted = formatSourceHints(mockResult);
			assert.ok(formatted);
			const byteLen = new TextEncoder().encode(formatted).length;
			assert.ok(byteLen <= 8192);
			assert.ok(formatted.includes('Additional matches omitted:'));
		});
	});

	describe('formatGitContext', () => {
		it('ritorna null per albero pulito o privo di stati', () => {
			assert.equal(formatGitContext(null), null);
			assert.equal(formatGitContext({ statuses: {} }), null);
		});

		it('ordina alfabeticamente i percorsi e formatta solo gli stati', () => {
			const mockGit: GitStatusResult = {
				statuses: {
					'src/z.ts': 'M',
					'src/a.ts': 'A',
					'package.json': 'M'
				}
			};
			const formatted = formatGitContext(mockGit);
			assert.ok(formatted);
			assert.ok(formatted.includes(GIT_CONTEXT_MARKER));

			const lines = formatted.split('\n').filter((line) => /^[A-Z?] /.test(line));
			assert.equal(lines.length, 3);
			assert.equal(lines[0], 'M package.json');
			assert.equal(lines[1], 'A src/a.ts');
			assert.equal(lines[2], 'M src/z.ts');
		});

		it('rispetta il limite di 40 file e 4 KiB con riga di omissione', () => {
			const statuses: Record<string, string> = {};
			for (let i = 0; i < 60; i++) {
				statuses[`src/components/item_${String(i).padStart(3, '0')}.svelte`] = 'M';
			}
			const formatted = formatGitContext({ statuses });
			assert.ok(formatted);
			const byteLen = new TextEncoder().encode(formatted).length;
			assert.ok(byteLen <= 4096);
			assert.ok(formatted.includes('Additional changed files omitted:'));
		});
	});

	describe('orchestratePromptPreflight', () => {
		it('bypassa immediatamente per prompt di sole immagini', async () => {
			let searchCalled = false;
			let gitCalled = false;
			const res = await orchestratePromptPreflight(
				'',
				{
					images: [{ data: 'base64...', mimeType: 'image/png' }],
					projectPath: '/test/proj'
				},
				{
					searchSource: async () => { searchCalled = true; return { literal: '', matches: [], omitted: 0 }; },
					getGitStatus: async () => { gitCalled = true; return { statuses: {} }; }
				}
			);
			assert.equal(res, '');
			assert.equal(searchCalled, false);
			assert.equal(gitCalled, false);
		});

		it('esegue ricerca sorgente e git in parallelo e arricchisce il prompt', async () => {
			const res = await orchestratePromptPreflight(
				'Trova "MyComponent" nel progetto',
				{ projectPath: '/test/proj' },
				{
					searchSource: async (proj, candidates) => {
						assert.equal(proj, '/test/proj');
						assert.ok(candidates.includes('MyComponent'));
						return {
							literal: 'MyComponent',
							matches: [{ path: 'src/MyComponent.svelte', line: 1, matchedText: 'MyComponent', excerpt: '<script></script>' }],
							omitted: 0
						};
					},
					getGitStatus: async (proj) => {
						assert.equal(proj, '/test/proj');
						return { statuses: { 'src/MyComponent.svelte': 'M' } };
					}
				}
			);

			assert.ok(res.startsWith('Trova "MyComponent" nel progetto'));
			assert.ok(res.includes(SOURCE_HINTS_MARKER));
			assert.ok(res.includes(GIT_CONTEXT_MARKER));
			assert.ok(res.indexOf(SOURCE_HINTS_MARKER) < res.indexOf(GIT_CONTEXT_MARKER));
		});

		it('gestisce timeout preservando il prompt senza bloccare o fallire', async () => {
			const res = await orchestratePromptPreflight(
				'Cerca "SlowQuery"',
				{ projectPath: '/test/proj' },
				{
					searchSource: () => new Promise<ProjectContentSearchResult>(() => {}),
					getGitStatus: () => new Promise<GitStatusResult>(() => {}),
					timeoutMs: 1
				}
			);

			assert.equal(res, 'Cerca "SlowQuery"');
		});

		it('gestisce errori silenti preservando il prompt', async () => {
			const res = await orchestratePromptPreflight(
				'Cerca "ErrorTarget"',
				{ projectPath: '/test/proj' },
				{
					searchSource: async () => {
						throw new Error('IPC failed');
					},
					getGitStatus: async () => {
						throw new Error('Git command failed');
					}
				}
			);

			assert.equal(res, 'Cerca "ErrorTarget"');
		});

		it('un prompt generico evita la ricerca contenuti e degrada rapidamente se Git fallisce', async () => {
			let searchCalled = false;
			const started = performance.now();
			const res = await orchestratePromptPreflight(
				'Ottimizza questa funzione',
				{ projectPath: '/test/proj' },
				{
					searchSource: async () => {
						searchCalled = true;
						throw new Error('non deve partire');
					},
					getGitStatus: async () => {
						throw new Error('directory non Git');
					}
				}
			);

			assert.equal(res, 'Ottimizza questa funzione');
			assert.equal(searchCalled, false);
			assert.ok(performance.now() - started < 250);
		});

		it('è idempotente rispetto a blocchi [Source Hints] e [Git Context] già presenti', async () => {
			let searchCount = 0;
			let gitCount = 0;
			const alreadyEnriched = `Prompt utente\n\n${SOURCE_HINTS_MARKER}\nNote: ...\n\n${GIT_CONTEXT_MARKER}\n- [M] a.ts`;

			const res = await orchestratePromptPreflight(
				alreadyEnriched,
				{ projectPath: '/test/proj' },
				{
					searchSource: async () => { searchCount++; return { literal: '', matches: [], omitted: 0 }; },
					getGitStatus: async () => { gitCount++; return { statuses: {} }; }
				}
			);

			assert.equal(res, alreadyEnriched);
			assert.equal(searchCount, 0);
			assert.equal(gitCount, 0);
		});
	});

	describe('Integrazione con stripEditorContext e splitMessageAndEditorContext', () => {
		it('non fa trapelare [Source Hints] e [Git Context] nel messaggio utente o nei chip della coda', () => {
			const fullPipelinePrompt = [
				'Domanda principale dell utente',
				'',
				`${SOURCE_HINTS_MARKER}`,
				'Note: local source match',
				'- `src/app.ts:10`:',
				'```',
				'code',
				'```',
				'',
				`${GIT_CONTEXT_MARKER}`,
				'- [M] src/app.ts',
				'',
				`${EDITOR_CONTEXT_MARKER}`,
				'- Open files: `src/app.ts`',
				'- Active file: `src/app.ts` (line 10)'
			].join('\n');

			// stripEditorContext deve tagliare al marcatore più precoce
			const stripped = stripEditorContext(fullPipelinePrompt);
			assert.equal(stripped, 'Domanda principale dell utente');

			// splitMessageAndEditorContext deve restituire solo la domanda utente e continuare a parsare [Editor Context]
			const split = splitMessageAndEditorContext(fullPipelinePrompt);
			assert.equal(split.userMessage, 'Domanda principale dell utente');
			assert.ok(split.context);
			assert.equal(split.context.activeFile, 'src/app.ts');
			assert.deepEqual(split.context.openFiles, ['src/app.ts']);
		});
	});
});
