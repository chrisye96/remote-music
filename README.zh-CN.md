<p align="center">
  <img src="web/icon.svg" alt="Remote Music" width="112">
</p>

# Remote Music

[English](README.md) | 简体中文

在 iPad、手机或另一台电脑上，收听 Windows 电脑里 foobar2000 正在播放的音乐，并直接遥控它：浏览播放列表和专辑、点歌、切歌、拖进度。

解码仍然交给 foobar2000，所以它能播的格式都照样能听：SACD ISO、DSD、cue 整轨，你的 DSP 设置也全部保留。服务器从虚拟声卡截取 foobar2000 的输出，编码成无损 FLAC 的 HLS 流；同时提供一个网页，通过 beefweb 插件遥控 foobar2000。

## 功能

- **在哪里按播放，声音就到哪里。** 在 iPad 上按播放、点歌或切歌，声音会自动转到这台 iPad。左下角的小胶囊显示声音现在在哪里，点开可以把声音切回电脑音箱
- **无损串流**：16 bit / 48 kHz FLAC（备选 AAC 320k），比电脑晚约 3 秒
- **滚动歌词**：读取 foobar2000 的 ESLyric 保存的 `.lrc` 文件，按你实际听到的进度同步（扣掉串流延迟），中英对照的歌词成对显示。没有时间轴的 `.txt` 歌词按纯文本显示
- **随机播放和循环**（不循环、列表循环、单曲循环），对应 foobar2000 的播放顺序
- **锁屏控制**：显示真实的进度和时长，可以播放、暂停、切歌、拖动进度
- **播放列表和专辑**：筛选；大列表分页加载；专辑视图按文件夹分组（合辑和没有标签的整轨也能正确归类）；显示封面
- **主屏幕 App**（PWA），支持 iPad 和 iPhone、浅色和深色模式、英文和简体中文

## 工作原理

```
foobar2000 ──输出──▶ VB-Audio Hi-Fi Cable ──dshow──▶ ffmpeg (FLAC, fMP4 HLS) ──┐
     ▲                                                                       ├─ server.py 127.0.0.1:8090
     └──────────────── beefweb :8880 (仅本机) ◀── /api 代理 ─────────────────┘        │
                                                         tailscale serve --https=8090 │ HTTPS
                                                                                      ▼
                                                                       iPad / 手机 / 另一台电脑
```

`server.py` 只监听 127.0.0.1。其他设备通过 `tailscale serve` 访问，它同时提供 Safari 要求的 HTTPS。在家和在外面用的是同一个地址，在家时 Tailscale 会自动走局域网直连。

## 环境要求

