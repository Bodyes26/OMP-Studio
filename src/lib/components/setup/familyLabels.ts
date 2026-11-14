/**
 * Etichette delle famiglie di modelli usate dal preset dei ruoli (SET-042).
 *
 * Il backend manda un `familyId` (`anthropic.opus`, `google.flash_lite`, …) e
 * mai un'etichetta già scritta: la frase che l'utente legge è interfaccia, e
 * deve seguire la lingua di Studio. Qui c'è la sola traduzione, più il
 * ripiego sull'id per le famiglie che omp aggiungerà dopo di noi: perderne una
 * non deve rompere la card, al massimo la rende meno bella.
 *
 * I nomi commerciali (Opus, Sonnet, Codex, Gemini…) non si traducono.
 */
import { m } from '#lib/paraglide/messages.js';

/** Etichetta breve: è il soggetto delle frasi «Famiglia {family} …». */
const LABELS: Record<string, () => string> = {
	'anthropic.opus': () => m.setup2_roles_family_opus(),
	'anthropic.sonnet': () => m.setup2_roles_family_sonnet(),
	'anthropic.haiku': () => m.setup2_roles_family_haiku(),
	'openai.sol': () => m.setup2_roles_family_sol(),
	'openai.terra': () => m.setup2_roles_family_terra(),
	'openai.luna': () => m.setup2_roles_family_luna(),
	'openai.astra': () => m.setup2_roles_family_astra(),
	'openai.codex': () => m.setup2_roles_family_codex(),
	'openai.gpt': () => m.setup2_roles_family_gpt(),
	'openai.mini': () => m.setup2_roles_family_mini(),
	'google.pro': () => m.setup2_roles_family_gemini_pro(),
	'google.flash': () => m.setup2_roles_family_gemini_flash(),
	'google.flash_lite': () => m.setup2_roles_family_gemini_flash_lite(),
	'cursor.composer': () => m.setup2_roles_family_composer(),
	'deepseek.pro': () => m.setup2_roles_family_deepseek_pro(),
	'deepseek.flash': () => m.setup2_roles_family_deepseek_flash(),
	'deepseek.chat': () => m.setup2_roles_family_deepseek_chat(),
	'deepseek.reasoner': () => m.setup2_roles_family_deepseek_reasoner(),
	'xai.grok': () => m.setup2_roles_family_grok(),
	'xai.grok_mini': () => m.setup2_roles_family_grok_mini(),
	'zai.glm': () => m.setup2_roles_family_glm(),
	'zai.glm_flash': () => m.setup2_roles_family_glm_flash(),
	'mistral.large': () => m.setup2_roles_family_mistral_large(),
	'mistral.small': () => m.setup2_roles_family_mistral_small(),
	'mistral.codestral': () => m.setup2_roles_family_codestral()
};

export function familyLabel(familyId: string | null | undefined): string {
	if (!familyId) return '';
	const known = LABELS[familyId];
	return known ? known() : familyId;
}
