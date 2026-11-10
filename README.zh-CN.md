# Fab 免费资源一键入库

[English](README.md)

一个文件的油猴脚本：一键把 Fab 上某个卖家的全部免费资源加进你的库。为 [Quixel Megascans](https://www.fab.com/sellers/Quixel%20Megascans)（约 2.3 万个资源，2026 年 11 月起全部免费）而写，任何卖家页都能用。

## 安装

1. 装一个脚本管理器：[Tampermonkey 油猴](https://www.tampermonkey.net/)（Chrome、Edge、Firefox、Safari）或 [Violentmonkey 暴力猴](https://violentmonkey.github.io/)。
2. Chrome / Edge 要在扩展页（`chrome://extensions` 或 `edge://extensions`）右上角打开**开发者模式**，油猴才能运行脚本。
3. 点 **[安装脚本](https://raw.githubusercontent.com/akifukaku-ai/fab-library-claimer/main/fab-library-claimer.user.js)**，油猴会打开安装页，点**安装**。也可以在油猴里新建脚本，把整个文件粘进去保存。

## 使用

1. 在 [fab.com](https://www.fab.com) 登录。
2. 打开 [Quixel Megascans 卖家页](https://www.fab.com/sellers/Quixel%20Megascans)。在 Fab 其他页面，面板会显示 **Open Quixel Megascans** 按钮，点一下就跳过去。
3. 点右下角面板里的 **Start**。
4. 保持标签页开着。面板会显示已扫描、已拥有、新加入和失败的数量。

| 按钮 | 作用 |
|---|---|
| Start / Resume | 开始，或从上次保存的位置继续 |
| Stop | 跑完当前这一批后停下 |
| Reset | 清空进度，下次从头开始 |
| – | 收起面板 |

## 说明

- 已经在库里的会跳过，重复运行没有问题。过几天再跑一次，可以补上后来才变免费的资源。
- 每扫完一页就保存进度，关掉标签页或浏览器最多损失一页。
- 2.3 万个资源全部跑完需要一段时间。Fab 限速时脚本会自己等待重试。
- 脚本不下载任何文件，只是把资源加进你的 Fab 库；之后在 Fab、Unreal Engine 或 Bridge 里下载。
- 脚本只访问 fab.com，用的是你自己的登录状态，不收集任何信息。

## 常见问题

- **提示 "Please sign in to Fab first."**：先登录，再点 Start。
- **Failed 一直涨**：可能是 Fab 改版了，请提 issue 并附上面板截图。
- **看不到面板**：确认油猴里脚本已启用、开发者模式已打开，然后刷新页面。

## 许可

MIT
