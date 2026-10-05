/**
 * Tinte d'identita' dei ruoli (DESIGN.md, Colors D1): il pallino del ruolo nel
 * menu del composer e nei badge `!ruolo` del companion usa la rampa
 * d'inchiostro delle tessere con questa tinta. `default` non ha tinta: resta
 * `--brand-ink`.
 */
export const ROLE_HUES: Readonly<Record<string, number>> = {
	plan: 230,
	smol: 140,
	slow: 300,
	vision: 80,
	task: 35,
	commit: 180,
	advisor: 320
};

