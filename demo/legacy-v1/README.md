# 演示视频的录制与剪辑

用脚本重新生成平台演示视频（1920×1080、30 fps、H.264 + AAC，约 81 秒）。

## 准备

- macOS + Google Chrome（其他位置的 Chrome 用环境变量 `CHROME_PATH` 指定）
- Node.js 18+、Python 3、ffmpeg（需 libx264）
- 在本目录安装录制依赖（与主项目依赖分开）：

```bash
cd demo && npm install
```

## 运行

1. 在项目根目录启动应用（开发模式；录制依赖开发模式下暴露的 `window.__store` / `window.__r3f`）：

```bash
npm run dev
```

2. 在 `demo/` 中依次运行三步，或用 `npm run video` 一次完成：

```bash
npm run titles     # 渲染片头/片尾 → frames/intro, frames/outro（较慢，约 5 分钟）
npm run capture    # 录制 7 个功能场景 → frames/s1_orbit … s7_model（约 3 分钟）
npm run assemble   # 分段编码 + 转场 + 配乐 → ~/Desktop/三元相图三维交互平台_演示视频_1080p.mp4
```

- 应用不在 `http://127.0.0.1:5173/` 时（例如 5173 被其他项目占用，Vite 会自动改用 5174）：`DEMO_URL=http://127.0.0.1:5174/ npm run capture`。
  录制前脚本会检查打开的是否为本应用，地址不对时会提示并退出。
- 只重录某个场景（其余场景仍会执行交互以保持状态，但不保存帧）：`node capture.mjs s3_iso`
- 指定输出路径：`python3 assemble.py /path/to/out.mp4`

## 文件

| 文件 | 作用 |
| --- | --- |
| `capture.mjs` | 无头 Chrome 驱动应用：虚拟时钟逐帧推进动画，真实鼠标事件完成拖动/单击，叠加光标与字幕，可按帧放大局部 |
| `titles.mjs`、`title.html` | 片头/片尾动画，逐帧渲染；`title-bg.jpg` 为背景 |
| `assemble.py` | 帧序列编码为分段，`xfade` 转场拼接，配乐淡入淡出与响度归一化，输出 MP4 |
| `music/voxel_revolution.mp3` | 背景音乐 |

场景内容、字幕文字、镜头与时长都在 `capture.mjs` 中按场景顺序编写；转场类型和时长在 `assemble.py` 的 `TRANS` 中。中间产物 `frames/`、`segments/` 可随时删除。

## 音乐授权

“Voxel Revolution” Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License — https://creativecommons.org/licenses/by/4.0/

使用该音乐须保留署名；片尾已包含上述署名，剪辑或转发时请勿删除。
