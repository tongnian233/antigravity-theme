---
name: antigravity-theme
description: 使用、配置或排查 Antigravity Theme Studio（桌面端背景壁纸、毛玻璃透明化、主题色、消息气泡与自定义 CSS 美化插件）。
---

# Antigravity Theme Studio · 界面美化工作室

当用户询问如何修改 Antigravity 桌面端背景图、调节毛玻璃透明度、切换文字色调/气泡配色、导入导出配置或排查美化补丁状态时：

1. **应用内快捷操作**：
   - 按下快捷键 **`Ctrl + Shift + B`**（macOS 为 `Cmd + Shift + B`），或点击左侧栏底部（可自由拖动）的 **`🎨`** 悬浮小按钮，呼出 3-Tab 美化设置抽屉（`壁纸与布局` / `光影与质感` / `色彩与高级`，抽屉自身支持 `黑 / 白 / 透明` 皮肤切换，双击滑块项可恢复默认值）。
   - 支持本地图片（上限 20 MB）与循环视频壁纸（上限 35 MB，最多展示最近 24 项）、壁纸明暗自动感知文字色调、自定义发送气泡样式，以及安全隔离式导入自定义 CSS（需手动审查确认后启用）。
2. **配置文件与自定义壁纸持久化路径**：
   - 配置文件：`~/.gemini/config/plugins/antigravity-theme/theme_prefs.json`
   - 自定义壁纸目录：`~/.gemini/config/plugins/antigravity-theme/wallpapers/custom/`
3. **安装、校验、暂存与卸载（项目目录下）**：
   - `node setup.cjs --check`：只读检查 `app.asar` 美化块状态、实测版本、Electron ASAR Fuse 与插件兼容情况
   - `node setup.cjs --dry-run` / `node setup.cjs --uninstall --dry-run` / `node setup.cjs --apply-staged --dry-run`：严格只读校验（不修改磁盘、不终止进程）
   - `双击安装美化补丁.bat`（或 `node setup.cjs --kill --relaunch`）：原子安装或更新补丁（客户端版本升级后重新执行即可恢复；若客户端运行中会生成带双哈希元数据的安全暂存包，退出后可用 `node setup.cjs --apply-staged` 提交）
   - `双击卸载美化补丁.bat`（或 `node setup.cjs --uninstall --kill --relaunch`）：无损逐字节移除美化补丁（仅在正式包提交成功后才清理插件数据，不影响猫娘挂件与汉化）。