- Windows，装有 [foobar2000](https://www.foobar2000.org/)
- [beefweb](https://github.com/hyperblast/beefweb) 0.10 或更新版本（foobar2000 的网页 API 插件；0.10 起才能切换输出设备）
- [VB-Audio Hi-Fi Cable](https://vb-audio.com/Cable/)
- [ffmpeg](https://ffmpeg.org/)，在 `PATH` 里，并且带 libsoxr（gyan.dev 的 "full" 版本就带）
- Python 3.8 或更新版本（只用标准库）
- 电脑和每台设备都装有 [Tailscale](https://tailscale.com/)，并在管理后台启用 MagicDNS 和 HTTPS Certificates

## 一次性设置

1. **启用虚拟声卡。** 打开 声音设置 → 更多声音设置，在「播放」页启用 *Hi-Fi Cable Input*，在「录制」页启用 *Hi-Fi Cable Output*。两个设备都在 属性 → 高级 里设成 **24 位, 44100 Hz**。

   两端都必须和虚拟声卡驱动的内部采样率一致。不一致时，Windows 会按错误的采样率读取数据，流里的声音会变尖，而且大约一半时间是静音。采集本身最高只到 44.1 kHz，设得更高也没有好处。
2. **在 foobar2000 里安装 beefweb 0.10 或更新版本**（打开 `.fb2k-component` 文件，确认安装，重启 foobar2000）。foobar2000 的音量保持 0 dB，音量在收听的设备上调。
3. **用 Tailscale 在 tailnet 内发布 HTTPS。** 只需运行一次，重启后依然有效：

   ```bash
   tailscale serve --bg --https=8090 http://127.0.0.1:8090
   ```

   一定要带 `--https=8090`。如果写成 `tailscale serve --bg 8090`，会占用根地址（443 端口），把原来在那里的服务顶掉。如果这台电脑上还有其他应用在用 `tailscale serve`，千万不要运行 `tailscale serve reset`。

## 运行

```bash
python server.py
```

服务器启动后会打印访问地址，形如 `https://<电脑名>.<tailnet 名>.ts.net:8090`。之后想再查这个地址：

```bash
tailscale serve status
```

在 iPad 或手机上先打开 Tailscale，用 Safari 访问这个地址，再用「添加到主屏幕」把它当 App 使用。在电脑本机上访问 `http://localhost:8090`。

### 参数

| 参数 | 作用 |
|---|---|
| `--codec aac` | 改用 AAC 320k 串流，给播不了 FLAC 流的设备用 |
| `--device "名字"` | 采集设备名，默认 `Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)` |
| `--port 8090` | 本地端口 |
| `--test-tone` | 用 440 Hz 测试音代替采集，排查问题时用 |
| `--lyrics-dir "路径"` | ESLyric 的歌词文件夹。默认 `%APPDATA%\foobar2000-v2\lyrics` 或 `%APPDATA%\foobar2000\lyrics`。便携版 foobar2000 放在 `foobar2000.exe` 旁边的 `profile\lyrics` |

查看 ffmpeg 能看到的采集设备：

```bash
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
```

### 语言

界面语言跟随浏览器（英文或简体中文）。在地址后面加一次 `?lang=en` 或 `?lang=zh-CN` 可以强制指定，这台设备会记住这个选择。

## 常见问题

| 现象 | 原因和解决办法 |
|---|---|
| 声音变尖、卡顿，大约一半时间没声 | 虚拟声卡两端和驱动内部的采样率不一致。把两端都设成 44100 Hz（一次性设置第 1 步） |
| Safari 提示 "HTTPS-Only enabled" | 打开 `tailscale serve status` 显示的 `https://…ts.net:8090` 地址，不要用局域网 IP |
| 在电脑本机上打开 `ts.net` 地址超时 | Windows 不一定在本机解析 MagicDNS 名称，本机改用 `http://localhost:8090` |
| 某台设备完全连不上 | 这台设备要打开 Tailscale。带"局域网隐身"功能的 VPN（例如 NordVPN 的 Invisibility on LAN）也会挡住连接 |
| 按了播放没有声音 | 控制区下方的胶囊应该显示"声音在这台设备"。如果 foobar2000 在往电脑音箱输出，点开胶囊选 Hi-Fi Cable |

## 已知限制

- 有约 3 秒延迟：切歌之后要过几秒才能听到变化。锁屏上的进度已经按这个延迟校正过
- 采集精度是 16 bit / 44.1 kHz（DirectShow 的上限），再用 soxr 转成 iOS 和蓝牙使用的 48 kHz。无论歌曲本身是什么采样率，Windows 都会先把它转成虚拟声卡的格式
- 随机播放和循环不能同时打开：foobar2000 只有一个播放顺序，打开其中一个会关掉另一个
- 没有登录验证，访问范围只靠你的 tailnet 限制。不要用 `tailscale funnel` 或端口映射把它暴露到公网
- 只支持 Windows（DirectShow 采集、VB-Audio 虚拟声卡）

## 路线图

- 登录后自动在后台启动，foobar2000 隐藏在托盘里，听之前不用手动打开任何东西。方案见 [docs/autostart-plan.md](docs/autostart-plan.md)

## 许可证

MIT，见 [LICENSE](LICENSE)。

foobar2000 是其所有者的商标。本项目与 foobar2000、beefweb、VB-Audio、Tailscale 均无关联，也未获得它们的认可。
