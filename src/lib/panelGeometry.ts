export interface PanelGeometry {
	left: number;
	centerRatio: number;
	topRatio: number;
}

export type PanelGeometries = Record<string, PanelGeometry>;
export type SplitterAxis = 'left' | 'center';
/** Ruolo di una colonna: barra laterale (File/Git/Agente), editor, chat/terminale. */
export type ColumnRole = 'files' | 'editor' | 'agent';
export const DEFAULT_COLUMN_ORDER: readonly ColumnRole[] = ['files', 'editor', 'agent'];
export const PANEL_SPLIT = 6;
export const PANEL_MIN_COL = 160;
export const PANEL_MIN_ROW = 120;

export function panelScope(kind: 'git' | 'lab', identity: string): string {
	return JSON.stringify([kind, identity]);
}

export function readPanelGeometries(value: unknown): PanelGeometries | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const entries = Object.entries(value).filter((entry): entry is [string, PanelGeometry] => {
		const v = entry[1];
		return v && typeof v === 'object' && Number.isFinite(v.left) && v.left >= 0 &&
			Number.isFinite(v.centerRatio) && v.centerRatio >= 0 && v.centerRatio <= 1 &&
			Number.isFinite(v.topRatio) && v.topRatio >= 0 && v.topRatio <= 1;
	});
	return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Accetta solo una permutazione dei tre ruoli: un ordine parziale lascerebbe una colonna senza posto. */
export function readColumnOrder(value: unknown): ColumnRole[] | undefined {
	if (!Array.isArray(value) || value.length !== DEFAULT_COLUMN_ORDER.length) return undefined;
	return DEFAULT_COLUMN_ORDER.every((role) => value.includes(role)) ? [...value] as ColumnRole[] : undefined;
}

export function moveColumn(order: readonly ColumnRole[], role: ColumnRole, delta: number): ColumnRole[] {
	const next = [...order];
	const from = next.indexOf(role);
	const to = Math.max(0, Math.min(next.length - 1, from + delta));
	if (from === -1 || from === to) return next;
	next.splice(from, 1);
	next.splice(to, 0, role);
	return next;
}

/** La barra laterale chiude verso il bordo destro solo quando e' l'ultima colonna (anche in verticale). */
export function filesOnRight(order: readonly ColumnRole[]): boolean {
	return order[order.length - 1] === 'files';
}

export interface GridSlot { column: string; row: string }
export interface PanelPlacement {
	files: GridSlot;
	editor: GridSlot;
	agent: GridSlot;
	filesSplit: GridSlot;
	editorSplit: GridSlot;
	/** +1 se trascinare a destra/in basso allarga la colonna governata dal divisore, -1 se la stringe. */
	filesSign: 1 | -1;
	editorSign: 1 | -1;
	columns: string;
	rows: string;
}

/**
 * Barra laterale ed editor hanno misura propria, la chat prende il resto: cosi' le misure salvate
 * seguono la colonna anche dopo uno spostamento. Ogni divisore sta sul lato della colonna fissa
 * rivolto verso la chat, quindi ogni colonna fissa ha esattamente un divisore.
 */
export function panelPlacement(
	order: readonly ColumnRole[], vertical: boolean, files: number, filesSplit: number, editor: number
): PanelPlacement {
	const fill = 'minmax(0, 1fr)';
	const fi = order.indexOf('files');
	const ei = order.indexOf('editor');
	const ai = order.indexOf('agent');
	if (vertical) {
		const right = filesOnRight(order);
		const editorTop = ei < ai;
		const side = right ? '3' : '1';
		const stack = right ? '1' : '3';
		return {
			files: { column: side, row: '1 / span 3' },
			filesSplit: { column: '2', row: '1 / span 3' },
			editor: { column: stack, row: editorTop ? '1' : '3' },
			editorSplit: { column: stack, row: '2' },
			agent: { column: stack, row: editorTop ? '3' : '1' },
			filesSign: right ? -1 : 1,
			editorSign: editorTop ? 1 : -1,
			columns: right ? `${fill} ${filesSplit}px ${files}px` : `${files}px ${filesSplit}px ${fill}`,
			rows: editorTop ? `${editor}px ${PANEL_SPLIT}px ${fill}` : `${fill} ${PANEL_SPLIT}px ${editor}px`
		};
	}
	const filesSign = ai > fi ? 1 : -1;
	const editorSign = ai > ei ? 1 : -1;
	const track = (i: number) => 2 * i + 1;
	const tracks: string[] = [];
	tracks[track(fi) - 1] = `${files}px`;
	tracks[track(fi) + filesSign - 1] = `${filesSplit}px`;
	tracks[track(ei) - 1] = `${editor}px`;
	tracks[track(ei) + editorSign - 1] = `${PANEL_SPLIT}px`;
	tracks[track(ai) - 1] = fill;
	const slot = (column: number): GridSlot => ({ column: String(column), row: '1' });
	return {
		files: slot(track(fi)),
		filesSplit: slot(track(fi) + filesSign),
		editor: slot(track(ei)),
		editorSplit: slot(track(ei) + editorSign),
		agent: slot(track(ai)),
		filesSign,
		editorSign,
		columns: tracks.join(' '),
		rows: '1fr'
	};
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function panelMetrics(g: PanelGeometry, width: number, height: number, vertical: boolean, collapsed: boolean) {
	const leftMax = Math.max(0, width - (vertical ? PANEL_SPLIT + PANEL_MIN_COL : 2 * PANEL_SPLIT + 2 * PANEL_MIN_COL));
	const leftMin = Math.min(PANEL_MIN_COL, leftMax);
	const left = collapsed ? 0 : clamp(g.left, leftMin, leftMax);
	const available = Math.max(0, width - left - (collapsed ? 0 : PANEL_SPLIT) - PANEL_SPLIT);
	const centerMin = Math.min(PANEL_MIN_COL, available / 2);
	const centerMax = Math.max(centerMin, available - centerMin);
	const rows = Math.max(0, height - PANEL_SPLIT);
	const topMin = Math.min(PANEL_MIN_ROW, rows / 2);
	const topMax = Math.max(topMin, rows - topMin);
	return {
		left, leftMin, leftMax, available,
		center: clamp(available * g.centerRatio, centerMin, centerMax), centerMin, centerMax,
		top: clamp(rows * g.topRatio, topMin, topMax), topMin, topMax, rows
	};
}

export function resizePanel(g: PanelGeometry, axis: SplitterAxis, value: number, width: number, height: number, vertical: boolean, collapsed: boolean): PanelGeometry {
	const b = panelMetrics(g, width, height, vertical, collapsed);
	if (axis === 'left') return { ...g, left: clamp(value, b.leftMin, b.leftMax) };
	if (vertical) return { ...g, topRatio: b.rows ? clamp(value, b.topMin, b.topMax) / b.rows : 0.5 };
	return { ...g, centerRatio: b.available ? clamp(value, b.centerMin, b.centerMax) / b.available : 0.5 };
}

export function panelKeyValue(key: string, current: number, min: number, max: number, vertical: boolean, shift: boolean, reverse = false): number | null {
	if (key === 'Home') return min;
	if (key === 'End') return max;
	// Con la colonna dall'altro lato del divisore la freccia muove comunque il divisore nel suo verso.
	const before = vertical ? 'ArrowUp' : 'ArrowLeft';
	const after = vertical ? 'ArrowDown' : 'ArrowRight';
	const decrease = reverse ? after : before;
	const increase = reverse ? before : after;
	if (key !== decrease && key !== increase) return null;
	return clamp(current + (key === increase ? 1 : -1) * (shift ? 40 : 10), min, max);
}
