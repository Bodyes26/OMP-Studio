import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
	plugins: [svelte()],
	root: __dirname,
	resolve: {
		alias: {
			'#lib': resolve(__dirname, '../../src/lib'),
			'$remote-protocol': resolve(__dirname, '../src/protocol.ts')
		},
		dedupe: ['svelte']
	},
	server: {
		port: 5173,
		fs: {
			allow: [resolve(__dirname, '../..')]
		},
		proxy: {
			'/v1': {
				target: 'http://localhost:8787',
				ws: true,
				changeOrigin: true
			},
			'/healthz': {
				target: 'http://localhost:8787',
				changeOrigin: true
			}
		}
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true
	}
});
