export interface PanelGeometry {
	left: number;
	centerRatio: number;
	topRatio: number;
}

export type PanelGeometries = Record<string, PanelGeometry>;
export type SplitterAxis = 'left' | 'center';
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

export function panelKeyValue(key: string, current: number, min: number, max: number, vertical: boolean, shift: boolean): number | null {
	if (key === 'Home') return min;
	if (key === 'End') return max;
	const decrease = vertical ? 'ArrowUp' : 'ArrowLeft';
	const increase = vertical ? 'ArrowDown' : 'ArrowRight';
	if (key !== decrease && key !== increase) return null;
	return clamp(current + (key === increase ? 1 : -1) * (shift ? 40 : 10), min, max);
}
