"use strict";

/*
 * PDF staging and acquisition.
 *
 * Drag workflow: COPY source into PDF_BASE/_incoming/<token>/<filename>; the
 * original source file is always preserved. Failure before linkFromFile only
 * removes this operation's staging; the source is untouched.
 *
 * Connector workflow: download the first clearly primary PDF into staging via
 * Zotero.Attachments.getFileResolvers() + downloadFirstAvailableFile() only.
 * Priority: TRANSLATOR_URL -> DOI -> URL -> OA. Only the first explicit
 * primary PDF candidate is processed (precision over recall). No custom
 * resolver and no supplementary files in 0.2.0.
 *
 * Forbidden (never used): addFileFromURLs / importFromNetworkStream /
 * importFromFile as attachment creators. Final attachment creation is always
 * Zotero.Attachments.linkFromFile() in modules/linkedAttachment.js.
 */

this.stagePDF = async function (state, sourcePath) {
	let sourceStat = await this.assertPDF(sourcePath);
	let filename = PathUtils.filename(sourcePath);
	let token = Zotero.Utilities.randomString(24);
	let incomingDir = PathUtils.join(state.pdfBase, "_incoming", token);
	let incomingPath = PathUtils.join(incomingDir, filename);
	let partialPath = incomingPath + ".partial";
	await IOUtils.makeDirectory(incomingDir, { ignoreExisting: true, createAncestors: true });
	try {
		await IOUtils.copy(sourcePath, partialPath);
		let partialStat = await IOUtils.stat(partialPath);
		let sourceHash = this.sha256(sourcePath);
		let partialHash = this.sha256(partialPath);
		if (sourceStat.size !== partialStat.size || sourceHash !== partialHash) {
			throw new Error("Incoming copy failed size/SHA-256 verification");
		}
		await IOUtils.move(partialPath, incomingPath, { noOverwrite: true });
		return { sourcePath, filename, sourceSize: sourceStat.size, sourceHash, incomingDir, incomingPath };
	}
	catch (error) {
		await this.removeAcquisitionArtifacts({ incomingDir, incomingPath, partialPath });
		throw error;
	}
};

this.acquirePDF = async function (state, parentItem, translatorCandidates, filename) {
	let token = Zotero.Utilities.randomString(24);
	let incomingDir = PathUtils.join(state.pdfBase, "_incoming", token);
	let partialPath = PathUtils.join(incomingDir, "candidate.partial");
	let incomingPath = PathUtils.join(incomingDir, filename);
	await IOUtils.makeDirectory(incomingDir, { ignoreExisting: true, createAncestors: true });
	let startedMethod = "NONE";
	let resolvers = [];
	for (let candidate of translatorCandidates) {
		resolvers.push({
			url: candidate.url,
			accessMethod: "TRANSLATOR_URL",
			referrer: parentItem.getField("url") || undefined,
			title: candidate.title || "Full Text PDF"
		});
	}
	for (let resolver of Zotero.Attachments.getFileResolvers(parentItem, ["doi", "url", "oa"], true)) {
		resolvers.push(resolver);
	}
	try {
		let result = await Zotero.Attachments.downloadFirstAvailableFile(resolvers, partialPath, {
			enforceFileType: true,
			shouldDisplayCaptcha: false,
			onAccessMethodStart(method) {
				startedMethod = String(method || "NONE").toUpperCase();
			}
		});
		if (!result || !result.url || !(await IOUtils.exists(partialPath))) {
			await this.removeAcquisitionArtifacts({ incomingDir, incomingPath, partialPath });
			return false;
		}
		let stat = await this.assertPDF(partialPath);
		let hash = this.sha256(partialPath);
		await IOUtils.move(partialPath, incomingPath, { noOverwrite: true });
		let finalStat = await this.assertPDF(incomingPath);
		let finalHash = this.sha256(incomingPath);
		if (stat.size !== finalStat.size || hash !== finalHash) {
			throw new Error("Acquired PDF failed atomic staging verification");
		}
		let method = String(result.props?.accessMethod || startedMethod || "NONE").toUpperCase();
		return {
			sourcePath: null,
			filename,
			sourceSize: stat.size,
			sourceHash: hash,
			incomingDir,
			incomingPath,
			partialPath,
			sourceURL: result.url,
			sourceMethod: method,
			contentType: result.mimeType || "application/pdf"
		};
	}
	catch (error) {
		await this.removeAcquisitionArtifacts({ incomingDir, incomingPath, partialPath });
		throw error;
	}
};

this.removeAcquisitionArtifacts = async function (staged) {
	for (let path of [staged.partialPath, staged.incomingPath]) {
		if (path && await IOUtils.exists(path)) await IOUtils.remove(path);
	}
	if (staged.incomingDir && await IOUtils.exists(staged.incomingDir)
		&& !(await IOUtils.getChildren(staged.incomingDir)).length) {
		await IOUtils.remove(staged.incomingDir);
	}
};

this.removeEmptyIncoming = async function (staged) {
	if (await IOUtils.exists(staged.incomingDir)
		&& !(await IOUtils.getChildren(staged.incomingDir)).length) {
		await IOUtils.remove(staged.incomingDir);
	}
};
