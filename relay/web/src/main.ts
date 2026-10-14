import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) {
	mount(App, { target });
}

if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch((err) => {
			console.warn('Service Worker non registrato:', err);
		});
	});
}
