# Image Studio Web

一个直接在浏览器中使用的 AI 图片创作工作台，支持文生图、图生图、局部编辑和蒙版编辑。

线上地址：<https://imagestudio.luhg.cn>

## 功能

- 文生图、图生图、局部编辑三种创作模式
- 可绘制、擦除、反选、撤销和继续编辑的蒙版编辑器
- 标准尺寸与自定义尺寸；自定义尺寸会校验 GPT Image 2 的宽高、比例、像素数与 2K 上限
- 会话和请求记录，可复制提示词、回显任务参数、删除请求
- 生成结果与源图切换、并排对比及放大预览
- 浏览器原生下载图片
- API Key 和接口地址仅保存在当前浏览器的本地存储中

## 使用方式

1. 打开线上地址，进入“设置”。
2. 填写 API Key 和支持跨域访问的 HTTPS Images API 地址。
3. 选择创作模式，填写指令和图片参数后开始生成。
4. 生成完成后可下载结果，或继续编辑、局部编辑。

> 请只在可信设备上保存 API Key。浏览器本地存储可能被同一浏览器环境中的站点脚本或扩展读取。

## 本地开发

需要 Node.js 20+ 与 pnpm 9+。

```bash
pnpm install
pnpm dev
```

默认开发地址为 <http://127.0.0.1:1421/>。

## 校验与构建

```bash
pnpm lint
pnpm build
```

构建结果输出到 `dist/`。

## 发布与部署

仓库使用 GitHub Pages 部署。推送以 `v` 开头的标签时，GitHub Actions 会自动安装依赖、构建并发布新版本。

```bash
git tag v0.1.1
git push main v0.1.1
```

自定义域名为 `imagestudio.luhg.cn`。域名 DNS 配置请参见下方“域名绑定”。

## 域名绑定

在 `luhg.cn` 的 DNS 服务商控制台添加下列记录：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| CNAME | `imagestudio` | `RainbowLand6.github.io` |

DNS 生效后，在 GitHub 仓库的 **Settings > Pages** 中确认自定义域名为 `imagestudio.luhg.cn`，并启用 **Enforce HTTPS**。

## 技术栈

- React 18
- TypeScript
- Vite
- Lucide React
- GitHub Actions / GitHub Pages

