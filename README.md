# Zotero LinkSync

让新导入的 PDF 从创建时就成为链接附件：**Zotero 同步文献数据，坚果云同步 PDF 文件。**

[English](README.en.md) · [安装包 / Releases](https://github.com/kaifeng0922/zotero-linksync/releases) · [使用教程](docs/USAGE.zh-CN.md) · [问题反馈](https://github.com/kaifeng0922/zotero-linksync/issues)

这是 Kai 在 Codex 协助下开发的第一个小插件，起点是一个真实需求：在多台电脑间切换阅读 Zotero 文献，只同步新增 PDF，不把整个 Zotero 数据目录放进云盘。第三方社区项目，与 Zotero 官方无隶属关系。

## 适合谁？

- 家里、办公室、笔记本之间切换阅读，同一个文献库需要访问同一份新 PDF。
- 已有独立云盘同步文件夹，希望新增附件保存到其中，而不是 Zotero/storage。
- 希望保留 Zotero 文献 Data Sync，又使用自己的文件同步方案。

**不适合**：希望开箱即用、完全不用配置云盘；需要群组库或移动端附件访问；希望一键迁移历史附件、恢复缺失文件或去重。插件不提供这些功能。

## 当前能力

1. 在“我的文库”中，将外部本地 PDF 普通拖到已有文献或列表空白区域，创建链接附件，保留拖入的原文件。
2. Connector 保存文章页面时，由 Zotero 创建文献记录，LinkSync 尝试获取一个主 PDF 并创建链接附件。
3. 从浏览器直接 PDF 页面使用 Connector，支持符合条件的 PDF 流保存。

成功路径：`PDFs/<attachmentKey>/<filename>.pdf`；Zotero 路径为 `attachments:<attachmentKey>/<filename>.pdf`，linkMode=2。保存过程中验证 PDF 文件头、大小和 SHA-256。

## 先读这个

**早期公开版：0.2.2.6（rc6）**。开发者的 macOS / Zotero 10.0.4 / 坚果云经典完整本地同步环境已完成跨设备、Reader、重启和 Data Sync 验证；后续个人使用稳定由开发者报告。没有全面验证 Windows、Linux、其他云盘、所有出版商或其他 Zotero 版本。

- 安装前备份 Zotero 数据与附件，用少量可丢弃文件先测试。
- 每台电脑登录同一 Zotero 账号、同步同一独立云盘文件夹，分别设置本机的 Linked Attachment Base Directory。
- Data Sync 开；此方案在个人库关闭 Zotero 附件文件同步 / WebDAV。已有 stored 附件不会因此被迁移，也不再由该关闭的文件同步方案上传。
- **不要把 Zotero 数据目录或 sqlite 放到云盘。** 云盘同步不是备份。
- PDF 必须完整下载到每台电脑。文献同步完成不代表 PDF 已到达。
- `SYNCED` 仅按坚果云日志活跃程度推断，**不证明上传完成或另一台设备已收到文件**。
- 插件启用时暂时将 `downloadAssociatedFiles` 设为 false，以避免 Connector 原生 stored PDF 与 linked PDF 重复；正常停用、退出或卸载会尝试恢复原设置。群组库等不支持范围也可能受这个全局偏好影响。
- 没有成功下载 PDF 时，可能只保存文献记录。登录、验证码、授权下载及网站变化可能影响获取结果。不绕过付费墙。
- 插件使用 Zotero 内部接口，可能与其他附件/Connector 插件冲突，Zotero 更新也可能使其失效。

## 快速开始

1. 阅读[完整教程](docs/USAGE.zh-CN.md)，在云盘客户端建立独立一级同步文件夹 `ZoteroIncrementalSync`，里面建 `PDFs`。
2. 各电脑设置 Zotero → Settings → Advanced → Files and Folders → Linked Attachment Base Directory 为各自完整本地的 `PDFs` 目录。不要更改 Data Directory。
3. 从 Releases 下载 `.xpi`，在 Zotero → Tools → Plugins 窗口拖入安装。重启 Zotero。
4. 先导入一份测试 PDF，等待 Zotero Data Sync 与云盘同步；到另一台电脑确认相同附件可用 Reader 打开。

没有设置有效 Base Directory 时，插件不启用工作流，交还 Zotero 原生处理。插件不会替你注册云盘同步文件夹，也不会自动配置文件同步选项。

## 隐私、故障与卸载

日志位于 `PDFs` 的父目录下 `_logs/<machineRole或default>/`，可能包含本地路径、文献 key、来源 URL（可能带临时签名）和错误详情。**不要原样公开上传日志**。[隐私及反馈说明](docs/SAFETY.md)。

停用/卸载：在 Tools → Plugins 中停用或移除，正常重启。既有链接附件和云盘 PDF 不会自动改回 stored 附件；保留 Base Directory 和文件即可继续读取。若出现重复或异常，停止新导入，勿批量转换或清理历史对象。

## 开发与许可

MIT，见 [LICENSE](LICENSE)。不包含 Zotero 本体源码或文献 PDF。使用 Zotero 和云盘须遵守其条款及文献授权。

安装包构建：Python 3 运行 `python3 scripts/build.py`。该脚本只打包列出的插件文件，不收集用户库或日志。详见 [版本说明](CHANGELOG.md) 与[验收范围](docs/VALIDATION.md)。

官方参考：[插件安装与权限提醒](https://www.zotero.org/support/plugins)、[链接文件说明](https://www.zotero.org/support/attaching_files)、[同步说明](https://www.zotero.org/support/sync)。
