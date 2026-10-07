/**
 * Localizzazione dinamica dei controlli diagnostici di Studio Doctor.
 * Mappa gli ID stabili e le frasi fisse generate dal backend Rust sui messaggi Paraglide.
 */
import { m } from '$lib/paraglide/messages.js';
import type { DoctorItem } from '$lib/stores/doctor.svelte';

export function getDoctorCheckName(item: DoctorItem): string {
	switch (item.id) {
		case 'omp_binary':
			return m.doctor_check_omp_binary();
		case 'omp_version':
			return m.doctor_check_omp_version();
		case 'omp_rpc':
			return m.doctor_check_omp_rpc();
		case 'git_lanes_merge':
			return m.doctor_check_git_lanes_merge();
		case 'git_version':
			return m.doctor_check_git_version();
		case 'shell_bash':
			return item.name.includes('Git Bash')
				? m.doctor_check_shell_bash_windows()
				: m.doctor_check_shell_bash_unix();
		case 'git_repo_status':
			return m.doctor_check_git_repo_status();
		case 'pty_backend':
			return m.doctor_check_pty_backend();
		case 'sqlite_history_db':
			return m.doctor_check_sqlite_history_db();
		case 'sqlite_stats_db':
			return m.doctor_check_sqlite_stats_db();
		case 'sqlite_agent_db':
			return m.doctor_check_sqlite_agent_db();
		case 'provider_none':
			return m.doctor_check_provider_none();
		default:
			return item.name;
	}
}

export function getDoctorCheckValue(item: DoctorItem): string {
	const val = item.value;
	if (!val) return '';

	if (val === 'Non trovato nel PATH di sistema') {
		return m.doctor_val_omp_not_found();
	}
	if (val === 'Sconosciuta') {
		return m.doctor_val_unknown();
	}
	if (val === 'Non rilevabile (eseguibile assente)') {
		return m.doctor_val_version_missing();
	}
	if (val === 'Non disponibile') {
		return m.doctor_val_not_available();
	}
	if (val === 'Non trovato o non funzionante') {
		return m.doctor_val_git_not_found();
	}
	if (val === 'Non rilevato nei percorsi standard') {
		return m.doctor_val_bash_not_in_standard_paths();
	}
	if (val === 'bash non rilevata in PATH') {
		return m.doctor_val_bash_not_in_path();
	}
	if (val === 'Nessun progetto aperto in primo piano') {
		return m.doctor_val_repo_none();
	}
	if (val === 'La cartella attiva non è un repository Git') {
		return m.doctor_val_repo_not_a_repo();
	}
	if (val.startsWith('ConPTY operativo')) {
		return m.doctor_val_pty_conpty();
	}
	if (val.startsWith('POSIX openpty operativo')) {
		return m.doctor_val_pty_posix();
	}
	if (val.startsWith('Non ancora creato')) {
		return m.doctor_val_sqlite_not_created();
	}
	if (val === 'Aperto ma PRAGMA query_only non attivo') {
		return m.doctor_val_sqlite_query_only_inactive();
	}
	if (val === 'Nessun provider configurato in Studio') {
		return m.doctor_val_provider_none();
	}
	if (val === 'Non verificabile: baseUrl mancante nella configurazione modelli') {
		return m.doctor_val_provider_missing_base_url();
	}
	if (val.startsWith('Configurato · connettività non verificabile')) {
		return m.doctor_val_provider_endpoint_unknown();
	}

	const repoCleanMatch = val.match(/^Ramo `(.+?)` · working tree pulito$/);
	if (repoCleanMatch) {
		return m.doctor_val_repo_clean({ branch: repoCleanMatch[1] });
	}
	const repoModMatch = val.match(/^Ramo `(.+?)` · (\d+) file modificati non committati$/);
	if (repoModMatch) {
		return m.doctor_val_repo_modified({ branch: repoModMatch[1], count: repoModMatch[2] });
	}

	return val;
}

export function getDoctorCheckRecommendation(item: DoctorItem): string | undefined {
	const rec = item.recommendation;
	if (!rec) return undefined;

	if (rec.includes('Installa omp eseguendo') || rec.includes('aggiungilo al PATH')) {
		return m.doctor_rec_omp_install();
	}
	if (rec.includes('omp --version')) {
		return m.doctor_rec_omp_version_verify();
	}
	if (rec === 'Installare omp per rilevare la versione') {
		return m.doctor_rec_install_omp_version();
	}
	if (rec.includes('--mode rpc-ui')) {
		return m.doctor_rec_omp_rpc_update();
	}
	if (rec === 'Installare omp per abilitare il runtime delle sessioni') {
		return m.doctor_rec_install_omp_rpc();
	}
	if (rec.includes('Installa Git e assicurati che sia disponibile nel PATH')) {
		return m.doctor_rec_git_install();
	}
	if (rec.includes('Installa Git for Windows con i componenti bash')) {
		return m.doctor_rec_bash_install_windows();
	}
	if (rec.includes('/bin/bash sia installata e accessibile')) {
		return m.doctor_rec_bash_verify_unix();
	}
	if (rec.includes('Inizializza un repository con `git init`')) {
		return m.doctor_rec_repo_init();
	}
	if (rec.includes('Verifica che il sistema supporti ConPTY')) {
		return m.doctor_rec_pty_conpty();
	}
	if (rec.includes('/dev/pts')) {
		return m.doctor_rec_pty_posix();
	}
	if (rec.includes('Assicurarsi che la connessione al DB imponga la sola lettura')) {
		return m.doctor_rec_sqlite_readonly();
	}
	if (rec.includes('Configura almeno un provider')) {
		return m.doctor_rec_provider_none();
	}
	if (rec.includes('limitazioni firewall aziendali')) {
		return m.doctor_rec_provider_network();
	}

	return rec;
}
