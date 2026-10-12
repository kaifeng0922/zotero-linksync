# Zotero LinkSync

**New PDFs become linked attachments from birth: Zotero syncs library data; an independently synced local folder carries the PDF files.**

[中文](README.md) · [Download](https://github.com/kaifeng0922/zotero-linksync/releases) · [Issues](https://github.com/kaifeng0922/zotero-linksync/issues)

Kai's first small plugin, developed with Codex assistance to solve a personal multi-computer reading workflow. This is a third-party project, not an official Zotero product.

## Current setup and scope

I currently synchronize PDFs between two Macs with **Syncthing**, using **Tailscale for cross-network connectivity or a fallback network path**. Nutstore was used in earlier tests and is no longer part of the production sync setup. Tailscale does not itself synchronize folders and is not required by LinkSync.

This device-to-device PDF synchronization setup does not require a cloud-storage subscription; capacity remains limited by device disk space. LinkSync is not tied to one cloud provider. Other tools providing fully local synchronized folders are candidates requiring compatibility tests.

**Testing is limited to a two-Mac workflow. Windows and Linux have not been validated.** This does not constitute fresh independent acceptance of every new 0.2.2.8 hook.

## Use cases

Switch between home, office and laptop while keeping new PDFs in a dedicated cloud-synced folder. Use Zotero Data Sync for records and a separate service for files, without putting Zotero's data directory in cloud storage.

Supported workflows in editable My Library: plain drag of external local PDFs onto an existing parent or blank item-list area; article-page Connector saves with one primary PDF candidate; compatible direct-PDF Connector stream saves; eligible standalone local PDF imports. ItemTree drop hooks are refreshed after view replacement. Success creates linkMode=2 with `attachments:<key>/<filename>` pointing to `PDFs/<key>/<filename>`. Local drag sources are copied, not moved.

## Setup

1. Back up your library and PDFs. Start with disposable test files.
2. Create a dedicated top-level sync folder, e.g. `ZoteroIncrementalSync`, using Syncthing or a separately configured cloud client. Create `PDFs` inside it. Sync that folder, not the whole cloud account or Zotero data directory.
3. On every computer, synchronize the same dedicated PDF folder, keep PDFs fully downloaded, sign in to the same Zotero library, and set Settings → Advanced → Files and Folders → Linked Attachment Base Directory to that computer's `PDFs` folder. Absolute paths can differ; relative layout must match.
4. Keep Data Sync enabled. This workflow uses Zotero personal-library attachment File Sync / WebDAV disabled. Existing stored attachments are not migrated or uploaded by LinkSync.
5. Download the `.xpi` from Releases, drag it onto Tools → Plugins, and restart Zotero. Perform one test import, wait for both sync systems, and open the same attachment on another machine.

## Important limitations

Early release 0.2.2.8, sourced from the developer's currently active installed XPI. The developer reports extended personal use without observed issues. Earlier 0.2.2.6 acceptance covered macOS, Zotero 10.0.4 and Nutstore classic full-local synchronization, including cross-device linked paths, SHA-256, Reader, restart and Data Sync; this does not independently validate the new 0.2.2.8 hooks. Other operating systems, Zotero versions, cloud services and all publisher sites are not comprehensively tested.

- No historical migration, deduplication or missing-file repair. Group libraries and mobile attachment access are not supported targets.
- Plugin startup temporarily sets the global `downloadAssociatedFiles` preference to false. Normal shutdown/disable/uninstall attempts to restore its original value. Unsupported Connector targets can still be affected by this global preference.
- Metadata may save without a PDF if acquisition fails. Login, CAPTCHA, download permissions and website changes can affect results. No paywall bypass.
- Internal API hooks may conflict with other plugins or break after a Zotero update. No automatic updates are configured in this release.
- Transport `SYNCED` is a Nutstore client-log freshness heuristic, not proof of upload or remote receipt.
- Local logs can contain file paths, item keys and source URLs with signed query parameters. Redact before sharing.
- Cloud sync is not a backup. Removing the plugin does not convert linked attachments or remove the PDFs. Preserve the base path and files.

See [Safety](docs/SAFETY.md), [Validation](docs/VALIDATION.md), and [Changelog](CHANGELOG.md). Build with Python 3: `python3 scripts/build.py`. MIT licensed; no Zotero distribution or article PDFs are included.

Official references: [plugins](https://www.zotero.org/support/plugins), [attachments](https://www.zotero.org/support/attaching_files), [sync](https://www.zotero.org/support/sync).
