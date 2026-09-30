import { invoke } from '@tauri-apps/api/core';

export type DoctorCategory = 'omp' | 'shell_git' | 'pty' | 'sqlite' | 'providers';
export type DoctorStatus = 'ok' | 'warn' | 'error';

export interface DoctorItem {
	id: string;
	category: DoctorCategory;
	name: string;
	status: DoctorStatus;
	value: string;
	recommendation?: string | null;
}

export interface SystemInfo {
	os: string;
	arch: string;
	osVersion: string;
	studioVersion: string;
	timestamp: string;
}

export interface DoctorReport {
	system: SystemInfo;
	items: DoctorItem[];
	overallStatus: DoctorStatus;
	elapsedMs: number;
	markdownReport: string;
}

class DoctorStore {
	report = $state<DoctorReport | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	copiedToast = $state(false);
	filter = $state<'all' | 'issues'>('all');

	get issuesCount(): number {
		if (!this.report) return 0;
		return this.report.items.filter((i) => i.status === 'warn' || i.status === 'error').length;
	}

	get errorsCount(): number {
		if (!this.report) return 0;
		return this.report.items.filter((i) => i.status === 'error').length;
	}

	get warningsCount(): number {
		if (!this.report) return 0;
		return this.report.items.filter((i) => i.status === 'warn').length;
	}

	get filteredItems(): DoctorItem[] {
		if (!this.report) return [];
		if (this.filter === 'issues') {
			return this.report.items.filter((i) => i.status === 'warn' || i.status === 'error');
		}
		return this.report.items;
	}

	async runDoctor(projectPath?: string): Promise<DoctorReport | null> {
		this.loading = true;
		this.error = null;
		try {
			const res = await invoke<DoctorReport>('run_studio_doctor', {
				projectPath: projectPath || null
			});
			this.report = res;
			return res;
		} catch (err) {
			this.error = String(err);
			return null;
		} finally {
			this.loading = false;
		}
	}

	async copyReport(): Promise<boolean> {
		if (!this.report) return false;
		try {
			await navigator.clipboard.writeText(this.report.markdownReport);
			this.copiedToast = true;
			setTimeout(() => {
				this.copiedToast = false;
			}, 2500);
			return true;
		} catch (err) {
			console.error('Impossibile copiare il report del doctor negli appunti', err);
			return false;
		}
	}
}

export const doctorStore = new DoctorStore();
