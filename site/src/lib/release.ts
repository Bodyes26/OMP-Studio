// Versione e installer letti dall'ultima release stabile di GitHub al momento della build.
// Ogni release stabile ricompila il sito (deploy hook di Cloudflare chiamato dal workflow),
// quindi i pulsanti puntano sempre agli installer pubblicati, senza numeri scritti a mano.
const REPO = 'Bodyes26/OMP-Studio';

export type Platform = 'windows' | 'macos' | 'linux';

export interface Installer {
	platform: Platform;
	label: string;
	url: string;
	sizeMb: number;
}

export interface Release {
	version: string;
	url: string;
	date: string;
	windows: Installer;
	macos: Installer;
	linux: { deb: Installer; appImage: Installer };
	checksums: string;
}

interface GithubAsset {
	name: string;
	size: number;
	browser_download_url: string;
}

function pick(assets: GithubAsset[], suffix: string, platform: Platform, label: string): Installer {
	const asset = assets.find((a) => a.name.endsWith(suffix));
	// Una release senza l'installer atteso non deve produrre un sito con un pulsante rotto.
	if (!asset) throw new Error(`Ultima release di ${REPO} senza installer "*${suffix}"`);
	return { platform, label, url: asset.browser_download_url, sizeMb: Math.round(asset.size / 1e6) };
}

let cached: Promise<Release> | undefined;

export function latestRelease(): Promise<Release> {
	cached ??= (async () => {
		const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'omp-studio-site' };
		// Nella build di Cloudflare il token e' facoltativo: alza solo il limite di richieste.
		const token = import.meta.env.GITHUB_TOKEN as string | undefined;
		if (token) headers.Authorization = `Bearer ${token}`;
		const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
		if (!res.ok) throw new Error(`GitHub releases/latest: HTTP ${res.status}`);
		const data = (await res.json()) as { tag_name: string; html_url: string; published_at: string; assets: GithubAsset[] };
		const assets = data.assets;
		const sums = assets.find((a) => a.name === 'SHA256SUMS.txt');
		return {
			version: data.tag_name.replace(/^v/, ''),
			url: data.html_url,
			date: data.published_at.slice(0, 10),
			windows: pick(assets, '_x64-setup.exe', 'windows', 'Installer (.exe)'),
			macos: pick(assets, '_universal.dmg', 'macos', 'Disk image (.dmg)'),
			linux: {
				deb: pick(assets, '_amd64.deb', 'linux', '.deb'),
				appImage: pick(assets, '_amd64.AppImage', 'linux', 'AppImage')
			},
			checksums: sums ? sums.browser_download_url : data.html_url
		};
	})();
	return cached;
}
