// Web Worker dedicato per la compilazione dei prototipi del Laboratorio.
// Riceve un messaggio di tipo LabCompileRequest e risponde con LabCompileResult.

import { compileLabPrototype, ensureEsbuildInitialized, type LabCompileRequest } from './compiler.ts';

interface WebWorkerScope {
	onmessage: ((event: MessageEvent<LabCompileRequest>) => void) | null;
	postMessage(message: unknown): void;
}

const workerScope = globalThis as unknown as WebWorkerScope;

workerScope.onmessage = async (event: MessageEvent<LabCompileRequest>) => {
	try {
		await ensureEsbuildInitialized();
		const result = await compileLabPrototype(event.data);
		workerScope.postMessage(result);
	} catch (error) {
		workerScope.postMessage({
			ok: false,
			errors: [error instanceof Error ? error.message : String(error)],
			elapsedMs: 0
		});
	}
};
