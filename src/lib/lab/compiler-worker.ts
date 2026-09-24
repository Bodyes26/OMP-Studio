// Web Worker dedicato per la compilazione dei prototipi del Laboratorio.
// Riceve un messaggio di tipo LabFile[] e risponde con LabCompileResult.

import { compileLabPrototype, ensureEsbuildInitialized, type LabCompileResult } from './compiler.ts';
import { LOCAL_VENDOR_SPECIFIERS } from './catalog.ts';
import type { LabFile } from './types.ts';

interface WebWorkerScope {
	onmessage: ((event: MessageEvent<LabFile[]>) => void) | null;
	postMessage(message: LabCompileResult): void;
}

const workerScope = globalThis as unknown as WebWorkerScope;

workerScope.onmessage = async (event: MessageEvent<LabFile[]>) => {
	try {
		await ensureEsbuildInitialized();
		const result = await compileLabPrototype(event.data);
		workerScope.postMessage(result);
	} catch (error) {
		workerScope.postMessage({
			ok: false,
			errors: [
				{
					kind: 'compile',
					message: error instanceof Error ? error.message : String(error)
				}
			],
			compiledJs: '',
			compiledCss: '',
			importMap: { ...LOCAL_VENDOR_SPECIFIERS }
		});
	}
};
