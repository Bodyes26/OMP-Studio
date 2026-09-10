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
import './terminal-task-config.test.ts';
import './wire-omp.test.ts';
import './rpc-open-lifecycle.test.ts';
import './editor-context.test.ts';
import './studio-tasks.test.ts';
import './acl-coverage.test.ts';
import './context-menu-and-tree.test.ts';
import './ask-tool.test.ts';
import './smooth-cursor.test.ts';
import './external-url.test.ts';
import './platform.test.ts';
import './resume-errors.test.ts';
import './omp-contract.test.ts';
import './studio-updater.test.ts';
import './tool-errors.test.ts';
import './prompt-suggestions.test.ts';
import './agent-interaction.test.ts';
import './model-settings.test.ts';
import './studio-preview.test.ts';
import './browser-live-contract.test.ts';
import './markdown-filepaths.test.ts';
import './browser-viewer.test.ts';
import './browser-control-epochs.test.ts';
import './browser-origin-policy.test.ts';
import './browser-inspector.test.ts';
import './browser-dialogs-files.test.ts';
import './browser-hardening-matrix.test.ts';
import './companion-quick-task.test.ts';
import './companion-attention.test.ts';
import './lab-contracts.test.ts';
import './lab-persistence.test.ts';
import './lab-revisions.test.ts';
import './lab-confinement.test.ts';
import './lab-concurrency.test.ts';
import './lab-compiler.test.ts';
import './lab-renderer.test.ts';
import './lab-visual-tools.test.ts';
import './lab-context.test.ts';
import './lab-orchestration.test.ts';
import './lab-export-handoff.test.ts';
import './lab-migration.test.ts';
import './lab-acceptance-e2e.test.ts';
import './quota-recovery.test.ts';
