# 使用教程

## 1. 准备与备份

先备份 Zotero 数据和 PDF。用少量可以丢弃的测试文件开始；不要先拿整个文献库试验。只用于个人“我的文库”，不要期待群组或手机附件可用。

## 2. 云盘文件夹

在坚果云客户端正式建立独立一级同步文件夹 `ZoteroIncrementalSync`，内部新建 `PDFs`，所有电脑同步同一云端文件夹。不是“我的坚果云”内部一个需要同步整个父目录的子文件夹。

示例结构（不是必须使用的绝对路径）：

```
ZoteroIncrementalSync/
├── PDFs/
│   └── <attachmentKey>/<filename>.pdf
└── _logs/<machineRole或default>/
```

确认云盘客户端显示文件夹已注册、实际文件已同步；不要只创建本地同名目录就认定同步成功。经典同步保留完整本地文件；占位模式须单独保持该 PDF 目录下载/离线可用。其他云盘仅属未验证方案。

## 3. Zotero 配置

每台电脑：

- 登录同一个 Zotero 账号，开启正常 Data Sync。
- 此方案关闭个人库附件 File Sync / WebDAV。注意这意味着旧 stored 附件不再通过被关闭的文件同步上传，插件不会替代其历史同步。
- Settings → Advanced → Files and Folders → Linked Attachment Base Directory：选本机独立同步文件夹内的 `PDFs`。
- 不修改 Data Directory，不将 Zotero/storage 或 sqlite 放进云盘。

各机器绝对路径可以不同，PDFs 内相对结构须一致。已经有其他 linked 附件时，**不要盲目更换 Base Directory**：先核对旧链接解析和备份，设置变更可能影响现有链接。

## 4. 安装

Releases 下载 `.xpi`（不是 Source code.zip）。下载同版本 SHA256SUMS.txt 进行校验。Zotero → Tools → Plugins，拖入 `.xpi` 安装，然后正常重启。

插件没有单独的可视化配置面板；从 Zotero 已有 Base Directory 读取路径。有效目录不存在时不启用工作流。选定路径后需要正常重启以重新加载配置。

可选：熟悉高级配置者可设置字符串 `extensions.zotero.linksync.machineRole` 为 PRIMARY / B 等安全简单标签，区分日志。不是同步身份，不影响 item key；不配置时为 default。

## 5. 日常导入

本地 PDF：在“我的文库”中普通拖放（不按 Cmd/Alt/Ctrl/Shift）到已有文献条目，或列表空白位置。来源文件保留；生成独立链接文件。空白拖放可由 Zotero 后续识别元数据，不保证每个 PDF 都能识别。

文章页面：使用 Zotero Connector 保存。Zotero 保存文献记录，插件尝试获取一个主 PDF；没有候选或下载失败时可能只有文献记录。必要时合法下载 PDF 后拖到现有父条目。不要因为只出现文献记录就反复点击保存，否则可能产生重复记录。

直接 PDF 页面：在浏览器打开合法可访问 PDF，使用 Connector，支持符合条件的 PDF 流；不同浏览器/网站行为可能不同。

不要期待普通“添加文件”、已有附件转换、群组或非 PDF 导入也被覆盖。

## 6. 跨设备验收

先在 A 导入一份测试文件，确认 `PDFs/<key>/` 中有实体 PDF。分别等待 Zotero 正常 Data Sync 与云盘客户端同步。在 B 正常 Data Sync，等待 PDF 完整下载后从 Zotero Reader 打开同一附件。重启后再次打开。

高级诊断可比对 item key、linkMode=2、`attachments:` 路径和两台机器 SHA-256。不同机器 item ID 不必相同，item key 应一致。`synced=1` 是数据状态，不代表文件运输完成；插件日志 SYNCED 也不是云端确认。

## 7. 异常与卸载

找不到文件：核对账号、独立同步文件夹、本机 Base Directory、实体下载状态，不要重新 Add PDF 或批量更改旧路径。Connector 下载失败先保留父记录，查看脱敏日志。

若发现 duplicate、路径异常、启动/停用恢复失败，停止新导入并反馈；不要批量删除或转换附件。和其他附件管理插件同时使用未验证，建议先在隔离测试库评估。

停用/卸载：Tools → Plugins 停用/移除，正常重启；原 Connector 偏好及 hook 会尝试恢复。既有 linked 文件仍须保留在原位置并维持 Base Directory。卸载不会搬回 Zotero/storage，也不会删除云盘文件。
