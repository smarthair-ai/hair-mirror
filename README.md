# SmartHair AI — AI+AR 智能发型设计

纯静态网站，官网为根入口，AR 工作台在 `/demo/` 子目录。人脸分析全程在浏览器本地完成（照片不上传）。

## 目录结构

```
index.html              官网首页（产品介绍 / 关于 / 联系我们）
css/style.css           官网样式（深蓝紫科技风 + 毛玻璃卡片）
js/main.js              官网交互（滚动动画 / 导航 / 表单）

demo/                   AR 发型魔镜工作台（理发店平板系统）
├── index.html          工作台入口（摄像头 / AI 分析 / AR 试戴）
├── css/style.css       工作台样式（v3 商务精调 · 米灰棕）
├── js/                 工作台全部逻辑（含 face-api.min.js）
│   └── models/         本地 AI 模型（tiny_face_detector / face_landmark_68 的 .bin 权重）
└── img/
    ├── hair/           试戴用发型抠图（23 张 PNG）
    └── styles/         发型库缩略图（23 张 JPG）

vercel.json             Vercel 部署配置（零构建 + 静态缓存头）
```

## 部署：GitHub + Vercel

### 方式 A：用 Vercel 账号一键导入（最简单）

1. 把本目录推送到一个 GitHub 仓库。
2. 打开 https://vercel.com/new → 选择该仓库 → Framework 选 **Other** → 直接 Deploy。
3. 部署完成后获得 `https://xxx.vercel.app`：
   - 根路径 `/` → 官网首页
   - `/demo/` → AR 工作台

### 方式 B：Vercel CLI

```bash
npm i -g vercel
cd <本目录>
vercel            # 按提示登录并部署
vercel --prod     # 切到生产域名
```

### 注意事项

- **无需构建**：`vercel.json` 已设为 `buildCommand: null`，直接以静态文件托管。
- **存档功能**：纯静态托管下 `store.js` 自动降级到浏览器 `localStorage`（同一设备可存档，跨设备不同步）。
  若需跨设备存档，可额外加 Vercel Serverless Function + KV（可选，未包含）。
- **统计脚本**：腾讯 beacon 已改为异步非阻塞加载，外部网络异常不影响页面打开。
- **自定义域名**：在 Vercel 项目 Settings → Domains 绑定即可。
