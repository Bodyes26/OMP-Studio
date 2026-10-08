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
import './lanes-store.test.ts';
import './lanes-concurrency.test.ts';
import './lanes-routing.test.ts';
import './lanes-dispatch.test.ts';
import './lanes-surfaces.test.ts';
import './lanes-stack.test.ts';
import './lanes-processes.test.ts';
import './lanes-review.test.ts';
import './lanes-w07.test.ts';
import './lanes-cleanup.test.ts';
import './terminal-task-config.test.ts';
import './wire-omp.test.ts';
import './session-tree.test.ts';
import './btw.test.ts';
import './guided-goal.test.ts';
import './rpc-open-lifecycle.test.ts';
import './rpc-hang-report.test.ts';
import './editor-context.test.ts';
import './studio-tasks.test.ts';
import './schedule-reset.test.ts';
import './studio-loop.test.ts';
import './loop-mode.test.ts';
import './acl-coverage.test.ts';
import './context-menu-and-tree.test.ts';
import './ask-tool.test.ts';
import './composer-doc.test.ts';
import './context-report.test.ts';
import './external-url.test.ts';
import './platform.test.ts';
import './resume-errors.test.ts';
import './omp-contract.test.ts';
import './studio-updater.test.ts';
import './ui-fixes-170.test.ts';
import './tool-errors.test.ts';
import './prompt-suggestions.test.ts';
import './turn-headsup.test.ts';
import './agent-interaction.test.ts';
import './model-settings.test.ts';
import './loose-search.test.ts';
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
import './automation-gate.test.ts';
import './quota-recovery.test.ts';
import './notices.test.ts';
import './prewalk.test.ts';
import './i18n-catalog.test.ts';
import './prompt-preflight.test.ts';
import './task-row.test.ts';
import './task-recovery.test.ts';
import './icons.test.ts';
import './tool-stopwatch.test.ts';
import './file-mention.test.ts';
import './two-step-stop.test.ts';
import './prompt-bus.test.ts';
import './project-tab-metadata.test.ts';
import './reveal.test.ts';
import './tool-categories.test.ts';
import './queue-restore.test.ts';
import './composer-submit.test.ts';
import './ask-stream.test.ts';
import './chat-drop.test.ts';
import './tool-group-34.test.ts';
import './todo-trace.test.ts';
import './tooltip-behavior.test.ts';
import './companion-settings.test.ts';
import './session-modes.test.ts';
import './command-layout.test.ts';
import './command-manifest.test.ts';
import './extension-ui-settle.test.ts';
import './auto-dispatch-stability.test.ts';
import './plan-mode.test.ts';
