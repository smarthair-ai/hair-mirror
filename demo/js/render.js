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

  // 边缘透明融合：对整张精灵做一次轻量模糊再 destination-in，柔化 PNG 硬边/黑边
  if(featherPx && featherPx > 0){
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const tx = tmp.getContext('2d');
    tx.filter = `blur(${featherPx}px)`;
    tx.drawImage(c, 0, 0);
    tx.filter = 'none';
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

// 实时帧的轻量 T 矩阵（跳过二次精修 + 鬓角对位，只做双眼对齐）
/* =========================================================================
 * 实时 AR 发型变换 —— 核心可调参数集中在这里（AR_TUNE）
 * -------------------------------------------------------------------------
 * 坐标系：landmarks 为视频原生像素，本函数先映射到画布坐标(720x880)再计算；
 *        视频被拉伸铺满画布，不映射会导致整体偏移/缩放错位。
 * 生物特征锚点：face-api 输出 68 关键点（项目未集成 MediaPipe 468，故用 68 点
 *        充分覆盖：左右太阳穴=0/16，额头中点=27，头顶=眉上外推，下颌=8/下巴轮廓）。
 * ★ 你要微调的“发型偏移/缩放”入口（改这里即可适配不同长短发型）：
 *   - VERTICAL_OFFSET : 发型相对头顶的纵向偏移(px，画布坐标)。正=下移，负=上移。
 *   - SCALE_BOOST     : 整体缩放微调，与 UI“大小”滑块叠加（>1 放大）。
 *   - HEADTOP_RATIO   : 头顶外推比例（眉→头顶 / 眉→下巴）。圆脸调小、长脸调大。
 *   - TEMPLE_FACTOR   : 鬓角宽度贴合系数（1=正好贴合，>1 略宽）。
 *   - YAW_STRENGTH    : 左右转头(yaw)横向压缩强度（跟转头）。
 *   - PITCH_STRENGTH  : 抬头/低头(pitch)纵向压缩强度（跟俯仰）。
 * 此外 UI 滑块「上下 fitDy / 大小 fitScale / 左右 fitDx / 旋转 fitRot」即 STATE.fit，
 *   在 app.js 中实时传入本函数的 fit 参数，优先级最高，可即时拖动微调。
 * ========================================================================= */
const AR_TUNE = {
  VERTICAL_OFFSET: 0,    // ★ 上下偏移(px)：正=下移，负=上移（发型锚点相对颅顶）
  SCALE_BOOST: 1.0,      // ★ 基础缩放倍率：整体缩放微调，与 UI“大小”滑块、每款 arScale 叠加
  SCALE_MIN: 0.45,       // ★ 缩放下限：防极端远端发型过小
  SCALE_MAX: 2.20,       // ★ 缩放上限：防极端近端发型过大
  HEADTOP_RATIO: 0.58,   // 头顶外推比例（眉→头顶 / 眉→下巴）。圆脸↓ 长脸↑
  TEMPLE_FACTOR: 1.0,    // ★ 横向补偿（鬓角宽度贴合系数）：>1 略宽，<1 略窄
  YAW_STRENGTH: 0.18,    // 左右转头(yaw)横向压缩强度（0=不跟转，0.25=明显跟转）
  PITCH_STRENGTH: 0.12,  // 抬头/低头(pitch)纵向压缩强度
  BOX_PAD: 0.03          // 发顶相对颅顶的蓬度（>0 发顶略高，避免盖脸）
};

function buildRealtimeTransform(landmarks, meta, canvasW, canvasH, fit, videoW, videoH, box){
  if(!landmarks || landmarks.length < 68 || !meta || !meta.eyeL || !meta.eyeR) return null;

  // [AR-DEBUG] ① 坐标映射：视频原生坐标(如1280x960) → 画布坐标(720x880)。
  //   视频被拉伸铺满画布，不映射会导致发型整体偏移/缩放错位。L 即映射后的关键点。
  const vsx = (videoW && videoW > 1) ? canvasW / videoW : 1;
  const vsy = (videoH && videoH > 1) ? canvasH / videoH : 1;
  const L = landmarks.map(p => ({ x: p.x * vsx, y: p.y * vsy }));

  // —— 生物特征锚点（68 点充分覆盖太阳穴/额头/头顶/下颌）——
  const e = eyeCentersFromLandmarks(L);
  const dL = e.L, dR = e.R;                       // 双眼中心
  const templeL = L[0], templeR = L[16];          // 左右太阳穴（鬓角）
  const jawChin = L[8];                           // 下颌底（下巴尖）
  // 源发型双眼锚点（离线检测，PNG 素材坐标系）
  const sL = { x: meta.eyeL[0], y: meta.eyeL[1] };
  const sR = { x: meta.eyeR[0], y: meta.eyeR[1] };

  // 缩放：顾客眼距 / 源眼距 × 覆盖率补偿。
  //   ★ 每款发型可在 HAIR_META[id].arScale 单独微调（与 AR_TUNE.SCALE_BOOST、UI“大小”滑块叠加）
  const dDist = Math.hypot(dR.x - dL.x, dR.y - dL.y);
  const sDist = Math.max(1, Math.hypot(sR.x - sL.x, sR.y - sL.y));
  const coverage = meta.coverage || 0.25;
  const coverageScale = 1.06 + Math.max(0, (0.30 - coverage) * 0.5);
  const scaleBoost = AR_TUNE.SCALE_BOOST * (meta.arScale != null && isFinite(meta.arScale) ? meta.arScale : 1);
  // [AR-DEBUG] ② 自适应缩放核心：双眼距(头型) + 人脸包围盒(远近) 双信号实时算头部像素尺寸。
  //   box.width = 视频坐标人脸包围盒宽；srcBoxW = 素材发型包围盒宽；比值与坐标空间无关。
  //   人物靠近→box变大→scaleFromBox变大→发型放大；远离→变小。逐帧动态更新。
  const srcBoxW = (meta.box && meta.box[2] > meta.box[0]) ? (meta.box[2] - meta.box[0]) : null;
  const scaleFromEye = dDist / sDist;
  let scaleFromBox = scaleFromEye;
  if(box && box.width && srcBoxW){ scaleFromBox = box.width / srcBoxW; } // 顾客头宽 / 素材头宽 = 距离自适应缩放比
  const sizeRatio = srcBoxW ? (0.5 * scaleFromEye + 0.5 * scaleFromBox) : scaleFromEye;
  // [AR-DEBUG] 缩放上下限钳制：防极端距离下发型过大/过小
  const scale = _clamp(sizeRatio * coverageScale * scaleBoost, AR_TUNE.SCALE_MIN, AR_TUNE.SCALE_MAX);

  // 旋转：双眼倾角差（跟随头部左右倾斜 roll）
  const angle = Math.atan2(dR.y - dL.y, dR.x - dL.x) - Math.atan2(sR.y - sL.y, sR.x - sL.x);

  // —— 头部姿态（角度联动）——
  // yaw（左右转头）：鼻尖(30)到左右太阳穴(0/16)的横向不对称 → 转头时发型横向轻微压缩
  const nose = L[30];
  const dLx = Math.abs(nose.x - L[0].x), dRx = Math.abs(nose.x - L[16].x);
  const yaw = _clamp((dRx - dLx) / Math.max(1, (dLx + dRx)), -0.7, 0.7);
  // pitch（抬头/低头）：眉-鼻底 与 鼻底-下巴 高度比偏离正面 → 俯仰时纵向压缩
  const browMidY = Math.min(L[19].y, L[24].y);
  const noseBotY = L[33].y;
  const pitch = _clamp(((noseBotY - browMidY) - (jawChin.y - noseBotY)) / Math.max(1, (jawChin.y - browMidY)), -0.5, 0.5);
  const yawComp   = _clamp(1 - AR_TUNE.YAW_STRENGTH   * Math.abs(yaw),   0.80, 1.0);
  const pitchComp = _clamp(1 - AR_TUNE.PITCH_STRENGTH * Math.abs(pitch), 0.85, 1.0);

  const dM = { x: (dL.x + dR.x) / 2, y: (dL.y + dR.y) / 2 };
  const sM = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };

  // —— 人脸自动适配：按“脸宽/眼距”“脸长/眼距”“额头高度”做各向异性微调（宽脸加宽、长脸拉长、高额头拉高）——
  let fitX = 1, fitY = 1, foreheadMul = 1;
  if(meta.face){
    const a = computeAnchorsFromLandmarks(L);
    const jaw = L.slice(0, 17);
    let minX = Infinity, maxX = -Infinity;
    jaw.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
    const browTopY = Math.min(...L.slice(17, 27).map(p => p.y));
    const dFaceW = maxX - minX;                    // 顾客颧-颌最大宽
    const dFaceH = L[8].y - browTopY;              // 顾客眉-颏高
    const dForeheadH = dFaceH * AR_TUNE.HEADTOP_RATIO;  // 顾客额头高（按可调比例外推）
    const dTempleW = a ? a.templeW : dFaceW * 0.94;
    const wRatio = (dTempleW / dDist) / ((meta.face[2] / 1.06) / sDist);
    const hRatio = ((dFaceH * 1.22) / dDist) / (meta.face[3] / sDist);
    fitX = _clamp(wRatio, 0.86, 1.18);
    fitY = _clamp(hRatio, 0.86, 1.18);
    // 高额头补偿：顾客额头比素材高时，纵向上拉头发覆盖区
    const srcForeheadH = meta.h * AR_TUNE.HEADTOP_RATIO * (meta.face[3] / Math.max(1, meta.h));
    const fhRatio = dForeheadH / Math.max(1, srcForeheadH);
    foreheadMul = _clamp(fhRatio, 0.92, 1.15);
  }

  // 长短滑块（实时模式固定中性 0.5）
  const syMul = 0.92 + 0.5 * 0.18;

  // 手动微调
  const f = fit || {};
  const uScale = (f.scale != null && isFinite(f.scale)) ? _clamp(f.scale, 0.5, 1.8) : 1;
  const uDx = f.dx || 0, uDy = f.dy || 0, uRot = f.rot || 0;
  const finalScale = scale * uScale;

  // ④+++ 基础相似变换（双眼对齐 + 自动适配，暂不含手动偏移）
  // [AR-DEBUG] ④ 最终变换矩阵 T：dx/dy=平移(锚点位置)，sx/sy=缩放(含自适应scale+脸型fitX/fitY+俯仰)，angle=旋转(roll+yaw/pitch)。
  //   发型贴图即以 T 映射到画布：先平移到锚点→旋转→缩放→回退源锚点→绘制。
  const T = {
    dx: dM.x, dy: dM.y, angle: angle,
    sx: finalScale * fitX * yawComp,                 // 叠加 yaw 横向压缩
    sy: finalScale * fitY * syMul * foreheadMul * pitchComp, // 叠加 pitch 纵向压缩
    ox: sM.x, oy: sM.y
  };

  // —— 人头锚点自动对齐：以【顾客真实人头】为摆放基准（头顶 + 左右鬓角）——
  //    发顶锁到估算头顶(headTop)，中线锁到真实人头中线(headCx)，消除垂直过高/过低与左右脱离头部
  if(meta.box){
    const bx0 = meta.box[0], by0 = meta.box[1], bx1 = meta.box[2];
    const bcx = (bx0 + bx1) / 2;
    const hairTopY = T.dy + (by0 - T.oy) * T.sy;   // 变换后的发顶 Y
    const hairCx   = T.dx + (bcx - T.ox) * T.sx;   // 变换后的发型中线 X
    const a = computeAnchorsFromLandmarks(L);
    let targetTop, targetCx, refH, refW, full;
    if(a){
      refH = a.faceH; refW = a.faceW;
      // [AR-DEBUG] ③ 锚点锁定颅顶：targetTop 由预估颅顶点(a.headTop = 眉上外推) 决定，
      //   再叠加 VERTICAL_OFFSET / 每款 arDy → 发型落在头顶区域，不盖脸。
      targetTop = a.headTop - refH * AR_TUNE.BOX_PAD + AR_TUNE.VERTICAL_OFFSET + (meta.arDy != null ? meta.arDy : 0);
      targetCx  = a.headCx;                 // 真实人头中线（鬓角中点为主）
      full = 1;                             // 完全对齐，严格跟随人头
    }else{
      refH = canvasH * 0.30; refW = canvasW * 0.40;
      targetTop = canvasH * 0.16 - refH * AR_TUNE.BOX_PAD + AR_TUNE.VERTICAL_OFFSET + (meta.arDy != null ? meta.arDy : 0);
      targetCx  = canvasW / 2;
      full = 0.82;
    }
    T.dy += _clamp((targetTop - hairTopY) * full, -refH * 1.60, refH * 1.60);
    T.dx += _clamp((targetCx  - hairCx)  * full, -refW * 1.60, refW * 1.60);
    // 鬓角二次对位：把发型左右外缘按顾客鬓角连线做精修，消除单侧偏移
    if(a){
      const hairHalfW = ((bx1 - bx0) / 2) * T.sx;
      const wantHalfW = (a.templeW / 2) * AR_TUNE.TEMPLE_FACTOR * (1 + Math.max(0, (0.34 - coverage) * 0.7));
      const kw = _clamp(wantHalfW / Math.max(1, hairHalfW), 0.90, 1.12);
      if(Math.abs(kw - 1) > 0.01){
        T.sx *= kw;
        T.dx = targetCx - (bcx - T.ox) * T.sx;
      }
      // 头顶再锁一次（保证与 headTop 严格对齐）
      T.dy += (targetTop - (T.dy + (by0 - T.oy) * T.sy));
    }
  }

  // 手动微调（上下偏移 / 左右偏移 / 旋转）叠加在自动贴合之上。
  //   ★ meta.arDx 为每款发型单独的横向偏移覆盖（与 UI“左右”滑块、AR_TUNE 叠加）
  T.dx += uDx + (meta.arDx != null ? meta.arDx : 0);
  T.dy += uDy;
  T.angle += uRot;

  T.valid = isFinite(dDist) && dDist > 10 && scale > 0.1 && scale < 8
            && isFinite(T.dx) && isFinite(T.dy) && isFinite(T.sx) && isFinite(T.sy);
  return T;
}

