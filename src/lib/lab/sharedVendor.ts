// Pubblicazione degli asset vendor condivisi (React 19.2.8 ESM + Tailwind browser runtime).
// Viene eseguita una sola volta per ciclo di vita dell'applicazione.

import { labApi } from './api';
import type { LabServedFile } from './types';

let isPublished = false;
let publishPromise: Promise<void> | null = null;

export async function ensureSharedVendorPublished(): Promise<void> {
	if (isPublished) return;
	if (publishPromise) return publishPromise;

	publishPromise = (async () => {
		try {
			const vendorFiles = [
				{ path: 'react.js', url: '/lab/vendor-esm/react.js' },
				{ path: 'react-jsx-runtime.js', url: '/lab/vendor-esm/react-jsx-runtime.js' },
				{ path: 'react-jsx-dev-runtime.js', url: '/lab/vendor-esm/react-jsx-dev-runtime.js' },
				{ path: 'react-dom.js', url: '/lab/vendor-esm/react-dom.js' },
				{ path: 'react-dom-client.js', url: '/lab/vendor-esm/react-dom-client.js' },
				{ path: 'tailwind.js', url: '/lab/tailwind.js' }
			];

			const servedFiles: LabServedFile[] = await Promise.all(
				vendorFiles.map(async (v) => {
					const res = await fetch(v.url);
					if (!res.ok) {
						throw new Error(`Impossibile caricare l'asset vendor: ${v.url} (${res.status})`);
					}
					const content = await res.text();
					return {
						path: v.path,
						content,
						contentType: 'application/javascript'
					};
				})
			);

			await labApi.publishShared(servedFiles);
			isPublished = true;
		} finally {
			if (!isPublished) {
				publishPromise = null;
			}
		}
	})();

	return publishPromise;
}
