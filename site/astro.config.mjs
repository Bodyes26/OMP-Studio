import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Sito statico per Cloudflare Pages: root directory `site/`, comando `npm run build`, uscita `dist/`.
export default defineConfig({
	site: 'https://omp-studio.pages.dev',
	integrations: [svelte()],
	build: { inlineStylesheets: 'auto' }
});
