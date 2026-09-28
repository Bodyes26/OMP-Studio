// Guardia dev-only per il banco di prova.
// In produzione l'accesso al banco di prova viene bloccato con un errore 404.

import { error } from '@sveltejs/kit';

export const prerender = false;
export const ssr = false;

export function load() {
	if (!import.meta.env.DEV) {
		throw error(404, 'Not found');
	}
	return {};
}
