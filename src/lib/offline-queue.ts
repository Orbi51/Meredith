/**
 * The offline capture queue (§11).
 *
 * Capture is the one thing that must never fail. If the user types a task on
 * the métro and it vanishes, they stop trusting the app with anything — so a
 * capture made offline is written to IndexedDB immediately and posted when the
 * connection returns.
 *
 * IndexedDB rather than localStorage because the queue must survive the tab
 * being killed mid-flush, and localStorage writes are lost on a hard close.
 *
 * Runs in the browser only.
 */

const DB_NAME = 'capacity-offline';
const STORE = 'captures';
const DB_VERSION = 1;

export type QueuedCapture = {
	id?: number;
	text: string;
	capturedAt: string;
};

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE, mode);
				const request = run(transaction.objectStore(STORE));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			})
	);
}

export async function enqueue(text: string): Promise<void> {
	await tx('readwrite', (store) =>
		store.add({ text, capturedAt: new Date().toISOString() } satisfies QueuedCapture)
	);
}

export async function queued(): Promise<QueuedCapture[]> {
	return tx<QueuedCapture[]>('readonly', (store) => store.getAll() as IDBRequest<QueuedCapture[]>);
}

export async function queueSize(): Promise<number> {
	return tx<number>('readonly', (store) => store.count());
}

/**
 * Post everything waiting, oldest first, removing each only once the server
 * has confirmed it.
 *
 * An entry that fails stays in the queue — losing a capture to a flaky
 * connection is exactly the failure this exists to prevent. Returns how many
 * were sent.
 */
export async function flush(): Promise<number> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

	const pending = (await queued()).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
	let sent = 0;

	for (const capture of pending) {
		try {
			const response = await fetch('/api/capture', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: capture.text, capturedAt: capture.capturedAt })
			});
			if (!response.ok) break; // stop on the first failure; try again later
			if (capture.id !== undefined) {
				await tx('readwrite', (store) => store.delete(capture.id as number));
			}
			sent++;
		} catch {
			break;
		}
	}

	return sent;
}

/** Flush now, and again whenever the connection comes back. */
export function startFlushing(onFlushed?: (count: number) => void) {
	const run = () => {
		flush()
			.then((count) => {
				if (count > 0) onFlushed?.(count);
			})
			.catch(() => {
				/* offline again; the queue keeps */
			});
	};

	run();
	window.addEventListener('online', run);
	return () => window.removeEventListener('online', run);
}