// 双阶滤波·第二阶：对发型变换参数(dx/dy/sx/sy/angle)再做一次指数平滑，
// 抑制“人物轻微晃动时发型忽大忽小、剧烈抖动”。首帧/重置时直接吸附。
let _hairTSmooth = null;
const _T_SMOOTH = 0.30;   // 越小越稳（抗抖动），越大越跟手
function resetHairSmoothing(){ _hairTSmooth = null; }
// [AR-DEBUG] ⑥ 双阶滤波·第二阶：对变换参数(dx/dy/sx/sy/angle)再做指数平滑，
//   抑制“人物轻微晃动时发型忽大忽小、剧烈漂移”。首帧/重置时直接吸附。
function smoothTransform(T){
  if(!T) return null;
  if(!_hairTSmooth){
    _hairTSmooth = { dx:T.dx, dy:T.dy, sx:T.sx, sy:T.sy, angle:T.angle, valid:T.valid };
    return _hairTSmooth;
  }
  const a = _T_SMOOTH;
  _hairTSmooth.dx    += (T.dx    - _hairTSmooth.dx)    * a;
  _hairTSmooth.dy    += (T.dy    - _hairTSmooth.dy)    * a;
  _hairTSmooth.sx    += (T.sx    - _hairTSmooth.sx)    * a;
  _hairTSmooth.sy    += (T.sy    - _hairTSmooth.sy)    * a;
  _hairTSmooth.angle += (T.angle - _hairTSmooth.angle) * a;
  _hairTSmooth.valid  = T.valid;
  return _hairTSmooth;
}

