"use strict";

/*
 * Connector workflow hook (frozen architecture B, from rc4).
 *
 * Zotero Connector
 *   -> downloadAssociatedFiles = false (user's original value saved & restored)
 *   -> Zotero native metadata parent creation (parent / collections / tags /
 *      session mapping are always created by Zotero itself, never by LinkSync)
 *   -> SaveSession.prototype.saveItems hook captures connector payload
 *   -> calls the ORIGINAL saveItems (correct `this` binding)
 *   -> parent resolved ONLY via this.getItemByConnectorKey(connectorItemID)
 *   -> LinkSync PDF acquisition (TRANSLATOR_URL -> DOI -> URL -> OA)
 *   -> Zotero.Attachments.linkFromFile() -> linkMode=2 at creation
 *   -> PDF_BASE/<attachmentKey>/<filename>, attachmentPath update only
 *
 * Scope: editable My Library only; everything else delegates to the original
 * handler untouched. If the Zotero-created parent already has a stored PDF
 * child (suppression failed), LinkSync logs and skips; it never deletes the
 * parent, never rolls back metadata, never creates a broken attachment.
 *
 * restoreConnectorSaveSession() removes the monkey patch and restores the
 * original downloadAssociatedFiles value on disable / shutdown / uninstall.
 */

this.connectorSaveSessionRecord = null;

function normalizedURL(url) {
	try {
		let parsed = new URL(url);
		parsed.hash = "";
		return parsed.href;
	}
	catch (_) { return ""; }
}

function cloneConnectorData(data) {
	return JSON.parse(JSON.stringify(data || {}));
}

function compactAttachment(attachment) {
	return {
		title: attachment.title || null,
		url: attachment.url || null,
		mimeType: attachment.mimeType || null,
		snapshot: attachment.snapshot ?? null,
		linkMode: attachment.linkMode ?? null,
		parent: attachment.parent ?? null,
		isPrimary: attachment.isPrimary ?? null
	};
}

