"use strict";

/*
 * Direct PDF page Connector workflow (C route, new in 0.2.0-rc5).
 *
 * User workflow: article PDF page -> Zotero Connector ->
 *   POST /connector/saveStandaloneAttachment (application/pdf stream).
 *
 * Official Zotero 10.0.4 semantics (source-audited from app omni.ja):
 *   server.js RequestHandler:  this.endpoint = Zotero.Server.Endpoints[pathname]
 *     is re-read on EVERY request; dispatch is `new this.endpoint()` followed by
 *     endpoint.init({method, pathname, pathParams, searchParams, headers, data})
 *     because endpoint.init.length === 1. For content-type application/pdf the
 *     body is never string-decoded, so requestData.data is the raw
 *     request.bodyInputStream (nsIInputStream).
 *   server_connector.js SaveStandaloneAttachment.init:
 *     X-Metadata header (JSON: sessionID, url, title)
 *     -> SessionManager.create(sessionID, 'saveStandaloneAttachment', requestData)
 *     -> session.update(targetID)
 *     -> Zotero.Attachments.importFromNetworkStream({... stream: requestData.data ...})   [creates STORED attachment]
 *     -> session.addItem(metadata.url, item)
 *     -> canRecognize = Zotero.RecognizeDocument.canRecognize(item)
 *     -> session.autoRecognizePromise = Zotero.RecognizeDocument.autoRecognizeItems([item])
 *     -> return [201, "application/json", JSON.stringify({ canRecognize })]
 *
 * rc5 replaces ONLY the importFromNetworkStream step (the single step that
 * creates a stored attachment). Everything else reuses official semantics:
 *   stream -> Zotero.File.putNetworkStream() -> LinkSync staging
 *   -> validate (exists / size / %PDF- magic / SHA-256)
 *   -> Zotero.Attachments.linkFromFile()  (linkMode = 2 at creation, standalone)
 *   -> move to PDF_BASE/<attachmentKey>/<filename> -> attachmentPath update only
 *   -> session.addItem(metadata.url, attachment)   [official mapping, unchanged]
 *   -> RecognizeDocument.canRecognize + autoRecognizeItems([attachment])
 *
 * The attachment is LINKED FROM BIRTH: linkMode is 2 from the creation call and
 * is never mutated. No stored attachment exists at any point in the lifecycle.
 *
 * Scope guard: only action saveStandaloneAttachment, Content-Type application/pdf,
 * editable My Library, nsIInputStream body. Everything else delegates to the
 * original official handler untouched.
 *
 * restoreStandaloneEndpoint() reinstates the official endpoint object on
 * disable / shutdown / uninstall.
 */

this.standaloneEndpointRecord = null;

const STANDALONE_ENDPOINT_PATH = "/connector/saveStandaloneAttachment";

function standaloneFilenameFromMetadata(url, contentType) {
	try {
		let name = Zotero.Attachments._getFileNameFromURL(url, contentType || "application/pdf");
		name = Zotero.File.getValidFileName(name || "Full Text.pdf");
		return Zotero.File.truncateFileName(name, 180);
	}
	catch (_) {
		return Zotero.File.truncateFileName(
			Zotero.File.getValidFileName("Full Text.pdf"), 180);
	}
}

function isRawInputStream(value) {
	// Gecko nsIInputStream: close() and available() are scriptable, but
	// read() and readSegments() are [noscript] (invisible to privileged JS).
	// Duck-typing on .read therefore always fails and silently delegates to
	// the official handler (stored PDF). Match on the scriptable methods.
	return !!value && typeof value === "object"
		&& typeof value.available === "function"
		&& typeof value.close === "function";
}

