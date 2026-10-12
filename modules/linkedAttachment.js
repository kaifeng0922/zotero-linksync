"use strict";

/*
 * linked-from-birth attachment creation.
 *
 * Flow: staging file -> Zotero.Attachments.linkFromFile() (linkMode=2 at
 * creation, verified) -> move file to PDF_BASE/<attachmentKey>/<filename> ->
 * update attachmentPath ONLY (attachmentLinkMode is never mutated).
 *
 * Final invariants verified before success:
 *   linkMode == LINK_MODE_LINKED_FILE (2)
 *   attachmentPath == attachments:<attachmentKey>/<filename>
 *   resolved path == final file path
 *   SHA-256 unchanged from staged source
 *
 * On failure only THIS operation's freshly created attachment is cleaned up
 * (erase + remove staged/final files). No historical attachment, no other
 * item is ever touched.
 */

this.createLinkedFromBirth = async function (state, staged, options, notifierQueue) {
	let attachment = null;
	let finalDir = null;
	let finalPath = null;
	try {
		attachment = await Zotero.Attachments.linkFromFile({
			file: staged.incomingPath,
			parentItemID: options.parentItemID || undefined,
			collections: options.collectionIDs?.length ? options.collectionIDs : undefined,
			title: options.title,
			contentType: options.contentType || "application/pdf",
			saveOptions: { notifierQueue }
		});
		attachment = await Zotero.Items.getAsync(attachment.id);
		let linkModeAtCreation = attachment.attachmentLinkMode;
		if (linkModeAtCreation !== Zotero.Attachments.LINK_MODE_LINKED_FILE) {
			throw new Error("linkFromFile did not create linkMode=2");
		}
		finalDir = PathUtils.join(state.pdfBase, attachment.key);
		finalPath = PathUtils.join(finalDir, staged.filename);
		await IOUtils.makeDirectory(finalDir, { ignoreExisting: true, createAncestors: true });
		if (await IOUtils.exists(finalPath)) throw new Error("Final keyed destination already exists");
		await IOUtils.move(staged.incomingPath, finalPath, { noOverwrite: true });
		attachment.attachmentPath = finalPath;
		await attachment.saveTx({ notifierQueue });
		attachment = await Zotero.Items.getAsync(attachment.id);
		let resolvedPath = await attachment.getFilePathAsync();
		let expectedRelative = "attachments:" + attachment.key + "/" + staged.filename;
		let finalHash = this.sha256(finalPath);
		if (attachment.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_FILE
			|| attachment.attachmentPath !== expectedRelative
			|| resolvedPath !== finalPath
			|| finalHash !== staged.sourceHash) {
			throw new Error("Final linked attachment verification failed");
		}
		await this.removeEmptyIncoming(staged);
		return { attachment, linkModeAtCreation, finalDir, finalPath, finalHash, expectedRelative };
	}
	catch (error) {
		if (attachment) {
			try {
				attachment = await Zotero.Items.getAsync(attachment.id);
				if (attachment) await attachment.eraseTx({ notifierQueue });
			}
			catch (cleanupError) { Zotero.logError(cleanupError); }
		}
		try {
			if (finalPath && await IOUtils.exists(finalPath)) await IOUtils.remove(finalPath);
			if (staged.incomingPath && await IOUtils.exists(staged.incomingPath)) await IOUtils.remove(staged.incomingPath);
			if (finalDir && await IOUtils.exists(finalDir)
				&& !(await IOUtils.getChildren(finalDir)).length) await IOUtils.remove(finalDir);
			await this.removeEmptyIncoming(staged);
		}
		catch (cleanupError) { Zotero.logError(cleanupError); }
		throw error;
	}
};
