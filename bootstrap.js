"use strict";

/*
 * Zotero LinkSync 0.2.0 Stable Candidate
 *
 * Frozen architecture (from 0.2.0-rc4, cross-device verified):
 *   A. Drag workflow:    external local PDF drag -> linked-from-birth (linkMode=2)
 *                        -> Linked Attachment Base Directory -> relative attachments: path
 *   B. Connector workflow: Zotero Connector -> downloadAssociatedFiles=false ->
 *                        native metadata parent -> SaveSession.saveItems hook ->
 *                        LinkSync PDF acquisition -> linkFromFile() (linkMode=2)
 *
 * Nutstore transport is nonblocking: attachment success and file transport
 * success are recorded separately. Nutstore being offline never blocks a save.
 *
 * Scope: My Library only, regular bibliographic parents, PDF content type.
 * Unsupported scope is safely skipped / delegated to Zotero native behavior.
 */

const MODULES = [
	"modules/integrity.js",
	"modules/logger.js",
	"modules/fileTransfer.js",
	"modules/linkedAttachment.js",
	"modules/nutstoreStatus.js",
	"hooks/dropInterceptor.js",
	"hooks/localPDFImport.js",
	"hooks/connectorSaveSession.js",
	"hooks/standaloneEndpoint.js"
];

var LinkSync = {
	pluginID: "zotero-linksync@example.com",
	version: "0.2.2.8",
	mode: "RC5_DIRECT_PDF_CANDIDATE",
	productionMode: true,
	machineRole: "",            // optional label, from pref extensions.zotero.linksync.machineRole
	pdfBase: null,              // resolved at startup from Zotero Linked Attachment Base Directory
	incrementalRoot: null,      // parent of pdfBase
	logDir: null,               // <incrementalRoot>/_logs/<machineRole|default>
	logRoot: null,              // <logDir>/production-imports
	statusPath: null,           // <logDir>/linksync-status.json
	runtimeStatusPath: null,    // <logDir>/connector-runtime.json
	standaloneRuntimeStatusPath: null, // <logDir>/standalone-runtime.json
	transportWaitNotified: false,
	rootURI: null,
	windows: new Set(),
	reconcileTimer: null,
	dragRefreshTimer: null,
	modules: {}
};

// Shared ownership survives a bootstrap scope replacement. References are
// released only after restoration, never by module reload.
const LIFECYCLE_SLOT = "__zoteroLinkSyncLifecycleOwner";
var lifecycleEvents = [];
var startupTask = null;
var stopping = false;

function trace(event, detail = {}) {
	lifecycleEvents.push({ time: new Date().toISOString(), event, ...detail });
	Zotero.debug("LinkSync lifecycle " + event + " " + JSON.stringify(detail));
}

async function flushTrace(state = LinkSync) {
	if (!state.logDir) return;
	await Zotero.File.putContentsAsync(PathUtils.join(state.logDir, "lifecycle-runtime.json"),
		JSON.stringify({ version: LinkSync.version, events: lifecycleEvents }, null, 2));
}

function runtimeOwners() {
	let owners = new Set();
	if (Zotero[LIFECYCLE_SLOT]) owners.add(Zotero[LIFECYCLE_SLOT]);
	// Recover rc5 orphaned scopes without recapturing wrappers as originals.
	let functions = [Zotero.Attachments.importFromFile,Zotero.Server.Connector.SaveSession.prototype.saveItems,
		Zotero.Server.Endpoints["/connector/saveStandaloneAttachment"]?.prototype.init,
		...Zotero.getMainWindows().map(w => w.ZoteroPane?.itemsView?.onDrop)];
	for (let fn of functions) {
		if (typeof fn !== "function" || !/processConnectorItem|processStandaloneRequest|pdfBase|localPDFImport/.test(String(fn))) continue;
		let owner = Components.utils.getGlobalForObject(fn).LinkSync;
		if (owner?.pluginID === LinkSync.pluginID) owners.add(owner);
	}
	return owners;
}

