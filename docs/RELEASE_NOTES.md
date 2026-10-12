# Zotero LinkSync 0.2.2.8 — Early public release

New PDFs as linked attachments: use Zotero Data Sync for records and a dedicated cloud-synced local folder for files.

Use cases: switching between home, office and laptop; keeping new PDF files outside Zotero/storage; no automatic historical migration.

Download the attached `.xpi` and SHA256SUMS.txt. Read the README and backup/setup instructions before installing. Current developer installation: 0.2.2.8, with extended personal use reported stable. Earlier 0.2.2.6 acceptance covered macOS, Zotero 10.0.4 and Nutstore classic full-local sync; it is not an independent runtime acceptance of new 0.2.2.8 hooks. Other environments remain unverified.

Connector behavior changes while enabled; see Safety and known limitations. Transport SYNCED is not cloud delivery confirmation. No automatic update endpoint is configured. This is a third-party plugin, not an official Zotero product.

Includes resilient ItemTree drag hooks and eligible standalone local PDF imports. This package cleans up manifest homepage/update metadata only; JavaScript is unchanged from the current installed 0.2.2.8 XPI. The production installation was not modified by publishing.

Current personal setup: Syncthing synchronizes PDFs between two Macs; Tailscale provides network connectivity, not folder synchronization. This setup does not require purchasing cloud storage for PDF transport. Nutstore was used in earlier tests. Windows and Linux remain unvalidated. See the current README for updated setup choices.
