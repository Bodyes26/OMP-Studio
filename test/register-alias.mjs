// Registra l'hook di risoluzione di `$lib` prima del caricamento dei test.
import { register } from 'node:module';
import './runes-shim.mjs';

register('./alias-hooks.mjs', import.meta.url);