function restoreState(state) {
	let failures = [];
	let modules = state.modules;
	let pref = modules.connectorPreferenceRecord || modules.connectorSaveSessionRecord;
	state.pdfBase = null; // Stop admission before removing handlers.
	if (state.reconcileTimer) {
		clearInterval(state.reconcileTimer);
		state.reconcileTimer = null;
	}
	if (state.dragRefreshTimer) { clearInterval(state.dragRefreshTimer); state.dragRefreshTimer = null; }
	function step(name, action, verify) {
		trace("RESTORE_" + name + "_BEGIN");
		try {
			action();
			if (!verify()) throw new Error(name + " restoration verification failed");
			trace("RESTORE_" + name + "_RESULT", { result: "PASS" });
		}
		catch (error) {
			failures.push(error);
			trace("RESTORE_" + name + "_RESULT", { result: "FAIL", error: String(error), stack: error.stack || "" });
			Zotero.logError(error);
		}
	}
	let localImport = modules.localImportRecord;
	step("LOCAL_IMPORT", () => modules.restoreLocalPDFImport?.(state),
		() => !localImport || Zotero.Attachments.importFromFile === localImport.original);
	let endpoint = modules.standaloneEndpointRecord;
	step("STANDALONE", () => modules.restoreStandaloneEndpoint?.(state),
		() => !endpoint || endpoint.endpoints[endpoint.path] === endpoint.originalEndpoint);
	let connector = modules.connectorSaveSessionRecord;
	step("SAVESESSION", () => modules.restoreConnectorSaveSession?.(state, true),
		() => !connector || connector.prototype.saveItems === connector.originalSaveItems);
	let drag = [...(modules.interceptorRecords?.entries() || [])];
	step("DRAG", () => {
		for (let [window] of drag) modules.restoreDropInterceptor(state, window);
	}, () => drag.every(([, record]) => record.view.onDrop === record.originalOnDrop));
	trace("RESTORE_PREF_ORIGINAL_VALUE", {
		value: pref?.originalDownloadAssociatedFiles ?? null,
		had_user_value: pref?.originalPrefHadUserValue ?? "UNKNOWN_LEGACY_RC5"
	});
	step("PREF", () => modules.restoreConnectorPreference?.(state), () => !pref || (
		Zotero.Prefs.get("downloadAssociatedFiles") === pref.originalDownloadAssociatedFiles
		&& (pref.originalPrefHadUserValue === undefined || Services.prefs.prefHasUserValue(
			"extensions.zotero.downloadAssociatedFiles") === pref.originalPrefHadUserValue)));
	if (!failures.length) {
		state.windows.clear();
		if (Zotero[LIFECYCLE_SLOT] === state) delete Zotero[LIFECYCLE_SLOT];
	}
	return failures;
}

function install() {}

async function startup(data, reason) {
	trace("BOOTSTRAP_STARTUP_ENTER", { reason });
	if (startupTask) return startupTask;
	stopping = false;
	startupTask = (async () => {
		// A repeated startup in the same active scope is an idempotent no-op.
		if (Zotero[LIFECYCLE_SLOT] === LinkSync && LinkSync.pdfBase) return;
		for (let owner of runtimeOwners()) {
			if (restoreState(owner).length) throw new Error("Previous runtime restoration failed; startup refused");
		}
		Zotero[LIFECYCLE_SLOT] = LinkSync;
		await startWorkflows(data);
	})().catch(error => {
		trace("BOOTSTRAP_STARTUP_EXCEPTION", { error: String(error), stack: error.stack || "" });
		restoreState(LinkSync);
		throw error;
	}).finally(async () => {
		trace("BOOTSTRAP_STARTUP_EXIT", { stopping });
		await flushTrace();
	});
	try { await startupTask; }
	finally { startupTask = null; }
}