this.installStandaloneEndpoint = async function (state) {
	if (this.standaloneEndpointRecord) return;
	let endpoints = Zotero.Server.Endpoints;
	let originalEndpoint = endpoints[STANDALONE_ENDPOINT_PATH];
	if (String(originalEndpoint?.prototype.init).includes("processStandaloneRequest")) throw new Error("Orphaned LinkSync standalone wrapper; refusing recapture");

	// Runtime identity audit: the official endpoint object must still be the
	// registered dispatch target, with a single-argument init (the dispatch
	// contract in server.js). If anything drifted, do NOT hook.
	if (typeof originalEndpoint !== "function" || !originalEndpoint.prototype
		|| typeof originalEndpoint.prototype.init !== "function"
		|| originalEndpoint.prototype.init.length !== 1) {
		throw new Error("saveStandaloneAttachment dispatch identity audit failed");
	}
	let official = Zotero.Server.Connector?.SaveStandaloneAttachment;
	let identityMatch = official === originalEndpoint;

	let proto = originalEndpoint.prototype;
	let record = {
		endpoints,
		path: STANDALONE_ENDPOINT_PATH,
		originalEndpoint,
		identityMatch,
		originalInit: proto.init,
		originalSupportedMethods: proto.supportedMethods,
		originalSupportedDataTypes: proto.supportedDataTypes,
		originalPermitBookmarklet: proto.permitBookmarklet,
		originalAllowUnsafe: proto.allowRequestsFromUnsafeWebContent,
		interceptedAt: new Date().toISOString()
	};

	function InterceptedSaveStandaloneAttachment() {}
	InterceptedSaveStandaloneAttachment.prototype = {
		supportedMethods: record.originalSupportedMethods,
		supportedDataTypes: record.originalSupportedDataTypes,
		permitBookmarklet: record.originalPermitBookmarklet,
		allowRequestsFromUnsafeWebContent: record.originalAllowUnsafe,
		init: async function (requestData) {
			return state.modules.processStandaloneRequest(state, this, record, requestData);
		}
	};

	endpoints[STANDALONE_ENDPOINT_PATH] = InterceptedSaveStandaloneAttachment;
	record.interceptedEndpoint = InterceptedSaveStandaloneAttachment;
	this.standaloneEndpointRecord = record;
	state.modules.standaloneEndpointRecord = record;

	await this.writeJSON(state.standaloneRuntimeStatusPath, {
		version: state.version,
		mode: state.mode,
		endpoint: STANDALONE_ENDPOINT_PATH,
		dispatch_target: "Zotero.Server.Endpoints['/connector/saveStandaloneAttachment']"
			+ " (server.js RequestHandler re-reads Endpoints[pathname] per request,"
			+ " dispatches via new endpoint() and endpoint.init(requestData), arity 1)",
		official_identity_match: identityMatch,
		intercept_point_verified: true,
		standalone_wrapper_active: true,
		original_endpoint_preserved: true,
		shutdown_restoration_registered: true,
		last_result: "READY",
		installed_at: record.interceptedAt
	});
};

