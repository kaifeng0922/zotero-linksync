"use strict";

/*
 * Production logging.
 *
 * Every operation record carries at least:
 *   timestamp, operation, machine_role (if configured), parent_key,
 *   attachment_key, link_mode, relative_path, sha256, pdf_source_method,
 *   result, file_transport_status
 *
 * Operations:
 *   DRAG_EXISTING_PARENT, DRAG_STANDALONE, CONNECTOR_METADATA, CONNECTOR_PDF
 *
 * Never logged: PDF binary content, cookies, web authentication material.
 *
 * ATTACHMENT_STATE (link_mode / relative_path / resolved file) and
 * FILE_TRANSPORT_STATE (Nutstore) are recorded as separate fields.
 */

this.writeJSON = async function (path, value) {
	await IOUtils.makeDirectory(PathUtils.parent(path), { ignoreExisting: true, createAncestors: true });
	await IOUtils.writeUTF8(path, JSON.stringify(value, null, 2) + "\n");
};

this.initializeProductionLogging = async function (state) {
	await IOUtils.makeDirectory(state.logRoot, { ignoreExisting: true, createAncestors: true });
	if (!(await IOUtils.exists(state.statusPath))) {
		await this.writeJSON(state.statusPath, {
			version: state.version,
			mode: state.mode,
			machine_role: state.machineRole,
			production_import_count: 0,
			created_at: new Date().toISOString()
		});
	}
};

this.getProductionLogPaths = async function (state) {
	let children = await IOUtils.getChildren(state.logRoot);
	return children.filter(path => path.toLowerCase().endsWith(".json")).sort();
};

this.logOperation = async function (state, record) {
	record.version = state.version;
	record.mode = state.mode;
	record.machine_role = state.machineRole;
	record.logged_at = new Date().toISOString();
	await this.writeJSON(PathUtils.join(state.logRoot, record._file_key + ".json"), record);
};

this.reconcileProductionLogs = async function (state) {
	if (!state.pdfBase) return;
	let paths = await this.getProductionLogPaths(state);
	let transport = await this.fileTransportState();
	let allSynced = true;
	for (let path of paths) {
		let record;
		try { record = JSON.parse(await IOUtils.readUTF8(path)); }
		catch (_) { continue; }
		if (record.attachment_key) {
			let item = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, record.attachment_key);
			if (!item) { allSynced = false; continue; }
			let resolved = await item.getFilePathAsync();
			record.synced = item.synced ? 1 : 0;
			record.data_sync_result = item.synced ? "PASS" : "PENDING";
			record.link_mode = item.attachmentLinkMode;
			record.relative_path = item.attachmentPath;
			record.nutstore_file_exists = !!resolved && await IOUtils.exists(resolved);
			record.file_transport_status = record.nutstore_file_exists ? transport.state : "UNKNOWN";
			record.last_reconciled_at = new Date().toISOString();
			if (!item.synced || record.link_mode !== 2
				|| !String(record.relative_path || "").startsWith("attachments:")
				|| !record.nutstore_file_exists) allSynced = false;
		}
		await this.writeJSON(path, record);
	}
	await this.writeJSON(state.statusPath, {
		version: state.version,
		mode: state.mode,
		machine_role: state.machineRole,
		production_import_count: paths.length,
		data_sync_all_pass: allSynced,
		file_transport_status: transport.state,
		updated_at: new Date().toISOString()
	});
};