function isPDFCandidate(attachment) {
	let mime = String(attachment.mimeType || "").split(";", 1)[0].trim().toLowerCase();
	let url = String(attachment.url || "");
	return !!url && (mime === "application/pdf" || /(?:\.pdf(?:$|[?#])|[?&](?:type|format)=pdf(?:&|$))/i.test(url));
}

function translatorPDFCandidates(connectorItem) {
	return (connectorItem.attachments || [])
		.filter(attachment => isPDFCandidate(attachment))
		.sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
		.slice(0, 1)
		.map(compactAttachment);
}

function safePDFName(parentItem, title) {
	let base = Zotero.Attachments.getFileBaseNameFromItem(parentItem, {
		attachmentTitle: title || "Full Text PDF"
	});
	base = Zotero.File.getValidFileName(base || "Full Text PDF");
	return Zotero.File.truncateFileName(base + ".pdf", 180);
}

async function connectorObservedDownloadAssociatedFiles() {
	let constructor = Zotero.Server?.Endpoints?.["/connector/ping"];
	if (!constructor || constructor !== Zotero.Server?.Connector?.Ping) return undefined;
	let response = await new constructor().init({ method: "POST", data: {}, headers: {} });
	if (!Array.isArray(response) || response[0] !== 200) return undefined;
	return JSON.parse(response[2])?.prefs?.downloadAssociatedFiles;
}

async function childAttachments(parent) {
	let children = [];
	for (let id of parent.getAttachments()) {
		let item = await Zotero.Items.getAsync(id);
		if (item) children.push(item);
	}
	return children;
}

async function writeRuntimeStatus(modules, state, extra) {
	let record = state.modules.connectorSaveSessionRecord;
	let status = {
		version: state.version,
		mode: state.mode,
		hook: "Zotero.Server.Connector.SaveSession.prototype.saveItems",
		savesession_wrapper_active: !!record && record.prototype.saveItems === record.wrappedSaveItems,
		original_savesession_handler_preserved: typeof record?.originalSaveItems === "function",
		shutdown_restoration_registered: !!record,
		original_download_associated_files: record?.originalDownloadAssociatedFiles ?? null,
		connector_observed_download_associated_files: record?.connectorObservedDownloadAssociatedFiles ?? null,
		preference_restore_armed: !!record?.preferenceChanged
	};
	Object.assign(status, extra || {});
	await modules.writeJSON(state.runtimeStatusPath, status);
}

this.installConnectorSaveSession = async function (state) {
	if (this.connectorSaveSessionRecord) return;
	let SaveSession = Zotero.Server?.Connector?.SaveSession;
	let prototype = SaveSession?.prototype;
	if (!prototype || typeof prototype.saveItems !== "function") {
		throw new Error("Connector SaveSession.saveItems is unavailable");
	}
	let descriptor = Object.getOwnPropertyDescriptor(prototype, "saveItems");
	if (String(prototype.saveItems).includes("processConnectorItem")) throw new Error("Orphaned LinkSync SaveSession wrapper; refusing recapture");
	if (!descriptor || (!descriptor.writable && !descriptor.set)) {
		throw new Error("Connector SaveSession.saveItems is not safely wrappable");
	}

	// Suppress Zotero Connector's automatic stored-PDF creation.
	// automaticSnapshots is intentionally NOT touched.
	let originalDownloadAssociatedFiles = !!Zotero.Prefs.get("downloadAssociatedFiles");
	let originalPrefHadUserValue = Services.prefs.prefHasUserValue("extensions.zotero.downloadAssociatedFiles");
	this.connectorPreferenceRecord = { originalDownloadAssociatedFiles, originalPrefHadUserValue };
	let preferenceChanged = originalDownloadAssociatedFiles !== false;
	Zotero.Prefs.set("downloadAssociatedFiles", false);
	if (Zotero.Prefs.get("downloadAssociatedFiles") !== false) {
		throw new Error("downloadAssociatedFiles could not be set false");
	}
	let connectorObserved;
	try {
		connectorObserved = await connectorObservedDownloadAssociatedFiles();
	}
	catch (_) { connectorObserved = undefined; }
	if (connectorObserved !== false) {
		// Non-fatal diagnostic: the pref itself is the active mechanism.
		Zotero.debug("LinkSync: Connector preference probe could not confirm "
			+ "downloadAssociatedFiles=false (observed: " + connectorObserved + "); continuing on pref value.");
	}

	let originalSaveItems = prototype.saveItems;
	let modules = this;
	let wrappedSaveItems = async function (target) {
		let copiedData;
		try { copiedData = cloneConnectorData(this._requestData?.data); }
		catch (_) { return originalSaveItems.call(this, target); }
		let copiedItems = Array.isArray(copiedData?.items) ? copiedData.items : [];
		if (this._action !== "saveItems" || !copiedItems.length) {
			return originalSaveItems.call(this, target);
		}

		// Production scope guard: only editable My Library. Out of scope ->
		// delegate to Zotero native behavior, never throw.
		let library;
		try {
			({ library } = Zotero.Server.Connector.resolveTarget(target));
		}
		catch (_) {
			return originalSaveItems.call(this, target);
		}
		if (library.libraryID !== Zotero.Libraries.userLibraryID || !library.editable || !library.filesEditable) {
			return originalSaveItems.call(this, target);
		}
		if (Zotero.Prefs.get("downloadAssociatedFiles") !== false) {
			// Suppression no longer active -> delegate native to avoid stored/linked duplication.
			return originalSaveItems.call(this, target);
		}

		let itemsWithCandidates = copiedItems
			.filter(item => item && item.attachments)
			.map(item => ({ item, candidates: translatorPDFCandidates(item) }));

		let result = await originalSaveItems.call(this, target);
		let originalResultCount = Array.isArray(result) ? result.length : null;

		for (let { item: connectorItem, candidates } of itemsWithCandidates) {
			try {
				await modules.processConnectorItem(state, this, connectorItem, candidates, originalResultCount);
			}
			catch (error) {
				Zotero.logError(error);
				await modules.logOperation(state, {
					_file_key: "CONNECTOR_" + (connectorItem.id || "UNKNOWN"),
					operation: "CONNECTOR_METADATA",
					parent_key: null,
					attachment_key: null,
					link_mode: null,
					relative_path: null,
					sha256: null,
					pdf_source_method: "NONE",
					result: "FAIL",
					attachment_state: "PARENT_PRESERVED",
					file_transport_status: null,
					connector_item_id: connectorItem.id || null,
					parent_url: normalizedURL(connectorItem.url),
					failure: String(error)
				}).catch(() => {});
			}
		}
		return result;
	};

	prototype.saveItems = wrappedSaveItems;
	if (Zotero.Server.Connector.SaveSession.prototype.saveItems !== wrappedSaveItems) {
		Object.defineProperty(prototype, "saveItems", descriptor);
		if (preferenceChanged) Zotero.Prefs.set("downloadAssociatedFiles", originalDownloadAssociatedFiles);
		throw new Error("SaveSession wrapper identity verification failed");
	}
	this.connectorSaveSessionRecord = {
		prototype,
		descriptor,
		originalSaveItems,
		wrappedSaveItems,
		originalDownloadAssociatedFiles,
		originalPrefHadUserValue,
		connectorObservedDownloadAssociatedFiles: connectorObserved ?? null,
		preferenceChanged
	};
	state.modules.connectorSaveSessionRecord = this.connectorSaveSessionRecord;
	await writeRuntimeStatus(modules, state, { last_result: "READY", installed_at: new Date().toISOString() });
};

this.processConnectorItem = async function (state, session, connectorItem, candidates, originalResultCount) {
	let modules = this;
	// Parent resolution: connector key ONLY. Never title/DOI fuzzy matching,
	// never dateAdded guessing.
	let parent = session.getItemByConnectorKey(connectorItem.id);
	if (!parent || !parent.isRegularItem() || parent.libraryID !== Zotero.Libraries.userLibraryID) {
		await writeRuntimeStatus(modules, state, {
			last_result: "PARENT_LOOKUP_FAILED",
			original_saveitems_called: true,
			original_saveitems_result_count: originalResultCount,
			parent_resolution_method: "SAVESESSION_CONNECTOR_KEY"
		});
		return;
	}

	let children = await childAttachments(parent);
	let connectorStoredPDFs = children.filter(item => item.isAttachment()
		&& item.attachmentContentType === "application/pdf"
		&& [Zotero.Attachments.LINK_MODE_IMPORTED_FILE, Zotero.Attachments.LINK_MODE_IMPORTED_URL]
			.includes(item.attachmentLinkMode));
	if (connectorStoredPDFs.length) {
		// Zotero already stored a PDF (suppression failed somewhere).
		// Never convert it, never delete the parent, never duplicate it.
		await modules.logOperation(state, {
			_file_key: "CONNECTOR_" + parent.key,
			operation: "CONNECTOR_METADATA",
			parent_key: parent.key,
			parent_item_id: parent.id,
			attachment_key: null,
			link_mode: null,
			relative_path: null,
			sha256: null,
			pdf_source_method: "NONE",
			result: "FAIL",
			attachment_state: "PARENT_PRESERVED",
			file_transport_status: null,
			connector_item_id: connectorItem.id,
			parent_created_by_zotero: true,
			parent_resolution_method: "SAVESESSION_CONNECTOR_KEY",
			original_saveitems_called: true,
			original_saveitems_result_count: originalResultCount,
			connector_created_stored_pdf_count: connectorStoredPDFs.length,
			failure: "CONNECTOR_STORED_PDF_CREATED"
		});
		await writeRuntimeStatus(modules, state, { last_result: "CONNECTOR_STORED_PDF_CREATED" });
		return;
	}

	if (!candidates.length) {
		await modules.logOperation(state, {
			_file_key: "CONNECTOR_" + parent.key,
			operation: "CONNECTOR_METADATA",
			parent_key: parent.key,
			parent_item_id: parent.id,
			attachment_key: null,
			link_mode: null,
			relative_path: null,
			sha256: null,
			pdf_source_method: "NONE",
			result: "PASS",
			attachment_state: "PARENT_PRESERVED",
			file_transport_status: null,
			connector_item_id: connectorItem.id,
			parent_created_by_zotero: true,
			parent_resolution_method: "SAVESESSION_CONNECTOR_KEY",
			pdf_auto_acquisition: "NOT_FOUND",
			needs_pdf: true
		});
		await writeRuntimeStatus(modules, state, { last_result: "NEEDS_PDF" });
		return;
	}

	let filename = safePDFName(parent, candidates[0]?.title);
	let staged;
	try {
		staged = await modules.acquirePDF(state, parent, candidates, filename);
		if (!staged) {
			await modules.logOperation(state, {
				_file_key: "CONNECTOR_" + parent.key,
				operation: "CONNECTOR_METADATA",
				parent_key: parent.key,
				parent_item_id: parent.id,
				attachment_key: null,
				link_mode: null,
				relative_path: null,
				sha256: null,
				pdf_source_method: "NONE",
				result: "PASS",
				attachment_state: "PARENT_PRESERVED",
				file_transport_status: null,
				connector_item_id: connectorItem.id,
				parent_created_by_zotero: true,
				parent_resolution_method: "SAVESESSION_CONNECTOR_KEY",
				pdf_auto_acquisition: "NOT_FOUND",
				needs_pdf: true
			});
			await writeRuntimeStatus(modules, state, { last_result: "NEEDS_PDF" });
			return;
		}

		let notifierQueue = new Zotero.Notifier.Queue();
		let attachment;
		try {
			let created = await modules.createLinkedFromBirth(state, staged, {
				parentItemID: parent.id,
				title: candidates[0]?.title || "Full Text PDF",
				contentType: "application/pdf"
			}, notifierQueue);
			attachment = created.attachment;
			attachment.setField("url", staged.sourceURL);
			attachment.setField("accessDate", "CURRENT_TIMESTAMP");
			await attachment.saveTx({ notifierQueue });
			attachment = await Zotero.Items.getAsync(attachment.id);
			let storageDir = Zotero.Attachments.getStorageDirectory(attachment).path;
			let storagePDFExists = false;
			if (await IOUtils.exists(storageDir)) {
				for (let path of await IOUtils.getChildren(storageDir)) {
					if (path.toLowerCase().endsWith(".pdf")) storagePDFExists = true;
				}
			}
			if (storagePDFExists || attachment.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_FILE) {
				throw new Error("Linked-from-birth storage invariant failed");
			}
			let transport = await modules.fileTransportState();
			modules.maybeNotifyTransportWaiting(state, transport);
			await modules.logOperation(state, {
				_file_key: attachment.key,
				operation: "CONNECTOR_PDF",
				parent_key: parent.key,
				parent_item_id: parent.id,
				attachment_key: attachment.key,
				attachment_item_id: attachment.id,
				link_mode: attachment.attachmentLinkMode,
				link_mode_at_creation: created.linkModeAtCreation,
				relative_path: attachment.attachmentPath,
				resolved_path: await attachment.getFilePathAsync(),
				sha256: created.finalHash,
				pdf_source_method: staged.sourceMethod,
				source_pdf_url: staged.sourceURL,
				pdf_size: staged.sourceSize,
				result: "PASS",
				attachment_state: "READY",
				file_transport_status: transport.state,
				connector_item_id: connectorItem.id,
				parent_created_by_zotero: true,
				parent_resolution_method: "SAVESESSION_CONNECTOR_KEY",
				stored_attachment_ever_created: false,
				zotero_storage_pdf_exists: false
			});
			await writeRuntimeStatus(modules, state, {
				last_result: "SUCCEEDED",
				last_parent_key: parent.key,
				last_attachment_key: attachment.key,
				last_link_mode: attachment.attachmentLinkMode,
				last_relative_path: attachment.attachmentPath,
				last_sha256: created.finalHash
			});
		}
		finally { await Zotero.Notifier.commit(notifierQueue); }
	}
	catch (error) {
		Zotero.logError(error);
		// Parent (Zotero-created metadata) is always preserved on PDF failure.
		await modules.logOperation(state, {
			_file_key: "CONNECTOR_" + parent.key,
			operation: "CONNECTOR_METADATA",
			parent_key: parent.key,
			parent_item_id: parent.id,
			attachment_key: null,
			link_mode: null,
			relative_path: null,
			sha256: null,
			pdf_source_method: staged?.sourceMethod || "NONE",
			source_pdf_url: staged?.sourceURL || null,
			result: "PASS",
			attachment_state: "PARENT_PRESERVED",
			file_transport_status: null,
			connector_item_id: connectorItem.id,
			parent_created_by_zotero: true,
			parent_resolution_method: "SAVESESSION_CONNECTOR_KEY",
			pdf_auto_acquisition: "FAIL",
			needs_pdf: true,
			failure: String(error)
		});
		await writeRuntimeStatus(modules, state, { last_result: "PDF_ACQUISITION_OR_LINK_FAILED", last_error: String(error) });
	}
};

this.restoreConnectorSaveSession = function (state, deferPreference = false) {
	let record = this.connectorSaveSessionRecord;
	if (record && record.prototype.saveItems === record.wrappedSaveItems) {
		Object.defineProperty(record.prototype, "saveItems", record.descriptor);
	}
	if (record && record.prototype.saveItems !== record.originalSaveItems) throw new Error("SaveSession original not restored");
	this.connectorSaveSessionRecord = null;
	if (state?.modules) state.modules.connectorSaveSessionRecord = null;
	if (!deferPreference) this.restoreConnectorPreference(state);
};

this.restoreConnectorPreference = function (state) {
	let record = this.connectorPreferenceRecord;
	if (!record) return;
	if (record.originalPrefHadUserValue) Zotero.Prefs.set("downloadAssociatedFiles", record.originalDownloadAssociatedFiles);
	else Services.prefs.clearUserPref("extensions.zotero.downloadAssociatedFiles");
	if (Zotero.Prefs.get("downloadAssociatedFiles") !== record.originalDownloadAssociatedFiles
		|| Services.prefs.prefHasUserValue("extensions.zotero.downloadAssociatedFiles") !== record.originalPrefHadUserValue) {
		throw new Error("downloadAssociatedFiles original semantics not restored");
	}
	this.connectorPreferenceRecord = null;
};
