/**
 * Rileva un nome amichevole per il dispositivo corrente a partire dal User-Agent,
 * per precompilare il campo durante il primo abbinamento (es. "iPhone Safari", "Mac Chrome").
 */
export function detectDefaultDeviceName(userAgent?: string): string {
	const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
	if (!ua) {
		return 'Browser';
	}

	let os = 'Dispositivo';
	if (/iPhone/i.test(ua)) {
		os = 'iPhone';
	} else if (/iPad/i.test(ua)) {
		os = 'iPad';
	} else if (/Macintosh|Mac OS X/i.test(ua)) {
		os = 'Mac';
	} else if (/Windows/i.test(ua)) {
		os = 'Windows';
	} else if (/Android/i.test(ua)) {
		os = 'Android';
	} else if (/Linux/i.test(ua)) {
		os = 'Linux';
	}

	let browser = 'Browser';
	if (/Edg\//i.test(ua)) {
		browser = 'Edge';
	} else if (/Chrome\/|CriOS\//i.test(ua) && !/Edg\//i.test(ua)) {
		browser = 'Chrome';
	} else if (/Firefox\/|FxiOS\//i.test(ua)) {
		browser = 'Firefox';
	} else if (/Safari/i.test(ua) && !/Chrome\/|CriOS\//i.test(ua)) {
		browser = 'Safari';
	}

	return `${os} ${browser}`;
}
