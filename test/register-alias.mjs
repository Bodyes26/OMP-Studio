// Registra lo shim delle rune Svelte 5 e l'hook di risoluzione prima del caricamento dei test.
import { register } from 'node:module';
import './runes-shim.mjs';

register('./alias-hooks.mjs', import.meta.url);
