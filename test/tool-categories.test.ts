import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	categorizeTool,
	categoryForTool,
	parseDiffStats,
	formatDurationSecs
} from '../src/lib/agent/tools/categories.ts';

describe('Categorie e sintesi dei tool (Gate R32 - C09)', () => {
	it('conta +/- da testo diff reale di omp (EditToolDetails.diff)', () => {
		// Esempio reale da ricerca/TOOL-DETAILS.md (catturato dal filo RPC di omp)
		const realOmpDiff =
			'-1|// probe\n' +
			' 2|export const a = 1;\n' +
			'-3|export const b = 2;\n' +
			'+2|export const b = 22;';

		const stats = parseDiffStats(realOmpDiff);
		assert.deepEqual(stats, [1, 2], 'deve contare 1 aggiunta e 2 rimozioni');

		// Chiamata tool edit con quel diff
		const summary = categorizeTool({
			toolName: 'edit',
			args: {
				path: 'src/lib/alpha.ts'
			},
			result: {
				details: {
					diff: realOmpDiff,
					firstChangedLine: 1,
					op: 'update',
					path: 'alpha.ts'
				}
			}
		});

		assert.equal(summary.category, 'edit');
		assert.equal(summary.label, 'Modifica');
		assert.equal(summary.detail, 'alpha.ts');
		assert.deepEqual(summary.diff, [1, 2]);
		assert.equal(summary.meta, 'update');
		assert.equal(summary.fail, false);
	});

	it('estrae il motivo di fallimento da un tool bash fallito', () => {
		const summary = categorizeTool({
			toolName: 'bash',
			args: {
				command: 'cargo test --manifest-path src-tauri/Cargo.toml'
			},
			result: {
				isError: true,
				details: {
					wallTimeMs: 1240,
					exitCode: 101
				},
				content: [
					{
						type: 'text',
						text: 'error[E0432]: unresolved import `crate::missing::Module`\n  --> src/main.rs:12:5\n'
					}
				]
			}
		});

		assert.equal(summary.category, 'run');
		assert.equal(summary.label, 'Comando');
		assert.equal(summary.detail, 'cargo test --manifest-path src-tauri/Cargo.toml');
		assert.equal(summary.meta, 'exit 101');
		assert.equal(summary.fail, true);
		assert.ok(summary.errorReason, 'motivo di errore estratto');
		assert.ok(
			summary.errorReason.includes('unresolved import'),
			`motivo contiene l'errore effettivo: "${summary.errorReason}"`
		);
	});

	it('gestisce il fallback per tool MCP e strumenti sconosciuti', () => {
		const mcpSummary = categorizeTool({
			toolName: 'mcp__sqlite__execute_query',
			args: {
				sql: 'SELECT * FROM users WHERE active = 1',
				limit: 20
			},
			result: {
				content: [{ type: 'text', text: '[{"id":1,"name":"Alice"}]' }]
			}
		});

		assert.equal(mcpSummary.category, 'other');
		assert.equal(mcpSummary.label, 'mcp__sqlite__execute_query');
		assert.ok(
			mcpSummary.detail?.includes('SELECT * FROM users'),
			`detail contiene la query SQL passata: "${mcpSummary.detail}"`
		);
		assert.equal(mcpSummary.fail, false);

		// Altro tool sconosciuto senza args tipici
		const unknownSummary = categorizeTool({
			toolName: 'custom_orchestrator_step',
			args: {
				arbitrary_field: 'valore personalizzato'
			}
		});

		assert.equal(unknownSummary.category, 'other');
		assert.equal(unknownSummary.label, 'custom_orchestrator_step');
		assert.ok(
			unknownSummary.detail?.includes('valore personalizzato'),
			'detail contiene il valore custom'
		);
	});

	it('mappa correttamente tutti i tool noti e i loro alias', () => {
		assert.equal(categoryForTool('read'), 'read');
		assert.equal(categoryForTool('grep'), 'search');
		assert.equal(categoryForTool('ast_grep'), 'search');
		assert.equal(categoryForTool('ast-grep'), 'search');
		assert.equal(categoryForTool('astgrep'), 'search');
		assert.equal(categoryForTool('glob'), 'search');
		assert.equal(categoryForTool('bash'), 'run');
		assert.equal(categoryForTool('eval'), 'run');
		assert.equal(categoryForTool('job'), 'run');
		assert.equal(categoryForTool('edit'), 'edit');
		assert.equal(categoryForTool('ast_edit'), 'edit');
		assert.equal(categoryForTool('ast-edit'), 'edit');
		assert.equal(categoryForTool('write'), 'edit');
		assert.equal(categoryForTool('web_search'), 'web');
		assert.equal(categoryForTool('web-search'), 'web');
		assert.equal(categoryForTool('fetch'), 'web');
		assert.equal(categoryForTool('browser'), 'web');
		assert.equal(categoryForTool('reflect'), 'think');
		assert.equal(categoryForTool('task'), 'task');
		assert.equal(categoryForTool('todo'), 'todo');
		assert.equal(categoryForTool('ask'), 'ask');
	});

	it('formatta correttamente i secondi conformemente al prototipo', () => {
		assert.equal(formatDurationSecs(0), '0,1 s');
		assert.equal(formatDurationSecs(500), '0,5 s');
		assert.equal(formatDurationSecs(1449), '1,4 s');
		assert.equal(formatDurationSecs(12800), '12,8 s');
	});
});
