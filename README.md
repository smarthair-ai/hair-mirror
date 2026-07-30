# 智能发型魔镜（部署版）

AI 人脸发型推荐 Web 应用，纯静态、可任意设备打开、人脸分析全程在浏览器本地完成（照片不上传）。

## 目录结构

```
index.html              入口页面（SPA，已去除渲染阻塞的外部脚本）
css/style.css          样式
js/                    全部前端逻辑（含 face-api.min.js）
js/models/             本地 AI 模型（tiny_face_detector / face_landmark_68 的 .bin 权重）
img/hair/              试戴用发型抠图（23 张 PNG）
img/styles/            发型库缩略图（23 张 JPG）
```

## 部署：GitHub + Vercel

### 方式 A：用 Vercel 账号一键导入（最简单）

1. 把本目录推送到一个 GitHub 仓库（见下方命令）。
2. 打开 https://vercel.com/new → 选择该仓库 → Framework 选 **Other** → 直接 Deploy。
3. 部署完成后获得 `https://xxx.vercel.app`，可自定义域名。

### 方式 B：Vercel CLI

```bash
npm i -g vercel
cd <本目录>
vercel            # 按提示登录并部署
vercel --prod    # 切到生产域名
```

### 注意事项

- **无需构建**：`vercel.json` 已设为 `buildCommand: null`，直接以静态文件托管。
- **存档功能**：原 CloudStudio 版带一个 `/api/` 后端做方案存档。纯静态托管下该接口不存在，
  `store.js` 会自动降级到浏览器 `localStorage`（同一设备可存档，跨设备不同步）。
  若需跨设备存档，可额外加 Vercel Serverless Function + KV（可选，未包含）。
- **统计脚本**：腾讯 beacon 已改为异步非阻塞加载，外部网络异常不影响页面打开。
- **自定义域名**：在 Vercel 项目 Settings → Domains 绑定即可，彻底摆脱临时域名失效问题。