this.processStandaloneRequest = async function (state, endpointThis, record, requestData) {
	// Pre-flight scope guard. Any ambiguity -> delegate to the official handler.
	let contentType = String(requestData?.headers?.["content-type"] || "")
		.split(";", 1)[0].trim().toLowerCase();
	if (contentType !== "application/pdf") {
		return record.originalInit.call(endpointThis, requestData);
	}
	let metadata;
	try {
		metadata = JSON.parse(requestData.headers["X-Metadata"]);
	}
	catch (_) {
		return record.originalInit.call(endpointThis, requestData);
	}
	if (!requestData?.data || !isRawInputStream(requestData.data)) {
		return record.originalInit.call(endpointThis, requestData);
	}
	let { library, collection } = Zotero.Server.Connector.getSaveTarget(false, false);
	if (library.libraryID !== Zotero.Libraries.userLibraryID
		|| !library.editable || !library.filesEditable) {
		return record.originalInit.call(endpointThis, requestData);
	}

	// ---- In scope: official semantics with the stored-import step replaced ----
	let sessionID = metadata.sessionID || requestData.searchParams.get("sessionID");
	if (!sessionID) {
		return [400, "application/json", JSON.stringify({ error: "SESSION_ID_NOT_PROVIDED" })];
	}
	let byteCount = parseInt(requestData.headers["Content-Length"], 10);
	if (!byteCount || byteCount <= 0) {
		return [400, "application/json", JSON.stringify({ error: "CONTENT_LENGTH_NOT_PROVIDED" })];
	}

	let libraryID = library.libraryID;
	let targetID = collection ? collection.treeViewID : library.treeViewID;
	let session;
	try {
		session = Zotero.Server.Connector.SessionManager.create(
			sessionID, "saveStandaloneAttachment", requestData);
	}
	catch (_) {
		return [409, "application/json", JSON.stringify({ error: "SESSION_EXISTS" })];
	}
	await session.update(targetID);

	let filename = standaloneFilenameFromMetadata(metadata.url, contentType);
	let token = Zotero.Utilities.randomString(24);
	let incomingDir = PathUtils.join(state.pdfBase, "_incoming", token);
	let partialPath = PathUtils.join(incomingDir, filename + ".partial");
	let incomingPath = PathUtils.join(incomingDir, filename);
	let notifierQueue = new Zotero.Notifier.Queue();
	let staged = { incomingDir, incomingPath, partialPath };
	let created = null;

	try {
		await IOUtils.makeDirectory(incomingDir, { ignoreExisting: true, createAncestors: true });

		// Stream -> staging using the official Zotero.File helper (same one the
		// official importFromNetworkStream uses internally). No re-downloading,
		// no resolvers: the PDF bytes are already in requestData.data.
		await Zotero.File.putNetworkStream(partialPath, requestData.data, byteCount);
		let stat = await this.assertPDF(partialPath);          // %PDF- magic + size > 0
		let stagedSize = stat.size;
		let hash = this.sha256(partialPath);
		if (byteCount && stagedSize > byteCount * 4) {
			throw new Error("Staged size implausibly larger than Content-Length");
		}
		await IOUtils.move(partialPath, incomingPath, { noOverwrite: true });
		staged = { incomingDir, incomingPath, partialPath, filename, sourceHash: hash };

		// Linked-from-birth: linkMode = 2 at creation, then move + path update only.
		created = await this.createLinkedFromBirth(state, staged, {
			collectionIDs: collection ? [collection.id] : [],
			title: metadata.title || filename,
			contentType: "application/pdf"
		}, notifierQueue);
		let attachment = created.attachment;

		// Preserve official attachment URL semantics (original stored item got
		// its url field from createURLAttachmentFromTemporaryStorageDirectory).
		if (metadata.url) {
			attachment.setField("url", metadata.url);
			attachment.setField("accessDate", "CURRENT_TIMESTAMP");
			await attachment.saveTx({ notifierQueue });
			attachment = await Zotero.Items.getAsync(attachment.id);
		}

		// Official session mapping, unchanged.
		session.addItem(metadata.url, attachment);

		let canRecognize = Zotero.RecognizeDocument.canRecognize(attachment);
		if (canRecognize) {
			// Official auto-recognition on the LINKED attachment. Identity guard:
			// after recognition the same attachment key must persist, still
			// linkMode = 2, path unchanged, no replacement item created.
			session.autoRecognizePromise =
				Zotero.RecognizeDocument.autoRecognizeItems([attachment])
					.then(async (result) => {
						await this.verifyRecognitionIdentity(state, attachment.id, created.finalHash);
						return result;
					})
					.catch(async (error) => {
						Zotero.logError(error);
						await this.writeJSON(state.standaloneRuntimeStatusPath, {
							version: state.version,
							standalone_recognition_guard: "FAIL",
							last_error: String(error && error.stack ? error.stack : error)
						}).catch(() => {});
					});
		}

		let transport = await this.fileTransportState();
		this.maybeNotifyTransportWaiting(state, transport);
		await this.logOperation(state, {
			_file_key: attachment.key,
			operation: "DIRECT_PDF_STANDALONE",
			parent_key: null,
			parent_item_id: null,
			attachment_key: attachment.key,
			attachment_item_id: attachment.id,
			link_mode: attachment.attachmentLinkMode,
			link_mode_at_creation: created.linkModeAtCreation,
			relative_path: attachment.attachmentPath,
			resolved_path: created.finalPath,
			sha256: created.finalHash,
			pdf_source_method: "DIRECT_PDF_STREAM",
			source_pdf_url: metadata.url || null,
			pdf_size: stagedSize,
			result: "PASS",
			attachment_state: "READY",
			file_transport_status: transport.state,
			can_recognize: canRecognize,
			linked_from_birth: true,
			stored_attachment_ever_created: false
		});
		await this.writeJSON(state.standaloneRuntimeStatusPath, {
			version: state.version,
			last_result: "SUCCEEDED",
			last_attachment_key: attachment.key,
			last_sha256: created.finalHash,
			standalone_wrapper_active: true
		});
		return [201, "application/json", JSON.stringify({ canRecognize })];
	}
	catch (error) {
		Zotero.logError(error);
		// Remove only THIS operation's staging; nothing else is ever touched.
		try {
			if (staged.partialPath && await IOUtils.exists(staged.partialPath)) {
				await IOUtils.remove(staged.partialPath);
			}
			if (staged.incomingPath && await IOUtils.exists(staged.incomingPath)) {
				await IOUtils.remove(staged.incomingPath);
			}
			if (staged.incomingDir && await IOUtils.exists(staged.incomingDir)
				&& !(await IOUtils.getChildren(staged.incomingDir)).length) {
				await IOUtils.remove(staged.incomingDir);
			}
		}
		catch (cleanupError) { Zotero.logError(cleanupError); }
		await this.logOperation(state, {
			_file_key: "DIRECT_PDF_" + (sessionID || "UNKNOWN"),
			operation: "DIRECT_PDF_STANDALONE",
			parent_key: null,
			attachment_key: null,
			link_mode: null,
			relative_path: null,
			sha256: null,
			pdf_source_method: "DIRECT_PDF_STREAM",
			source_pdf_url: metadata?.url || null,
			result: "FAIL",
			attachment_state: "NO_ATTACHMENT_CREATED",
			file_transport_status: null,
			failure: String(error && error.stack ? error.stack : error)
		}).catch(() => {});
		await this.writeJSON(state.standaloneRuntimeStatusPath, {
			version: state.version,
			last_result: "PDF_VALIDATION_OR_LINK_FAILED",
			last_error: String(error && error.stack ? error.stack : error)
		}).catch(() => {});
		// Explicit failure to the Connector; no stored PDF was created.
		return [500, "application/json",
			JSON.stringify({ error: "LINKSYNC_PDF_STANDALONE_FAILED" })];
	}
	finally {
		await Zotero.Notifier.commit(notifierQueue);
	}
};

