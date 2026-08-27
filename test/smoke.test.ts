/**
 * Aggregatore principale degli smoke test di OMP Studio.
 * Verifica le componenti critiche:
 * - Normalizzazione dei percorsi di progetto
 * - Validazione e parsing dello store tasks.json
 * - Parsing dei comandi e degli eventi wire OMP
 * - Copertura ACL dei comandi nativi esposti al webview
 */

import './paths.test.ts';
import './tasks-store.test.ts';
import './wire-omp.test.ts';
import './editor-context.test.ts';
import './studio-tasks.test.ts';
import './acl-coverage.test.ts';
import './context-menu-and-tree.test.ts';
import './ask-tool.test.ts';
