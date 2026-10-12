# Validation scope

Early public release, not a certification of all operating systems or websites.

Developer acceptance on 2026-09-30: Zotero 10.0.4, macOS, Nutstore classic full-local folder synchronization. PRIMARY lifecycle disable/restart restoration passed; two B → PRIMARY reverse fixtures (local drag and direct PDF Connector) passed parent/attachment key identity, linkMode=2, relative path, complete local file, SHA-256, Reader before/after normal restart, no duplicate PDF child, no stored PDF copy, and final synced=1. PRIMARY-side earlier acceptance and developer-reported B acceptance provide the bidirectional workflow context.

Versions/dateModified changed during acceptance; content fields, identity, attachment relationship, linkMode, path and file SHA-256 remained stable. Cause of all timestamp/version updates was not established. Do not describe the validation as zero state changes.

The release target is 0.2.2.8, not 0.2.2.6. Its source was read from the developer's currently active installed XPI, SHA-256 `281a3bc4b503a617d7e4206ec20f14d171550076a0c1dade7aa1539f771402b2`. Installation metadata confirms version 0.2.2.8, active=true, userDisabled=false. The developer reports extended personal use without observed issues. New 0.2.2.8 local-import and ItemTree refresh behavior has not undergone a fresh independent runtime acceptance in this publishing task. Earlier rc6 acceptance must not be represented as rc8 acceptance. No independent broad-platform audit or universal publisher compatibility test is claimed.

Public packaging changes only manifest homepage and removes the placeholder update URL. JavaScript remains byte-identical to the currently installed 0.2.2.8 XPI. The repackaged XPI has a different checksum and has not been reinstalled into the production library during publication. No historical attachments were operated on.

Known limitation: transport state and some lifecycle identity observability are diagnostic heuristics, not end-to-end proof. Other plugins, library modes and future Zotero internal changes remain unverified.
