"use strict";

// Cover native standalone local imports even while an ItemTree is being replaced.
// Never convert an existing attachment. Recognition stays with the native caller.
this.installLocalPDFImport = function (state) {
	if (this.localImportRecord) return;
	let original = Zotero.Attachments.importFromFile;
	let modules = this;
	let localPDFImport = async function (options) {
		let libraryID = options?.libraryID || Zotero.Libraries.userLibraryID;
		let file = options?.file;
		let path = typeof file === "string" ? file : file?.path;
		if (!state.pdfBase || !path || !/\.pdf$/i.test(path)
			|| options.parentItemID || options.moveFile || options.fileBaseName
			|| libraryID !== Zotero.Libraries.userLibraryID
			|| !Zotero.Libraries.get(libraryID).editable
			|| (options.contentType && options.contentType !== "application/pdf")
			|| (options.saveOptions && Object.keys(options.saveOptions).some(k => k !== "notifierQueue"))) {
			return original.call(this, options);
		}
		// Internal storage and LinkSync staging are not user import sources.
		let normalized = PathUtils.normalize(path);
		let internalRoots = [state.pdfBase, Zotero.DataDirectory.dir];
		if (internalRoots.some(root => normalized === root || normalized.startsWith(root + "/"))) {
			return original.call(this, options);
		}
		let staged = await modules.stagePDF(state, path);
		let created = await modules.createLinkedFromBirth(state, staged, {
			collectionIDs: options.collections,
			title: options.title,
			contentType: "application/pdf"
		}, options.saveOptions?.notifierQueue);
		// A diagnostic failure must not turn a successful creation into a retry/duplicate.
		try {
			let transport = await modules.fileTransportState();
			await modules.logOperation(state, {
				_file_key: created.attachment.key,
				operation: "LOCAL_PDF_STANDALONE",
				parent_key: null,
				attachment_key: created.attachment.key,
				attachment_item_id: created.attachment.id,
				link_mode: created.attachment.attachmentLinkMode,
				relative_path: created.attachment.attachmentPath,
				resolved_path: created.finalPath,
				sha256: created.finalHash,
				pdf_source_method: "LOCAL_IMPORT",
				pdf_size: staged.sourceSize,
				result: "PASS",
				attachment_state: "READY",
				file_transport_status: transport.state,
				source_preserved: await IOUtils.exists(path),
				stored_attachment_ever_created: false
			});
		}
		catch (error) { Zotero.logError(error); }
		return created.attachment;
	};
	Zotero.Attachments.importFromFile = localPDFImport;
	this.localImportRecord = { original, wrapped: localPDFImport };
};

this.restoreLocalPDFImport = function () {
	let record = this.localImportRecord;
	if (!record) return;
	if (Zotero.Attachments.importFromFile === record.wrapped) {
		Zotero.Attachments.importFromFile = record.original;
	}
	delete this.localImportRecord;
};
