'use strict';

(() => {
	const ECHO_EVERY_MS = 10_000;
	const $ = (id) => document.getElementById(id);

	let ws = null;
	let authedAt = 0;
	let beats = 0;
	let uptimeTimer = null;
	let echoTimer = null;

	function log(text) {
		const item = document.createElement('li');
		item.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
		$('log').prepend(item);
	}

	function duration(ms) {
		const total = Math.floor(ms / 1000);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		return `${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${s}s`;
	}

	function setConnected(connected) {
		$('connect-btn').disabled = connected;
		$('disconnect-btn').disabled = !connected;
	}

	function stopTimers() {
		clearInterval(uptimeTimer);
		clearInterval(echoTimer);
		uptimeTimer = null;
		echoTimer = null;
	}

	function connect(token) {
		const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/v1/diag`;
		$('status').textContent = 'connecting';
		log(`Opening ${url}`);
		setConnected(true);
		ws = new WebSocket(url);

		ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));

		ws.onmessage = (event) => {
			let msg;
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}
			if (msg.type === 'welcome') {
				authedAt = Date.now();
				beats = 0;
				$('status').textContent = 'connected';
				log(`Authenticated, server heartbeat every ${msg.heartbeatMs / 1000}s`);
				uptimeTimer = setInterval(() => {
					$('uptime').textContent = duration(Date.now() - authedAt);
				}, 1000);
				echoTimer = setInterval(() => {
					ws?.send(JSON.stringify({ type: 'echo', t: performance.now() }));
				}, ECHO_EVERY_MS);
			} else if (msg.type === 'ping') {
				beats += 1;
				$('beats').textContent = String(beats);
				ws?.send(JSON.stringify({ type: 'pong', seq: msg.seq }));
			} else if (msg.type === 'echo') {
				$('rtt').textContent = `${Math.round(performance.now() - msg.t)} ms`;
			}
		};

		ws.onerror = () => log('WebSocket error, see the close code below');

		ws.onclose = (event) => {
			stopTimers();
			const lasted = authedAt ? ` after ${duration(Date.now() - authedAt)}` : '';
			const reason = event.reason ? `, ${event.reason}` : '';
			$('status').textContent = `closed (${event.code}${reason})`;
			log(`Closed${lasted}: code ${event.code}${reason}`);
			authedAt = 0;
			ws = null;
			setConnected(false);
		};
	}

	document.addEventListener('DOMContentLoaded', () => {
		$('connect').addEventListener('submit', (event) => {
			event.preventDefault();
			const input = $('token');
			const token = input.value.trim();
			input.value = '';
			if (token) connect(token);
		});
		$('disconnect-btn').addEventListener('click', () => ws?.close(1000, 'closed by user'));
	});
})();