this.verifyRecognitionIdentity = async function (state, attachmentID, expectedHash) {
	let item = await Zotero.Items.getAsync(attachmentID);
	let keyPreserved = !!item && item.isAttachment();
	let linkModePreserved = keyPreserved
		&& item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE;
	let pathPreserved = keyPreserved
		&& String(item.attachmentPath).startsWith("attachments:" + item.key + "/");
	let resolved = keyPreserved ? await item.getFilePathAsync() : null;
	let hashPreserved = !!resolved && await IOUtils.exists(resolved)
		&& this.sha256(resolved) === expectedHash;
	let passed = keyPreserved && linkModePreserved && pathPreserved && hashPreserved;
	await this.writeJSON(state.standaloneRuntimeStatusPath, {
		version: state.version,
		attachment_key_preserved: passed,
		attachment_key: keyPreserved ? item.key : null,
		link_mode: linkModePreserved ? 2 : (keyPreserved ? item.attachmentLinkMode : null),
		relative_path: pathPreserved ? item.attachmentPath : null,
		sha256_unchanged: hashPreserved,
		verified_at: new Date().toISOString()
	});
	if (!passed) {
		throw new Error("Recognition identity guard failed for attachment " + attachmentID);
	}
};

this.restoreStandaloneEndpoint = function (state) {
	let record = this.standaloneEndpointRecord;
	if (!record) return;
	record.endpoints[record.path] = record.originalEndpoint;
	if (record.endpoints[record.path] !== record.originalEndpoint) throw new Error("Standalone original not restored");
	this.standaloneEndpointRecord = null;
	if (state?.modules) state.modules.standaloneEndpointRecord = null;
};
