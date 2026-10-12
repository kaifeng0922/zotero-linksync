"use strict";

/*
 * Drag workflow hook (frozen architecture A).
 *
 * External local PDF drag -> linked-from-birth (linkMode=2).
 *   A. drop onto an existing parent item  -> DRAG_EXISTING_PARENT
 *   B. drop onto library/collection blank -> DRAG_STANDALONE
 *      -> Zotero native autoRecognizeItems()
 *
 * Scope guards: My Library only, editable, Publications excluded, PDF files
 * only, plain drop only. Everything out of scope delegates to the original
 * Zotero onDrop untouched.
 *
 * Source files are COPIED into staging and always preserved. On failure
 * before linkFromFile, only this operation's staging is removed. The hook is
 * restored on window unload / shutdown / disable / uninstall.
 */

this.interceptorRecords = new Map();

this.installDropInterceptor = async function (state, window) {
	let view = window.ZoteroPane.itemsView;
	if (!view || typeof view.onDrop !== "function") throw new Error("Current item tree onDrop is unavailable");
	if (this.interceptorRecords.has(window)) return;
	let originalOnDrop = view.onDrop;
	if (String(originalOnDrop).includes("pdfBase")) throw new Error("Orphaned LinkSync drag wrapper; refusing recapture");
	let modules = this;
	let wrapped = async function (event, row) {
		try {
			if (!state.pdfBase) return originalOnDrop.call(view, event, row);
			let types = event.dataTransfer && event.dataTransfer.types;
			if (!types || !types.includes("application/x-moz-file")) return originalOnDrop.call(view, event, row);
			let dragData = Zotero.DragDrop.getDataFromDataTransfer(event.dataTransfer);
			let orient = Zotero.DragDrop.currentOrientation;
			let plainDrop = !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
			if (!dragData || dragData.dataType !== "application/x-moz-file" || !plainDrop
				|| !dragData.data.length || !dragData.data.every(entry => entry.path.toLowerCase().endsWith(".pdf"))) {
				return originalOnDrop.call(view, event, row);
			}
			let userLibraryID = Zotero.Libraries.userLibraryID;
			let library = Zotero.Libraries.get(userLibraryID);
			if (!library.editable) return originalOnDrop.call(view, event, row);
			let parentItemID = false;
			let parentKey = null;
			let collectionIDs = [];
			let operation = null;
			if (orient === 0) {
				let target = view.getRow(row).ref;
				if (!target?.isRegularItem() || target.libraryID !== userLibraryID) return originalOnDrop.call(view, event, row);
				parentItemID = target.id;
				parentKey = target.key;
				operation = "DRAG_EXISTING_PARENT";
			}
			else {
				let selectedRows = view.collectionTreeRows;
				if (!selectedRows.length || selectedRows.some(r => r.ref.libraryID !== userLibraryID
					|| (typeof r.isPublications === "function" && r.isPublications()))) {
					return originalOnDrop.call(view, event, row);
				}
				let collections = selectedRows.filter(r => r.isCollection());
				if (!selectedRows.every(r => r.isCollection() || r.isLibrary(true))) return originalOnDrop.call(view, event, row);
				collectionIDs = collections.map(r => r.ref.id);
				operation = "DRAG_STANDALONE";
			}
			view._dropRow = null;
			Zotero.DragDrop.currentDragSource = null;
			Zotero.DragDrop.currentDropEffect = null;
			let addedItems = [];
			let notifierQueue = new Zotero.Notifier.Queue();
			try {
				for (let entry of dragData.data) {
					let staged = await modules.stagePDF(state, entry.path);
					let created = await modules.createLinkedFromBirth(state, staged, { parentItemID, collectionIDs }, notifierQueue);
					let attachment = created.attachment;
					addedItems.push(attachment);
					let transport = await modules.fileTransportState();
					modules.maybeNotifyTransportWaiting(state, transport);
					await modules.logOperation(state, {
						_file_key: attachment.key,
						operation,
						parent_key: parentKey,
						parent_item_id: parentItemID || null,
						attachment_key: attachment.key,
						attachment_item_id: attachment.id,
						link_mode: attachment.attachmentLinkMode,
						relative_path: attachment.attachmentPath,
						resolved_path: created.finalPath,
						sha256: created.finalHash,
						pdf_source_method: "LOCAL_DRAG",
						pdf_size: staged.sourceSize,
						result: "PASS",
						attachment_state: "READY",
						file_transport_status: transport.state,
						source_preserved: await IOUtils.exists(staged.sourcePath),
						stored_attachment_ever_created: false,
						collection_ids: collectionIDs
					});
				}
			}
			finally { await Zotero.Notifier.commit(notifierQueue); }
			if (parentItemID && addedItems.length) await view.selectItems(addedItems.map(item => item.id));
			else if (addedItems.length) Zotero.RecognizeDocument.autoRecognizeItems(addedItems);
			return false;
		}
		catch (error) {
			Zotero.logError(error);
			window.ZoteroPane.displayErrorMessage(true, "LinkSync failed: " + error);
			return false;
		}
	};
	view.onDrop = wrapped;
	this.interceptorRecords.set(window, { view, originalOnDrop, wrapped });
};

this.restoreDropInterceptor = function (state, window) {
	let record = this.interceptorRecords.get(window);
	if (!record) return;
	if (record.view.onDrop === record.wrapped) record.view.onDrop = record.originalOnDrop;
	this.interceptorRecords.delete(window);
};
