"use strict";

this.localFile = function (path) {
	let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
	file.initWithPath(path);
	return file;
};

this.sha256 = function (path) {
	let hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
	hash.init(hash.SHA256);
	let stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
	stream.init(this.localFile(path), -1, 0, 0);
	hash.updateFromStream(stream, -1);
	let binary = hash.finish(false);
	return Array.from(binary, c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
};

this.assertPDF = async function (path) {
	let bytes = await IOUtils.read(path, { maxBytes: 5 });
	let signature = Array.from(bytes).map(x => String.fromCharCode(x)).join("");
	if (signature !== "%PDF-") throw new Error("Source is not a PDF by signature");
	let stat = await IOUtils.stat(path);
	if (!stat.size) throw new Error("Source PDF is empty");
	return stat;
};
