# SmartHair AI 项目目录结构

```
hair-mirror-hardened/
├── index.html              # AR 发型魔镜工作台（原 Demo）
├── css/style.css            # 工作台样式
├── js/                      # 工作台 JS（face-api/analysis/render/app...）
│   ├── face-api.min.js
│   ├── models/              # AI 模型权重
│   └── ...
├── img/                     # 发型图片
│   ├── hair/                # 试戴精灵图 (23 张 PNG)
│   └── styles/              # 发型库缩略图 (23 张 JPG)
├── vercel.json              # Vercel 部署配置
│
└── website/                 # 🆕 SmartHair AI 产品官网（独立）
    ├── index.html            # 官网首页（单页滚动）
    ├── css/style.css         # 官网样式（深色蓝紫渐变科技风）
    ├── js/main.js            # 官网交互（滚动动画/导航/表单）
    └── img/                  # 官网图片（预留）
```

## 本地运行

### 方式一：官网 + Demo 一起跑

```bash
cd hair-mirror-hardened
python3 -m http.server 8080
```

浏览器打开：
- 官网首页：http://localhost:8080/website/
- AR 工作台：http://localhost:8080/

### 方式二：只跑官网

```bash
cd hair-mirror-hardened/website
python3 -m http.server 3000
```

浏览器打开：http://localhost:3000

## Vercel 一键部署

整个 `hair-mirror-hardened/` 目录推送到 GitHub 后：

1. 打开 https://vercel.com/new
2. 导入仓库 `smarthair-ai/hair-mirror`
3. Framework 选 **Other**
4. **Root Directory** 保持 `./`（默认）
5. 点 **Deploy**

部署完成后：
- 官网首页：`https://xxx.vercel.app/website/`
- AR 工作台：`https://xxx.vercel.app/`

### 自定义域名配置

在 Vercel 项目 Settings → Domains 绑定你的域名。

如需官网作为根路径（`/`），在 `vercel.json` 中添加 `rewrites` 规则即可，无需移动文件。

## 页面说明

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 Hero | `website/#hero` | 品牌展示、核心数据、CTA |
| 产品介绍 | `website/#product` | 五步流程 + 六大核心能力 |
| 关于项目 | `website/#about` | 愿景/架构/算法/规划 + 技术指标 |
| 联系我们 | `website/#contact` | 联系信息 + 留言表单 |
| Demo 体验 | 跳转 AR 工作台 | 导航栏 `Demo体验` 链接到 `/` |
