"use strict";

/*
 * Nutstore transport status detection (lightweight, nonblocking).
 *
 * Model: ATTACHMENT_STATE and FILE_TRANSPORT_STATE are separate.
 * Transport status is best-effort only and NEVER blocks a save:
 *   SYNCED                - Nutstore client detected as active; transport assumed in progress
 *   WAITING_FOR_NUTSTORE  - Nutstore installed but client appears not to be running
 *   LOCAL_ONLY            - no Nutstore installation detected on this machine
 *   UNKNOWN               - detection failed
 *
 * Detection heuristic: mtime of the Nutstore client log (~/.nutstore/logs/client.log)
 * within a freshness window means the client is alive. This is intentionally
 * cheap and read-only.
 */

const NUTSTORE_LOG_STALE_MS = 3 * 60 * 1000;

this.nutstoreClientLogPath = function () {
	try {
		let home = Services.dirsvc.get("Home", Ci.nsIFile).path;
		return PathUtils.join(home, ".nutstore", "logs", "client.log");
	}
	catch (_) { return null; }
};

this.fileTransportState = async function () {
	let logPath = this.nutstoreClientLogPath();
	if (!logPath) return { state: "UNKNOWN", nutstore_detected: null, client_log_age_ms: null };
	try {
		if (!(await IOUtils.exists(logPath))) {
			return { state: "LOCAL_ONLY", nutstore_detected: false, client_log_age_ms: null };
		}
		let stat = await IOUtils.stat(logPath);
		let ageMs = Date.now() - stat.lastModified;
		if (ageMs <= NUTSTORE_LOG_STALE_MS) {
			return { state: "SYNCED", nutstore_detected: true, client_log_age_ms: ageMs };
		}
		return { state: "WAITING_FOR_NUTSTORE", nutstore_detected: true, client_log_age_ms: ageMs };
	}
	catch (_) { return { state: "UNKNOWN", nutstore_detected: null, client_log_age_ms: null }; }
};

this.maybeNotifyTransportWaiting = function (state, transport) {
	if (transport?.state !== "WAITING_FOR_NUTSTORE") return;
	if (state.transportWaitNotified) return;
	state.transportWaitNotified = true;
	try {
		Services.prompt.alert(null, "Zotero LinkSync",
			"LinkSync: PDF saved locally. Nutstore is not currently syncing.");
	}
	catch (error) { Zotero.logError(error); }
};