async function startWorkflows({ rootURI }) {
	LinkSync.rootURI = rootURI;
	if (!LinkSync.modulesLoaded) {
		for (let modulePath of MODULES) {
			Services.scriptloader.loadSubScript(rootURI + modulePath, LinkSync.modules);
		}
		LinkSync.modulesLoaded = true;
	}
	await Zotero.initializationPromise;
	await Zotero.unlockPromise;
	await Zotero.uiReadyPromise;
	if (stopping) return;

	// Machine role is an optional label only; never a path component assumption
	// beyond the log directory name. Not configured -> "default".
	try {
		LinkSync.machineRole = Services.prefs.getStringPref("extensions.zotero.linksync.machineRole", "") || "default";
	}
	catch (_) { LinkSync.machineRole = "default"; }

	// Resolve PDF base from the Zotero Linked Attachment Base Directory.
	// No hard-coded absolute user paths anywhere in this plugin.
	let linkedBase = Zotero.Prefs.get("baseAttachmentPath");
	if (typeof linkedBase !== "string" || !linkedBase.length) {
		Zotero.debug("LinkSync: Linked Attachment Base Directory is not configured; "
			+ "all LinkSync workflows disabled, Zotero native behavior delegated.");
		return;
	}
	if (!(await IOUtils.exists(linkedBase))) {
		Zotero.debug("LinkSync: Linked Attachment Base Directory does not exist (" + linkedBase + "); "
			+ "all LinkSync workflows disabled, Zotero native behavior delegated.");
		return;
	}
	if (stopping) return;
	LinkSync.pdfBase = linkedBase;
	LinkSync.incrementalRoot = PathUtils.parent(linkedBase);
	LinkSync.logDir = PathUtils.join(LinkSync.incrementalRoot, "_logs", LinkSync.machineRole);
	LinkSync.logRoot = PathUtils.join(LinkSync.logDir, "production-imports");
	LinkSync.statusPath = PathUtils.join(LinkSync.incrementalRoot, "_logs", LinkSync.machineRole, "linksync-status.json");
	LinkSync.runtimeStatusPath = PathUtils.join(LinkSync.logDir, "connector-runtime.json");
	LinkSync.standaloneRuntimeStatusPath = PathUtils.join(LinkSync.logDir, "standalone-runtime.json");

	await LinkSync.modules.initializeProductionLogging(LinkSync);
	if (stopping) return;
	try {
		await LinkSync.modules.installConnectorSaveSession(LinkSync);
	}
	catch (error) {
		LinkSync.modules.restoreConnectorSaveSession?.(LinkSync);
		Zotero.logError(error);
		Zotero.debug("LinkSync: Connector workflow could not be installed; "
			+ "Connector saves delegate to Zotero native behavior. " + error);
	}
	if (stopping) return;
	try {
		await LinkSync.modules.installStandaloneEndpoint(LinkSync);
	}
		catch (error) {
		LinkSync.modules.restoreStandaloneEndpoint?.(LinkSync);
		Zotero.logError(error);
		Zotero.debug("LinkSync: Direct PDF standalone workflow could not be installed; "
				+ "direct PDF page saves delegate to Zotero native behavior. " + error);
		}
		if (stopping) return;
	LinkSync.modules.installLocalPDFImport(LinkSync);
	for (let window of Zotero.getMainWindows()) {
		await onMainWindowLoad({ window });
	}
	// ItemTree instances are replaced when library/collection views are rebuilt.
	LinkSync.dragRefreshTimer = setInterval(() => {
		if (stopping || !LinkSync.pdfBase) return;
		for (let window of Zotero.getMainWindows()) {
			if (window.ZoteroPane?.itemsView?.onDrop) {
				LinkSync.modules.installDropInterceptor(LinkSync, window).catch(Zotero.logError);
			}
		}
	}, 1000);
	LinkSync.reconcileTimer = setInterval(() => {
		LinkSync.modules.reconcileProductionLogs(LinkSync).catch(Zotero.logError);
	}, 60000);
	LinkSync.modules.reconcileProductionLogs(LinkSync).catch(Zotero.logError);
}

async function onMainWindowLoad({ window }) {
	if (stopping) return;
	if (!window || !window.ZoteroPane) return;
	if (!LinkSync.pdfBase) return;
	if (window.ZoteroPane.initPromise) await window.ZoteroPane.initPromise;
	if (stopping) return;
	await LinkSync.modules.installDropInterceptor(LinkSync, window);
	LinkSync.windows.add(window);
}

function onMainWindowUnload({ window }) {
	LinkSync.modules.restoreDropInterceptor?.(LinkSync, window);
	LinkSync.windows.delete(window);
}

async function shutdown(data, reason) {
	trace("BOOTSTRAP_SHUTDOWN_ENTER");
	trace("BOOTSTRAP_SHUTDOWN_REASON", { reason });
	stopping = true;
	if (startupTask) {
		try { await startupTask; } catch (_) { /* startup failure already traced */ }
	}
	let failures = [];
	let owners = runtimeOwners();
	owners.add(LinkSync);
	if (!LinkSync.logDir) LinkSync.logDir = [...owners].find(owner => owner.logDir)?.logDir || null;
	for (let owner of owners) failures.push(...restoreState(owner));
	trace("BOOTSTRAP_SHUTDOWN_EXIT", { result: failures.length ? "FAIL" : "PASS" });
	await flushTrace();
	if (failures.length) throw new Error("LinkSync lifecycle restoration failed; see lifecycle-runtime.json");
}

async function uninstall(data, reason) {
	await shutdown(data, reason);
}
