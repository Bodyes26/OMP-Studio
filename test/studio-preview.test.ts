import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	rmSync,
	existsSync,
	readFileSync,
	writeFileSync,
	symlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import studioExtension from '../extensions/studio-diagram.ts';

describe('Estensione studio_preview: sicurezza, confinamento e I/O atomico', () => {
	let tempProjectDir: string;
	interface RegisteredTool {
		name: string;
		label: string;
		description: string;
		approval: string;
		execute: (
			toolCallId: string,
			params: { title?: string; code?: string; name?: string; description?: string; mermaid?: string },
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: { sessionManager?: { getCwd?: () => string; getSessionId?: () => string } } | undefined
		) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
	}

	let registeredTools: Map<string, RegisteredTool>;

	before(() => {
		tempProjectDir = mkdtempSync(join(tmpdir(), 'omp-studio-preview-test-'));
		registeredTools = new Map();

		// Mock Zod builder per la registrazione dei tool
		const mockZod = {
			object: (shape: Record<string, unknown>) => ({
				shape,
				optional: () => mockZod.object(shape),
				describe: () => mockZod.object(shape)
			}),
			string: () => ({
				optional: () => mockZod.string(),
				describe: () => mockZod.string()
			})
		};

		const mockPi = {
			zod: mockZod,
			registerTool: (def: RegisteredTool) => {
				registeredTools.set(def.name, def);
			}
		};

		studioExtension(mockPi);
	});

	after(() => {
		try {
			rmSync(tempProjectDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
	});

	it('registra studio_preview con approval "write" e studio_diagram con "read"', () => {
		const previewTool = registeredTools.get('studio_preview');
		assert.ok(previewTool, 'studio_preview tool deve essere registrato');
		assert.equal(previewTool.approval, 'write', 'studio_preview deve richiedere approval "write"');

		const diagramTool = registeredTools.get('studio_diagram');
		assert.ok(diagramTool, 'studio_diagram tool deve essere registrato');
		assert.equal(diagramTool.approval, 'read', 'studio_diagram richiede approval "read"');
	});

	it('rifiuta prototipi con codice vuoto', async () => {
		const previewTool = registeredTools.get('studio_preview');
		const ctx = {
			sessionManager: {
				getCwd: () => tempProjectDir,
				getSessionId: () => 'test-session-1'
			}
		};

		const res = await previewTool.execute('call-1', { title: 'Test', code: '   ' }, undefined, undefined, ctx);
		assert.equal(res.isError, true);
		assert.ok(res.content[0].text.includes('prototype code is empty'));
	});

	it('genera slug sicuro confinato ed esegue scrittura atomica e .gitignore', async () => {
		const previewTool = registeredTools.get('studio_preview');
		const ctx = {
			sessionManager: {
				getCwd: () => tempProjectDir,
				getSessionId: () => 'test-session-2'
			}
		};

		// Prova con nome contenente tentativi di directory traversal e caratteri non validi
		const res = await previewTool.execute(
			'call-2',
			{
				title: 'Card Prova',
				name: '../../../etc/passwd:hack?*#',
				code: 'export default function Card() { return <div>Card Content</div>; }'
			},
			undefined,
			undefined,
			ctx
		);

		assert.equal(res.isError, undefined);
		assert.ok(res.content[0].text.includes('proto/passwd-hack.html') || res.content[0].text.includes('proto/'));

		// Verifica che proto/ esista nel cwd del progetto
		const protoDir = join(tempProjectDir, 'proto');
		assert.ok(existsSync(protoDir));

		// Verifica che .gitignore contenga proto/
		const gitignore = readFileSync(join(tempProjectDir, '.gitignore'), 'utf8');
		assert.ok(gitignore.includes('proto/'));

		// Verifica che il file generato contenga il codice racchiuso nel template
		const generatedFile = join(protoDir, 'passwd-hack.html');
		assert.ok(existsSync(generatedFile));
		const htmlContent = readFileSync(generatedFile, 'utf8');
		assert.ok(htmlContent.includes('Card Content'));
		assert.ok(htmlContent.includes('<!DOCTYPE html>'));
	});

	it('rifiuta la scrittura se .gitignore è un symlink', async () => {
		const symlinkTestDir = mkdtempSync(join(tmpdir(), 'omp-preview-symlink-gi-'));
		const targetFile = join(symlinkTestDir, 'actual-gitignore');
		writeFileSync(targetFile, '# real gitignore\n', 'utf8');
		const gitignorePath = join(symlinkTestDir, '.gitignore');

		let canSymlink = true;
		try {
			symlinkSync(targetFile, gitignorePath, 'file');
		} catch {
			canSymlink = false; // Windows senza privilegi o developer mode
		}

		if (canSymlink) {
			const previewTool = registeredTools.get('studio_preview');
			const ctx = {
				sessionManager: {
					getCwd: () => symlinkTestDir,
					getSessionId: () => 'test-symlink'
				}
			};

			const res = await previewTool.execute(
				'call-symlink-gi',
				{ title: 'Symlink Test', code: 'function App() { return <div>Test</div>; }' },
				undefined,
				undefined,
				ctx
			);

			assert.equal(res.isError, true);
			assert.ok(res.content[0].text.includes('symbolic link or junction'));
		}

		try {
			rmSync(symlinkTestDir, { recursive: true, force: true });
		} catch {}
	});

	it('rifiuta la scrittura se proto/ è un symlink', async () => {
		const symlinkTestDir = mkdtempSync(join(tmpdir(), 'omp-preview-symlink-proto-'));
		const outsideDir = mkdtempSync(join(tmpdir(), 'omp-preview-outside-'));
		const protoPath = join(symlinkTestDir, 'proto');

		let canSymlink = true;
		try {
			symlinkSync(outsideDir, protoPath, 'dir');
		} catch {
			canSymlink = false;
		}

		if (canSymlink) {
			const previewTool = registeredTools.get('studio_preview');
			const ctx = {
				sessionManager: {
					getCwd: () => symlinkTestDir,
					getSessionId: () => 'test-symlink-proto'
				}
			};

			const res = await previewTool.execute(
				'call-symlink-proto',
				{ title: 'Proto Symlink Test', code: 'function App() { return <div>Test</div>; }' },
				undefined,
				undefined,
				ctx
			);

			assert.equal(res.isError, true);
			assert.ok(res.content[0].text.includes('symbolic link or junction'));
		}

		try {
			rmSync(symlinkTestDir, { recursive: true, force: true });
			rmSync(outsideDir, { recursive: true, force: true });
		} catch {}
	});

	it('rifiuta la scrittura se il file foglia è un symlink', async () => {
		const symlinkTestDir = mkdtempSync(join(tmpdir(), 'omp-preview-symlink-leaf-'));
		const outsideFile = join(symlinkTestDir, 'outside.html');
		writeFileSync(outsideFile, '<html></html>', 'utf8');

		const protoDir = join(symlinkTestDir, 'proto');
		mkdtempSync(protoDir);
		const leafPath = join(protoDir, 'target-leaf.html');

		let canSymlink = true;
		try {
			symlinkSync(outsideFile, leafPath, 'file');
		} catch {
			canSymlink = false;
		}

		if (canSymlink) {
			const previewTool = registeredTools.get('studio_preview');
			const ctx = {
				sessionManager: {
					getCwd: () => symlinkTestDir,
					getSessionId: () => 'test-symlink-leaf'
				}
			};

			const res = await previewTool.execute(
				'call-symlink-leaf',
				{
					title: 'Target Leaf Test',
					name: 'target-leaf',
					code: 'function App() { return <div>Test</div>; }'
				},
				undefined,
				undefined,
				ctx
			);

			assert.equal(res.isError, true);
			assert.ok(res.content[0].text.includes('symbolic link or junction'));
		}

		try {
			rmSync(symlinkTestDir, { recursive: true, force: true });
		} catch {}
	});
});
