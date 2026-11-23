# Antigravity Theme Studio · 界面美化工作室

> 专为 **Google Antigravity 2.0** 桌面客户端打造的无损界面美化插件：支持自定义本地静态/动态壁纸、通透毛玻璃（Glassmorphism）、壁纸明暗自动识别与字色联动、自定义发送气泡、3-Tab 实时美化抽屉与自定义 CSS 安全导入，**零外部依赖**，与猫娘挂件（`gemini-neko-cockpit`）及汉化补丁（`AG_ZH` / 运行时汉化）无损共存。

---

## ✅ 已验证平台与版本

- **已实机验证宿主**：Windows 11 + Google Antigravity `2.34.0`（Electron `BaseWindow` + `WebContentsView`）
- **其他平台（macOS / Linux）**：CLI 与 ASAR 打包逻辑已做跨平台适配（待更多环境实测）。
- **安全门禁与探测**：安装器会自动检测宿主二进制的 Electron ASAR Header Integrity Fuse 并核对已实测版本清单；若启用了强头校验（`enabled`）将强制中止，若遇到未实测新版本或无法确认关闭的 Fuse 状态，正式安装也会在写入前停止并提示先用 `--check` / `--dry-run` 诊断（高级用户自担风险可附带 `--allow-unverified-host`，但 `enabled` 仍绝对禁止写入）。

---

## ✨ 核心特性

- **🖼️ 自定义背景壁纸（静态 & 动态）**
  - 一键调用系统文件选择器导入本地图片（`PNG / JPG / WebP / GIF / AVIF / SVG`，单文件上限 **20 MB**）或循环动态视频（`MP4 / WebM`，单文件上限 **35 MB**，窗口最小化或切走时自动暂停释放资源）
  - 内置壁纸历史列表（按最近修改时间展示最近 **24 项**），个人壁纸与配置持久化保存在用户目录，客户端升级后重跑安装脚本不会丢失
  - 支持「铺满 (`cover`) / 完整 (`contain`，自动采样边缘色填边无黑条) / 拉伸 (`fill`)」与 5 向对齐锚点
- **🎨 5 套开箱即用精选预设**
  - **Gemini 猫猫（默认）** / **蓝紫星河（Starry Neko）** / **樱雪微光（Sakura Mist）** / **极光深海（Cyber Aurora）** / **纯光渐变（Nebula CSS）**
  - **单击切换壁纸，再次点击同一预设可一键套用该预设的推荐光影参数**
  - *资源来源与许可说明*：内置 4 张 16:9 预设壁纸（`assets/wallpapers/*.jpg`）均为 AI 图像生成工具生成的原创配图，已清除全部 EXIF/XMP 元数据，随本项目按 [LICENSE](./LICENSE)（MIT）发布。
- **🪟 双渲染模式自由切换**
  - **通透毛玻璃（Glass，默认）**：柔化主画布、侧边栏、顶栏、底部输入框与代码块为半透明毛玻璃，并为设置页、右侧概览面板、弹窗及猫娘挂件建立原生表面与 CSS 继承防火墙
  - **轻柔叠层（Overlay）**：保留原生画布与侧栏实底，以滤色/正片叠底柔和叠合壁纸（注：为了保持视觉统一，Windows 标题栏控制区透明化与可选的底部输入框毛玻璃/发送气泡样式在叠层模式下同样生效）
- **🧠 壁纸明暗智能感知 & 色彩系统**
  - **自动文字色调**：对静态壁纸（含 PNG 透明底与 `cover` 裁剪区）和动态视频采样真实视觉亮度并结合护眼遮罩与滞回防抖，在深色模式配亮壁纸 / 浅色模式配暗壁纸等反向搭配下自动匹配清晰文字、通透毛玻璃底色与 Windows 标题栏按钮色
  - **自定义发送消息气泡**：独立调节用户发出消息气泡的底色、磨砂不透明度，支持 WCAG 亮度自动对比字色或手动选色
  - **3-Tab 实时抽屉（`Ctrl + Shift + B`）**：`壁纸与布局` / `光影与质感` / `色彩与高级`，抽屉自身支持 `黑 / 白 / 透明` 3 种外观；按住拖动滑块自动半透明透视预览，双击滑块项恢复默认值；左侧栏底部可自由拖动 `🎨` 悬浮入口
  - **安全导入配置**：导入外部 JSON 主题配置（上限 256 KB）时，若包含 `customCss` 将默认隔离暂不执行，需经你在抽屉中完整审阅转义后的全部代码并手动点击「确认启用」后才会生效
