// Registra l'hook di risoluzione di `$lib` prima del caricamento dei test.
import { register } from 'node:module';

register('./alias-hooks.mjs', import.meta.url);
