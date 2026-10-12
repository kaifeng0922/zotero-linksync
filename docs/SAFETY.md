# Safety / 隐私和反馈

This plugin has privileged access to Zotero and local files. Review source and back up before use. No guarantee of loss-free operation or cloud delivery is provided.

## Data and network

The plugin writes new PDF files to the configured linked attachment base and JSON logs to its parent `_logs` directory. Connector acquisition uses Zotero download/resolver services and may contact publisher, DOI, URL or OA services. Zotero metadata recognition and cloud-client synchronization have their own network behavior and policies. This is not an offline-only tool.

It does not include a separate analytics or telemetry service. Logs may include source URLs, signed query parameters, local paths, item keys, error messages and machine labels. Cloud clients may sync these logs as part of the folder. Do not publish raw logs or your library database.

## Feedback / 反馈

Include plugin version, Zotero version, OS, cloud client and mode, which workflow failed, a minimal reproduction with disposable files, and the observed result. Redact usernames, local paths, source URLs/query strings, cookies, tokens, institution information and private document titles. Do not attach paid or private PDFs.

File public issues only with non-sensitive information. If an issue contains sensitive material, do not post it publicly; first ask for a private contact channel. The repository has no guaranteed response time or established private security inbox.

## Failure scope

Unsupported operations can fall back to Zotero native behavior, which may create stored attachments. Global Connector download preference changes can affect unsupported targets. Do not interpret the plugin's presence as a universal prevention of stored files or duplicates. Existing attachments are not automatically migrated, repaired or deduplicated.

Regular disable/uninstall/shutdown attempts to restore original hooks and Connector preference. Forced termination, version drift and plugin conflicts can prevent normal restoration. Stop imports and investigate before continuing if restoration fails.
