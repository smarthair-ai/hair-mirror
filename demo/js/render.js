/* =========================================================================
 * render.js — 简易人脸模型 + 发型渲染（4 视角 / 发色 / 质感 / 光线）
 * 纯 Canvas 2D，参数化绘制，无外部素材依赖。
 * ========================================================================= */

/* ---------- 颜色工具 ---------- */
function hexToRgb(h){ h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); const n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function rgbStr(rgb,a){ return a==null?`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`:`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }
function mix(c1,c2,t){ return [Math.round(c1[0]+(c2[0]-c1[0])*t),Math.round(c1[1]+(c2[1]-c1[1])*t),Math.round(c1[2]+(c2[2]-c1[2])*t)]; }
function lighten(c,t){ return mix(c,[255,255,255],t); }
function darken(c,t){ return mix(c,[0,0,0],t); }

/* 发质渲染参数（雾面 / 通透光泽 / 哑光） */
const TEXTURE_PARAMS = {
  frosted: { top:0.14, bottom:-0.05, sheen:0.16, gloss:0.0,  label:'雾面' },
  glossy:  { top:0.24, bottom:-0.10, sheen:0.45, gloss:0.9,  label:'通透光泽' },
  matte:   { top:0.03, bottom:-0.02, sheen:0.04, gloss:0.0,  label:'哑光' }
};
const LIGHT_PARAMS = {
  indoor: { wash:[180,200,235], washA:0.06, hi:0.75, bgTop:'#eef1f6', bgBot:'#dfe4ec', warm:0 },
  sun:    { wash:[255,221,150], washA:0.12, hi:1.35, bgTop:'#fff4e2', bgBot:'#ffe3bd', warm:1 }
};

/* ---------- 脸型轮廓关键系数 ---------- */
// 关键点（归一化，x 右为正，y 上为负）: TL颞, TL2颧, JL下颌角, C下巴, JR, TR2, TR, T头顶
const SHAPE_MOD = {
  '圆脸':    { TL:[-0.86,-0.6], TL2:[-0.96,-0.12], JL:[-0.82,0.56], C:[0,0.96],  TR2:[0.96,-0.12], TR:[0.86,-0.6],  ratio:1.14 },
  '方脸':    { TL:[-0.9,-0.58], TL2:[-1.0,-0.1],  JL:[-0.94,0.54], C:[0,0.9],   TR2:[1.0,-0.1],   TR:[0.9,-0.58],  ratio:1.12 },
  '鹅蛋脸':  { TL:[-0.78,-0.62],TL2:[-0.92,-0.12], JL:[-0.7,0.58],  C:[0,1.06],  TR2:[0.92,-0.12], TR:[0.78,-0.62], ratio:1.32 },
  '长脸':    { TL:[-0.72,-0.66],TL2:[-0.86,-0.12], JL:[-0.64,0.6],  C:[0,1.16],  TR2:[0.86,-0.12], TR:[0.72,-0.66], ratio:1.46 },
  '菱形脸':  { TL:[-0.74,-0.6], TL2:[-1.06,-0.12], JL:[-0.62,0.56], C:[0,1.0],   TR2:[1.06,-0.12], TR:[0.74,-0.6],  ratio:1.28 },
  '心形脸':  { TL:[-0.98,-0.58],TL2:[-1.02,-0.12], JL:[-0.6,0.56],  C:[0,1.0],   TR2:[1.02,-0.12], TR:[0.98,-0.58], ratio:1.2 }
};

function faceRatio(shape){ return (SHAPE_MOD[shape]||SHAPE_MOD['鹅蛋脸']).ratio; }

// 由 8 个关键点生成平滑闭合轮廓路径
function headShapePath(cx, cy, headW, headH, mod){
  const P = {
    T:  [0, -1.0],
    TR: mod.TR,  TR2: mod.TR2, JR: [mod.TR2[0], 0.28],
    C:  mod.C,
    JL: [mod.TL2[0], 0.28], TL2: mod.TL2, TL: mod.TL
  };
  const order = ['TL','TL2','JR','C','JL','TR2','TR','T'];
  const pts = order.map(k => [cx + P[k][0]*headW/2, cy + P[k][1]*headH/2]);
  return smoothClosedPath(pts);
}
function smoothClosedPath(pts){
  const p = new Path2D();
  const n = pts.length;
  const mid = (a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  let m0 = mid(pts[n-1], pts[0]);
  p.moveTo(m0[0], m0[1]);
  for(let i=0;i<n;i++){
    const cur = pts[i], nxt = pts[(i+1)%n];
    const m = mid(cur,nxt);
    p.quadraticCurveTo(cur[0],cur[1], m[0],m[1]);
  }
  p.closePath();
  return p;
}

/* ---------- 发色填充 + 高光 ---------- */
function hairFillStyle(ctx, box, baseRgb, texture, lighting){
  const tp = TEXTURE_PARAMS[texture] || TEXTURE_PARAMS.frosted;
  const top = lighten(baseRgb, Math.max(0,tp.top));
  const bot = darken(baseRgb, Math.max(0,-tp.bottom));
  const g = ctx.createLinearGradient(0, box.y, 0, box.y+box.h);
  g.addColorStop(0, rgbStr(top));
  g.addColorStop(0.55, rgbStr(baseRgb));
  g.addColorStop(1, rgbStr(bot));
  return g;
}
function applyLighting(ctx, box, lighting){
  const lp = LIGHT_PARAMS[lighting] || LIGHT_PARAMS.indoor;
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = rgbStr(lp.wash, lp.washA);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}
function drawSheen(ctx, cx, topY, w, h, texture, lighting){
  const tp = TEXTURE_PARAMS[texture] || TEXTURE_PARAMS.frosted;
  const lp = LIGHT_PARAMS[lighting] || LIGHT_PARAMS.indoor;
  if (tp.sheen <= 0.02) return;
  ctx.save();
  const g = ctx.createRadialGradient(cx - w*0.12, topY + h*0.12, w*0.04, cx - w*0.1, topY + h*0.16, w*0.7);
  g.addColorStop(0, `rgba(255,255,255,${tp.sheen*lp.hi})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - w, topY, w*2, h);
  // 顺滑发质：几缕高光发丝
  ctx.globalAlpha = 0.25 * lp.hi;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(1, w*0.012);
  for(let i=0;i<5;i++){
    const x = cx - w*0.4 + (i/4)*w*0.8;
    ctx.beginPath();
    ctx.moveTo(x, topY + h*0.05);
    ctx.quadraticCurveTo(x + w*0.05, topY + h*0.4, x - w*0.02, topY + h*0.9);
    ctx.stroke();
  }
  ctx.restore();
  if (tp.gloss > 0){
    ctx.save();
    ctx.globalAlpha = 0.5*tp.gloss*lp.hi;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(1.5, w*0.02);
    ctx.beginPath();
    ctx.moveTo(cx - w*0.3, topY + h*0.1);
    ctx.quadraticCurveTo(cx, topY + h*0.18, cx + w*0.32, topY + h*0.12);
    ctx.stroke();
    ctx.restore();
  }
}

/* ---------- 发型几何参数 ---------- */
function hairGeo(style, lengthSlider, curlSlider){
  const baseLen = { short:0.18, medium:0.52, long:0.95 }[style.length] ?? 0.5;
  const len = Math.max(0, Math.min(1, baseLen + (lengthSlider - 0.5) * 0.4));
  const baseCurl = { straight:0.06, wave:0.5, curly:0.95 }[style.curl] ?? 0.4;
  const curl = Math.max(0, Math.min(1, baseCurl * (0.5 + curlSlider)));
  return { len, curl };
}

/* 波浪/卷曲边缘采样 */
function wavyX(baseX, dir, depth, curl, phase){
  if (curl < 0.05) return baseX;
  const amp = depth * curl;
  return baseX + dir * amp * Math.sin(phase);
}

/* ---------- 头发路径构建（正面：后层 / 前层框脸） ---------- */
function buildBackHairPath(geo, halfW, topY, bottomY, curl){
  const { cx } = geo;
  const p = new Path2D();
  const y0 = topY + (bottomY - topY) * 0.06;
  p.moveTo(cx - halfW*0.96, y0);
  p.quadraticCurveTo(cx, topY - (bottomY - topY)*0.04, cx + halfW*0.96, y0);
  const segs = 10;
  for(let i=0;i<=segs;i++){
    const t=i/segs, y=y0 + t*(bottomY - y0);
    p.lineTo(wavyX(cx + halfW*(0.96 + 0.08*t), 1, halfW*0.10, curl, t*Math.PI*5 + 1), y);
  }
  p.quadraticCurveTo(cx, bottomY + (bottomY - topY)*0.03, cx - halfW*1.04, bottomY);
  for(let i=segs;i>=0;i--){
    const t=i/segs, y=y0 + t*(bottomY - y0);
    p.lineTo(wavyX(cx - halfW*(0.96 + 0.08*t), -1, halfW*0.10, curl, t*Math.PI*5), y);
  }
  p.closePath();
  return p;
}
// 前层 = 头顶盖 + 两侧框脸的"马蹄形"，中间露出脸
function buildFrontHairPath(geo, o){
  const { cx, headTop, headH, headW } = geo;
  const p = new Path2D();
  const topArcY = headTop + headH*0.10;
  const crownY  = headTop - headH*0.14;
  const segs = 8;
  // 左外缘：底 → 顶
  p.moveTo(wavyX(cx - o.ow, -1, o.ow*0.08, o.curl, 0), o.sideBottom);
  for(let i=1;i<=segs;i++){
    const t=i/segs;
    const x = cx - (o.ow - (o.ow - headW*0.52) * t*t);
    const y = o.sideBottom - t*(o.sideBottom - topArcY);
    p.lineTo(wavyX(x, -1, o.ow*0.08, o.curl, t*Math.PI*4), y);
  }
  // 头顶圆弧
  p.quadraticCurveTo(cx, crownY, cx + headW*0.52, topArcY);
  // 右外缘：顶 → 底
  for(let i=1;i<=segs;i++){
    const t=i/segs;
    const x = cx + (headW*0.52 + (o.ow - headW*0.52) * Math.sqrt(t));
    const y = topArcY + t*(o.sideBottom - topArcY);
    p.lineTo(wavyX(x, 1, o.ow*0.08, o.curl, t*Math.PI*4 + 1), y);
  }
  // 内缘：右下 → 发际线弧 → 左下（露出脸）
  p.lineTo(cx + o.iw, o.sideBottom);
  p.lineTo(cx + o.iw*0.98, o.hlY + headH*0.10);
  p.quadraticCurveTo(cx + o.iw*0.9,  o.hlY, cx + o.iw*0.55, o.hlY - headH*0.015);
  p.quadraticCurveTo(cx, o.hlY - headH*0.05, cx - o.iw*0.55, o.hlY - headH*0.015);
  p.quadraticCurveTo(cx - o.iw*0.9,  o.hlY, cx - o.iw*0.98, o.hlY + headH*0.10);
  p.lineTo(cx - o.iw, o.sideBottom);
  p.closePath();
  return p;
}

/* ---------- 正面场景 ---------- */
function drawSceneFront(ctx, geo, style, params, metrics){
  const { cx, headTop, headH, headW } = geo;
  const mod = SHAPE_MOD[metrics.faceShape] || SHAPE_MOD['鹅蛋脸'];
  const headPath = headShapePath(cx, headTop + headH/2, headW, headH, mod);

  const { len, curl } = hairGeo(style, params.length, params.curl);
  const hairBottomY = headTop + headH*0.85 + len * (geo.H - headTop - headH*0.85) * 0.9;
  const hb = { x: cx - headW*0.9, y: headTop - headH*0.1, w: headW*1.8, h: (hairBottomY - (headTop - headH*0.1)) };
  const baseRgb = hexToRgb(getColorById(params.colorId).hex);

  // ① 后层头发（画在脸后面）
  ctx.save();
  ctx.fillStyle = hairFillStyle(ctx, hb, darken(baseRgb,0.12), params.texture, params.lighting);
  ctx.fill(buildBackHairPath(geo, headW*(0.56 + curl*0.08), headTop - headH*0.06, hairBottomY, curl));
  ctx.restore();

  // ② 脸 + 五官（盖在后层头发之上）
  ctx.save();
  ctx.fillStyle = metrics.skinColor || '#e8c9a8';
  ctx.fill(headPath);
  ctx.restore();
  drawFaceFeatures(ctx, geo, metrics, 'front');

  // ③ 前层（头顶盖 + 两侧框脸，露出脸部）
  ctx.save();
  ctx.fillStyle = hairFillStyle(ctx, hb, baseRgb, params.texture, params.lighting);
  ctx.fill(buildFrontHairPath(geo, {
    ow: headW*0.58, iw: headW*0.40,
    hlY: headTop + headH*(style.bang==='none' ? 0.14 : 0.22),
    sideBottom: hairBottomY, curl
  }));
  ctx.restore();

  // ④ 刘海
  drawBangs(ctx, geo, style.bang, baseRgb, params, headW, headH, headTop, cx);

  // ⑤ 高光 / 光线 / 发质
  drawSheen(ctx, cx, headTop - headH*0.06, headW*0.8, (hairBottomY-(headTop-headH*0.06)), params.texture, params.lighting);
  applyLighting(ctx, hb, params.lighting);
}