- **🛡️ 事务级原子安装 & 字节级幂等**
  - 纯 Node.js 实现，零 `npm install`
  - 独立标记块 `AG_THEME_STUDIO_BEGIN` ~ `END`，同版本重复安装严格字节幂等，卸载逐字节还原宿主原文，完整保留 `GEMINI_NEKO_HUD` 与汉化区块
  - 写入前强制校验备份、互斥锁与源包哈希，通过同目录临时文件 + `renameSync` 原子替换；宿主运行中时自动生成带「源包 + 暂存包」双 SHA-256 元数据的安全暂存包，拒绝过期暂存包覆盖新版宿主或其他新装补丁

---

## 🚀 快速安装与验证

### Windows 一键安装（推荐）
直接双击项目根目录下的：
```text
双击安装美化补丁.bat
```
脚本会自动关闭目标 Antigravity 进程、同步插件资源与壁纸、校验并原子写入 `app.asar` 后重启客户端。

### 命令行安装 / 检验 / 暂存应用（Windows / macOS / Linux）
```bash
# 仅做纯只读内存干跑校验（绝不修改磁盘、不关闭进程）
node setup.cjs --dry-run

# 查看安装状态、宿主实测版本与 Electron Fuse 报告
node setup.cjs --check

# 安装 / 更新（若客户端正在运行，自动安全暂存到 app.asar.theme-staged）
node setup.cjs

# 一键关闭目标客户端、原子写入补丁并重启
node setup.cjs --kill --relaunch

# 校验并应用之前生成的暂存包（支持 --dry-run 只读预检）
node setup.cjs --apply-staged --dry-run
node setup.cjs --apply-staged --kill --relaunch

# 显式指定安装目录（目录无效将直接报错，不会误改默认安装）
node setup.cjs --install-dir "D:\Apps\Antigravity" --dry-run
```

### 一键无损卸载与手动恢复
- **Windows**：双击 `双击卸载美化补丁.bat`（支持附加命令行参数，如 `--dry-run` 或 `--purge-data`，脚本始终强制保持卸载模式）
- **命令行**：`node setup.cjs --uninstall --kill --relaunch`（默认保留 `theme_prefs.json` 与自定义壁纸；加 `--purge-data` 将在正式包原子提交成功后一并清除用户数据；暂存卸载期间不会提前删除插件数据）
- **紧急手动恢复**：首次安装时会在 `app.asar` 同目录创建经校验的纯净备份 `app.asar.theme-bak`。若需手动回滚，完全退出 Antigravity 后将 `app.asar.theme-bak` 复制/重命名覆盖回 `app.asar` 即可。

---

## ⌨️ 日常使用

1. 启动 Antigravity 2.0 后，按 **`Ctrl + Shift + B`**（macOS 为 `Cmd + Shift + B`），或点击左侧栏底部可自由拖动的 **🎨 调色盘按钮** 呼出美化设置抽屉。
2. 个人数据持久化目录：
   - 配置文件：`~/.gemini/config/plugins/antigravity-theme/theme_prefs.json`
   - 本地壁纸库：`~/.gemini/config/plugins/antigravity-theme/wallpapers/custom/`
3. 客户端官方升级覆盖 `app.asar` 后，重新双击一次 `双击安装美化补丁.bat` 即可无损恢复美化。

---

## 📁 项目结构

```text
antigravity-theme/
├── assets/
│   ├── wallpapers/               # 内置 4 张 16:9 护眼预设壁纸（默认含 Gemini 猫猫）
│   └── logo.svg                  # 插件矢量图标
├── skills/antigravity-theme/
│   └── SKILL.md                  # Antigravity 对话伴生 Skill
├── src/
│   └── asar_patcher.cjs          # 零依赖 ASAR 严格解析、字节幂等注入与逐块校验器
├── theme/
│   ├── main_bridge.js            # Electron 主进程可信 IPC、异步媒体、原子配置与标题栏桥接
│   └── preload_theme.js          # 渲染层毛玻璃引擎、壁纸明暗感知与 3-Tab 实时抽屉
├── plugin.json                   # 插件清单
├── setup.cjs                     # 跨平台事务化安装 / 校验 / 暂存 / 卸载 CLI
├── 双击安装美化补丁.bat            # Windows 一键安装（纯 ASCII + CRLF）
├── 双击卸载美化补丁.bat            # Windows 一键卸载（纯 ASCII + CRLF）
├── .gitignore
└── LICENSE
```
