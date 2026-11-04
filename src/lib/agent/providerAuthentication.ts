export type AuthenticationOutcome = 'verified' | 'reauth_required' | 'unavailable';

/** Solo gli errori del trasporto/provider, mai il testo generato dall'assistente. */
export function authenticationFailureOutcome(error: string): AuthenticationOutcome | null {
	if (/(?:\b401\b|\bunauthorized\b|\bunauthenticated\b|invalid[_ -](?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|grant)|(?:access|refresh)[_ -]?token.{0,40}(?:revoked|expired|invalid)|authentication[_ -]?(?:failed|required)|(?:please|must|need to) (?:log|sign) in|not logged in)/i.test(error)) {
		return 'reauth_required';
	}
	if (/(?:\b429\b|rate[_ -]?limit|quota.{0,30}(?:exceeded|exhausted)|insufficient[_ -](?:quota|credits)|usage[_ -]?limit)/i.test(error)) {
		return 'verified';
	}
	if (/(?:\btimeout\b|timed out|\bECONN\w*\b|\bENOTFOUND\b|\bEAI_AGAIN\b|network error|fetch failed|\b50[0234]\b)/i.test(error)) {
		return 'unavailable';
	}
	return null;
}
