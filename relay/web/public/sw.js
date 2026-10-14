/**
 * Service Worker per la PWA di controllo remoto di OMP Studio.
 * - Cache-first per /assets/* (immutabili con hash)
 * - Network-first per le navigazioni HTML con fallback su index.html in cache
 * - MAI intercettare /v1/*, /healthz, /diag*
 * - skipWaiting() e clients.claim() per attivazione immediata
 */

const CACHE_NAME = 'omp-studio-remote-v1';

self.addEventListener('install', (event) => {
	self.skipWaiting();
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(['/', '/index.html', '/manifest.webmanifest']);
		})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	// MAI intercettare le chiamate API del relay, l'endpoint di salute o la diagnosi
	if (
		url.pathname.startsWith('/v1/') ||
		url.pathname.startsWith('/healthz') ||
		url.pathname.startsWith('/diag')
	) {
		return;
	}

	// Solo richieste GET
	if (event.request.method !== 'GET') {
		return;
	}

	// 1. Navigazioni HTML: network-first con fallback a index.html in cache
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					if (response.ok) {
						const clone = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
					}
					return response;
				})
				.catch(() => {
					return caches.match('/index.html').then((cached) => {
						return cached || caches.match('/');
					});
				})
		);
		return;
	}

	// 2. Asset statici bundlati (/assets/*): cache-first
	if (url.pathname.startsWith('/assets/')) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				if (cached) {
					return cached;
				}
				return fetch(event.request).then((response) => {
					if (response.ok) {
						const clone = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
					}
					return response;
				});
			})
		);
		return;
	}

	// 3. Altre risorse (icone, manifest): cache con aggiornamento di sottofondo
	event.respondWith(
		caches.match(event.request).then((cached) => {
			const fetchPromise = fetch(event.request)
				.then((response) => {
					if (response.ok) {
						const clone = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
					}
					return response;
				})
				.catch(() => cached);
			return cached || fetchPromise;
		})
	);
});

// ---------------------------------------------------------------------------
// Notifiche Web Push (Gate R44 - R9)
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
	let data = { title: 'OMP Studio', body: 'Nuovo aggiornamento' };
	if (event.data) {
		try {
			data = event.data.json();
		} catch {
			data = { title: 'OMP Studio', body: event.data.text() };
		}
	}

	const title = data.title || 'OMP Studio';
	const options = {
		body: data.body || '',
		icon: data.icon || '/icons/icon-192.png',
		badge: data.badge || '/icons/apple-touch-icon.png',
		tag: data.tag || 'omp-studio-notification',
		data: data.data || {},
		renotify: true
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const targetData = event.notification.data || {};
	const targetUrl = new URL('/', self.location.origin);
	if (targetData.hostId) targetUrl.searchParams.set('host', targetData.hostId);
	if (targetData.projectId) targetUrl.searchParams.set('project', targetData.projectId);
	if (targetData.laneId) targetUrl.searchParams.set('lane', targetData.laneId);
	if (targetData.requestId) targetUrl.searchParams.set('request', targetData.requestId);

	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if ('focus' in client) {
						if (targetData.hostId || targetData.projectId) {
							client.postMessage({
								type: 'notification_focus',
								hostId: targetData.hostId,
								projectId: targetData.projectId,
								laneId: targetData.laneId,
								requestId: targetData.requestId
							});
						}
						return client.focus();
					}
				}
				if (self.clients.openWindow) {
					return self.clients.openWindow(targetUrl.href);
				}
			})
	);
});
