/**
 * Registro delle icone di Studio.
 *
 * Regola: nessun componente importa direttamente da `@lucide/svelte`. Le icone
 * entrano da qui con un nome che dice a cosa servono, non come sono disegnate:
 * cambiare il glifo di un'azione e' una riga in questo file, non una caccia in
 * trentasette componenti.
 *
 * La dimensione arriva dalla regola globale `svg.lucide` in `app.css`, che legge
 * `--icon-size` (14px per default): chi ha bisogno di un'altra misura la imposta
 * sul contenitore, e tutte le icone dentro la seguono. La prop `size` non si usa.
 *
 * Vietato: emoji come icona. Il font emoji del sistema porta il suo colore e
 * cambia forma tra Windows e macOS, quindi rompe sia la palette (DESIGN.md §2)
 * sia la coerenza del disegno.
 */

// Affordance: apertura, chiusura, direzione, conferma.
export { default as IconClose } from '@lucide/svelte/icons/x';
export { default as IconCheck } from '@lucide/svelte/icons/check';
export { default as IconPlus } from '@lucide/svelte/icons/plus';
export { default as IconChevronRight } from '@lucide/svelte/icons/chevron-right';
export { default as IconChevronLeft } from '@lucide/svelte/icons/chevron-left';
export { default as IconChevronDown } from '@lucide/svelte/icons/chevron-down';
export { default as IconArrowRight } from '@lucide/svelte/icons/arrow-right';
export { default as IconArrowLeft } from '@lucide/svelte/icons/arrow-left';
export { default as IconArrowDown } from '@lucide/svelte/icons/arrow-down';
export { default as IconExternalLink } from '@lucide/svelte/icons/external-link';
export { default as IconRefresh } from '@lucide/svelte/icons/refresh-cw';
export { default as IconLoop } from '@lucide/svelte/icons/rotate-ccw';
export { default as IconZoomIn } from '@lucide/svelte/icons/zoom-in';
export { default as IconZoomOut } from '@lucide/svelte/icons/zoom-out';
export { default as IconSearch } from '@lucide/svelte/icons/search';

// Barra dei progetti e guscio.
export { default as IconGhost } from '@lucide/svelte/icons/ghost';
export { default as IconSettings } from '@lucide/svelte/icons/settings';
export { default as IconWarning } from '@lucide/svelte/icons/triangle-alert';
export { default as IconQuota } from '@lucide/svelte/icons/gauge';
export { default as IconKeyboard } from '@lucide/svelte/icons/keyboard';

// Azioni su un progetto.
export { default as IconFolderOpen } from '@lucide/svelte/icons/folder-open';
export { default as IconFile } from '@lucide/svelte/icons/file';
export { default as IconCopy } from '@lucide/svelte/icons/copy';
export { default as IconTerminal } from '@lucide/svelte/icons/square-terminal';
export { default as IconEditor } from '@lucide/svelte/icons/code';
export { default as IconRename } from '@lucide/svelte/icons/square-pen';
export { default as IconPlay } from '@lucide/svelte/icons/play';
export { default as IconQueue } from '@lucide/svelte/icons/list';
export { default as IconAuto } from '@lucide/svelte/icons/zap';
export { default as IconCloseOthers } from '@lucide/svelte/icons/square-x';
export { default as IconGitBranch } from '@lucide/svelte/icons/git-branch';
export { default as IconRule } from '@lucide/svelte/icons/scroll-text';
export { default as IconSkill } from '@lucide/svelte/icons/wand-sparkles';

// Menu contestuali e modifica testo.
export { default as IconUndo } from '@lucide/svelte/icons/undo';
export { default as IconRedo } from '@lucide/svelte/icons/redo';
export { default as IconCut } from '@lucide/svelte/icons/scissors';
export { default as IconPaste } from '@lucide/svelte/icons/clipboard-paste';
export { default as IconSelectAll } from '@lucide/svelte/icons/text-select';
export { default as IconTrash } from '@lucide/svelte/icons/trash-2';
export { default as IconNewFile } from '@lucide/svelte/icons/file-plus';
export { default as IconNewFolder } from '@lucide/svelte/icons/folder-plus';
export { default as IconSave } from '@lucide/svelte/icons/save';
export { default as IconClear } from '@lucide/svelte/icons/eraser';
// Stato: le stesse quattro forme per task, job, subagent e todo.
export { default as IconStatusPending } from '@lucide/svelte/icons/circle';
export { default as IconStatusRunning } from '@lucide/svelte/icons/circle-dot';
export { default as IconStatusDone } from '@lucide/svelte/icons/check';
export { default as IconStatusFailed } from '@lucide/svelte/icons/circle-x';

// Controlli di scelta dentro le card degli strumenti.
export { default as IconCheckbox } from '@lucide/svelte/icons/square';
export { default as IconCheckboxChecked } from '@lucide/svelte/icons/square-check';
export { default as IconRadio } from '@lucide/svelte/icons/circle';
export { default as IconRadioChecked } from '@lucide/svelte/icons/circle-dot';
export { default as IconNote } from '@lucide/svelte/icons/notebook-pen';

// Ruoli dei modelli: un segno per ruolo, usato da badge e selettori.
export { default as IconRoleDefault } from '@lucide/svelte/icons/message-circle';
export { default as IconRolePlan } from '@lucide/svelte/icons/diamond';
export { default as IconRoleSmol } from '@lucide/svelte/icons/zap';
export { default as IconRoleSlow } from '@lucide/svelte/icons/infinity';
export { default as IconRoleVision } from '@lucide/svelte/icons/eye';
export { default as IconContextWindow } from '@lucide/svelte/icons/scan-text';
export { default as IconRoleTask } from '@lucide/svelte/icons/split';
export { default as IconRoleCommit } from '@lucide/svelte/icons/git-commit-horizontal';
export { default as IconRoleAdvisor } from '@lucide/svelte/icons/shield-check';

// Varie.
export { default as IconDiamond } from '@lucide/svelte/icons/diamond';
export { default as IconSubagents } from '@lucide/svelte/icons/split';