// 实时 AR 渲染：将发型 PNG 叠加到视频帧上
function renderRealtimeAR(canvas, opts){
  // opts: { video, landmarks, box, hairImg, hairMeta, colorId, texture, fit }
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if(!opts.video) return;
  const vw = opts.video.videoWidth || W;
  const vh = opts.video.videoHeight || H;
  // ① 进入镜像上下文：视频与发型都在同一镜像空间绘制 → 左右严格对齐，消除左右翻转错位
  ctx.save();
  ctx.translate(W, 0); ctx.scale(-1, 1);
  // 视频帧（按画布比例拉伸铺满）
  ctx.drawImage(opts.video, 0, 0, vw, vh, 0, 0, W, H);
  // ② 有发型且有关键点 → 叠加发型贴图（landmarks 为视频原生坐标，buildRealtimeTransform 内部映射到画布坐标）
  if(opts.landmarks && opts.hairImg && opts.hairMeta){
    // [AR-DEBUG] ⑦ 第一阶：关键点/包围盒已在 app.js 平滑；此处算出原始变换 T0。
    const T0 = buildRealtimeTransform(opts.landmarks, opts.hairMeta, W, H, opts.fit, vw, vh, opts.box);
    // [AR-DEBUG] ⑧ 第二阶：对变换参数再做指数平滑 → 消除忽大忽小/剧烈抖动。
    const T = (T0 && T0.valid) ? smoothTransform(T0) : null;
    if(T){
      const sprite = buildHairSprite(opts.hairImg, opts.hairMeta, opts.colorId, opts.texture, 'realtime|'+opts.hairImg.src, 2.5);
      const op = (opts.fit && opts.fit.opacity != null && isFinite(opts.fit.opacity)) ? _clamp(opts.fit.opacity, 0.2, 1) : 1;
      ctx.globalAlpha = op;
      // [AR-DEBUG] ⑨ 发型最终绘制：以 T 把发型 PNG(原点在左上) 映射到画布锚点。若发型偏大/偏小/偏位，
      //   优先调 AR_TUNE.SCALE_BOOST / VERTICAL_OFFSET / TEMPLE_FACTOR 或对应款式 arScale/arDy/arDx。
      ctx.translate(T.dx, T.dy);
      ctx.rotate(T.angle);
      ctx.scale(T.sx, T.sy);
      ctx.translate(-T.ox, -T.oy);
      ctx.drawImage(sprite, 0, 0, opts.hairMeta.w, opts.hairMeta.h);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
