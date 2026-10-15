import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// I componenti condivisi non richiedono l'adapter desktop di SvelteKit.
export default {
	preprocess: vitePreprocess()
};