function drawBangs(ctx, geo, bang, baseRgb, params, headW, headH, headTop, cx){
  if (bang === 'none') return;
  const y0 = headTop + headH*0.16, y1 = headTop + headH*0.34;
  ctx.save();
  ctx.fillStyle = hairFillStyle(ctx, {x:cx-headW*0.5,y:y0,w:headW,h:y1-y0+headH*0.1}, darken(baseRgb,0.04), params.texture, params.lighting);
  if (bang === 'blunt'){
    ctx.beginPath();
    ctx.moveTo(cx - headW*0.46, y0);
    ctx.quadraticCurveTo(cx, y0 - headH*0.04, cx + headW*0.46, y0);
    ctx.lineTo(cx + headW*0.46, y1);
    ctx.quadraticCurveTo(cx, y1 + headH*0.02, cx - headW*0.46, y1);
    ctx.closePath(); ctx.fill();
  } else if (bang === 'air'){
    for(let i=0;i<7;i++){
      const x = cx - headW*0.42 + i*(headW*0.84/6);
      ctx.beginPath();
      ctx.ellipse(x, y0 + headH*0.06, headW*0.05, headH*0.06, 0, 0, Math.PI*2);
      ctx.fill();
    }
  } else if (bang === 'middle'){
    ctx.beginPath();
    ctx.moveTo(cx - headW*0.46, y0 - headH*0.02);
    ctx.quadraticCurveTo(cx - headW*0.1, y0, cx, headTop + headH*0.42);
    ctx.quadraticCurveTo(cx + headW*0.1, y0, cx + headW*0.46, y0 - headH*0.02);
    ctx.quadraticCurveTo(cx, y0 - headH*0.05, cx - headW*0.46, y0 - headH*0.02);
    ctx.fill();
  } else if (bang === 'side'){
    ctx.beginPath();
    ctx.moveTo(cx - headW*0.46, y0 - headH*0.02);
    ctx.quadraticCurveTo(cx + headW*0.2, y0, cx + headW*0.5, y1 + headH*0.04);
    ctx.quadraticCurveTo(cx + headW*0.1, y1 + headH*0.02, cx - headW*0.3, y0 + headH*0.02);
    ctx.quadraticCurveTo(cx - headW*0.4, y0 - headH*0.02, cx - headW*0.46, y0 - headH*0.02);
    ctx.fill();
  } else if (bang === 'short'){
    ctx.beginPath();
    ctx.moveTo(cx - headW*0.42, y0);
    ctx.quadraticCurveTo(cx, y0 - headH*0.03, cx + headW*0.42, y0);
    ctx.lineTo(cx + headW*0.42, headTop + headH*0.26);
    ctx.quadraticCurveTo(cx, headTop + headH*0.22, cx - headW*0.42, headTop + headH*0.26);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* 五官（正面） */
function drawFaceFeatures(ctx, geo, metrics, view){
  const { cx, headTop, headH, headW } = geo;
  const eyeY = headTop + headH*0.42, eyeDX = headW*0.2, eyeR = headW*0.05;
  ctx.save();
  // 眉
  ctx.strokeStyle = 'rgba(80,55,40,0.8)'; ctx.lineWidth = Math.max(1.5, headW*0.012); ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(cx-eyeDX-eyeR, eyeY-headH*0.07); ctx.quadraticCurveTo(cx-eyeDX, eyeY-headH*0.09, cx-eyeDX+eyeR, eyeY-headH*0.07); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+eyeDX-eyeR, eyeY-headH*0.07); ctx.quadraticCurveTo(cx+eyeDX, eyeY-headH*0.09, cx+eyeDX+eyeR, eyeY-headH*0.07); ctx.stroke();
  // 眼
  ctx.fillStyle = '#3a2a20';
  ctx.beginPath(); ctx.ellipse(cx-eyeDX, eyeY, eyeR, eyeR*0.6, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx+eyeDX, eyeY, eyeR, eyeR*0.6, 0, 0, Math.PI*2); ctx.fill();
  // 鼻
  ctx.strokeStyle = 'rgba(120,85,65,0.6)';
  ctx.beginPath(); ctx.moveTo(cx, eyeY+headH*0.02); ctx.quadraticCurveTo(cx-headW*0.04, eyeY+headH*0.12, cx, eyeY+headH*0.16); ctx.stroke();
  // 唇
  ctx.fillStyle = 'rgba(190,110,105,0.85)';
  const my = headTop + headH*0.72;
  ctx.beginPath(); ctx.moveTo(cx-headW*0.12, my); ctx.quadraticCurveTo(cx, my+headH*0.04, cx+headW*0.12, my); ctx.quadraticCurveTo(cx, my+headH*0.01, cx-headW*0.12, my); ctx.fill();
  // 耳
  ctx.fillStyle = metrics.skinColor || '#e8c9a8';
  ctx.beginPath(); ctx.ellipse(cx-headW*0.5, headTop+headH*0.46, headW*0.05, headH*0.08, 0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx+headW*0.5, headTop+headH*0.46, headW*0.05, headH*0.08, 0,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

/* ---------- 入口 ---------- */
function renderScene(canvas, opts){
  if(opts.colorId==='original'){
    opts = Object.assign({}, opts, { colorId:(opts.style && opts.style.suitableColors && opts.style.suitableColors[0]) || 'coolbrown' });
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  // 背景
  const lp = LIGHT_PARAMS[opts.lighting] || LIGHT_PARAMS.indoor;
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0, lp.bgTop); bg.addColorStop(1, lp.bgBot);
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

  const headH = Math.min(H*0.72, W*0.95);
  const headW = headH / (faceRatio(opts.metrics.faceShape) * 1.15 + 0.4);
  const cx = W/2, cy = H*0.5;
  const headTop = cy - headH/2;
  const geo = { cx, cy, headTop, headH, headW, W, H };

  const style = opts.style || HAIRSTYLES[0];
  drawSceneFront(ctx, geo, style, opts, opts.metrics);

  // 底部柔和阴影
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.beginPath(); ctx.ellipse(cx, headTop+headH+headH*0.02, headW*0.5, headH*0.05, 0,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

/* =========================================================================
 * 真人试发（Try-On）：把发型直接“戴”到顾客照片头上
 * 依赖 68 关键点定位；无关键点时用画面中心估计兜底。
 * ========================================================================= */
function computeAnchorsFromLandmarks(pts){
  let minX=Infinity, maxX=-Infinity;
  for(let i=0;i<=16;i++){ minX=Math.min(minX,pts[i].x); maxX=Math.max(maxX,pts[i].x); }
  const browTopY = Math.min(...pts.slice(17,27).map(p=>p.y));
  const chinY = pts[8].y;
  const faceW = maxX - minX;
  const faceH = Math.max(1, chinY - browTopY);
  const cx = (pts[27].x + (minX+maxX)/2) / 2;
  // 精确头顶估算：三庭比例（发际→眉 = 眉→鼻底 = 鼻底→下巴 ≈ 1:1:1）
  //   发际线在眉上方约 faceH*0.33，头顶在发际上方约 faceH*0.25
  //   总计 headTop ≈ browTopY - faceH * (0.33 + 0.25) = browTopY - faceH * 0.58
  //   但不同脸型有差异：圆脸额头更短、长脸额头更长
  const foreheadRatio = 0.58;  // 默认鹅蛋脸比例
  const headTop = browTopY - faceH * foreheadRatio;

  // 左右鬓角锚点：68 点轮廓的两个端点（0 / 16）位于耳前太阳穴处，即鬓角位置
  //   —— 这是发型两侧的真实贴合基准，随人头在画面里的位置一起移动
  const tL = { x: pts[0].x,  y: pts[0].y  };
  const tR = { x: pts[16].x, y: pts[16].y };
  const templeW  = Math.max(1, Math.hypot(tR.x - tL.x, tR.y - tL.y)); // 两鬓角间距 = 真实头宽
  const templeCx = (tL.x + tR.x) / 2;
  const templeY  = (tL.y + tR.y) / 2;
  // 真实人头中线：鬓角中点为主（几何头中心），融合 cx（含鼻位，抗侧脸偏移）
  const headCx = templeCx * 0.6 + cx * 0.4;
  // 人脸倾斜角（基于双眼连线）
  const eyeL = eyeCentersFromLandmarks(pts).L;
  const eyeR = eyeCentersFromLandmarks(pts).R;
  const tilt = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);

  return { cx, faceW, faceH, browTopY, chinY, headTop, minX, maxX, jaw: pts.slice(0,17),
           templeL: tL, templeR: tR, templeW, templeCx, templeY, headCx, tilt };
}

// 脸部裁剪路径：下颌 17 点 + 额头圆弧（把真人脸从照片里“抠”回最上层）
function buildFaceClipPath(a){
  const p = new Path2D();
  if (a.jaw){
    p.moveTo(a.jaw[0].x, a.jaw[0].y);
    for(let i=1;i<=16;i++) p.lineTo(a.jaw[i].x, a.jaw[i].y);
    // 额头弧：右耳上方 → 额顶 → 左耳上方
    const topY = a.browTopY - a.faceH*0.40;
    p.quadraticCurveTo(a.maxX + a.faceW*0.06, a.browTopY - a.faceH*0.16, a.cx + a.faceW*0.30, topY);
    p.quadraticCurveTo(a.cx, topY - a.faceH*0.08, a.cx - a.faceW*0.30, topY);
    p.quadraticCurveTo(a.minX - a.faceW*0.06, a.browTopY - a.faceH*0.16, a.jaw[0].x, a.jaw[0].y);
  } else {
    p.ellipse(a.cx, (a.browTopY + a.chinY)/2, a.faceW*0.52, (a.chinY - a.browTopY)*0.78, 0, 0, Math.PI*2);
  }
  p.closePath();
  return p;
}

function renderTryOn(canvas, opts){
  if(opts.colorId==='original'){
    opts = Object.assign({}, opts, { colorId:(opts.style && opts.style.suitableColors && opts.style.suitableColors[0]) || 'coolbrown' });
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  // ① 照片打底
  ctx.drawImage(opts.photo, 0, 0, W, H);

  const hasLm = opts.landmarks && opts.landmarks.length >= 68;
  const a = hasLm
    ? computeAnchorsFromLandmarks(opts.landmarks)
    // 降级兜底：人脸检测失败时才以画面中心估算人头
    : { cx:W/2, faceW:W*0.40, faceH:H*0.30, browTopY:H*0.36, chinY:H*0.66,
        headTop:H*0.36 - H*0.30*0.62, minX:W/2-W*0.20, maxX:W/2+W*0.20, jaw:null,
        templeL:{x:W/2-W*0.19,y:H*0.42}, templeR:{x:W/2+W*0.19,y:H*0.42},
        templeW:W*0.38, templeCx:W/2, templeY:H*0.42, headCx:W/2 };

  // 自动贴合：覆盖系数 + 高额头补偿（与真人试戴一致）
  const coverageMul = 1.06;  // 基础放大盖住顾客原有发际
  let foreheadMul = 1;
  if(hasLm){
    const browTopY = Math.min(...opts.landmarks.slice(17,27).map(p=>p.y));
    const faceH = Math.max(1, opts.landmarks[8].y - browTopY);
    const foreheadH = browTopY - (browTopY - faceH * 0.62);
    const avgForeheadH = faceH * 0.62;
    foreheadMul = Math.min(1.15, Math.max(0.92, foreheadH / Math.max(1, avgForeheadH)));
  }

  // 头宽以「两侧鬓角间距」为准，中线用真实人头中线（headCx），不使用画布中心
  const headW = Math.max(a.templeW, a.faceW * 0.92) * coverageMul;
  const headH = (a.chinY - a.headTop) * foreheadMul;
  const geo = { cx:a.headCx, cy:a.headTop + headH/2, headTop:a.headTop, headH, headW, W, H };

  // （试戴时不再隐藏顾客原发型；新发型直接叠加到照片上）
  const style = opts.style || HAIRSTYLES[0];
  const baseRgb = hexToRgb(getColorById(opts.colorId).hex);
  const { len, curl } = hairGeo(style, opts.length, opts.curl);
  const hairBottomY = Math.min(H - 6, a.chinY + len * (H - a.chinY) * 0.92);
  const hb = { x:a.cx - headW, y:a.headTop - headH*0.15, w:headW*2, h:hairBottomY - (a.headTop - headH*0.15) };

  const fit2 = opts.fit || {};
  const uOp = (fit2.opacity != null && isFinite(fit2.opacity)) ? _clamp(fit2.opacity, 0.2, 1) : 1;
  const hasBang2 = !!(style.bang && style.bang !== 'none');

  // ⓪ 原生头发淡化压暗（弱化原有头发存在感，再叠新发型；轻量前端处理非 AI 抹除）
  if(hasLm) suppressOriginalHair(ctx, opts.photo, a, W, H, 0.78 * uOp);

  // ② 后层头发（垂在肩两侧）→ 独立图层，羽化后为脸部让位
  const back = tmpCanvas('tryBack', W, H);
  const bx = back.getContext('2d');
  bx.fillStyle = hairFillStyle(bx, hb, darken(baseRgb, 0.12), opts.texture, opts.lighting);
  bx.fill(buildBackHairPath(geo, headW*(0.60 + curl*0.08), a.headTop - headH*0.10, hairBottomY, curl));
  featherLayer(back, _clamp(W*0.006, 1.5, 5));
  if(hasLm){
    // 脸部区域柔和让位（替代原来的硬裁剪盖回，无硬边）
    const bl = back.getContext('2d');
    bl.save();
    bl.globalCompositeOperation = 'destination-out';
    bl.filter = `blur(${_clamp(W*0.014, 3, 10)}px)`;
    bl.fillStyle = '#000';
    bl.fill(buildFaceClipPath(a));
    bl.restore();
  }
  ctx.save(); ctx.globalAlpha = uOp; ctx.drawImage(back, 0, 0); ctx.restore();

  // ③ 前层头发 + 刘海 → 独立图层（头顶盖 + 两侧框脸）
  const front = tmpCanvas('tryFront', W, H);
  const fx = front.getContext('2d');
  fx.fillStyle = hairFillStyle(fx, hb, baseRgb, opts.texture, opts.lighting);
  fx.fill(buildFrontHairPath(geo, {
    ow: headW*0.62, iw: headW*0.46,
    hlY: a.browTopY - a.faceH*(hasBang2 ? 0.16 : 0.30),
    sideBottom: hairBottomY, curl
  }));
  drawBangs(fx, geo, style.bang, baseRgb, opts, headW, headH, a.headTop, a.cx);
  // 高光只落在头发上（source-atop），不溢出到皮肤/背景
  fx.save();
  fx.globalCompositeOperation = 'source-atop';
  drawSheen(fx, a.cx, a.headTop - headH*0.10, headW*0.9, hb.h, opts.texture, opts.lighting);
  fx.restore();
  featherLayer(front, _clamp(W*0.007, 1.6, 6));

  // ④ 只贴合头发区域：五官与额头柔和让位，保留原发际线
  if(hasLm) eraseFaceZone(front, opts.landmarks, a, hasBang2, W);

  // ⑤ 接触阴影 → 头发层 → 原发际细节回融
  if(hasLm) drawContactShadow(ctx, front, a, W, H, 0.24 * uOp);
  ctx.save(); ctx.globalAlpha = uOp; ctx.drawImage(front, 0, 0); ctx.restore();
  if(hasLm) blendHairlineDetail(ctx, opts.photo, a, W, H, 0.24 * uOp);

  // ⑥ 光线氛围（同时作用于头发与照片，让光线统一）
  applyLighting(ctx, { x:0, y:0, w:W, h:H }, opts.lighting);
}

/* =========================================================================
 * 照片级真发试戴：把收集表照片中 AI 抠出的真实头发（img/hair/sNN.png）
 * 按双眼锚点做相似变换（缩放+旋转+平移），完美贴合到顾客头上。
 * 依赖：js/hairmeta.js 中的 HAIR_META（源照片尺寸/眼睛坐标/头发包围盒）
 * ========================================================================= */
function eyeCentersFromLandmarks(pts){
  function avg(a,b){ let x=0,y=0; for(let i=a;i<=b;i++){ x+=pts[i].x; y+=pts[i].y; } const n=b-a+1; return {x:x/n, y:y/n}; }
  return { L: avg(36,41), R: avg(42,47) };
}

// 发丝精修 + 调色 + 质感的离屏精灵缓存
const _hairSpriteCache = {};
function buildHairSprite(img, meta, colorId, texture, cacheKey, featherPx){
  const key = cacheKey + '|' + (colorId||'original') + '|' + (texture||'glossy') + '|f' + (featherPx||0);
  if(_hairSpriteCache[key]) return _hairSpriteCache[key];
  const c = document.createElement('canvas'); c.width = meta.w; c.height = meta.h;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);

  // 调色：'original' 保留照片原发色；否则用 color 混合改色（保留发丝明暗纹理）
  if(colorId && colorId !== 'original'){
    const col = getColorById(colorId);
    if(col){
      x.globalCompositeOperation = 'color';
      x.fillStyle = col.hex; x.fillRect(0, 0, meta.w, meta.h);
      x.globalCompositeOperation = 'soft-light';
      x.globalAlpha = 0.45; x.fillStyle = col.hex; x.fillRect(0, 0, meta.w, meta.h);
      x.globalAlpha = 1;
    }
  }
  // 质感：通透光泽 / 雾面 / 哑光
  if(texture === 'glossy'){
    const g = x.createLinearGradient(0, 0, meta.w, meta.h*0.9);
    g.addColorStop(0.30, 'rgba(255,255,255,0)');
    g.addColorStop(0.46, 'rgba(255,255,255,0.30)');
    g.addColorStop(0.60, 'rgba(255,255,255,0)');
    x.globalCompositeOperation = 'soft-light';
    x.fillStyle = 'rgba(255,255,255,0.28)'; x.fillRect(0, 0, meta.w, meta.h);
    x.globalCompositeOperation = 'screen';
    x.globalAlpha = 0.55; x.fillStyle = g; x.fillRect(0, 0, meta.w, meta.h);
    x.globalAlpha = 1;
  } else if(texture === 'frosted'){
    x.globalCompositeOperation = 'saturation';
    x.globalAlpha = 0.35; x.fillStyle = '#808080'; x.fillRect(0, 0, meta.w, meta.h);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'soft-light';
    x.fillStyle = 'rgba(230,230,235,0.30)'; x.fillRect(0, 0, meta.w, meta.h);
  } else { // matte 哑光
    x.globalCompositeOperation = 'soft-light';
    x.fillStyle = 'rgba(40,35,32,0.35)'; x.fillRect(0, 0, meta.w, meta.h);
  }
  // 恢复头发透明通道
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-over';

  /* ★【规格五·发际线边缘抗锯齿】
   * PNG 抠图边缘常残留两类瑕疵：① 阶梯状硬边锯齿；② 抠图带出的半透明深色描边（黑边光晕）。
   * 一次 destination-in(模糊图) 即可同时解决，原理是最终 alpha = 原alpha × 模糊alpha：
   *   · 主体内部：1 × 1 = 1             → 发型【不会整体变淡】
   *   · 轮廓外侧：0 × 模糊值 = 0        → 羽化不会向外洇出，黑边光晕无处产生
   *   · 轮廓边界：1 × (0,1) = 平滑过渡  → 硬边阶梯被软化，边缘自然内收（等效形态学腐蚀）
   * ⚠ 切勿再叠一层 globalAlpha<1 的 destination-in 做"二次内缩"：
   *   destination-in 下 globalAlpha 会乘到【整张图】的 alpha 上，
   *   实测会把整个发型压到 35% 不透明度（曾出现"发型发灰、像蒙了层雾"）。
   */
  if(featherPx && featherPx > 0){
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const tx = tmp.getContext('2d');
    tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = 'high';
    tx.filter = `blur(${featherPx}px)`;
    tx.drawImage(c, 0, 0);
    tx.filter = 'none';
    x.globalAlpha = 1;                      // ★ 必须为 1，否则整张发型被整体压暗
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(tmp, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }

  _hairSpriteCache[key] = c;
  // 缓存上限，防内存膨胀
  const keys = Object.keys(_hairSpriteCache);
  if(keys.length > 24) delete _hairSpriteCache[keys[0]];
  return c;
}

// 核心五官保护区路径：眉线以下、下颌以内（刘海可盖额头，但眼鼻嘴永不被头发遮挡）
function buildCoreFacePath(pts){
  const jaw = pts.slice(0, 17);
  let cxSum = 0; jaw.forEach(p => cxSum += p.x);
  const fcx = cxSum / 17;
  const browTopY = Math.min(...pts.slice(17, 27).map(p => p.y));
  const faceH = Math.max(1, pts[8].y - browTopY);
  const inset = 0.95;                 // 下颌轮廓向内收 5%，让发丝能自然搭在脸缘
  const topY = browTopY - faceH * 0.05;   // 保护区上界 ≈ 眉毛上缘
  const p = new Path2D();
  const jx = i => fcx + (jaw[i].x - fcx) * inset;
  p.moveTo(jx(0), Math.max(jaw[0].y, topY));
  for(let i = 1; i <= 15; i++) p.lineTo(jx(i), jaw[i].y);
  p.lineTo(jx(16), Math.max(jaw[16].y, topY));
  p.lineTo(jx(16), topY);
  p.lineTo(jx(0), topY);
  p.closePath();
  return p;
}

/* 把发型相似变换参数打包，可在任意 canvas 上复用，用于把新发型 PNG 贴合到顾客头上 */
function applyHairTransform(ctx, T){
  ctx.translate(T.dx, T.dy);
  ctx.rotate(T.angle);
  ctx.scale(T.sx, T.sy);
  ctx.translate(-T.ox, -T.oy);
}

/* =========================================================================
 * 真实感融合（Photoreal Blend）工具组
 *  —— 目标：消除“贴纸感/头盔感”，让发型像原照片里长出来的一样
 *  ① 只贴合头发区域（额头/五官柔和让位）
 *  ② 关键点对齐头顶/中线/发际
 *  ③ 边缘羽化 + 透明过渡
 *  ④ 匹配原片亮度/对比度/色温 + 接触阴影
 *  ⑤ 保留顾客原发际线与碎发细节
 * ========================================================================= */
function _clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }

/* 分段软钳制（规格三）：|v| ≤ knee 区间【1:1 精确保真】，超出后用 tanh 渐进饱和到 ±max。
 * 相比全域 tanh，避免了"正常倾头 30° 也被衰减 11%"的系统性误差；
 * 相比硬 clamp，避免了到达上限瞬间的角速度突变（视觉上的"卡住再弹开"）。 */
function _softLimit(v, knee, max){
  const a = Math.abs(v);
  if(a <= knee) return v;
  const room = Math.max(1e-6, max - knee);
  return Math.sign(v) * (knee + room * Math.tanh((a - knee) / room));
}

/* 离屏画布池：避免每帧重复分配 */
const _tmpPool = {};
function tmpCanvas(key, w, h){
  let c = _tmpPool[key];
  if(!c){ c = _tmpPool[key] = document.createElement('canvas'); }
  if(c.width !== w || c.height !== h){ c.width = w; c.height = h; }
  else { c.getContext('2d').clearRect(0, 0, w, h); }
  return c;
}

/* ---------- ④ 原照片光照分析（亮度 / 对比度 / 饱和度 / 色温） ---------- */
const _photoStat = new WeakMap();
const SRC_BASE = { lum:0.46, contrast:0.24, sat:0.30, warm:1.10 }; // 抠发素材（影棚正常曝光）基准
function analyzePhotoLight(photo, a, W, H){
  const cached = _photoStat.get(photo);
  if(cached) return cached;
  const fallback = { lum:SRC_BASE.lum, contrast:SRC_BASE.contrast, sat:SRC_BASE.sat, rgb:[128,128,128], warm:SRC_BASE.warm };
  const s = 48;
  const c = tmpCanvas('stat', s, s);
  const x = c.getContext('2d', { willReadFrequently:true });
  let rx, ry, rw, rh;
  if(a){ rw = a.faceW*1.6; rh = (a.chinY - a.headTop)*1.15; rx = a.cx - rw/2; ry = a.headTop - rh*0.05; }
  else { rw = W*0.6; rh = H*0.6; rx = W*0.2; ry = H*0.2; }
  rx = Math.max(0, rx); ry = Math.max(0, ry);
  rw = Math.max(8, Math.min(W - rx, rw)); rh = Math.max(8, Math.min(H - ry, rh));
  let d;
  try{
    x.drawImage(photo, rx, ry, rw, rh, 0, 0, s, s);
    d = x.getImageData(0, 0, s, s).data;
  }catch(e){ return fallback; }
  let sr=0, sg=0, sb=0, sl=0, sl2=0;
  const n = s*s;
  for(let i=0;i<d.length;i+=4){
    const r=d[i], g=d[i+1], b=d[i+2];
    sr+=r; sg+=g; sb+=b;
    const l=(0.2126*r + 0.7152*g + 0.0722*b)/255;
    sl+=l; sl2+=l*l;
  }
  const mr=sr/n, mg=sg/n, mb=sb/n, ml=sl/n;
  const contrast = Math.sqrt(Math.max(0, sl2/n - ml*ml));
  const mx=Math.max(mr,mg,mb), mn=Math.min(mr,mg,mb);
  const st = {
    lum: ml,
    contrast,
    sat: mx > 0 ? (mx - mn)/mx : 0,
    rgb: [mr, mg, mb],
    warm: (mr + 1)/(mb + 1)
  };
  _photoStat.set(photo, st);
  return st;
}

/* ---------- ④ 把发型精灵调成与原照片同一「光照/色温」 ---------- */
const _gradeCache = {};
function gradeSpriteToPhoto(sprite, st, key){
  const gk = key + '|' + Math.round(st.lum*40) + '_' + Math.round(st.contrast*40) + '_'
           + Math.round(st.sat*40) + '_' + Math.round(st.rgb[0]/8) + '_' + Math.round(st.rgb[2]/8);
  if(_gradeCache[gk]) return _gradeCache[gk];
  const w = sprite.width, h = sprite.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  // 亮度 / 对比度 / 饱和度对齐（只做 35%~55% 的部分匹配，避免过校正失真）
  const bri = _clamp(1 + (st.lum/SRC_BASE.lum - 1) * 0.55, 0.82, 1.22);
  const con = _clamp(1 + (st.contrast/SRC_BASE.contrast - 1) * 0.40, 0.88, 1.14);
  const sat = _clamp(1 + (st.sat/SRC_BASE.sat - 1) * 0.35, 0.85, 1.15);
  x.filter = `brightness(${bri.toFixed(3)}) contrast(${con.toFixed(3)}) saturate(${sat.toFixed(3)})`;
  x.drawImage(sprite, 0, 0);
  x.filter = 'none';
  // 色温对齐：以原照片平均色做 soft-light 环境色染
  const tintA = _clamp(0.10 + Math.abs(st.warm - SRC_BASE.warm) * 0.55, 0.10, 0.30);
  x.globalCompositeOperation = 'soft-light';
  x.globalAlpha = tintA;
  x.fillStyle = `rgb(${Math.round(st.rgb[0])},${Math.round(st.rgb[1])},${Math.round(st.rgb[2])})`;
  x.fillRect(0, 0, w, h);
  x.globalAlpha = 1;
  // 还原发丝透明通道
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(sprite, 0, 0);
  x.globalCompositeOperation = 'source-over';
  _gradeCache[gk] = c;
  const ks = Object.keys(_gradeCache);
  if(ks.length > 18) delete _gradeCache[ks[0]];
  return c;
}

/* ---------- ③ 边缘羽化：alpha × blur(alpha)，消除硬边 ---------- */
function featherLayer(layer, px){
  const W = layer.width, H = layer.height;
  const m = tmpCanvas('feather', W, H);
  const mx = m.getContext('2d');
  mx.filter = `blur(${px}px)`;
  mx.drawImage(layer, 0, 0);
  mx.filter = 'none';
  const lx = layer.getContext('2d');
  lx.save();
  lx.globalCompositeOperation = 'destination-in';
  lx.drawImage(m, 0, 0);
  lx.restore();
}

/* ---------- ① + ⑤ 让位脸部与额头：柔和擦除（非硬裁剪，无硬边） ---------- */
function eraseFaceZone(layer, pts, a, hasBang, W){
  const lx = layer.getContext('2d');
  // (1) 五官核心区（眉线以下、下颌以内）——羽化擦除，眼鼻嘴永不被压住
  lx.save();
  lx.globalCompositeOperation = 'destination-out';
  lx.filter = `blur(${_clamp(W*0.014, 3, 10)}px)`;
  lx.fillStyle = '#000';
  lx.fill(buildCoreFacePath(pts));
  lx.restore();
  // (2) 额头 / 发际过渡区——椭圆径向渐变擦除
  //     无刘海：强擦除，露出顾客真实额头与原发际线
  //     有刘海：弱擦除，只柔化刘海压在皮肤上的接缝
  const strong = hasBang ? 0.26 : 0.95;
  const mid    = hasBang ? 0.12 : 0.55;
  const rx = a.faceW * 0.40;
  const ry = a.faceH * (hasBang ? 0.20 : 0.26);
  const cy = a.browTopY - a.faceH * (hasBang ? 0.10 : 0.15);
  lx.save();
  lx.globalCompositeOperation = 'destination-out';
  lx.translate(a.cx, cy);
  lx.scale(1, Math.max(0.15, ry/rx));
  const g = lx.createRadialGradient(0, 0, rx*0.16, 0, 0, rx);
  g.addColorStop(0,   `rgba(0,0,0,${strong})`);
  g.addColorStop(0.6, `rgba(0,0,0,${mid})`);
  g.addColorStop(1,   'rgba(0,0,0,0)');
  lx.fillStyle = g;
  lx.beginPath(); lx.arc(0, 0, rx, 0, Math.PI*2); lx.fill();
  lx.restore();
}

/* ---------- ⓪ 原生头发淡化压暗（轻量前端处理，非 AI 抹除） ----------
 * 根据人脸关键点估算原图头发大致区域（头顶盖 + 两侧垂发带），
 * 对该区域做「降亮度 + 降饱和」局部淡化，弱化原有头发的视觉存在感，
 * 之后再叠加新发型素材。特性：
 *  - 遮罩全部用径向渐变 + 羽化，不会出现处理硬边
 *  - 脸部与额头皮肤（buildFaceClipPath 区域）被柔和挖空，肤色完全不受影响
 *  - 只是淡化不是抹除，边缘和缝隙会保留少量原发痕迹（符合预期）
 */
function suppressOriginalHair(ctx, photo, a, W, H, strength){
  if(!a || strength <= 0) return;
  // ① 头发区域遮罩：头顶盖 + 左右两侧垂发带
  const mask = tmpCanvas('ohMask', W, H);
  const mx = mask.getContext('2d');
  // 头顶盖：覆盖颅顶到发际的整个上部发区
  const capRx = a.faceW * 0.82;
  const capRy = Math.max(10, (a.browTopY - a.headTop) * 1.05);
  const capCy = a.headTop + a.faceH * 0.12;
  mx.save();
  mx.translate(a.cx, capCy);
  mx.scale(1, Math.max(0.2, capRy / capRx));
  const cg = mx.createRadialGradient(0, 0, capRx * 0.25, 0, 0, capRx);
  cg.addColorStop(0,    'rgba(0,0,0,1)');
  cg.addColorStop(0.72, 'rgba(0,0,0,0.85)');
  cg.addColorStop(1,    'rgba(0,0,0,0)');
  mx.fillStyle = cg;
  mx.beginPath(); mx.arc(0, 0, capRx, 0, Math.PI*2); mx.fill();
  mx.restore();
  // 两侧垂发带：耳侧沿脸缘向下（覆盖披肩发/鬓角区域）
  const sideRx = a.faceW * 0.30;
  const sideRy = (a.chinY - a.browTopY) * 0.85;
  const sideCy = a.browTopY + (a.chinY - a.browTopY) * 0.42;
  [a.minX - a.faceW*0.18, a.maxX + a.faceW*0.18].forEach(sx => {
    mx.save();
    mx.translate(sx, sideCy);
    mx.scale(1, Math.max(0.2, sideRy / sideRx));
    const sg = mx.createRadialGradient(0, 0, sideRx * 0.2, 0, 0, sideRx);
    sg.addColorStop(0,   'rgba(0,0,0,0.90)');
    sg.addColorStop(0.7, 'rgba(0,0,0,0.55)');
    sg.addColorStop(1,   'rgba(0,0,0,0)');
    mx.fillStyle = sg;
    mx.beginPath(); mx.arc(0, 0, sideRx, 0, Math.PI*2); mx.fill();
    mx.restore();
  });
  // 脸部（含额头皮肤）柔和挖空——只淡化头发区域，不碰五官与肤色
  mx.save();
  mx.globalCompositeOperation = 'destination-out';
  mx.filter = `blur(${_clamp(W*0.012, 3, 9)}px)`;
  mx.fillStyle = '#000';
  mx.fill(buildFaceClipPath(a));
  mx.restore();

  // ② 合成一份「压暗 + 降饱和」的照片，按遮罩叠回原位
  //    只做部分淡化（brightness 0.62 / saturate 0.55 + strength 混合），保留少量原发痕迹
  const dim = tmpCanvas('ohDim', W, H);
  const dx = dim.getContext('2d');
  dx.filter = 'brightness(0.62) saturate(0.55) contrast(0.94)';
  dx.drawImage(photo, 0, 0, W, H);
  dx.filter = 'none';
  dx.globalCompositeOperation = 'destination-in';
  dx.drawImage(mask, 0, 0);
  dx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = _clamp(strength, 0, 1);
  ctx.drawImage(dim, 0, 0);
  ctx.restore();
}

/* ---------- ④ 接触阴影：新发型在额头/两颊投下柔和阴影 ---------- */
function drawContactShadow(ctx, layer, a, W, H, strength){
  if(!a || strength <= 0) return;
  const sh = tmpCanvas('shadow', W, H);
  const sx = sh.getContext('2d');
  sx.filter = `blur(${_clamp(W*0.016, 4, 14)}px)`;
  sx.drawImage(layer, 0, Math.max(2, H*0.007));
  sx.filter = 'none';
  sx.globalCompositeOperation = 'source-in';
  sx.fillStyle = '#1a1208';           // 暖调暗部，比纯黑自然
  sx.fillRect(0, 0, W, H);
  sx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.clip(buildFaceClipPath(a));     // 阴影只落在皮肤上，不脏背景
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = strength;
  ctx.drawImage(sh, 0, 0);
  ctx.restore();
}

/* ---------- ⑤ 原发际 / 碎发细节回融：把照片沿发际带低透明度叠回 ---------- */
function blendHairlineDetail(ctx, photo, a, W, H, alpha){
  if(!a || alpha <= 0) return;
  const det = tmpCanvas('detail', W, H);
  const d = det.getContext('2d');
  d.drawImage(photo, 0, 0, W, H);
  d.globalCompositeOperation = 'destination-in';
  const rx = a.faceW * 0.60;
  const ry = a.faceH * 0.44;
  const cy = a.browTopY - a.faceH * 0.26;
  d.save();
  d.translate(a.cx, cy);
  d.scale(1, Math.max(0.15, ry/rx));
  const g = d.createRadialGradient(0, 0, rx*0.30, 0, 0, rx);
  g.addColorStop(0,    'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.50)');
  g.addColorStop(0.82, 'rgba(0,0,0,0.90)');
  g.addColorStop(1,    'rgba(0,0,0,0)');
  d.fillStyle = g;
  d.beginPath(); d.arc(0, 0, rx, 0, Math.PI*2); d.fill();
  d.restore();
  d.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(det, 0, 0);
  ctx.restore();
}

function renderPhotoTryOn(canvas, opts){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // ① 顾客照片打底
  ctx.drawImage(opts.photo, 0, 0, W, H);

  const meta = opts.hairMeta, img = opts.hairImg;
  if(!meta || !img){ return; }

  const hasLm = opts.landmarks && opts.landmarks.length >= 68;
  const a = hasLm ? computeAnchorsFromLandmarks(opts.landmarks) : null;
  // ② 顾客双眼位置（68 关键点；无关键点按画面中心估算）
  let dL, dR;
  if(hasLm){
    const e = eyeCentersFromLandmarks(opts.landmarks); dL = e.L; dR = e.R;
  } else {
    // 降级兜底：人脸检测失败时才用画面中心估算双眼位置
    dL = { x: W*0.40, y: H*0.42 }; dR = { x: W*0.60, y: H*0.42 };
  }
  // ③ 源发型照片双眼锚点（离线检测；缺失时按经验比例估算）
  let sL, sR;
  if(meta.eyeL && meta.eyeR){
    sL = { x: meta.eyeL[0], y: meta.eyeL[1] }; sR = { x: meta.eyeR[0], y: meta.eyeR[1] };
  } else {
    sL = { x: meta.w*0.40, y: meta.h*0.42 }; sR = { x: meta.w*0.60, y: meta.h*0.42 };
  }

  // ④ 基础相似变换：缩放 + 旋转 + 平移，双眼对双眼
  const dDist = Math.hypot(dR.x - dL.x, dR.y - dL.y);
  const sDist = Math.max(1, Math.hypot(sR.x - sL.x, sR.y - sL.y));
  // 自动贴合核心系数：1.06 基础放大 + coverage 补偿
  //   —— coverage 低的发型（如短发）需更大放大倍率以确保头部轮廓被覆盖
  //   —— coverage 高的发型（如长发）放大倍率适中，避免遮脸
  const coverage = meta.coverage || 0.25;
  const coverageScale = 1.06 + Math.max(0, (0.30 - coverage) * 0.5);  // 覆盖率越低放大越多
  const scale = (dDist / sDist) * coverageScale;
  const angle = Math.atan2(dR.y - dL.y, dR.x - dL.x) - Math.atan2(sR.y - sL.y, sR.x - sL.x);
  const dM = { x:(dL.x + dR.x)/2, y:(dL.y + dR.y)/2 };
  const sM = { x:(sL.x + sR.x)/2, y:(sL.y + sR.y)/2 };

  // ④+ 人脸自动适配：按「脸宽/眼距」「脸长/眼距」「额头高度」的比例差异做各向异性微调
  //    —— 宽脸自动加宽头发、长脸自动拉长头发、高额头自动拉高头发覆盖区
  //    —— 避免头发夹脸或盖不住头型
  let fitX = 1, fitY = 1, foreheadMul = 1;
  if(hasLm && meta.face){
    const jaw = opts.landmarks.slice(0, 17);
    let minX = Infinity, maxX = -Infinity;
    jaw.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
    const browTopY = Math.min(...opts.landmarks.slice(17, 27).map(p => p.y));
    const dFaceW = maxX - minX;                    // 顾客颧-颌最大宽
    const dFaceH = opts.landmarks[8].y - browTopY; // 顾客眉-颏高
    // 顾客额头高度估算（眉顶到估计头顶）
    const dForeheadH = browTopY - (browTopY - dFaceH * 0.62);  // computeAnchorsFromLandmarks 里的 headTop 估算
    // 横向：以「两侧鬓角间距」为准（发型两侧要正好落在鬓角上），而非颧颌最大宽
    //   1.06：素材人脸框宽 → 鬓角间距的标定系数；1.22：人脸框高比 68 点眉-颏高
    const dTempleW = a ? a.templeW : dFaceW * 0.94;
    const wRatio = (dTempleW / dDist) / ((meta.face[2] / 1.06) / sDist);
    const hRatio = ((dFaceH * 1.22) / dDist) / (meta.face[3] / sDist);
    fitX = Math.min(1.18, Math.max(0.86, wRatio));
    fitY = Math.min(1.18, Math.max(0.86, hRatio));
    // 高额头补偿：顾客额头比素材照片高时，纵向上拉头发覆盖区
    const srcForeheadH = meta.h * 0.62 * (meta.face[3] / Math.max(1, meta.h));
    const fhRatio = dForeheadH / Math.max(1, srcForeheadH);
    foreheadMul = Math.min(1.15, Math.max(0.92, fhRatio));
  }
  // 长短滑块：轻微纵向伸缩（0.92~1.10）
  const syMul = 0.92 + (opts.length != null ? opts.length : 0.5) * 0.18;

  // ④++ 手动贴合微调：缩放 / 左右偏移 / 上下偏移 / 旋转 / 透明度
  //     opts.fit = { scale:0.7~1.4, dx:px, dy:px, rot:弧度, opacity:0.35~1 }
  const fit = opts.fit || {};
  const uScale = (fit.scale != null && isFinite(fit.scale)) ? Math.min(1.8, Math.max(0.5, fit.scale)) : 1;
  const uDx = fit.dx || 0, uDy = fit.dy || 0;
  const uRot = fit.rot || 0;
  const uOpacity = (fit.opacity != null && isFinite(fit.opacity)) ? _clamp(fit.opacity, 0.2, 1) : 1;
  const finalScale = scale * uScale;

  // ④+++ 基础相似变换（双眼对齐 + 自动适配，暂不含手动偏移）
  const T = { dx: dM.x, dy: dM.y, angle: angle,
              sx: finalScale * fitX, sy: finalScale * fitY * syMul * foreheadMul, ox: sM.x, oy: sM.y };

  // ② 人头锚点自动对齐：以【顾客真实人头位置】为摆放基准 —— 头顶 + 左右鬓角
  //    绝不使用画布中心：目标点全部来自人脸关键点，人脸在画面任意位置/偏移时，
  //    发型都会跟随人头一起移动缩放。仅在人脸检测失败时才降级用画面中心兜底。
  if(meta.box){
    const bx0 = meta.box[0], by0 = meta.box[1], bx1 = meta.box[2];
    const bcx = (bx0 + bx1) / 2;
    const hairTopY = T.dy + (by0 - T.oy) * T.sy;   // 变换后的发顶 Y（小角度下忽略旋转）
    const hairCx   = T.dx + (bcx - T.ox) * T.sx;   // 变换后的发型中线 X

    let targetTop, targetCx, refH, refW, full;
    if(a){
      // ——— 正常路径：真实人头锚点 ———
      refH = a.faceH; refW = a.faceW;
      targetTop = a.headTop - refH * 0.03;  // 发顶略高于颅顶（头发蓬度）
      targetCx  = a.headCx;                 // 两鬓角中点为主的真实人头中线
      full = 1;                             // 完全对齐，残差归零 → 严格跟随人头
    }else{
      // ——— 降级兜底：人脸检测失败，才退回画面中心 ———
      refH = H*0.30; refW = W*0.40;
      targetTop = H*0.16 - refH*0.03;
      targetCx  = W/2;
      full = 0.82;
    }
    T.dy += _clamp((targetTop - hairTopY) * full, -refH*1.60, refH*1.60);
    T.dx += _clamp((targetCx  - hairCx)  * full, -refW*1.60, refW*1.60);

    // ②+ 鬓角二次对位：把发型左右外缘按顾客鬓角连线做精修，消除单侧偏移
    if(a){
      const hairHalfW = ((bx1 - bx0) / 2) * T.sx;          // 变换后发型半宽
      const wantHalfW = (a.templeW / 2) * (1 + Math.max(0, (0.34 - (meta.coverage||0.25))) * 0.7);
      const kw = _clamp(wantHalfW / Math.max(1, hairHalfW), 0.90, 1.12);
      if(Math.abs(kw - 1) > 0.01){
        // 以人头中线为轴缩放，缩放后中线保持贴合鬓角中点
        T.sx *= kw;
        T.dx = targetCx - (bcx - T.ox) * T.sx;
      }
      // 头顶再锁一次（sx 变化不影响 Y，但保证与 headTop 严格对齐）
      T.dy += (targetTop - (T.dy + (by0 - T.oy) * T.sy));
    }
  }
  // 手动微调叠加在自动贴合之上
  T.dx += uDx; T.dy += uDy; T.angle += uRot;

  // ⑤ 发色/质感精灵 → ④ 按原照片光照调色
  const spriteKey = 'hs' + (opts.style ? opts.style.id : 0);
  const sprite = buildHairSprite(img, meta, opts.colorId, opts.texture, spriteKey);
  const stat = analyzePhotoLight(opts.photo, a, W, H);
  const graded = gradeSpriteToPhoto(sprite, stat, spriteKey + '|' + (opts.colorId||'o') + '|' + (opts.texture||'g'));

  // ⑥ 把发型画进独立图层，便于做羽化 / 让位 / 阴影，而不是直接“贴纸”覆盖
  const layer = tmpCanvas('hairLayer', W, H);
  const lx = layer.getContext('2d');
  lx.save();
  applyHairTransform(lx, T);
  lx.drawImage(graded, 0, 0);
  lx.restore();

  // ③ 边缘羽化：发丝外缘、碎发处形成透明过渡，消除硬边
  featherLayer(layer, _clamp(W*0.007, 1.6, 6));

  // ① + ⑤ 只贴合头发区域：脸部五官与额头柔和让位，保留原发际线细节
  const hasBang = !!(opts.style && opts.style.bang && opts.style.bang !== 'none');
  if(hasLm && a) eraseFaceZone(layer, opts.landmarks, a, hasBang, W);

  // ⓪ 原生头发淡化压暗：按关键点估算原图头发区域，降亮度/降饱和弱化原有头发
  //    （轻量前端处理，非 AI 抹除；强度随新发型透明度联动，半透明预览时原发相应回显）
  if(hasLm && a) suppressOriginalHair(ctx, opts.photo, a, W, H, 0.78 * uOpacity);

  // ④ 接触阴影（先画在照片上，位于头发之下）
  if(hasLm && a) drawContactShadow(ctx, layer, a, W, H, 0.26 * uOpacity);

  // ⑦ 合成头发层（支持理发师手动调透明度）
  ctx.save();
  ctx.globalAlpha = uOpacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  // ⑤ 原发际 / 两侧碎发细节回融，让新旧头发自然衔接（不完全擦除原头发）
  if(hasLm && a) blendHairlineDetail(ctx, opts.photo, a, W, H, 0.26 * uOpacity);

  // ⑧ 光线氛围统一（室内光 / 太阳光作用于整幅画面）
  applyLighting(ctx, { x:0, y:0, w:W, h:H }, opts.lighting);
}

/* =========================================================================
 * 实时 AR 跟踪渲染 — 发型跟随头部实时移动/旋转/缩放
 * 用于摄像头实时预览：每帧检测人脸 → 计算相似变换 → 叠加发型 PNG
 * 轻量版：跳过精修步骤（光照匹配/碎发回融/接触阴影），保证 15fps+
 * ========================================================================= */

/* =========================================================================
 * 【AR 贴合引擎 v2】全新策略 —— MediaPipe FaceMesh 驱动的头部绑定
 * -------------------------------------------------------------------------
 * 一、检测管线：优先 MediaPipe FaceMesh 468/478 点 + 4×4 头部姿态矩阵；
 *     CDN/模型不可用时自动降级 face-api 68 点（extractFaceAnchors 统一适配）。
 * 二、定位策略：不再用"脸中心"，而是用固定解剖锚点
 *       33/468 左眼中心 · 263/473 右眼中心 · 151 眉心 · 10 额顶 · 234/454 太阳穴 · 152 下巴
 *     → 求出【头部原点·头宽·头高·倾角】→ 发型基准原点落在【额上颅顶】。
 * 三、镜像坐标系：landmarks 取自未镜像的 <video> 原生帧，发型也用同一套未镜像
 *     坐标计算；renderRealtimeAR 内视频与发型在【同一个镜像上下文】里绘制，
 *     二者同步翻转 → 从根本上消除"画面镜像了、发型没翻转"的恒定左右偏移。
 * 四、防抖与过渡：关键点(app.js 一阶 EMA) + 变换参数(smoothTransform 二阶 EMA)；
 *     置信度低于 MIN_CONF 暂停贴图；短暂丢脸保持上一帧并缓慢淡出。
 * 五、素材适配：每款发型只需在 HAIR_META 填 scaleRate / offsetY / offsetX 三个参数，
 *     核心追踪代码无需改动。
 * -------------------------------------------------------------------------
 * ★ 全局微调入口（AR_TUNE）：
 *   SCALE_BOOST  全局缩放     GEO_BLEND   缩放信号融合(眼距 vs 眼-颏纵距)
 *   HAIR_W_COEFF 全局横向宽度  YAW_SHIFT   转头横移强度
 *   YAW/PITCH_STRENGTH 转头/俯仰压缩强度，YAW/PITCH_MIN 压缩下限
 * ★ 单款微调入口（HAIR_META[id]）：scaleRate(倍率) / offsetY(×头高,正=下移) / offsetX(×头宽,正=右移)
 * ★ UI 滑块（STATE.fit）优先级最高：fitScale / fitDx / fitDy / fitRot / fitOpacity
 * ========================================================================= */
const AR_TUNE = {
  SCALE_BOOST:    1.00,  // ★ 全局缩放倍率
  SCALE_MIN:      0.30,  // 缩放下限（防远端过小）
  SCALE_MAX:      2.80,  // 缩放上限（防近端过大）
  POSE_DISTRUST:  2.0,   // 姿态自适应调权强度：越大，大角度时越果断抛弃失真的那路信号
  YAW_GAIN:       0.68,  // 几何 yaw 增益（三维投影标定：真转头 30° → yawN≈0.5）
  PITCH_SHIFT:    0.19,  // ★ 俯仰视差补偿：抬头时颅顶朝下的位移量（×头高）
  HAIR_W_COEFF:   1.00,  // ★ 全局横向宽度系数（>1 发型更宽，包住鬓角）
  YAW_STRENGTH:   0.22,  // 左右转头(yaw)横向压缩强度
  PITCH_STRENGTH: 0.16,  // 抬头/低头(pitch)纵向压缩强度
  YAW_MIN:        0.78,  // yaw 压缩下限（防转头被压扁）
  PITCH_MIN:      0.82,  // pitch 压缩下限
  YAW_SHIFT:      0.13,  // ★ 转头视差补偿：颅顶朝转向反侧的横移量（×头宽）
  EYE_TO_HEAD:    2.15,  // 眼距→头宽 兜底系数（= 需求三 headWidth = eyeDist × 2.15；太阳穴点异常时启用）
  MIN_CONF:       0.30,  // ★ 置信度阈值：低于此暂停贴图，避免无效漂移
  LOST_HOLD_MS:   600,   // ★ 人脸短暂丢失：保持上一帧位置的时长
  LOST_FADE_MS:   400,   // ★ 保持期后的淡出时长（淡出完毕彻底隐藏）

  /* ---- 【规格二】虚拟颅顶锚点基准 ---- */
  CROWN_LIFT:     0.30,  // ★ 虚拟颅顶：自额顶(P10)沿头轴再上推的比例（×头高）→ 估算真实发际线之上的颅骨顶点
  CROWN_BLEND:    0.62,  // ★ 基准融合权重：0=全用素材外推(旧行为) 1=全用实测虚拟颅顶。0.62=以解剖实测为主

  /* ---- 【规格三】动态跟随：缩放阻尼 + 极限侧脸旋转钳制 ---- */
  SCALE_DAMP:     0.55,  // ★ 缩放阻尼：缩放平滑系数 = 位移系数 × 此值（<1 → 缩放比位移更迟钝，杜绝忽大忽小）
  SCALE_DEADZONE: 0.012,  // ★ 缩放死区：相对变化小于 1.2% 直接忽略，消除静止时的"呼吸式"缩放抖动
  ROT_CLAMP_YAW:  0.55,  // ★ 极限侧脸判定起点：|yawN| 超过此值开始压制旋转（≈33°）
  ROT_CLAMP_AMT:  0.60,  // ★ 极限侧脸最大旋转压制比例（1=完全归零）
  ROT_KNEE:       0.60,  // ★ 旋转保真区（弧度，≈34°）：此范围内 1:1 精确跟随，绝不衰减
  ROT_MAX:        0.90,  // ★ 旋转软上限（弧度，≈52°）：超出保真区后渐进饱和至此，防穿模/畸变

  /* ---- 【规格四】双权重指数平滑 ---- */
  SMOOTH_STATIC:  0.20,  // ★ 静态正脸：低系数 → 极稳，杜绝细微抖动
  SMOOTH_DYNAMIC: 0.52,  // ★ 动态运动：高系数 → 跟手，杜绝拖影滞后
  SMOOTH_SLOW:    0.22,  // ★ 慢速转头旋转系数（稳）
  SMOOTH_FAST:    0.58,  // ★ 快速转头旋转系数（跟手）
  MOTION_REF:     0.055, // 运动量归一化基准：单帧位移 / 头宽 达到此值即视为"完全动态"
  ROT_MOTION_REF: 0.030, // 角速度归一化基准（弧度/帧）达到此值即视为"快转"

  /* ---- 【规格五】渲染细节 ---- */
  EDGE_FEATHER:   1.6,   // ★ 发际线边缘羽化半径(px)：柔化 PNG 硬边锯齿，同时天然内收消除黑边光晕

  DEBUG: (typeof location !== 'undefined' && /[?&]ardebug=1/.test(location.search))
};
// 暴露到全局：app.js 读取丢脸时间窗口；浏览器控制台可直接改参数实时调试，
// 例：AR_TUNE.SCALE_BOOST = 1.15 → 下一帧立即生效，无需刷新页面。
window.AR_TUNE = AR_TUNE;

/* =========================================================================
 * 【规格二·发型锚点与素材配置机制】
 *   每款发型拥有一套完全独立、互不干扰的配置，挂在 HAIR_META[id] 上：
 *     ┌ id        发型编号（与 HAIRSTYLES.id 一致）
 *     │ anchorX   素材 PNG 上的对齐锚点 X，归一化 0~1（= 像素 / 素材宽）
 *     │ anchorY   素材 PNG 上的对齐锚点 Y，归一化 0~1（= 像素 / 素材高）
 *     │ scaleBase 素材基准缩放（蓬松卷发 >1，贴头皮短发 <1）
 *     │ offsetX   横向偏移（×头宽，正=向右）
 *     │ offsetY   纵向偏移（×头高，正=向下）
 *     └ rotFix    旋转补偿（弧度，正=顺时针），用于源图本身带倾斜的素材
 *   ★ 缺省值：anchorX/Y 由素材不透明包围盒顶边中点派生 → 不填也完全兼容旧行为。
 *   ★ 兼容别名：旧字段 hairAnchorX / hairAnchorY / hairScale / rotationOffset 与
 *     新字段【双向同步】，任一侧被改写（含调试面板、localStorage 覆盖）都会生效。
 *   ★ 分组预设：未单独标定的发型，按【长发 / 大波浪 / 短发 / 锁骨发】自动套用组预设，
 *     避免 24 款逐一手调；单款一旦显式配置，即覆盖组预设（单款 > 组 > 缺省）。
 * ========================================================================= */

/* ---- 分组预设：按 HAIRSTYLES 的 length / curl 自动归组（规格二） ----
 * scaleBase   组基准缩放（与单款 scaleRate 相乘）
 * offsetYAdd  ★ 组纵向【增量】，叠加在单款 offsetY 之上（不是覆盖）
 *             —— 单款 offsetY 由素材 coverage 自动派生，刻画的是"这张图自身的构图"；
 *                组增量刻画的是"这个品类的共性"，二者正交，应当相加而非二选一。
 * anchorYAdj  组锚点纵向微调（仅在该款未显式配置 anchorY 时生效）
 * ★ 幅度经保守标定：单款 scaleRate 已含 0.97~1.045 的品类区分，组系数只做二次微调，
 *   避免与虚拟颅顶新基准叠加后过冲。 */
const HAIR_GROUP_PRESET = {
  // 大波浪/卷发：蓬松外扩略放大；★纵向额外下延最多，让卷发尾部自然垂落不"吊起来"
  wave:     { scaleBase: 1.07, offsetYAdd:  0.030, anchorYAdj: -0.012 },
  // 长发：整体略大，重心靠下
  long:     { scaleBase: 1.03, offsetYAdd:  0.012, anchorYAdj: -0.008 },
  // 短发：贴头皮，缩放收敛，避免头发大过脑袋
  short:    { scaleBase: 0.99, offsetYAdd: -0.004, anchorYAdj:  0.005 },
  // 锁骨发（中长）：介于两者之间
  clavicle: { scaleBase: 1.01, offsetYAdd:  0.006, anchorYAdj: -0.003 }
};

/* 依据发型属性判定所属预设组：卷/波浪优先（蓬松度对贴合影响大于长度） */
function resolveHairGroup(style){
  if(!style) return 'clavicle';
  const curl = style.curl || '', len = style.length || '';
  if((curl === 'wave' || curl === 'curly') && len !== 'short') return 'wave';
  if(len === 'long')   return 'long';
  if(len === 'short')  return 'short';
  return 'clavicle';
}

/* 新旧字段别名映射：新规范名 → 旧兼容名 */
const _META_ALIAS = { anchorX:'hairAnchorX', anchorY:'hairAnchorY', scaleBase:'hairScale', rotFix:'rotationOffset' };

function normalizeHairMeta(){
  if(typeof HAIR_META !== 'object' || !HAIR_META) return;
  const styles = (typeof HAIRSTYLES !== 'undefined' && HAIRSTYLES) ? HAIRSTYLES : [];
  for(const k in HAIR_META){
    const m = HAIR_META[k];
    if(!m || typeof m !== 'object') continue;
    const w = m.w || 1, h = m.h || 1;
    const bx = (m.box && m.box.length === 4) ? m.box : [0, 0, w, h];

    m.id = (m.id != null) ? m.id : (isNaN(+k) ? k : +k);

    // ① 旧字段若已存在而新字段缺失 → 先把旧值提升为新字段（向后兼容）
    for(const nk in _META_ALIAS){
      const ok = _META_ALIAS[nk];
      if(m[nk] == null && m[ok] != null && isFinite(m[ok])) m[nk] = m[ok];
    }

    // ② 组预设（仅填补未显式配置的项）
    const style = styles.find(s => String(s.id) === String(m.id));
    const grp   = resolveHairGroup(style);
    const pre   = HAIR_GROUP_PRESET[grp] || {};
    m.group = grp;

    // ③ 锚点缺省＝素材不透明包围盒顶边中点，再叠加组预设的纵向微调
    if(m.anchorX == null) m.anchorX = ((bx[0] + bx[2]) / 2) / w;
    if(m.anchorY == null) m.anchorY = _clamp(bx[1] / h + (pre.anchorYAdj || 0), 0, 1);
    // ④ 基准缩放 / 旋转补偿（缺省填充）
    if(m.scaleBase == null) m.scaleBase = (pre.scaleBase != null) ? pre.scaleBase : 1;
    if(m.offsetX   == null) m.offsetX   = 0;
    if(m.rotFix    == null) m.rotFix    = 0;
    // ⑤ ★纵向偏移＝素材自身标定值 + 组增量（幂等：原始值只快照一次，重复归一化不会累加）
    if(m._rawOffsetY == null) m._rawOffsetY = (m.offsetY != null && isFinite(m.offsetY)) ? +m.offsetY : 0;
    m.offsetY = m._rawOffsetY + (pre.offsetYAdd || 0);

    // ⑥ 反向同步到旧字段名，保证历史代码 / 旧 localStorage 覆盖仍然可读可写
    for(const nk in _META_ALIAS) m[_META_ALIAS[nk]] = m[nk];
  }

  /* ⑦ 单款永久预设库（hairmeta.js → hairStyleOverrides）最后应用：
   *    优先级最高，直接覆盖（不参与组增量叠加），保证调试面板复制出的配置粘贴后所见即所得。 */
  const ovr = (typeof window !== 'undefined') ? window.hairStyleOverrides : null;
  if(ovr){
    for(const id in ovr){
      const src = ovr[id], dst = HAIR_META[id];
      if(!src || !dst) continue;
      for(const k in src){
        if(src[k] == null || !isFinite(src[k])) continue;
        dst[k] = +src[k];
        if(_META_ALIAS[k]) dst[_META_ALIAS[k]] = +src[k];
      }
    }
  }
}

/* 单款重置为"缺省 + 组预设"（调试面板【重置】按钮调用，仅影响当前发型） */
function resetHairMetaOne(id){
  const m = (typeof HAIR_META === 'object' && HAIR_META) ? HAIR_META[id] : null;
  if(!m) return null;
  m.anchorX = m.anchorY = m.scaleBase = m.offsetX = m.offsetY = m.rotFix = null;
  for(const nk in _META_ALIAS) m[_META_ALIAS[nk]] = null;
  normalizeHairMeta();
  return HAIR_META[id];
}

/* 读取单款生效配置（调试面板 / 复制配置文本用） */
function getHairMetaConfig(id){
  const m = (typeof HAIR_META === 'object' && HAIR_META) ? HAIR_META[id] : null;
  if(!m) return null;
  return {
    id: m.id, group: m.group,
    anchorX: +(+m.anchorX).toFixed(4), anchorY: +(+m.anchorY).toFixed(4),
    scaleBase: +(+m.scaleBase).toFixed(3),
    offsetX: +(+m.offsetX).toFixed(4), offsetY: +(+m.offsetY).toFixed(4),
    rotFix: +(+m.rotFix).toFixed(4)
  };
}

normalizeHairMeta();
if(typeof window !== 'undefined'){
  window.normalizeHairMeta = normalizeHairMeta;
  window.resetHairMetaOne  = resetHairMetaOne;
  window.getHairMetaConfig = getHairMetaConfig;
  window.HAIR_GROUP_PRESET = HAIR_GROUP_PRESET;
}

/* =========================================================================
 * 统一锚点提取 —— 把两种检测源归一成同一套解剖锚点（画布像素坐标，未镜像）
 *   source='mp'  MediaPipe FaceMesh：landmarks 为归一化 {x,y,z} ∈ [0,1]
 *   source='api' face-api 68 点     ：landmarks 为视频原生像素
 * 输出：eyeL/eyeR(双眼中心) browMid(眉心) foreheadTop(额顶) nose chin templeL/templeR
 * ========================================================================= */
function extractFaceAnchors(landmarks, source, canvasW, canvasH, videoW, videoH){
  if(!landmarks || !landmarks.length) return null;

  // 以【点数】为最终判据，不盲信传入的 source：
  // 引擎切换存在时序窗口（source 已变、点集还没换，或反之），
  // 一旦按错误语义解读坐标（归一化 0..1 当成像素），发型会瞬间飞到画面角落。
  // 468/478 只可能来自 MediaPipe，68 只可能来自 face-api，据此纠正即可根除错配。
  if(landmarks.length >= 468) source = 'mp';
  else if(landmarks.length >= 68) source = 'api';
  else return null;

  /* ---- ① MediaPipe FaceMesh（468 基础点 / 478 含虹膜）---- */
  if(source === 'mp'){
    const P = i => { const p = landmarks[i]; return { x: p.x * canvasW, y: p.y * canvasH, z: (p.z || 0) * canvasW }; };
    const MID = idx => {
      let x = 0, y = 0;
      for(const i of idx){ x += landmarks[i].x; y += landmarks[i].y; }
      return { x: (x / idx.length) * canvasW, y: (y / idx.length) * canvasH, z: 0 };
    };
    // 眼中心：有虹膜点(478)时用虹膜中心，否则用眼环均值（含用户指定的 33 / 263）
    const hasIris = landmarks.length >= 478;
    const eyeL = hasIris ? MID([468, 469, 470, 471, 472]) : MID([33, 133, 159, 145]);
    const eyeR = hasIris ? MID([473, 474, 475, 476, 477]) : MID([263, 362, 386, 374]);
    return {
      eyeL, eyeR,
      browMid:     P(151),   // 眉心
      foreheadTop: P(10),    // 额头顶点
      nose:        P(1),     // 鼻尖
      chin:        P(152),   // 下巴
      templeL:     P(234),   // 左太阳穴
      templeR:     P(454),   // 右太阳穴
      source: 'mp', n: landmarks.length
    };
  }

  /* ---- ② face-api 68 点（降级兜底）---- */
  if(landmarks.length < 68) return null;
  const kx = (videoW && videoW > 1) ? canvasW / videoW : 1;
  const ky = (videoH && videoH > 1) ? canvasH / videoH : 1;
  const P = i => ({ x: landmarks[i].x * kx, y: landmarks[i].y * ky, z: 0 });
  const MID = idx => {
    let x = 0, y = 0;
    for(const i of idx){ x += landmarks[i].x; y += landmarks[i].y; }
    return { x: (x / idx.length) * kx, y: (y / idx.length) * ky, z: 0 };
  };
  const eyeL = MID([36, 37, 38, 39, 40, 41]);
  const eyeR = MID([42, 43, 44, 45, 46, 47]);
  const browMid = MID([21, 22]);
  const chin = P(8);
  // 68 点无额顶 → 由眉心沿"下巴→眉心"方向外推 0.42×(眉→颏)，等效 MediaPipe 点 10
  const foreheadTop = {
    x: browMid.x + (browMid.x - chin.x) * 0.42,
    y: browMid.y + (browMid.y - chin.y) * 0.42, z: 0
  };
  return {
    eyeL, eyeR, browMid, foreheadTop, nose: P(30), chin,
    templeL: P(0), templeR: P(16), source: 'api', n: landmarks.length
  };
}

/* =========================================================================
 * 核心：求解发型 → 画布 的相似变换
 *   landmarks 检测点； matrix 4×4 头部姿态矩阵(可为 null)； meta HAIR_META[id]
 *   opts = { canvasW, canvasH, fit, source, videoW, videoH }
 * 返回 T = { dx,dy,angle,sx,sy,ox,oy,valid,pose,headW,headH,anchors }
 *   绘制序列：translate(dx,dy) → rotate(angle) → scale(sx,sy) → translate(-ox,-oy)
 *   即：素材颅顶(ox,oy) 被精确钉在实检颅顶(dx,dy) 上 —— 这就是"绑定人头"。
 * ========================================================================= */
function buildRealtimeTransform(landmarks, matrix, meta, opts){
  opts = opts || {};
  const canvasW = opts.canvasW || 0, canvasH = opts.canvasH || 0;
  const fit = opts.fit || {};
  if(!meta || !meta.eyeL || !meta.eyeR || !canvasW || !canvasH) return null;

  const A = extractFaceAnchors(landmarks, opts.source || 'mp', canvasW, canvasH, opts.videoW, opts.videoH);
  if(!A) return null;

  /* ---------- ① 头部几何量（画布像素） ---------- */
  const eyeMid  = { x: (A.eyeL.x + A.eyeR.x) / 2, y: (A.eyeL.y + A.eyeR.y) / 2 };
  const eyeDist = Math.hypot(A.eyeR.x - A.eyeL.x, A.eyeR.y - A.eyeL.y);
  if(!isFinite(eyeDist) || eyeDist < 6) return null;

  const roll  = Math.atan2(A.eyeR.y - A.eyeL.y, A.eyeR.x - A.eyeL.x);  // 头部左右倾斜
  const up    = { x:  Math.sin(roll), y: -Math.cos(roll) };            // 「头朝上」单位向量（随 roll 同步旋转）
  const right = { x:  Math.cos(roll), y:  Math.sin(roll) };            // 「头朝右」单位向量

  let headW = Math.hypot(A.templeR.x - A.templeL.x, A.templeR.y - A.templeL.y);
  if(!isFinite(headW) || headW < eyeDist * 0.9) headW = eyeDist * AR_TUNE.EYE_TO_HEAD;
  let headH = Math.hypot(A.chin.x - A.foreheadTop.x, A.chin.y - A.foreheadTop.y);
  if(!isFinite(headH) || headH < eyeDist) headH = headW * 1.35;

  /* ---------- ② 3D 头部姿态（yaw / pitch / roll） ----------
   * yaw 以【几何解】为准绳：两侧都在同一画布坐标系里测量，符号语义明确可控，
   *   不受 MediaPipe 矩阵坐标约定（不同版本/平台可能左右手系不同）影响。
   *   约定：yawN > 0 = 头转向画面右侧（鼻尖靠近右太阳穴）。
   *   增益 YAW_GAIN 经三维投影标定：转头 30° → yawN ≈ 0.5（即 30/60）。
   * 矩阵解只在【符号一致】时做小权重微调，符号相反时判定为坐标约定不同并弃用，
   *   避免出现"越转头发型越往反方向跑"的致命错位。
   * pitch 无可靠几何解（个体脸型差异大），仅在矩阵可用时启用；
   *   face-api 降级路径下 pitch=0，宁可不做纵向压缩，也不引入错误信号。
   * ---------------------------------------------------------------------- */
  const dTl = Math.hypot(A.nose.x - A.templeL.x, A.nose.y - A.templeL.y);
  const dTr = Math.hypot(A.nose.x - A.templeR.x, A.nose.y - A.templeR.y);
  let yawN = _clamp((dTl - dTr) / Math.max(1, dTl + dTr) * AR_TUNE.YAW_GAIN, -1, 1);
  let pitchN = 0, poseMat = null;
  if(matrix && matrix.length >= 16){
    const R = (r, c) => matrix[c * 4 + r];                 // MediaPipe 返回列主序 4×4
    const mYaw   = Math.atan2(R(0, 2), R(2, 2));
    const mPitch = Math.asin(_clamp(-R(1, 2), -1, 1));
    const mRoll  = Math.atan2(R(1, 0), R(1, 1));
    poseMat = { yaw: mYaw, pitch: mPitch, roll: mRoll };
    if(isFinite(mPitch)) pitchN = _clamp(mPitch / (Math.PI / 3), -1, 1);
    const my = _clamp(mYaw / (Math.PI / 3), -1, 1);
    if(isFinite(my) && Math.abs(yawN) > 0.08 && Math.abs(my) > 0.08 && Math.sign(my) === Math.sign(yawN)){
      yawN = yawN * 0.7 + my * 0.3;
    }
  }
  const yawRad    = yawN   * (Math.PI / 3);
  const pitchRad  = pitchN * (Math.PI / 3);
  const yawComp   = _clamp(1 - AR_TUNE.YAW_STRENGTH   * Math.abs(yawN),   AR_TUNE.YAW_MIN,   1);
  const pitchComp = _clamp(1 - AR_TUNE.PITCH_STRENGTH * Math.abs(pitchN), AR_TUNE.PITCH_MIN, 1);

  /* ---------- ③ 素材侧几何（PNG 像素坐标） ---------- */
  const sEyeL = { x: meta.eyeL[0], y: meta.eyeL[1] };
  const sEyeR = { x: meta.eyeR[0], y: meta.eyeR[1] };
  const sEyeMid  = { x: (sEyeL.x + sEyeR.x) / 2, y: (sEyeL.y + sEyeR.y) / 2 };
  const sEyeDist = Math.max(1, Math.hypot(sEyeR.x - sEyeL.x, sEyeR.y - sEyeL.y));
  const sRoll    = Math.atan2(sEyeR.y - sEyeL.y, sEyeR.x - sEyeL.x);
  const sBox     = (meta.box && meta.box.length === 4) ? meta.box : [0, 0, meta.w, meta.h];
  // ★【规格二·锚点配置·素材侧】发型基准原点＝素材 PNG 上的对齐锚点 anchorX/anchorY（归一化 0~1），
  //   缺省由包围盒顶边中点派生；兼容旧字段名 hairAnchorX/hairAnchorY。
  const _pick = (a, b, d) => (a != null && isFinite(a)) ? a : ((b != null && isFinite(b)) ? b : d);
  const anchorX = _pick(meta.anchorX, meta.hairAnchorX, ((sBox[0] + sBox[2]) / 2) / meta.w);
  const anchorY = _pick(meta.anchorY, meta.hairAnchorY, sBox[1] / meta.h);
  const sCrown  = { x: anchorX * meta.w, y: anchorY * meta.h };   // 素材颅顶（锚点还原为像素）

  /* ---------- ④ 自适应缩放：远近实时跟随 ----------
   * 双信号互补融合，两者盲区正好错开：
   *   信号 A 眼距比      —— 对俯仰完全免疫（双眼绕 X 轴转不改变间距），但转头时被 cos(yaw) 压缩
   *   信号 B 眼→颏纵距比 —— 对转头完全免疫（纵向不受 yaw 影响），但对俯仰敏感
   * ★ 不对 B 做 cos(pitch) 补偿：抬头时下巴靠近镜头，透视放大压过余弦收缩，
   *   眼-颏距实际是【变长】而非变短，套用余弦补偿会把误差放大一倍（曾实测纵向脱节 18% 头高）。
   *   改为按姿态动态调权：转头越大越信 B，俯仰越大越信 A，让不可信的信号自动退场。
   * ---------------------------------------------------------------------- */
  const sigA = (eyeDist / Math.max(0.78, Math.cos(yawRad))) / sEyeDist;
  let sigB = null;
  if(meta.face && meta.face.length === 4 && meta.face[3] > 1){
    const sChinY = meta.face[1] + meta.face[3];                  // 素材下巴 y（人脸框底边）
    const sVert  = Math.max(1, Math.abs(sChinY - sEyeMid.y));
    const dVert  = Math.hypot(A.chin.x - eyeMid.x, A.chin.y - eyeMid.y);
    const r = dVert / sVert;
    if(isFinite(r) && r > 0) sigB = r;
  }
  let sizeSig;
  if(sigB == null){
    sizeSig = sigA;
  }else{
    const wA = 1 / (1 + AR_TUNE.POSE_DISTRUST * Math.abs(yawN));    // 转头越大，眼距越不可信
    const wB = 1 / (1 + AR_TUNE.POSE_DISTRUST * Math.abs(pitchN));  // 俯仰越大，纵距越不可信
    const blend = _clamp(wB / (wA + wB), 0.15, 0.85);               // sigB 的权重（正面时 0.5）
    sizeSig = blend * sigB + (1 - blend) * sigA;
  }
  const scaleRate   = (meta.scaleRate != null && isFinite(meta.scaleRate)) ? meta.scaleRate : 1;  // ★ 单款倍率（HAIR_META）
  const legacyScale = (meta.arScale   != null && isFinite(meta.arScale))   ? meta.arScale   : 1;  // 兼容旧参数
  const scaleBase   = _pick(meta.scaleBase, meta.hairScale, 1);  // ★【规格二】素材基准缩放（兼容旧名 hairScale）
  // ★【缩放系数】自适应尺寸 × 单款倍率 × 素材基准缩放 × 全局缩放 → 远近实时跟随人头大小
  let scale = _clamp(sizeSig * scaleRate * legacyScale * scaleBase * AR_TUNE.SCALE_BOOST,
                     AR_TUNE.SCALE_MIN, AR_TUNE.SCALE_MAX);

  /* ---------- ⑤ UI 手动微调（优先级最高）+ 极限侧脸旋转钳制 ---------- */
  const uScale = (fit.scale != null && isFinite(fit.scale)) ? _clamp(fit.scale, 0.5, 1.8) : 1;
  const uDx = fit.dx || 0, uDy = fit.dy || 0, uRot = fit.rot || 0;
  const finalScale = scale * uScale;
  const rotFix = _pick(meta.rotFix, meta.rotationOffset, 0);   // ★【规格二】旋转补偿（弧度，兼容旧名 rotationOffset）
  /* ★【规格三·极限侧脸旋转钳制】
   *   大角度侧脸时 roll 的测量误差急剧放大（双眼几乎重合，atan2 分母趋零），
   *   若原样跟随会让发型剧烈摆动甚至穿透面部。此处做两级保护：
   *     ① 侧脸压制：|yawN| 越过 ROT_CLAMP_YAW 后，roll 分量按比例线性衰减到 (1-ROT_CLAMP_AMT)
   *     ② 软饱和  ：整体角度用 tanh 软钳制到 ±ROT_MAX，越界渐进逼近而非硬截断 → 无跳变、不穿模
   */
  const yawExcess = _clamp((Math.abs(yawN) - AR_TUNE.ROT_CLAMP_YAW) / Math.max(1e-3, 1 - AR_TUNE.ROT_CLAMP_YAW), 0, 1);
  const rollGain  = 1 - yawExcess * AR_TUNE.ROT_CLAMP_AMT;
  const rawAngle  = (roll - sRoll) * rollGain + uRot + rotFix;
  const angle     = _softLimit(rawAngle, AR_TUNE.ROT_KNEE, AR_TUNE.ROT_MAX);

  /* ---------- ⑥ 颅顶落点：基准＝【虚拟颅顶】，不是脸中心（规格二） ----------
   * 旧方案用「素材眼中心 → 素材锚点」向量外推，完全依赖素材自身比例：
   *   素材模特额头高/发际线低，就会整体带偏，个体适配差。
   * 新方案引入【实测虚拟颅顶】：以额顶特征点 P(10) 为起点，沿头部朝上轴再外推
   *   CROWN_LIFT × 头高 —— 因为 P(10) 只是额头最高点，真实颅骨顶点还在其上方，
   *   这段距离与头高强相关，比例稳定，个体差异远小于"额头高低"。
   * 两路结果按 CROWN_BLEND 融合：以解剖实测为主（抗个体差异），素材外推为辅
   *   （保留素材自身的发型重心信息），兼顾"贴得准"与"戴得像"。
   * -------------------------------------------------------------------- */
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // 路径 A：素材比例外推（旧行为）
  const vx = (sCrown.x - sEyeMid.x) * finalScale, vy = (sCrown.y - sEyeMid.y) * finalScale;
  const crownProp = { x: eyeMid.x + (vx * ca - vy * sa), y: eyeMid.y + (vx * sa + vy * ca) };
  // 路径 B：实测虚拟颅顶（额顶沿头轴上推）
  const lift = AR_TUNE.CROWN_LIFT * headH;
  const crownReal = { x: A.foreheadTop.x + up.x * lift, y: A.foreheadTop.y + up.y * lift };
  // 融合
  const kB = _clamp(AR_TUNE.CROWN_BLEND, 0, 1);
  const crownBase = {
    x: crownProp.x * (1 - kB) + crownReal.x * kB,
    y: crownProp.y * (1 - kB) + crownReal.y * kB
  };
  // ★【偏移参数】offsetY(×头高，正=下移) / offsetX(×头宽，正=右移)——素材相对头部的额外对齐微调（规格二）
  const offsetY = (meta.offsetY != null && isFinite(meta.offsetY)) ? meta.offsetY : 0;
  const offsetX = (meta.offsetX != null && isFinite(meta.offsetX)) ? meta.offsetX : 0;
  // 转头视差补偿：颅顶位于头部中轴线【偏后】，双眼位于【偏前】，二者深度不同。
  //   头转向画面右侧(yawN>0)时，颅顶在图像上会朝【左】偏移，而眼中心朝右——
  //   若不补这一项，转头时发型就会明显滞后/甩到脸的一侧。系数经三维投影标定。
  const lateral = offsetX * headW - yawN * AR_TUNE.YAW_SHIFT * headW;
  // 俯仰视差补偿：同理，抬头(pitchN>0)时头往后仰，颅顶在图像上朝【下】走；低头则朝上。
  const vertical = (offsetY + pitchN * AR_TUNE.PITCH_SHIFT) * headH;
  const crown = {
    x: crownBase.x - up.x * vertical + right.x * lateral,
    y: crownBase.y - up.y * vertical + right.y * lateral
  };

  /* ---------- ⑦ 头部包围框（调试可视化用，随 roll 旋转的 OBB 四角） ---------- */
  const hw = headW * 0.5, hUp = headH * 0.62, hDn = headH * 0.52;
  const headBox = [
    { x: crownReal.x - right.x*hw + up.x*(hUp-headH*0.62), y: crownReal.y - right.y*hw + up.y*(hUp-headH*0.62) },
    { x: crownReal.x + right.x*hw, y: crownReal.y + right.y*hw },
    { x: A.chin.x + right.x*hw - up.x*(hDn-headH*0.52), y: A.chin.y + right.y*hw - up.y*(hDn-headH*0.52) },
    { x: A.chin.x - right.x*hw, y: A.chin.y - right.y*hw }
  ];

  /* ---------- ⑧ 输出变换 ---------- */
  const T = {
    ox: sCrown.x, oy: sCrown.y,                                     // 变换原点＝素材颅顶
    dx: crown.x + uDx + (meta.arDx != null ? meta.arDx : 0),        // 落点＝实检颅顶
    dy: crown.y + uDy + (meta.arDy != null ? meta.arDy : 0),
    angle: angle,
    // ★【旋转补偿】yawComp / pitchComp：转头/俯仰时发型横向/纵向压缩，跟随头部透视（规格三）
    sx: finalScale * AR_TUNE.HAIR_W_COEFF * yawComp,
    sy: finalScale * pitchComp,
    pose: { yaw: yawN, pitch: pitchN, roll: roll, matrix: poseMat },
    headW: headW, headH: headH, eyeDist: eyeDist,
    anchors: A, eyeMid: eyeMid, crown: crown,
    crownReal: crownReal, headBox: headBox, rollGain: rollGain,
    cfg: { anchorX: anchorX, anchorY: anchorY, scaleBase: scaleBase, offsetX: offsetX, offsetY: offsetY, rotFix: rotFix, group: meta.group || '' }
  };
  T.valid = isFinite(T.dx) && isFinite(T.dy) && isFinite(T.sx) && isFinite(T.sy) && isFinite(T.angle)
            && T.sx > 0.02 && T.sy > 0.02 && eyeDist > 8 && Math.abs(angle) < 1.4;
  return T;
}

/* =========================================================================
 * 【规格四·统一指数平滑（坐标 / 缩放 / 旋转）+ 规格三·缩放阻尼与慢快双系数】
 *
 *   双阶滤波·第二阶：对变换参数(dx/dy/sx/sy/angle/ox/oy)做自适应指数平滑。
 *   一套系数走天下必然二选一：调稳则拖影、调跟手则抖动。因此按【运动状态】动态调权：
 *
 *   ┌ 坐标 —— 运动量 m = 单帧位移 / 头宽，归一到 [0,1]
 *   │        α_pos = SMOOTH_STATIC + (SMOOTH_DYNAMIC - SMOOTH_STATIC) × m
 *   │        静止正脸 → 0.20（极稳，肉眼无抖）；快速移动 → 0.52（紧跟，无滞后）
 *   │
 *   ├ 缩放 —— ★ 阻尼：α_scale = α_pos × SCALE_DAMP，天生比位移迟钝
 *   │        ★ 死区：相对变化 < SCALE_DEADZONE(1.2%) 直接冻结
 *   │        原因：缩放由眼距/纵距【比值】驱动，关键点 1px 噪声就会放大成尺寸抖动，
 *   │              视觉上表现为"发型呼吸式忽大忽小"，比位移抖动更刺眼。
 *   │
 *   └ 旋转 —— ★ 慢转/快转双系数：按角速度在 SMOOTH_SLOW(0.22) ↔ SMOOTH_FAST(0.58) 间插值
 *            慢慢转头时高度平滑（不抖），猛地转头时快速收敛（不甩尾）。
 *
 *   ★ 历史缺陷修复保留：ox/oy 必须复制，否则渲染 translate(NaN,NaN) 被浏览器静默忽略，
 *     发型原点不回退 → "发型独立悬浮、与人头脱节"。
 * ========================================================================= */
let _hairTSmooth = null;
function resetHairSmoothing(){ _hairTSmooth = null; }
function smoothTransform(T){
  if(!T) return null;
  if(!_hairTSmooth){
    _hairTSmooth = { dx:T.dx, dy:T.dy, sx:T.sx, sy:T.sy, angle:T.angle, ox:T.ox, oy:T.oy, valid:T.valid, m:0, rm:0 };
    return _hairTSmooth;
  }
  const S = _hairTSmooth;
  const ref = Math.max(20, T.headW || 120);

  /* ① 运动量估计（对运动量本身也做平滑，避免单帧噪声让系数忽高忽低） */
  const dist    = Math.hypot(T.dx - S.dx, T.dy - S.dy) / ref;
  const rotDist = Math.abs(T.angle - S.angle);
  S.m  += (_clamp(dist    / AR_TUNE.MOTION_REF,     0, 1) - S.m)  * 0.35;
  S.rm += (_clamp(rotDist / AR_TUNE.ROT_MOTION_REF, 0, 1) - S.rm) * 0.35;

  /* ② 坐标：静态 ↔ 动态 双权重 */
  const aPos = AR_TUNE.SMOOTH_STATIC + (AR_TUNE.SMOOTH_DYNAMIC - AR_TUNE.SMOOTH_STATIC) * S.m;
  S.dx += (T.dx - S.dx) * aPos;
  S.dy += (T.dy - S.dy) * aPos;

  /* ③ 缩放：阻尼 + 死区 */
  const aScale = aPos * AR_TUNE.SCALE_DAMP;
  const relX = Math.abs(T.sx - S.sx) / Math.max(1e-4, Math.abs(S.sx));
  const relY = Math.abs(T.sy - S.sy) / Math.max(1e-4, Math.abs(S.sy));
  if(relX > AR_TUNE.SCALE_DEADZONE) S.sx += (T.sx - S.sx) * aScale;
  if(relY > AR_TUNE.SCALE_DEADZONE) S.sy += (T.sy - S.sy) * aScale;

  /* ④ 旋转：慢转 ↔ 快转 双系数 */
  const aRot = AR_TUNE.SMOOTH_SLOW + (AR_TUNE.SMOOTH_FAST - AR_TUNE.SMOOTH_SLOW) * S.rm;
  S.angle += (T.angle - S.angle) * aRot;

  S.ox = T.ox;    // 素材原点随款式切换直接吸附，不做插值
  S.oy = T.oy;
  S.valid = T.valid;
  return S;
}

/* =========================================================================
 * 实时 AR 渲染（图层顺序：底层=摄像头画面，顶层=发型透明 PNG）
 * opts = { video, landmarks, matrix, source, confidence, hairImg, hairMeta,
 *          colorId, texture, fit, hairAlpha }
 *   hairAlpha  丢脸淡出用的整体透明度（1=正常，0=完全隐藏）
 *   confidence 检测置信度，低于 AR_TUNE.MIN_CONF 时暂停贴图
 * 返回本帧变换 T（无贴图时返回 null），供上层做调试/状态判断。
 * ========================================================================= */
function renderRealtimeAR(canvas, opts){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if(!opts || !opts.video) return null;
  const vw = opts.video.videoWidth || W;
  const vh = opts.video.videoHeight || H;

  // ★【规格五】高质量重采样：发型被缩放/旋转后仍保持平滑边缘，不出现像素阶梯
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ★ 镜像上下文：视频与发型在同一镜像空间绘制 → 二者同步翻转，左右严格对齐
  ctx.save();
  ctx.translate(W, 0); ctx.scale(-1, 1);

  // —— ★【规格五·图层锁定】图层①：摄像头画面（底层）——
  //    发型永远在同一 ctx 中【后】绘制，绘制顺序即层级，物理上不可能被视频帧覆盖，
  //    也不存在多 canvas 的 z-index 竞争 → 发型层始终锁定在画面上方。
  ctx.drawImage(opts.video, 0, 0, vw, vh, 0, 0, W, H);

  // —— 图层②：发型透明 PNG（顶层）——
  let T0 = null, T = null;
  const conf  = (opts.confidence != null && isFinite(opts.confidence)) ? opts.confidence : 1;
  const alpha = (opts.hairAlpha  != null && isFinite(opts.hairAlpha))  ? _clamp(opts.hairAlpha, 0, 1) : 1;
  if(opts.landmarks && opts.hairImg && opts.hairMeta && conf >= AR_TUNE.MIN_CONF && alpha > 0.01){
    T0 = buildRealtimeTransform(opts.landmarks, opts.matrix, opts.hairMeta, {
      canvasW: W, canvasH: H, fit: opts.fit,
      source: opts.source || 'mp', videoW: vw, videoH: vh
    });
    T = (T0 && T0.valid) ? smoothTransform(T0) : null;
    if(T && isFinite(T.ox) && isFinite(T.oy)){
      // ★【规格五】发际线边缘抗锯齿：羽化半径统一由 AR_TUNE.EDGE_FEATHER 控制
      const sprite = buildHairSprite(opts.hairImg, opts.hairMeta, opts.colorId, opts.texture, 'realtime|' + opts.hairImg.src, AR_TUNE.EDGE_FEATHER);
      const op = (opts.fit && opts.fit.opacity != null && isFinite(opts.fit.opacity)) ? _clamp(opts.fit.opacity, 0.2, 1) : 1;
      ctx.save();
      ctx.globalAlpha = op * alpha;
      // ★【坐标变换】绘制序列：translate(落点) → rotate(角) → scale(缩放) → translate(-锚点)
      //   即把素材颅顶(ox,oy) 精确钉在实检颅顶(dx,dy) 上 —— 这就是"绑定人头"（需求四·镜像坐标系）。
      ctx.translate(T.dx, T.dy);
      ctx.rotate(T.angle);
      ctx.scale(T.sx, T.sy);
      ctx.translate(-T.ox, -T.oy);
      ctx.drawImage(sprite, 0, 0, opts.hairMeta.w, opts.hairMeta.h);
      ctx.restore();
    }
  }
  ctx.restore();

  if(AR_TUNE.DEBUG && T0) drawArDebug(ctx, T0, W, H);
  return T;
}

/* =========================================================================
 * 【规格一·调试叠加层】URL 带 ?ardebug=1 时启用。绘制内容：
 *   ● 红点(大)   颅顶基准 —— 发型 PNG 锚点最终被钉住的位置（最关键的判读依据）
 *   ● 红圈(空心) 实测虚拟颅顶 —— 未叠加偏移前的解剖基准，与红点的差＝offsetX/Y 生效量
 *   ● 青点       双眼锚点        ● 橙点 额顶 P(10)      ● 黄点 眉心
 *   ● 绿点       下巴            ● 品红 左右太阳穴
 *   ▭ 绿框       头部包围框（随 roll 旋转的 OBB）
 * 判读方法：红点应稳定落在头顶正上方发际线之上；随头移动/转动时，红点须"焊"在头上不漂。
 * ========================================================================= */
function drawArDebug(ctx, T, W, H){
  const A = T.anchors; if(!A) return;
  ctx.save();
  ctx.translate(W, 0); ctx.scale(-1, 1);

  // —— 头部包围框 ——
  if(T.headBox && T.headBox.length === 4){
    ctx.strokeStyle = 'rgba(60,255,120,.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(T.headBox[0].x, T.headBox[0].y);
    for(let i = 1; i < 4; i++) ctx.lineTo(T.headBox[i].x, T.headBox[i].y);
    ctx.closePath(); ctx.stroke();
  }

  const dot = (p, c, r) => { if(!p) return; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, r || 4, 0, Math.PI * 2); ctx.fill(); };
  dot(A.eyeL, '#00e5ff'); dot(A.eyeR, '#00e5ff');
  dot(A.browMid, '#ffd400'); dot(A.foreheadTop, '#ff7b00');
  dot(A.chin, '#7cff00'); dot(A.templeL, '#ff00c8'); dot(A.templeR, '#ff00c8');

  // 实测虚拟颅顶（空心红圈）——偏移前的解剖基准
  if(T.crownReal){
    ctx.strokeStyle = 'rgba(255,80,80,.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(T.crownReal.x, T.crownReal.y, 9, 0, Math.PI * 2); ctx.stroke();
  }
  // ★ 颅顶基准红点（发型锚点最终落点）
  dot(T.crown, '#ff2d2d', 6);

  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(A.eyeL.x, A.eyeL.y); ctx.lineTo(A.eyeR.x, A.eyeR.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(T.eyeMid.x, T.eyeMid.y); ctx.lineTo(T.crown.x, T.crown.y); ctx.stroke();
  ctx.restore();

  const c = T.cfg || {};
  ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(8, 8, 288, 128);
  ctx.fillStyle = '#fff'; ctx.font = '12px monospace';
  ctx.fillText('src=' + A.source + '  n=' + A.n + '  grp=' + (c.group || '-'), 16, 26);
  ctx.fillText('scale sx=' + T.sx.toFixed(3) + ' sy=' + T.sy.toFixed(3), 16, 44);
  ctx.fillText('headW=' + T.headW.toFixed(1) + ' headH=' + T.headH.toFixed(1), 16, 62);
  ctx.fillText('yaw=' + T.pose.yaw.toFixed(2) + ' pitch=' + T.pose.pitch.toFixed(2) + ' roll=' + T.pose.roll.toFixed(2), 16, 80);
  ctx.fillText('angle=' + T.angle.toFixed(3) + ' rollGain=' + (T.rollGain != null ? T.rollGain.toFixed(2) : '-'), 16, 98);
  ctx.fillText('anc=' + (+c.anchorX).toFixed(3) + ',' + (+c.anchorY).toFixed(3) +
               ' base=' + (+c.scaleBase).toFixed(2) +
               ' off=' + (+c.offsetX).toFixed(3) + ',' + (+c.offsetY).toFixed(3), 16, 116);
  ctx.fillText('eyeDist=' + T.eyeDist.toFixed(1) + '  rotFix=' + (+c.rotFix).toFixed(3), 16, 132);
}
