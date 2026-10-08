// Etichette localizzate del pacchetto note visive (Gate R42).
import { m } from '$lib/paraglide/messages.js';
import type { LabNotesLabels } from './visualNotes';

export function labNotesLabels(): LabNotesLabels {
	return {
		element: m.lab_pkg_element(),
		elements: (count) => m.lab_pkg_elements({ count: String(count) }),
		area: (w, h, x, y) => m.lab_pkg_area({ w: String(w), h: String(h), x: String(x), y: String(y) }),
		areaCount: (count, groups) => m.lab_pkg_area_count({ count: String(count), groups: String(groups) }),
		note: m.lab_pkg_note(),
		noNote: m.lab_pkg_no_note(),
		stale: m.lab_pkg_stale(),
		missing: m.lab_pkg_missing(),
		callsite: m.lab_pkg_callsite(),
		ancestor: m.lab_pkg_ancestor(),
		noSource: m.lab_pkg_no_source(),
		instance: (index, count) => m.lab_pkg_instance({ index: String(index), count: String(count) }),
		moreGroups: (count) => m.lab_pkg_more_groups({ count: String(count) }),
		selector: m.lab_pkg_selector(),
		classes: m.lab_pkg_classes(),
		text: m.lab_pkg_text(),
		frame: m.lab_pkg_frame()
	};
}
