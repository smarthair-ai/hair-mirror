/* =========================================================================
 * app.js — 交互逻辑：采集 / 分析 / 渲染 / 推荐 / 收藏 / 筛选 / 截图
 * ========================================================================= */
(function(){
  'use strict';

  // 构建版本戳：每次部署更新此值，便于确认线上是否为最新版（见页面右下角徽标）
  const BUILD_VERSION = '2026-08-01T16:10+08:00 · AR-v2.3 · 修复摄像预览框固定显示';
  window.__SMARTHAIR_BUILD__ = BUILD_VERSION;
  console.log('%c[SmartHair AI] AR build ' + BUILD_VERSION, 'color:#6c8cff;font-weight:bold');

  /* 启动时应用 localStorage 中保存的发型素材覆盖项（规格一·调试面板「保存」）。
   * 在 render.js 的 normalizeHairMeta 之后写入，因此会覆盖组预设/默认派生值，整次会话持续生效。
   * 新旧字段名双向兼容：新 anchorX/anchorY/scaleBase/rotFix ↔ 旧 hairAnchorX/hairAnchorY/hairScale/rotationOffset。 */
  const _OVR_ALIAS = { anchorX:'hairAnchorX', anchorY:'hairAnchorY', scaleBase:'hairScale', rotFix:'rotationOffset' };
  function applyHairMetaOverrides(){
    try{
      const raw = localStorage.getItem('smarthair_hairmeta_overrides');
      if(!raw || typeof HAIR_META !== 'object') return;
      const map = JSON.parse(raw);
      let n = 0;
      for(const id in map){
        const m = HAIR_META[id];
        if(!m) continue;
        const o = map[id] || {};
        // ① 新字段名（含旧名回落）→ 同时写入新旧两侧
        for(const nk in _OVR_ALIAS){
          const ok = _OVR_ALIAS[nk];
          const v = (o[nk] != null && isFinite(o[nk])) ? +o[nk] : ((o[ok] != null && isFinite(o[ok])) ? +o[ok] : null);
          if(v != null){ m[nk] = v; m[ok] = v; }
        }
        // ② 无别名的字段
        ['offsetX','offsetY'].forEach(k=>{ if(o[k] != null && isFinite(o[k])) m[k] = +o[k]; });
        n++;
      }
      if(n) console.log('[AR] 已应用本地发型素材覆盖项：', n, '款');
    }catch(e){ /* 覆盖项损坏不影响主流程 */ }
  }
  applyHairMetaOverrides();

  const $ = id => document.getElementById(id);
  const STATE = {
    mode: 'camera',
    page: 'studio',       // 当前页面：studio/library/popular/season/archive
    metrics: { faceShape:'鹅蛋脸', skinTone:'neutral', skinColor:'#e8c9a8', currentLength:'medium', preferEasy:false, gender:'female', hasDetection:false,
               hairType:'normal', styleTime:'normal', acceptPerm:true },
    // 默认选中款：取发型库第一条真实存在的 id（历史上写死 1，但 data.js 无 id=1，
    // 会去请求不存在的 img/hair/s01.png 而报 404）
    selectedStyleId: (typeof HAIRSTYLES !== 'undefined' && HAIRSTYLES.length) ? HAIRSTYLES[0].id : 2,
    compareId: null,      // 对比款 B 的发型 id
    compareOn: false,     // 双方案对比开关
    view: 'front',
    colorId: 'coolbrown',
    texture: 'glossy',
    lighting: 'indoor',
    lengthSlider: 0.5,
    curlSlider: 0.5,
    favorites: loadFavs(),
    filterTag: 'all',
    seasonKey: 'spring',  // 当前季节专题
    origCanvasEl: null,   // 拍照/上传得到的原图（离屏 canvas，720×880）
    faceLandmarks: null,  // 68 关键点（与 origCanvasEl 同坐标系）
    tryOn: true,          // 真人试发开关
    sideOn: true,          // 原图-效果图并排开关
    fit: { scale:1, dx:0, dy:0, rot:0, opacity:1 }, // 手动贴合微调：缩放/左右偏移/上下偏移/旋转(弧度)/透明度
  };

  /* ---------- 自动检测状态 ---------- */
  const autoDetect = {
    active: false,          // 是否启用自动检测
    timer: null,            // setInterval 句柄
    lastResult: null,       // 上一次检测结果 { faceShape, skinTone, gender }
    stableCount: 0,         // 连续相同结果计数
    STABLE_THRESHOLD: 2,    // 需要连续多少次相同才触发
    cooldownUntil: 0,       // 冷却期结束时间戳 (Date.now())
    COOLDOWN_MS: 3000,      // 冷却3秒
    detected: false,        // 是否已成功检测并触发分析
  };

  /* ---------- 工具 ---------- */
  function loadFavs(){ try{ const ids=JSON.parse(localStorage.getItem('hairFavs')||'[]'); return ids.filter(id=>HAIRSTYLES.some(s=>s.id===id)); }catch(e){ return []; } }
  function saveFavs(){ localStorage.setItem('hairFavs', JSON.stringify(STATE.favorites)); }
  function makeCanvas(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; }
  function drawCover(ctx,img,cw,ch){
    const ir=(img.width||img.naturalWidth)/(img.height||img.naturalHeight), cr=cw/ch;
    let sw,sh,sx,sy;
    if(ir>cr){ sh=img.height||img.naturalHeight; sw=sh*cr; sx=((img.width||img.naturalWidth)-sw)/2; sy=0; }
    else { sw=img.width||img.naturalWidth; sh=sw/cr; sx=0; sy=((img.height||img.naturalHeight)-sh)/2; }
    ctx.drawImage(img,sx,sy,sw,sh,0,0,cw,ch);
  }

  function currentOpts(styleId, view){
    return {
      style: getStyleById(styleId || STATE.selectedStyleId),
      metrics: STATE.metrics,
      view: view || STATE.view,
      colorId: STATE.colorId,
      texture: STATE.texture,
      lighting: STATE.lighting,
      length: STATE.lengthSlider,
      curl: STATE.curlSlider
    };
  }

  // 真人试发是否可用（有照片即可；front 视角贴照片，其他视角回退模型）
  function tryOnAvailable(){ return !!STATE.origCanvasEl; }

  /* ---------- 收集表真发素材（AI 抠发 PNG + 眼睛锚点） ---------- */
  const HAIR_IMG_CACHE = {};   // styleId -> {img, loaded, failed}
  const HAIR_COVERAGE_MIN = 0.05; // 覆盖率低于 5% 视为素材不足，用绘制版兜底
  function photoHairMeta(id){
    return (typeof HAIR_META !== 'undefined' && HAIR_META) ? (HAIR_META[id] || HAIR_META[String(id)] || null) : null;
  }
  function metaUsable(meta){
    return !!(meta && meta.eyeL && meta.eyeR && (meta.coverage == null || meta.coverage >= HAIR_COVERAGE_MIN));
  }
  function getHairImg(id){
    let rec = HAIR_IMG_CACHE[id];
    if(rec) return rec;
    rec = HAIR_IMG_CACHE[id] = { img:new Image(), loaded:false, failed:false };
    rec.img.onload = ()=>{ rec.loaded = true; renderEffect(); };
    rec.img.onerror = ()=>{ rec.failed = true; renderEffect(); };
    rec.img.src = 'img/hair/s' + String(id).padStart(2,'0') + '.png';
    return rec;
  }
  function preloadAllHairImgs(){
    // 页面加载时静默预加载全部真发 PNG，保证点击即现
    // 遍历实际发型 id（非连续整数），避免请求不存在的文件
    HAIRSTYLES.forEach(s=>{
      const meta = photoHairMeta(s.id);
      if(metaUsable(meta)) getHairImg(s.id);
    });
  }

  // 把单款发型画到指定画布（A 或 B），复用同一套试戴/绘制逻辑
  function paintOne(canvas, styleId){
    const useTryOn = STATE.tryOn && tryOnAvailable() && STATE.view === 'front';
    if(useTryOn){
      const meta = photoHairMeta(styleId);
      const rec = metaUsable(meta) ? getHairImg(styleId) : null;
      if(meta && rec && rec.loaded && !rec.failed){
        renderPhotoTryOn(canvas, Object.assign(currentOpts(styleId), {
          photo: STATE.origCanvasEl, landmarks: STATE.faceLandmarks,
          hairImg: rec.img, hairMeta: meta, fit: STATE.fit
        }));
      }else{
        renderTryOn(canvas, Object.assign(currentOpts(styleId), {
          photo: STATE.origCanvasEl, landmarks: STATE.faceLandmarks, fit: STATE.fit
        }));
      }
    }else{
      renderScene(canvas, currentOpts(styleId));
    }
  }

  // 统一试戴画布：实时视频模式由 _rtTick 每帧绘制，其余模式在此静态绘制到 realtimeCanvas
  function renderEffect(){
    const stA = getStyleById(STATE.selectedStyleId);
    $('curStyleName').textContent = stA ? stA.name : '—';
    const live = STATE.mode==='camera' && camReady && stream && !STATE.origCanvasEl;
    if(!live) renderTryOnCanvas();
  }

  // 把当前发型绘制到唯一的 realtimeCanvas（照片模式 / 手动模式）
  function renderTryOnCanvas(){
    const rc = $('realtimeCanvas'); if(!rc) return;
    if(STATE.origCanvasEl){
      // 照片试戴：用真发抠图素材叠加
      const meta = photoHairMeta(STATE.selectedStyleId);
      const rec = metaUsable(meta) ? getHairImg(STATE.selectedStyleId) : null;
      if(meta && rec && rec.loaded && !rec.failed && STATE.tryOn){
        renderPhotoTryOn(rc, Object.assign(currentOpts(), {
          photo: STATE.origCanvasEl, landmarks: STATE.faceLandmarks,
          hairImg: rec.img, hairMeta: meta, fit: STATE.fit }));
      } else {
        const ctx = rc.getContext('2d'); ctx.clearRect(0,0,rc.width,rc.height);
        drawCover(ctx, STATE.origCanvasEl, rc.width, rc.height);
        if(!(meta && rec && rec.loaded && !rec.failed)){
          ctx.fillStyle='rgba(0,0,0,.45)'; ctx.fillRect(0,0,rc.width,rc.height);
          ctx.fillStyle='#fff'; ctx.font='22px sans-serif'; ctx.textAlign='center';
          ctx.fillText('该款暂无贴图素材', rc.width/2, rc.height/2);
        }
      }
      return;
    }
    // 手动 / 无照片：参数化模型预览
    renderScene(rc, currentOpts());
  }

  // 原图-效果图并排显隐（已移除双预览画布，保留为安全空函数）
  function syncPreviewLayout(){}

  // 原图预览（已移除 origView 画布，保留为安全空函数）
  function renderOrigView(){}

  function renderThumb(canvas, style, colorId){
    renderScene(canvas, { style, metrics:STATE.metrics, view:'front',
      colorId: colorId || style.suitableColors[0] || 'coolbrown',
      texture:'glossy', lighting:'indoor', length:0.5, curl:0.5 });
  }

  function createRealThumb(style, colorId, cls){
    const img = document.createElement('img');
    img.className = cls || 'real-thumb';
    img.alt = style.name;
    img.src = style.img || '';
    img.loading = 'lazy';
    img.onerror = function(){
      this.onerror=null;
      const cvs=makeCanvas(280, 340); cvs.className=this.className;
      this.replaceWith(cvs); renderThumb(cvs, style, colorId);
    };
    return img;
  }

  function updateRealRef(){} // 真人参考图已移除，保留安全空函数

  /* ---------- 发色 UI ---------- */
  function colorName(id){
    if(id==='original') return '原发色';
    const c=getColorById(id); return c?c.name:'—';
  }
  function buildColors(){
    const box = $('colorBox'); box.innerHTML='';
    // 「原发色」：真发试戴时保留照片原本发色，最真实
    const od=document.createElement('div');
    od.className='swatch'+(STATE.colorId==='original'?' active':'');
    od.style.background='conic-gradient(#2a221e,#5a4634,#8a6a4f,#2a221e)';
    od.title='原发色（照片原色）'; od.dataset.id='original';
    od.onclick=()=>setColor('original');
    box.appendChild(od);
    HAIR_COLORS.forEach(c=>{
      const d=document.createElement('div');
      d.className='swatch'+(c.id===STATE.colorId?' active':'');
      d.style.background=c.swatch; d.title=c.name; d.dataset.id=c.id;
      d.onclick=()=>setColor(c.id);
      box.appendChild(d);
    });
    // 细分色标记
    document.querySelectorAll('.qc').forEach(b=>{
      b.classList.toggle('active', b.dataset.c===STATE.colorId);
    });
  }
  function setColor(id){
    STATE.colorId=id;
    document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active', s.dataset.id===id));
    document.querySelectorAll('.qc').forEach(b=>b.classList.toggle('active', b.dataset.c===id));
    renderEffect();
  }

  /* ---------- 性别 UI ---------- */
  // 同步性别识别结果到面部分析区和手动下拉框
  function syncGenderUI(){
    const g = STATE.metrics.gender || 'female';
    const conf = STATE.metrics.genderConfidence || 0;
    const method = STATE.metrics.genderMethod || '';
    // 同步手动下拉框
    $('manGender').value = g;
    // 面部分析区的性别标签
    const label = $('genderLabel');
    if(label){
      const txt = {female:'♀ 女',male:'♂ 男',all:'不限'}[g]||'—';
      const pct = Math.round(conf * 100);
      const src = method === 'landmark' ? 'AI识别' : (STATE.metrics.hasDetection ? 'AI识别' : '手动选择');
      label.textContent = txt + (conf > 0 ? ' · ' + pct + '%' : '') + ' · ' + src;
      label.className = 'm-tag gender-tag' + (g === 'male' ? ' male' : g === 'female' ? ' female' : '');
    }
  }
  // 手动切换性别（当 AI 识别不准时）
  function switchGender(g){
    STATE.metrics.gender = g;
    STATE.metrics.genderMethod = 'manual';
    STATE.metrics.genderConfidence = 0;
    // 若当前发型不属于新性别池，自动切换到新池第一款
    const pool = stylesForGender(g);
    const curInPool = pool.some(s => s.id === STATE.selectedStyleId);
    if(!curInPool && pool.length > 0){
      STATE.selectedStyleId = pool[0].id;
      STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1};
      syncFitUI();
    }
    syncGenderUI();
    $('manGender').value = g;
    if(STATE.compareOn){ ensureCompareId(); buildCompareSelect(); }
    displayMetrics(); renderEffect(); refreshRecommend(); refreshPlans(); renderAllStyles(); updateAllActive();
    setStatus('已手动切换性别为：'+({female:'女',male:'男',all:'不限'}[g]||'')+'。发型推荐已按新性别重新匹配。');
  }

  /* ---------- 分析指标展示（右侧面板 Block1：脸型实时数据分析，6 项指标 + 进度条） ---------- */
  function displayMetrics(){
    const m = STATE.metrics; const box = $('metricsBox');
    if(!m){ box.innerHTML = '<span class="m-tag">尚未分析</span>'; return; }
    const toneTxt = {warm:'暖调',cool:'冷调',neutral:'中性'}[m.skinTone]||'—';
    const gTagCls = m.gender==='male'?' male':m.gender==='female'?' female':'';
    const gMethod = (m.genderMethod==='landmark'||m.hasDetection)?'AI识别':'手动选择';
    const gConf = m.genderConfidence ? (' · '+Math.round(m.genderConfidence*100)+'%') : '';

    let html = `<div class="fa-head">
        <span class="fa-shape">${m.faceShape||'—'}</span>
        <span class="fa-meta-tags">
          <span class="m-tag">肤色 ${toneTxt}</span>
          <span class="m-tag gender-tag${gTagCls}">${{female:'♀ 女',male:'♂ 男',all:'不限'}[m.gender]||'—'}${gConf} · ${gMethod}</span>
        </span>
      </div>
      <div class="gender-switch-row">
        <button class="ghost sm gender-switch" onclick="switchGender('female')">♀ 女</button>
        <button class="ghost sm gender-switch" onclick="switchGender('male')">♂ 男</button>
        <button class="ghost sm gender-switch" onclick="switchGender('all')">不限</button>
      </div>`;

    if(m.hasDetection && m.metrics){
      const mt = m.metrics;
      const fl = Math.max(1, mt.faceLength || mt.faceWidth || 1);
      const pct = (v,lo,hi)=>Math.round(Math.min(1,Math.max(0,(v-lo)/(hi-lo)))*100);
      html += `<div class="fa-metrics">
        ${faRow('脸长 / 脸宽比值', pct(mt.LWR,1.1,1.7), mt.LWR)}
        ${faRow('额宽', pct(mt.foreheadWidth/fl,0.5,0.85), mt.foreheadWidth+' px')}
        ${faRow('颧宽', pct(mt.cheekWidth/fl,0.55,0.95), mt.cheekWidth+' px')}
        ${faRow('下颌宽 / 颧宽比值', pct(mt.jawCheekRatio,0.65,0.98), mt.jawCheekRatio)}
        ${faRow('下巴尖锐角度', pct(mt.chinAngle,40,95), mt.chinAngle+'° <i class="fa-q">'+chinQual(mt.chinAngle)+'</i>')}
      </div>`;
      html += `<p class="fa-advice">${faceShapeAdvice(m.faceShape)}</p>`;
    } else {
      html += `<p class="hint">（手动 / 收集表模式）结合脸型与肤色为你匹配发型、发长与发色；点「重新检测」可启用实时 AI 分析。</p>`;
    }
    html += `<span class="m-tag" style="background:#f0f4ff;">发质：${quizText()}</span>`;
    box.innerHTML = html;
  }
  // 单条指标：标签 + 进度条 + 数值
  function faRow(label, pct, val){
    return `<div class="fa-metric">
        <div class="fa-mlabel">${label}</div>
        <div class="fa-bar"><span class="fa-fill" style="width:${Math.max(0,Math.min(100,pct))}%"></span></div>
        <div class="fa-val">${val}</div>
      </div>`;
  }
  // 下巴角度定性：越小越尖
  function chinQual(a){ return a<55?'尖锐':a>72?'圆润':'标准'; }
  // 脸型 → 简短适配建议（随识别脸型动态变化）
  function faceShapeAdvice(shape){
    const map = {
      '鹅蛋脸':'鹅蛋脸比例均衡，多数发型都适搭；可尝试中长微卷或锁骨发，凸显脸型优势。',
      '圆脸':'圆脸建议增加头顶蓬松度与两侧层次，避免齐厚刘海，拉长视觉比例。',
      '方脸':'方脸适合柔和曲线，推荐带弧度的中长发或微卷，柔化下颌线条。',
      '长脸':'长脸宜用刘海缩短中庭、两侧加宽，避免过贴的高马尾。',
      '心形脸':'心形脸额头偏宽，可用八字刘海修饰，发尾内扣更显精致。',
      '菱形脸':'菱形脸颧骨突出，建议蓬松刘海与两侧遮颧，平衡轮廓。'
    };
    return map[shape] || '已为你匹配适配发型，可左右拖动微调贴合度。';
  }

  /* ---------- 推荐 / 方案 ---------- */
  function diffClass(lv){ return 'diff l'+Math.min(5,Math.max(1,Math.ceil(lv))); }
  function diffText(lv){ return ['','低','低','中','中高','高'][Math.min(5,Math.max(1,Math.ceil(lv)))]; }

  function buildRecCards(list, container, showScore){
    container.innerHTML='';
    list.forEach(item=>{
      const st = item.style; const score = showScore?item.score:null;
      const card=document.createElement('div'); card.className='style-card';
      const thumb = createRealThumb(st, null, 'thumb'); card.appendChild(thumb);
      const body=document.createElement('div'); body.className='body';
      body.innerHTML=`<div class="nm">${st.name}${score!=null?` · 匹配${score}`:''}</div>
        <div class="meta">${st.feature}｜难度<span class="${diffClass(st.difficulty)}">${st.difficultyLabel}</span><br>修饰：${st.modifies}</div>
        <div class="scene">适用场景：${styleScene(st.id)}</div>
        <div class="home-tip">🏠 居家打理：${styleHomeTip(st.id)}</div>
        <div class="avoid-mini">⚠ ${styleAvoid(st.id)}</div>
        <div class="tags">${st.styleTags.map(t=>`<span class="chip">${t}</span>`).join('')}</div>
        <div class="acts">
          <button class="use">应用</button>
          <button class="fav">${STATE.favorites.includes(st.id)?'★':'☆'}</button>
        </div>`;
      card.appendChild(body);
      container.appendChild(card);
      body.querySelector('.use').onclick=()=>{ applyStyle(st.id); };
      body.querySelector('.fav').onclick=(e)=>{ toggleFav(st.id); e.target.textContent=STATE.favorites.includes(st.id)?'★':'☆'; };
    });
  }

  function applyStyle(id){
    STATE.selectedStyleId=id;
    const st=getStyleById(id);
    // 切换发型时重置手动微调——每次都从自动贴合的基准位置开始
    STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1};
    syncFitUI();
    // 真发试戴可用时默认「原发色」最真实；否则用推荐发色
    if(STATE.tryOn && tryOnAvailable() && metaUsable(photoHairMeta(id))) setColor('original');
    else if(st.suitableColors && st.suitableColors[0]) setColor(st.suitableColors[0]);
    // 从其他页面点选发型时回到工作台
    if(STATE.page !== 'studio') switchPage('studio');
    renderEffect();
    updateRecCardsActive();
    updateAllActive();
    updateRecStripActive();
  }

  // 右侧推荐条（原 recStrip 已合并为 3 张推荐卡片，保留为安全空函数）
  function renderRecStrip(){
    const items = $('recStripItems'); if(!items) return;
    const rec = recommendStyles(STATE.metrics, 3); // top3
    if(!rec.length){ const s=$('recStrip'); if(s) s.hidden=true; return; }
    items.innerHTML='';
    rec.forEach((r)=>{
      const st = r.style;
      const el = document.createElement('div');
      el.className='rec-strip-item'+(st.id===STATE.selectedStyleId?' active':'');
      el.dataset.id=st.id;
      el.innerHTML=`<img class="rec-thumb" src="${st.img}" alt="${st.name}"><div class="rec-score">匹配 ${r.score} 分</div><div class="rec-name">${st.name}</div>`;
      el.onclick = ()=>{ applyStyle(st.id); };
      items.appendChild(el);
    });
    const s=$('recStrip'); if(s) s.hidden=false;
  }
  function updateRecStripActive(){
    const items = document.querySelectorAll('.rec-strip-item');
    items.forEach(el=>el.classList.toggle('active', parseInt(el.dataset.id,10)===STATE.selectedStyleId));
  }
  function clearRecStrip(){
    const strip=$('recStrip'); if(strip) strip.hidden=true;
    const items=$('recStripItems'); if(items) items.innerHTML='';
  }

  // 右侧：为你推荐 3 张卡片（系统匹配），点选即切换左侧实时试戴
  function renderRecCards(){
    const box = $('recCards'); if(!box) return;
    const recs = recommendStyles(STATE.metrics, 3);
    const tags = ['日常百搭','大胆改变','个性专属'];
    box.innerHTML='';
    recs.forEach((r,i)=>{
      const st = r.style;
      const card=document.createElement('div');
      card.className='rec-card'+(st.id===STATE.selectedStyleId?' active':'');
      card.dataset.id=st.id;
      const badge=document.createElement('div'); badge.className='rc-badge'; badge.textContent=tags[i]||'推荐'; card.appendChild(badge);
      card.appendChild(createRealThumb(st, null, 'rc-thumb'));
      const body=document.createElement('div'); body.className='rc-body';
      const nm=document.createElement('div'); nm.className='rc-name'; nm.textContent=st.name; body.appendChild(nm);
      const mt=document.createElement('div'); mt.className='rc-meta'; mt.textContent=(st.sceneTags&&st.sceneTags[0])||''; body.appendChild(mt);
      card.appendChild(body);
      card.onclick=()=>applyStyle(st.id);
      box.appendChild(card);
    });
  }
  function updateRecCardsActive(){
    document.querySelectorAll('#recCards .rec-card').forEach(el=>{
      el.classList.toggle('active', parseInt(el.dataset.id,10)===STATE.selectedStyleId);
    });
  }

  function refreshRecommend(){
    renderRecCards();
  }

  function refreshPlans(){
    const plans = generatePlans(STATE.metrics);
    const box=$('planBox'); box.innerHTML='';
    const defs=[
      {key:'daily', cls:'daily', title:'日常百搭款', note:`匹配你的「${STATE.metrics.faceShape}」，难度${plans.daily.difficultyLabel}，通勤简约好打理。`},
      {key:'bold',  cls:'bold',  title:'改变大款',  note:`与当前发长形成反差，风格更鲜明，适合想大变样的你。`},
      {key:'safe',  cls:'safe',  title:'保守稳妥款',note:`贴近当前发长、难度${plans.safe.difficultyLabel}，改动小更稳妥。`}
    ];
    defs.forEach(d=>{
      const st=plans[d.key];
      const el=document.createElement('div'); el.className='plan '+d.cls;
      el.innerHTML=`<div class="ph">${d.title}</div>`;
      const thumb = createRealThumb(st, st.suitableColors[0]||'coolbrown', 'real-thumb'); el.appendChild(thumb);
      const pb=document.createElement('div'); pb.className='pb';
      pb.innerHTML=`<b>${st.name}</b><br>建议发长：${({short:'短发',medium:'中长',long:'长发'})[st.length]}｜发色：${getColorById(st.suitableColors[0]||'coolbrown').name}<br>适用场景：${styleScene(st.id)}<br>${d.note}<br>沙龙打理：${st.careTip}<br>🏠 居家贴士：${styleHomeTip(st.id)}<div class="avoid">${styleAvoid(st.id)}</div>`;
      el.appendChild(pb);
      box.appendChild(el);
      el.style.cursor='pointer';
      el.onclick=()=>applyStyle(st.id);
    });
    // 同步刷新右侧 3 张推荐卡片
    renderRecCards();
  }

  /* ---------- 页面切换（试戴/发型库/热门/季节/存档） ---------- */
  function switchPage(page){
    STATE.page = page;
    document.querySelectorAll('.navtab').forEach(t=>t.classList.toggle('active', t.dataset.page===page));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    const el = $('page-'+page); if(el) el.classList.add('active');
    if(page==='popular') renderPopular();
    if(page==='season') renderSeason();
    if(page==='archive') renderArchive();
    if(page==='library') renderAllStyles();
    window.scrollTo({top:0, behavior:'smooth'});
  }

  /* ---------- 发质问卷 ---------- */
  function readQuiz(){
    const pick = (grpId)=>{ const b=document.querySelector('#'+grpId+' .seg.active'); return b?b.dataset.v:null; };
    STATE.metrics.hairType = pick('qHairType') || 'normal';
    STATE.metrics.styleTime = pick('qStyleTime') || 'normal';
    STATE.metrics.acceptPerm = (pick('qPerm') || 'yes') === 'yes';
  }
  function applyQuiz(){
    readQuiz();
    refreshRecommend(); refreshPlans();
    setStatus('已结合发质问卷（'+quizText()+'）重新生成方案。');
    const pb=document.getElementById('planBox'); if(pb) pb.scrollIntoView({behavior:'smooth', block:'start'});
  }

  /* ---------- 双方案对比 ---------- */
  function ensureCompareId(){
    if(STATE.compareId && STATE.compareId!==STATE.selectedStyleId) return;
    // 默认选一个与当前不同的发型（同性别池优先）
    const pool = stylesForGender(STATE.metrics.gender);
    const cand = pool.find(s=>s.id!==STATE.selectedStyleId) || HAIRSTYLES.find(s=>s.id!==STATE.selectedStyleId);
    STATE.compareId = cand ? cand.id : STATE.selectedStyleId;
  }
  function buildCompareSelect(){
    const sel=$('cmpSelect'); if(!sel) return; sel.innerHTML='';
    stylesForGender(STATE.metrics.gender).forEach(s=>{
      const o=document.createElement('option'); o.value=s.id; o.textContent=s.name;
      if(s.id===STATE.compareId) o.selected=true; sel.appendChild(o);
    });
  }
  function setCompare(on){
    STATE.compareOn=on;
    document.querySelector('.page-studio').classList.toggle('cmp', on);
    $('effectFigB').hidden = !on;
    $('cmpBar').hidden = !on;
    if(on){ ensureCompareId(); buildCompareSelect(); }
    renderEffect();
  }

  /* ---------- 本店热门榜单 ---------- */
  function renderPopular(){
    const box=$('popularBox'); if(!box) return; box.innerHTML='';
    const ranked = popularRanking(STATE.metrics.gender);
    ranked.forEach((r,i)=>{
      const st=r.style;
      const item=document.createElement('div'); item.className='rank-item';
      const thumb=createRealThumb(st, null, 'rank-thumb');
      item.innerHTML=`<div class="rank-no">${i+1}</div>`;
      item.appendChild(thumb);
      const info=document.createElement('div'); info.className='rank-info';
      info.innerHTML=`<div class="nm">${st.name}</div>
        <div class="meta">${st.feature}｜难度 ${st.difficultyLabel}｜${styleScene(st.id)}</div>
        <div class="heat-bar"><div class="heat-fill" style="width:${r.heat}%"></div></div>
        <div class="heat-val">🔥 人气 ${r.heat}</div>`;
      item.appendChild(info);
      item.onclick=()=>applyStyle(st.id);
      box.appendChild(item);
    });
  }

  /* ---------- 季节发型专题 ---------- */
  function renderSeason(){
    const s=SEASON_MAP[STATE.seasonKey]; if(!s) return;
    const head=$('seasonHead');
    head.innerHTML=`<div class="st-title">${s.icon} ${s.name}</div><div class="st-desc">${s.desc}</div>`;
    const box=$('seasonBox'); box.innerHTML='';
    seasonStyles(STATE.seasonKey).forEach(st=>{
      const card=document.createElement('div'); card.className='style-card';
      const thumb=createRealThumb(st, null, 'thumb'); card.appendChild(thumb);
      const body=document.createElement('div'); body.className='body';
      body.innerHTML=`<div class="nm">${st.name}</div>
        <div class="meta">${st.feature}｜难度<span class="${diffClass(st.difficulty)}">${st.difficultyLabel}</span></div>
        <div class="scene">适用场景：${styleScene(st.id)}</div>
        <div class="avoid-mini">⚠ ${styleAvoid(st.id)}</div>
        <div class="tags">${st.styleTags.map(t=>`<span class="chip">${t}</span>`).join('')}</div>
        <div class="acts"><button class="use">试戴</button><button class="fav">${STATE.favorites.includes(st.id)?'★':'☆'}</button></div>`;
      card.appendChild(body); box.appendChild(card);
      body.querySelector('.use').onclick=()=>applyStyle(st.id);
      body.querySelector('.fav').onclick=(e)=>{ toggleFav(st.id); e.target.textContent=STATE.favorites.includes(st.id)?'★':'☆'; };
    });
  }

  /* ---------- 方案存档（后端 / 本地降级） ---------- */
  async function archiveCurrent(){
    const st=getStyleById(STATE.selectedStyleId); if(!st) return;
    const plan={
      customer:'', faceShape:STATE.metrics.faceShape, skinTone:STATE.metrics.skinTone,
      gender:STATE.metrics.gender, styleId:st.id, styleName:st.name,
      colorName:colorName(STATE.colorId),
      length:({short:'短发',medium:'中长',long:'长发'})[st.length]||st.length,
      scene:styleScene(st.id), cutKey:styleCutKey(st.id), careTip:st.careTip,
      homeTip:styleHomeTip(st.id), avoidTip:styleAvoid(st.id),
      quiz:{hairType:STATE.metrics.hairType, styleTime:STATE.metrics.styleTime, acceptPerm:STATE.metrics.acceptPerm},
      note:''
    };
    setStatus('正在存档…');
    const res=await PlanStore.save(plan);
    const where = res.source==='backend' ? '后端数据库' : '本机（后端不可用，已降级本地）';
    setStatus('✓ 方案已存档到'+where+'（'+st.name+'）。可在「方案存档」查看。');
  }
  async function renderArchive(){
    const box=$('archiveBox'); const st=$('archStatus');
    box.innerHTML='<p class="hint">加载中…</p>';
    const {plans, source}=await PlanStore.list();
    st.textContent = source==='backend' ? '· 来自后端数据库' : '· 后端不可用，显示本机存档';
    if(!plans.length){ box.innerHTML='<p class="hint">还没有存档。在工作台选好方案后点「🗂 存档本方案」。</p>'; return; }
    box.innerHTML='';
    plans.forEach(p=>{
      const gt={female:'女',male:'男',all:'不限'}[p.gender]||'';
      const to={warm:'暖调',cool:'冷调',neutral:'中性'}[p.skin_tone]||p.skin_tone||'';
      const item=document.createElement('div'); item.className='arch-item';
      item.innerHTML=`<div class="at">${p.style_name||'—'} <span class="mini-note">#${p.id}</span></div>
        <div class="ad">脸型 ${p.face_shape||'—'}｜肤色 ${to}｜性别 ${gt}<br>
        发色：${p.color_name||'—'}｜发长：${p.length||'—'}<br>
        ✂ ${p.cut_key||'—'}<br>
        ⚠ ${p.avoid_tip||'—'}<br>
        <span class="mini-note">${p.created_at||''}</span></div>
        <div class="aacts"><button class="load">回工作台试戴</button><button class="del">删除</button></div>`;
      box.appendChild(item);
      item.querySelector('.load').onclick=()=>{
        if(p.style_id) applyStyle(+p.style_id);
      };
      item.querySelector('.del').onclick=async()=>{ await PlanStore.remove(p.id, !!p._local); renderArchive(); };
    });
  }
  // 后端状态灯
  function bindBackendDot(){
    PlanStore.onStatus(ok=>{
      const dot=$('backendDot'); if(!dot) return;
      dot.classList.toggle('off', !ok);
      dot.title = ok ? '后端在线：方案存云端数据库' : '后端不可用：方案降级存本机';
    });
    PlanStore.ping();
  }

  /* ---------- 全部发型（点击试戴，不依赖脸型/肤色推荐） ---------- */
  // 构建单张发型卡（本店发型库 / 通用）：含「试戴」「收藏」按钮，点击即在左侧 AR 实时预览
  function buildStyleCard(st){
    const card=document.createElement('div'); card.className='style-card'; card.dataset.id=st.id;
    const thumb=createRealThumb(st, null, 'thumb'); card.appendChild(thumb);
    const body=document.createElement('div'); body.className='body';
    body.innerHTML=`<div class="nm">${st.name}</div>
      <div class="meta">${st.feature}｜难度<span class="${diffClass(st.difficulty)}">${st.difficultyLabel}</span></div>
      <div class="scene">适用场景：${styleScene(st.id)}</div>
      <div class="home-tip">🏠 居家打理：${styleHomeTip(st.id)}</div>
      <div class="avoid-mini">⚠ ${styleAvoid(st.id)}</div>
      <div class="tags">${st.styleTags.map(t=>`<span class="chip">${t}</span>`).join('')}</div>
      <div class="acts"><button class="use">试戴</button><button class="fav">${STATE.favorites.includes(st.id)?'★':'☆'}</button></div>`;
    card.appendChild(body);
    body.querySelector('.use').onclick=()=>applyStyle(st.id);
    body.querySelector('.fav').onclick=(e)=>{ toggleFav(st.id); e.target.textContent=STATE.favorites.includes(st.id)?'★':'☆'; };
    if(st.id===STATE.selectedStyleId) card.classList.add('active-style');
    return card;
  }
  // 同时渲染到「本店发型库」页面(#allGrid) 与 工作台内嵌发型库(#allGridStudio)
  function renderAllStyles(){
    ['allGrid','allGridStudio'].forEach(id=>{
      const box=$(id); if(!box) return; box.innerHTML='';
      HAIRSTYLES.forEach(st=> box.appendChild(buildStyleCard(st)));
    });
    const dcs=$('dbCountStudio'); if(dcs) dcs.textContent=HAIRSTYLES.length;
  }
  function updateAllActive(){
    ['#allGrid','#allGridStudio'].forEach(sel=>{
      document.querySelectorAll(sel+' .style-card').forEach(c=>{
        c.classList.toggle('active-style', parseInt(c.dataset.id,10)===STATE.selectedStyleId);
      });
    });
  }

  /* ---------- 收藏 ---------- */
  function toggleFav(id){
    const i=STATE.favorites.indexOf(id);
    if(i>=0) STATE.favorites.splice(i,1); else STATE.favorites.push(id);
    saveFavs(); updateFavUI();
  }
  function updateFavUI(){
    $('favCount').textContent=STATE.favorites.length;
    const b=$('btnFavorite');
    const on=STATE.favorites.includes(STATE.selectedStyleId);
    b.classList.toggle('on', on); b.textContent= on?'★ 已收藏':'☆ 收藏当前发型';
    const box=$('favBox');
    if(STATE.favorites.length===0){ box.innerHTML='<p class="hint">还没有收藏，点击「收藏当前发型」或卡片上的 ☆ 添加。</p>'; return; }
    box.innerHTML='';
    STATE.favorites.forEach(id=>{
      const st=getStyleById(id); if(!st) return;
      const card=document.createElement('div'); card.className='style-card';
      const thumb = createRealThumb(st, null, 'thumb'); card.appendChild(thumb);
      const body=document.createElement('div'); body.className='body';
      body.innerHTML=`<div class="nm">${st.name}</div>
        <div class="meta">${st.feature}｜难度<span class="${diffClass(st.difficulty)}">${st.difficultyLabel}</span></div>
        <div class="acts"><button class="use">应用</button><button class="rm">移除</button></div>`;
      card.appendChild(body); box.appendChild(card);
      body.querySelector('.use').onclick=()=>applyStyle(id);
      body.querySelector('.rm').onclick=()=>toggleFav(id);
    });
  }

  /* ---------- 截图 / 理发师卡 ---------- */
  function downloadCanvas(canvas, name){
    const a=document.createElement('a'); a.download=name+'.png'; a.href=canvas.toDataURL('image/png'); a.click();
  }
  function buildBarberCard(){
    const tmp=makeCanvas(800,880);
    if(STATE.tryOn && tryOnAvailable()){
      // 真人试发效果图（720×880 → 居中放到 800×880）
      const t2=makeCanvas(720,880);
      const meta=photoHairMeta(STATE.selectedStyleId);
      const rec=meta?getHairImg(STATE.selectedStyleId):null;
      if(meta && rec && rec.loaded && !rec.failed){
        renderPhotoTryOn(t2, Object.assign(currentOpts(null,'front'), { photo: STATE.origCanvasEl, landmarks: STATE.faceLandmarks, hairImg: rec.img, hairMeta: meta, fit: STATE.fit }));
      }else{
        renderTryOn(t2, Object.assign(currentOpts(null,'front'), { photo: STATE.origCanvasEl, landmarks: STATE.faceLandmarks }));
      }
      const tctx=tmp.getContext('2d'); tctx.fillStyle='#fff'; tctx.fillRect(0,0,800,880);
      tctx.drawImage(t2, 40, 0);
    }else{
      renderScene(tmp, currentOpts());
    }
    const c=makeCanvas(800,1320); const ctx=c.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
    ctx.drawImage(tmp, 0, 0, 800, 880);
    const st=getStyleById(STATE.selectedStyleId);
    const y0=905; ctx.fillStyle='#5b6cff'; ctx.fillRect(0,y0-8,c.width,4);
    ctx.fillStyle='#1f2530'; ctx.textAlign='left'; ctx.font='bold 30px sans-serif';
    ctx.fillText('理发师沟通卡 · 智能发型魔镜', 30, y0+34);
    const tone={warm:'暖调',cool:'冷调',neutral:'中性'}[STATE.metrics.skinTone];
    const gtxt={female:'女',male:'男',all:'不限'}[STATE.metrics.gender]||'';
    const qz = quizText();
    // 每行：{label, text, color, wrap} —— wrap 为 true 时自动折行
    const rows=[
      ['顾客脸型', `${STATE.metrics.faceShape}　肤色：${tone}　性别：${gtxt}`, '#333'],
      ['发质问卷', qz, '#333'],
      ['推荐发型', `${st.name}（难度${st.difficultyLabel}）`, '#5b6cff'],
      ['建议发长', `${({short:'短发',medium:'中长',long:'长发'})[st.length]}　适配发色：${colorName(STATE.colorId)}`, '#333'],
      ['适用场景', styleScene(st.id), '#333'],
      ['✂ 剪裁要点', styleCutKey(st.id), '#1f2530', true],
      ['沙龙打理', st.careTip, '#333', true],
      ['🏠 居家打理', styleHomeTip(st.id), '#9a6a2f', true],
      ['⚠ 避雷提示', styleAvoid(st.id), '#b8443a', true]
    ];
    let yy = y0+80;
    const maxW = 740;
    rows.forEach(r=>{
      const [label, text, color, wrap] = r;
      ctx.font='bold 22px sans-serif'; ctx.fillStyle='#5b6cff';
      ctx.fillText(label + '：', 30, yy);
      const indent = 30 + ctx.measureText(label + '：').width;
      ctx.font='22px sans-serif'; ctx.fillStyle=color||'#333';
      if(wrap){
        yy = drawWrapped(ctx, text, indent, yy, maxW, 30, 32);
      }else{
        ctx.fillText(text, indent, yy); yy += 40;
      }
    });
    ctx.fillStyle='#9aa3b2'; ctx.font='16px sans-serif';
    ctx.fillText('※ 本卡由本地程序生成，人脸数据未上传后端。', 30, yy+10);
    return c;
  }
  // canvas 文本自动折行：返回下一行 y
  function drawWrapped(ctx, text, x, y, maxRight, leftX, lh){
    let line=''; let curY=y; let firstX=x;
    for(const ch of String(text)){
      const test=line+ch;
      if(x + ctx.measureText(test).width > maxRight && line){
        ctx.fillText(line, x, curY); curY += lh; line=ch; x=leftX;
      }else line=test;
    }
    if(line) { ctx.fillText(line, x, curY); curY += lh; }
    return curY + 6;
  }
  function quizText(){
    const m=STATE.metrics;
    const ht={fine:'细软',normal:'正常',thick:'粗硬多',curly:'自然卷'}[m.hairType]||'—';
    const tm={quick:'≤5分钟',normal:'5-15分钟',patient:'愿意花时间'}[m.styleTime]||'—';
    const pm=m.acceptPerm===false?'不接受烫染':'接受烫染';
    return `${ht}｜${tm}｜${pm}`;
  }

  /* ---------- 摄像头 ---------- */
  let stream=null;
  let camReady=false;

  function setStatus(msg, isErr){
    const el=$('statusMsg');
    el.textContent=msg||'';
    el.style.color = isErr ? '#d6453a' : '';
  }

  function camErrorHint(e){
    const map={
      NotAllowedError:'请允许摄像头权限后继续试戴：点击地址栏左侧🔒 → 允许摄像头，再点「重新获取摄像头」。',
      PermissionDeniedError:'请允许摄像头权限后继续试戴：在浏览器设置中开启摄像头权限，再点「重新获取摄像头」。',
      NotFoundError:'未检测到摄像头设备。可改用「上传照片」或「手动/收集表」模式。',
      NotReadableError:'摄像头被其他程序占用（如微信 / 系统相机），请关闭后点「重新获取摄像头」。',
      OverconstrainedError:'摄像头不支持所请求的分辨率，已自动降级。',
      SecurityError:'当前页面环境不允许调用摄像头（非 HTTPS 或内嵌面板）。请直接「上传照片」使用。',
      TypeError:'摄像头参数异常，请点「重新获取摄像头」重试。'
    };
    if(!e || !e.name) return '无法访问摄像头。可用「上传照片」或「手动/收集表」模式。';
    return map[e.name] || ('无法访问摄像头（'+(e.name||'未知错误')+'）。可用「上传照片」或「手动/收集表」模式。');
  }

  async function startCamera(){
    stopCamera();
    camReady=false;
    $('btnRetryCam').hidden=true;
    // 恢复实时视频画面显示（清除上一次拍照的定格照片）
    restoreLiveVideo();

    // 1) 环境支持检测：getUserMedia 仅在 HTTPS / localhost 等安全上下文可用
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      setStatus('当前浏览器不支持摄像头功能，或当前不是安全环境（需 HTTPS 或 localhost）。可改用「上传照片」试戴。', true);
      $('camHint').textContent='当前浏览器不支持摄像头';
      $('btnRetryCam').hidden=false;
      return;
    }

    setStatus('正在请求摄像头权限…请点击「允许」');
    $('camHint').textContent='正在请求摄像头权限…';

    // 2) 多级降级获取视频流：高清 → 标清 → 任意摄像头
    const tries=[
      { video:{ facingMode:'user', width:{ideal:1280}, height:{ideal:960} }, audio:false },
      { video:{ facingMode:'user' }, audio:false },
      { video:true, audio:false }
    ];
    let lastErr=null;
    for(const c of tries){
      try{
        stream = await navigator.mediaDevices.getUserMedia(c);
        lastErr=null;
        break;
      }catch(e){
        lastErr=e;
        // 权限被拒 / 安全限制：继续尝试无意义，直接跳出
        if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(e.name)) break;
      }
    }
    if(!stream){
      setStatus(camErrorHint(lastErr||{name:'UnknownError'}), true);
      $('camHint').textContent='摄像头不可用，点「重新获取摄像头」重试';
      $('btnRetryCam').hidden=false;
      return;
    }

    // 3) 把视频流挂到 <video> 并播放，再把画面显示到左侧摄像头区域
    try{
      const v=$('cam');
      v.srcObject=stream;
      v.muted=true; v.playsInline=true; v.autoplay=true;   // 防御性设置，确保自动播放
      try{ await v.play(); }catch(_){ /* 部分浏览器 play() 需在用户手势中触发，忽略 */ }
      // 等待有效画面尺寸（最多 3 秒）
      await new Promise((res)=>{
        if(v.videoWidth>0) return res();
        let n=0; const t=setInterval(()=>{ if(v.videoWidth>0||++n>30){ clearInterval(t); res(); } },100);
      });
      camReady = v.videoWidth>0;
      if(camReady){
        $('camHint').textContent='正对摄像头，光线充足 · 自动检测中';
        $('btnCapture').classList.add('detecting');
        $('btnCapture').textContent='⏳ 检测中…';
        setStatus('摄像头已就绪 · 自动检测人脸中…');
        startAutoDetect();
        // ★ 启动实时 AR 跟踪：发型跟随头部实时移动/旋转/缩放
        startRealtimeAR();
      }else{
        setStatus('摄像头画面未就绪，请点「重新获取摄像头」。', true);
        $('camHint').textContent='摄像头画面未就绪';
        $('btnRetryCam').hidden=false;
      }
    }catch(e){
      setStatus(camErrorHint(e), true);
      $('btnRetryCam').hidden=false;
    }
  }
  function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } camReady=false; stopAutoDetect(); stopRealtimeAR(); }

  /* =======================================================================
   * 实时 AR 跟踪循环 v2
   *   检测管线：MediaPipe FaceMesh(468/478 点 + 3D 姿态矩阵) 为主，
   *            CDN/模型不可用时自动降级 face-api 68 点，功能不中断。
   *   状态过渡：置信度 < AR_TUNE.MIN_CONF 暂停贴图；
   *            人脸丢失 < LOST_HOLD_MS 保持上一帧 → 随后 LOST_FADE_MS 内淡出 → 隐藏并提示。
   * ======================================================================= */
  let _rtTimer = null;           // requestAnimationFrame ID
  let _rtRunning = false;        // 是否正在运行
  let _rtLandmarks = null;       // 最新关键点（mp: 归一化 0..1 / api: 视频原生像素）
  let _rtSmoothLM = null;        // 一阶 EMA 平滑后的关键点
  let _rtMatrix = null;          // 最新 4×4 头部姿态矩阵（MediaPipe 提供，可为 null）
  let _rtSource = 'mp';          // 当前检测源：'mp' | 'api'
  let _rtConf = 0;               // 当前检测置信度 0..1
  let _rtLastSeen = 0;           // 最近一次成功检测到人脸的时间戳
  let _rtLastDetect = 0;         // 上次发起检测的时间戳
  let _rtNoFace = 0;             // 连续未检到人脸的次数（用于软提示）
  let _rtMPTried = false;        // MediaPipe 是否已尝试初始化
  // 一阶平滑系数：越大越跟手，越小越稳。mp 点多且稳 → 可略高
  const _RT_SMOOTH = 0.40;
  // 检测频率：MediaPipe 很快，可提高到 ~16fps（桌面）/ ~9fps（移动）
  const _RT_DETECT_INTERVAL = (window.matchMedia && window.matchMedia('(max-width:768px)').matches) ? 110 : 60;
  const _AR = window.AR_TUNE || { MIN_CONF:0.3, LOST_HOLD_MS:600, LOST_FADE_MS:400 };

  // ★【规格四·容错分级】人脸丢失超过保持+淡出窗口后的用户提示（不阻断流程）
  function suggestFaceHint(){
    const mob = (window.matchMedia && window.matchMedia('(max-width:768px)').matches);
    $('camHint').textContent = mob
      ? '正对镜头，保持光线充足 · 未检到人脸；避免侧脸/逆光，或点「上传照片」'
      : '正对镜头，保持光线充足 · 未检到人脸；请正对摄像头、调亮环境光、避免侧脸与逆光，或点「上传照片」';
  }

  function startRealtimeAR(){
    if(_rtRunning) return;
    _rtRunning = true;
    _rtNoFace = 0;
    _rtSmoothLM = null;   // 重置平滑缓存，首帧直接吸附（避免从上次残留位置滑入）
    _rtLandmarks = null; _rtMatrix = null; _rtConf = 0; _rtLastSeen = 0;
    if(typeof resetHairSmoothing === 'function') resetHairSmoothing(); // 重置二阶平滑
    const rc = $('realtimeCanvas'); if(rc) rc.classList.remove('hidden');
    $('camHint').textContent = '正对摄像头，发型实时跟随中';
    // 预热 MediaPipe（异步，不阻塞首帧；失败则整条链路走 face-api）
    _ensureMediaPipe();
    _rtTick();
  }
  function stopRealtimeAR(){
    _rtRunning = false;
    if(_rtTimer){ cancelAnimationFrame(_rtTimer); _rtTimer = null; }
    // 注意：不再隐藏/清空 realtimeCanvas —— 它是唯一试戴画布，照片/手动模式下仍需显示。
  }

  // MediaPipe 初始化（只触发一次；ES Module 由 index.html 以 type=module 加载）
  function _ensureMediaPipe(){
    if(_rtMPTried) return;
    _rtMPTried = true;
    // 加载期状态：复用既有 autoDetectStatus 元素，不新增任何 DOM，界面布局保持原样
    const tip = (s, m) => { if(!autoDetect.detected) updateAutoStatus(s, m); };
    tip('detecting', '● 正在加载高精度追踪模型…');
    const tryInit = (retry) => {
      if(window.MPFace && typeof window.MPFace.init === 'function'){
        window.MPFace.init().then(ok => {
          if(ok){
            // 注意：此处只代表"初始化成功"。真正能否推理由首帧 detect 决定，
            // 若环境缺 WebGL 会在几帧后置 broken 并自动降级（见 _rtDetectFace）。
            console.log('[AR] 追踪引擎：MediaPipe FaceMesh 468 点 / ' + (window.MPFace.delegate || ''));
            tip('detecting', '● 高精度追踪已就绪 · 正在检测人脸…');
          }else{
            _rtSource = 'api';
            console.warn('[AR] MediaPipe 不可用，降级 face-api 68 点');
            tip('detecting', '● 正在检测人脸…（基础追踪模式）');
          }
        }).catch(() => { _rtSource = 'api'; });
      }else if(retry > 0){
        setTimeout(() => tryInit(retry - 1), 300);   // ES Module 还没执行完，稍后重试
      }else{
        _rtSource = 'api';
        console.warn('[AR] 未检测到 MPFace 模块，降级 face-api 68 点');
        tip('detecting', '● 正在检测人脸…（基础追踪模式）');
      }
    };
    tryInit(20);   // 最多等 6s
  }

  // 一阶指数平滑（EMA）：把平滑值朝最新检测值挪 _RT_SMOOTH 比例
  //   → 保留跟随性的同时滤掉单帧检测噪声，发型不会因画面抖动而剧烈晃动
  function smoothLandmarks(raw){
    if(!raw || !raw.length) return null;
    if(!_rtSmoothLM || _rtSmoothLM.length !== raw.length){
      _rtSmoothLM = raw.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
      return _rtSmoothLM;
    }
    const a = _RT_SMOOTH;
    for(let i = 0; i < raw.length; i++){
      _rtSmoothLM[i].x += (raw[i].x - _rtSmoothLM[i].x) * a;
      _rtSmoothLM[i].y += (raw[i].y - _rtSmoothLM[i].y) * a;
      _rtSmoothLM[i].z += ((raw[i].z || 0) - _rtSmoothLM[i].z) * a;
    }
    return _rtSmoothLM;
  }

  // 丢脸状态机：返回本帧发型整体透明度（1=正常，0..1=淡出中，0=隐藏）
  function _hairAlphaByTracking(now){
    if(!_rtLastSeen) return 0;
    const gone = now - _rtLastSeen;
    if(gone <= _AR.LOST_HOLD_MS) return 1;                       // 短暂丢失：保持上一帧位置
    const fade = gone - _AR.LOST_HOLD_MS;
    if(fade >= _AR.LOST_FADE_MS) return 0;                       // 超过阈值：彻底隐藏
    return 1 - fade / _AR.LOST_FADE_MS;                          // 缓慢淡出
  }

  function _rtTick(){
    if(!_rtRunning) return;
    _rtTimer = requestAnimationFrame(_rtTick);
    const v = $('cam');
    if(!v || !v.videoWidth || v.videoWidth < 2) return;
    const rc = $('realtimeCanvas');
    if(!rc) return;
    const now = Date.now();
    const styleId = STATE.selectedStyleId;
    const meta = photoHairMeta(styleId);
    const rec = metaUsable(meta) ? getHairImg(styleId) : null;
    const canHair = STATE.tryOn && meta && metaUsable(meta) && rec && rec.loaded && !rec.failed;
    const alpha = _hairAlphaByTracking(now);
    const drawLM = _rtLandmarks ? smoothLandmarks(_rtLandmarks) : null;
    let arT = null;
    try{
      if(canHair && drawLM && alpha > 0.01){
        // 摄像头画面（底层）+ 发型 PNG（顶层），同一镜像上下文，坐标系严格对齐
        arT = renderRealtimeAR(rc, {
          video: v,
          landmarks: drawLM,
          matrix: _rtMatrix,
          source: _rtSource,
          confidence: _rtConf,
          hairAlpha: alpha,
          hairImg: rec.img,
          hairMeta: meta,
          colorId: STATE.colorId,
          texture: STATE.texture,
          fit: STATE.fit
        });
      }else{
        // 仅显示镜像视频画面（未开启真人试发 / 人脸已丢失超阈值）
        const ctx = rc.getContext('2d');
        ctx.clearRect(0,0,rc.width,rc.height);
        ctx.save(); ctx.translate(rc.width,0); ctx.scale(-1,1);
        ctx.drawImage(v,0,0,rc.width,rc.height); ctx.restore();
        // 丢失超阈值 → 清空缓存，下次检到人脸时首帧直接吸附，不从旧位置滑入
        if(canHair && alpha <= 0.01 && _rtSmoothLM){
          _rtSmoothLM = null; _rtLandmarks = null;
          if(typeof resetHairSmoothing === 'function') resetHairSmoothing();
        }
      }
    }catch(e){ /* 渲染异常不影响主流程 */ }
    // 调试面板(需求八)：把本帧变换推送给面板，实时显示头部/发型尺寸与偏移读数
    if(arT && typeof ArDebugPanel !== 'undefined' && ArDebugPanel.visible) ArDebugPanel.push(arT, meta, styleId);
    // 检测：按间隔异步调用，不阻塞渲染帧
    if(now - _rtLastDetect >= _RT_DETECT_INTERVAL){
      _rtLastDetect = now;
      _rtDetectFace(v);
    }
  }

  let _rtDetecting = false;      // 防止检测回调堆积（慢设备上避免并发占用）
  async function _rtDetectFace(v){
    if(_rtDetecting) return;
    _rtDetecting = true;
    try{
      /* ---------- ① 主路径：MediaPipe FaceMesh ----------
       * 判据用 available（= ready 且推理未判定损坏）而非 ready：
       * 缺少 WebGL/硬件加速的机器上 MediaPipe 会"假就绪"——初始化成功但每帧推理抛错。
       * 若只看 ready，就会永远卡在主路径、永不降级，表现为发型始终不出现。
       * MP.detect 内部连续异常达阈值后会置 broken，此处随即自动切换到 face-api。
       * ------------------------------------------------------------------ */
      const MP = window.MPFace;
      if(MP && MP.available){
        const r = MP.detect(v, performance.now());
        if(r && r.landmarks && r.landmarks.length >= 468){
          _switchSource('mp');         // 引擎切换瞬间重置平滑，避免发型从旧位置滑入
          _rtLandmarks = r.landmarks;
          _rtMatrix = r.matrix || null;
          _rtConf = 1;                 // FaceLandmarker 已内置阈值过滤，输出即视为可信
          _rtLastSeen = Date.now();
          _rtNoFace = 0;
          _kickFirstAnalysis(v);       // 首帧脸型/肤色/性别分析（仍由 face-api 完成，仅一次）
          _rtDetecting = false;
          return;
        }
        // 引擎仍健康、只是本帧确实没脸 → 交给状态机做保持/淡出
        if(MP.available){
          _rtOnFaceLost();
          _rtDetecting = false;
          return;
        }
        // 刚刚被判定损坏 → 不浪费本帧，立即向下走 face-api
        console.warn('[AR] MediaPipe 推理不可用，本帧起降级 face-api 68 点');
        updateAutoStatus('detecting', '● 正在检测人脸…（基础追踪模式）');
      }

      /* ---------- ② 降级路径：face-api 68 点 ----------
       * 先无条件切源再检测：68 点与 468 点的坐标语义不同（像素 vs 归一化），
       * 若等到检测成功才切，中间这段时间 _rtSource 仍是 'mp' 而点集已是 68 点，
       * extractFaceAnchors 会按归一化解读像素坐标，发型瞬间飞到画面角落。
       * ------------------------------------------------------------------ */
      _switchSource('api');
      if(typeof FaceAnalyzer === 'undefined'){ _rtDetecting = false; return; }
      try{ await FaceAnalyzer.init(); }catch(e){ _rtDetecting = false; return; }
      const res = await FaceAnalyzer.analyze(v);
      if(res && res.landmarks && res.landmarks.length >= 68){
        _rtLandmarks = res.landmarks;
        _rtMatrix = null;
        _rtConf = (res.confidence != null && isFinite(res.confidence)) ? res.confidence : 0.9;
        _rtLastSeen = Date.now();
        _rtNoFace = 0;
        _applyFirstAnalysis(res);
      }else{
        _rtOnFaceLost();
      }
    }catch(e){
      _rtOnFaceLost();
    }
    _rtDetecting = false;
  }

  // 切换检测引擎（68点 ↔ 468点）：两套点集数量与坐标语义不同，
  // 必须清空一阶/二阶平滑缓存，让新引擎首帧直接吸附，否则发型会从旧位置缓慢滑入。
  function _switchSource(src){
    if(_rtSource === src) return;
    _rtSource = src;
    _rtSmoothLM = null;
    if(typeof resetHairSmoothing === 'function') resetHairSmoothing();
  }

  /* ★【规格四·人脸丢失分级容错】三级递进，位置/透明度由 _hairAlphaByTracking 的时间窗口统一管理：
   *   ① 丢失 ≤ LOST_HOLD_MS(600ms)  → 保持上一帧位置，发型不消失（应对眨眼、瞬时遮挡、检测抖动）
   *   ② 超过保持期                   → 在 LOST_FADE_MS(400ms) 内缓慢淡出，而非硬闪断
   *   ③ 持续丢失                     → 提示「正对镜头，保持光线充足」，引导用户自行纠正 */
  function _rtOnFaceLost(){
    _rtNoFace++;
    if(_rtNoFace >= 3 && _rtNoFace < 6){
      updateAutoStatus('cooldown', '● 追踪中 · 人脸短暂离开，发型保留');
    }else if(_rtNoFace >= 6){
      suggestFaceHint();   // 连续丢脸 ≥6 帧(≈0.36~0.66s)
    }
  }

  // MediaPipe 路径下，首帧仍需 face-api 做一次脸型/肤色/性别分析（只跑一次，不进渲染环）
  let _firstAnalysisRunning = false;
  function _kickFirstAnalysis(v){
    if(autoDetect.detected || STATE.origCanvasEl || _firstAnalysisRunning) return;
    if(typeof FaceAnalyzer === 'undefined') return;
    _firstAnalysisRunning = true;
    (async () => {
      try{
        await FaceAnalyzer.init();
        const res = await FaceAnalyzer.analyze(v);
        if(res && res.landmarks && res.landmarks.length >= 68) _applyFirstAnalysis(res);
      }catch(e){ /* 首帧分析失败不影响 AR 追踪 */ }
      _firstAnalysisRunning = false;
    })();
  }

  // 首次检测成功 → 写入分析结果 + 自动推荐 + 自动试戴（仅一次）
  function _applyFirstAnalysis(res){
    if(autoDetect.detected || STATE.origCanvasEl) return;
    autoDetect.detected = true;
    stopAutoDetect();
    updateAutoStatus('success', '● 已识别 · '+res.faceShape);
    $('btnCapture').classList.remove('detecting');
    $('btnCapture').textContent = '📷 重新检测';
    STATE.metrics = { ...STATE.metrics, ...res, hasDetection: true };
    STATE.faceLandmarks = res.landmarks;
    if(res.genderEstimate){
      STATE.metrics.gender = res.genderEstimate.gender;
      STATE.metrics.genderConfidence = res.genderEstimate.confidence;
      STATE.metrics.genderMethod = res.genderEstimate.method;
      syncGenderUI();
    }
    const recs = recommendStyles(STATE.metrics, 3);
    if(recs && recs[0]){ STATE.selectedStyleId = recs[0].style.id; }
    displayMetrics();
    refreshRecommend(); refreshPlans();
    renderEffect();
    const genderLabel = {female:'女',male:'男',all:'不限'}[STATE.metrics.gender]||'';
    const engine = (_rtSource === 'mp') ? 'FaceMesh 468点' : '68点';
    setStatus('AI已自动识别：'+STATE.metrics.faceShape+' · '+(STATE.metrics.skinTone==='warm'?'暖调':'冷调')+' · '+genderLabel
              +'　已自动试戴推荐发型，'+engine+'实时跟随头部移动');
  }

  /* ---------- 自动检测人脸 ---------- */
  function updateAutoStatus(state, msg){
    const el=$('autoDetectStatus');
    if(!el) return;
    el.hidden=false;
    el.className='auto-status '+state;
    el.textContent=msg;
  }
  function startAutoDetect(){
    if(autoDetect.active) return;
    autoDetect.active=true;
    autoDetect.detected=false;
    autoDetect.lastResult=null;
    autoDetect.stableCount=0;
    autoDetect.cooldownUntil=0;
    updateAutoStatus('detecting', '● 正在检测人脸…');
    // 每500ms检测一次
    autoDetect.timer=setInterval(detectFaceFromVideo, 500);
  }
  function stopAutoDetect(){
    autoDetect.active=false;
    if(autoDetect.timer){ clearInterval(autoDetect.timer); autoDetect.timer=null; }
    const el=$('autoDetectStatus'); if(el) el.hidden=true;
  }
  async function detectFaceFromVideo(){
    if(!autoDetect.active) return;
    // 冷却期跳过
    if(Date.now() < autoDetect.cooldownUntil){
      if(!autoDetect.detected) updateAutoStatus('cooldown', '◌ 冷却中…');
      return;
    }
    const v=$('cam');
    if(!v || !v.videoWidth || v.videoWidth<2) return;
    // 确保模型已加载
    if(typeof FaceAnalyzer==='undefined') return;
    try{
      await FaceAnalyzer.init();
    }catch(e){ return; }
    try{
      const res=await FaceAnalyzer.analyze(v);
      if(!res || !res.faceShape) return; // 未检测到人脸
      const key=res.faceShape+'|'+res.skinTone+'|'+(res.genderEstimate?res.genderEstimate.gender:'unknown');
      // 与上次结果对比
      if(autoDetect.lastResult===key){
        autoDetect.stableCount++;
        updateAutoStatus('detecting', '● 检测到人脸 · 稳定中 ' + autoDetect.stableCount + '/' + autoDetect.STABLE_THRESHOLD);
        if(autoDetect.stableCount >= autoDetect.STABLE_THRESHOLD && !autoDetect.detected){
          // 触发自动分析
          autoDetect.detected=true;
          await triggerAutoAnalysis(v, res);
        }
      }else{
        autoDetect.lastResult=key;
        autoDetect.stableCount=1;
        updateAutoStatus('detecting', '● 检测到人脸 · 稳定中 1/' + autoDetect.STABLE_THRESHOLD);
      }
    }catch(e){
      // 检测失败（无人脸），重置计数
      if(autoDetect.lastResult!==null && !autoDetect.detected){
        autoDetect.lastResult=null;
        autoDetect.stableCount=0;
        updateAutoStatus('detecting', '● 正在检测人脸…');
      }
    }
  }
  async function triggerAutoAnalysis(v, res){
    stopAutoDetect(); // 停止检测循环
    stopRealtimeAR(); // 停止实时AR循环，避免覆盖定格照片试戴
    updateAutoStatus('success', '● 已识别 · ' + res.faceShape);
    $('camHint').textContent='已自动识别 ✓ 点「重新检测」可再次检测';
    $('btnCapture').classList.remove('detecting');
    $('btnCapture').textContent='📷 重新检测';
    // 执行与手动拍照相同的分析流程
    const frame=snapFrame(v);
    const oc=makeCanvas(720,880); drawCover(oc.getContext('2d'), frame, 720, 880);
    STATE.origCanvasEl=oc;
    STATE.faceLandmarks=null;
    STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1}; syncFitUI();
    showSnapInCapture(frame);
    renderOrigView(); renderEffect();
    setStatus('正在AI分析…');
    await runAnalysis(oc, true);
  }

  // 从 video 定格一帧（做镜像翻转，与预览一致）
  function snapFrame(v){
    const w=v.videoWidth||720, h=v.videoHeight||880;
    if(w<2||h<2) return makeCanvas(720,880);  // 防御：尺寸异常时返回空画布
    const c=makeCanvas(w,h); const ctx=c.getContext('2d');
    ctx.translate(w,0); ctx.scale(-1,1);
    ctx.drawImage(v,0,0,w,h);
    return c;
  }

  // 拍照 / 上传后在主窗口显示定格照片（替代实时视频画面）
  function showSnapInCapture(frame){
    const v=$('cam');
    try{ v.pause(); }catch(e){}
    v.style.display='none';
    $('origCanvas').classList.add('orig'); // 定格画布始终隐藏，统一用 realtimeCanvas 显示
    const rc=$('realtimeCanvas'); rc.classList.remove('hidden');
    const ctx=rc.getContext('2d'); ctx.clearRect(0,0,rc.width,rc.height);
    drawCover(ctx, frame, rc.width, rc.height); // 立即显示定格照片，便于确认取景
    $('camHint').textContent='已拍照 ✓ 分析后发型自动贴合，或点「重新检测」重拍';
  }
  // 恢复实时视频画面（重拍 / 重试时调用）
  function restoreLiveVideo(){
    const v=$('cam'); const oc2=$('origCanvas');
    oc2.classList.add('orig');  // 重新隐藏定格画布
    v.style.display='';
    try{ v.play(); }catch(e){}
    const rc=$('realtimeCanvas'); if(rc) rc.classList.remove('hidden');
  }

  async function doCapture(){
    const v=$('cam');
    if(!stream || !v.videoWidth){
      setStatus('摄像头未就绪。点「重新获取摄像头」，或改用「上传照片」/「手动模式」。', true);
      $('btnRetryCam').hidden=false;
      return;
    }
    // 已自动检测 / 已上传照片 → 回到实时摄像头重新检测
    if(autoDetect.detected || STATE.origCanvasEl){
      stopRealtimeAR();
      restoreLiveVideo();
      STATE.origCanvasEl=null;
      STATE.faceLandmarks=null;
      STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1}; syncFitUI();
      refreshRecommend(); refreshPlans();
      autoDetect.detected=false;
      autoDetect.stableCount=0;
      autoDetect.lastResult=null;
      _rtLandmarks=null;
      $('camHint').textContent='正对摄像头，光线充足 · 自动检测中';
      $('btnCapture').classList.add('detecting');
      $('btnCapture').textContent='⏳ 检测中…';
      setStatus('重新检测中…请正对摄像头');
      startAutoDetect();
      startRealtimeAR();
      return;
    }
    // 手动拍照（降级方案）
    stopRealtimeAR();
    const frame=snapFrame(v);
    const oc=makeCanvas(720,880); drawCover(oc.getContext('2d'), frame, 720, 880);
    STATE.origCanvasEl=oc;
    STATE.faceLandmarks=null;
    STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1}; syncFitUI();
    showSnapInCapture(frame);
    renderEffect();
    setStatus('已拍照 ✓ 正在AI分析…');
    await runAnalysis(oc, true);
  }

  async function doUpload(file){
    const img=new Image();
    img.onload=async ()=>{
      const oc=makeCanvas(720,880); drawCover(oc.getContext('2d'), img, 720, 880);
      STATE.origCanvasEl=oc;
      STATE.faceLandmarks=null;
      STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1}; syncFitUI();
      stopRealtimeAR();
      // 上传照片在主窗口显示定格照片
      showSnapInCapture(img);
      renderEffect();
      setStatus('照片已载入 ✓ 正在AI分析…');
      await runAnalysis(oc, true);
      URL.revokeObjectURL(img.src);
    };
    img.onerror=()=>setStatus('图片读取失败，请换一张试试。', true);
    img.src=URL.createObjectURL(file);
  }

  async function runAnalysis(el, photoSaved){
    try{
      const res=await Promise.race([
        FaceAnalyzer.analyze(el),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('分析超时')), 15000))
      ]);
      STATE.metrics={ ...STATE.metrics, ...res, hasDetection:true };
      STATE.faceLandmarks = res.landmarks || null;  // 与 720×880 原图同坐标系
      // 自动识别性别：AI 估算结果写入 STATE，并同步 UI
      if(res.genderEstimate){
        STATE.metrics.gender = res.genderEstimate.gender;
        STATE.metrics.genderConfidence = res.genderEstimate.confidence;
        STATE.metrics.genderMethod = res.genderEstimate.method;
        // 若当前选中的发型不属于识别性别池，自动切换到该性别池第一款
        const pool = stylesForGender(STATE.metrics.gender);
        const curInPool = pool.some(s => s.id === STATE.selectedStyleId);
        if(!curInPool && pool.length > 0){
          STATE.selectedStyleId = pool[0].id;
        }
        syncGenderUI();
      }
      displayMetrics(); renderEffect();
      refreshRecommend(); refreshPlans();
      const genderLabel = {female:'女',male:'男',all:'不限'}[STATE.metrics.gender]||'';
      const genderNote = STATE.metrics.genderConfidence ? '（AI识别：'+genderLabel+'，置信度'+Math.round(STATE.metrics.genderConfidence*100)+'%）' : '';
      setStatus('分析完成：'+STATE.metrics.faceShape+' · '+(STATE.metrics.skinTone==='warm'?'暖调':STATE.metrics.skinTone==='cool'?'冷调':'中性')+' · 性别'+genderLabel+genderNote+'　✂ 发型已自动贴合，切换发型即刻对齐！');
    }catch(e){
      if(photoSaved){
        // 照片已留存：引导手动补充脸型，不算失败
        displayMetrics(); renderEffect(); refreshRecommend(); refreshPlans();
        setStatus('照片已保存，但AI未识别到人脸（'+e.message+'）。可在「手动/收集表」里选脸型，照片仍用于对照。', true);
      }else{
        setStatus('分析失败：'+e.message+'（可切到「手动/收集表」模式）', true);
      }
    }
  }

  /* ---------- 手动模式 ---------- */
  function applyManual(){
    const newGender = $('manGender').value;
    STATE.metrics={
      faceShape:$('manFace').value,
      skinTone:$('manSkin').value,
      skinColor: STATE.metrics.skinColor || '#e8c9a8',
      currentLength:$('manLen').value,
      preferEasy:$('manEasy').checked,
      gender:newGender,
      genderMethod:'manual',
      genderConfidence:0,
      hasDetection:false
    };
    // 若当前发型不属于新性别池，自动切换
    const pool = stylesForGender(newGender);
    const curInPool = pool.some(s => s.id === STATE.selectedStyleId);
    if(!curInPool && pool.length > 0){
      STATE.selectedStyleId = pool[0].id;
      STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1}; syncFitUI();
    }
    syncGenderUI();
    displayMetrics(); renderEffect(); refreshRecommend(); refreshPlans(); renderAllStyles(); updateAllActive();
    $('statusMsg').textContent='已按收集表/手动信息生成方案。';
  }

  // 摄像头实时AR ↔ 手动/收集表 模式切换
  function toggleManualMode(){
    if(STATE.mode==='manual'){
      STATE.mode='camera';
      const bm=$('btnManual'); if(bm) bm.textContent='手动/收集表';
      $('manualWrap').hidden=true; $('camWrap').hidden=false;
      startCamera();
    }else{
      STATE.mode='manual';
      const bm=$('btnManual'); if(bm) bm.textContent='← 返回摄像头';
      $('manualWrap').hidden=false;
      stopCamera();
      STATE.origCanvasEl=null; STATE.faceLandmarks=null;
      STATE.fit={scale:1, dx:0, dy:0, rot:0, opacity:1}; syncFitUI();
      $('camHint').textContent='手动/收集表模式 · 下方为参数化预览';
      renderEffect();
    }
  }

  /* ---------- 贴合微调（缩放 / 偏移 / 旋转） ---------- */
  function clampFit(){
    const f=STATE.fit;
    f.scale=Math.min(1.4, Math.max(0.7, f.scale));
    f.dx=Math.min(160, Math.max(-160, f.dx));
    f.dy=Math.min(160, Math.max(-160, f.dy));
    f.rot=Math.min(0.30, Math.max(-0.30, f.rot));
    if(f.opacity==null || !isFinite(f.opacity)) f.opacity=1;
    f.opacity=Math.min(1, Math.max(0.35, f.opacity));
  }
  function syncFitUI(){
    const f=STATE.fit;
    $('fitScale').value=f.scale; $('fitScaleVal').textContent=Math.round(f.scale*100)+'%';
    $('fitDx').value=Math.round(f.dx); $('fitDxVal').textContent=(f.dx>0?'右':f.dx<0?'左':'')+Math.abs(Math.round(f.dx));
    $('fitDy').value=Math.round(f.dy); $('fitDyVal').textContent=(f.dy>0?'下':f.dy<0?'上':'')+Math.abs(Math.round(f.dy));
    $('fitRot').value=(f.rot*180/Math.PI).toFixed(1); $('fitRotVal').textContent=(f.rot*180/Math.PI).toFixed(1)+'°';
    const op=$('fitOpacity'); if(op){ op.value=f.opacity; $('fitOpacityVal').textContent=Math.round(f.opacity*100)+'%'; }
  }
  function setFit(part){
    Object.assign(STATE.fit, part);
    clampFit(); syncFitUI(); renderEffect();
  }
  function resetFit(){ setFit({scale:1, dx:0, dy:0, rot:0, opacity:1}); }

  // 试戴画面手势：单指拖动 / 双指捏合 → 调整发型贴合（缩放 / 偏移 / 旋转）
  function bindFitGestures(){
    const cv=$('camWrap'); if(!cv) return;
    const rc=$('realtimeCanvas');
    const pointers=new Map();     // pointerId -> {x,y}
    let pinchDist=0, pinchAng=0;
    // 屏幕像素 → 画布(720×880)坐标 的换算系数
    const cw=()=> (rc?rc.height:880)/Math.max(1, cv.getBoundingClientRect().height);

    cv.addEventListener('pointerdown', e=>{
      if(!STATE.tryOn) return;
      try{ cv.setPointerCapture(e.pointerId); }catch(_){}
      pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if(pointers.size===2){
        const [a,b]=[...pointers.values()];
        pinchDist=Math.hypot(a.x-b.x, a.y-b.y);
        pinchAng=Math.atan2(a.y-b.y, a.x-b.x);
      }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e=>{
      if(!pointers.has(e.pointerId)) return;
      const prev=pointers.get(e.pointerId);
      pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
      const k=cw();
      if(pointers.size===1){
        setFit({ dx: STATE.fit.dx + (e.clientX-prev.x)*k, dy: STATE.fit.dy + (e.clientY-prev.y)*k });
      }else if(pointers.size===2){
        const [a,b]=[...pointers.values()];
        const d=Math.hypot(a.x-b.x, a.y-b.y);
        if(pinchDist>0) setFit({ scale: STATE.fit.scale * (d/pinchDist) });
        pinchDist=d;
      }
      e.preventDefault();
    });
    const up=e=>{ pointers.delete(e.pointerId); pinchDist=0; pinchAng=0; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e=>{
      if(!STATE.tryOn) return;
      e.preventDefault();
      setFit({ scale: STATE.fit.scale * (e.deltaY<0 ? 1.04 : 0.96) });
    }, {passive:false});
  }

  /* ---------- 事件绑定 ---------- */
  function bind(){
    // 摄像头实时AR ↔ 手动/收集表 切换
    $('btnManual').onclick=toggleManualMode;

    $('btnCapture').onclick=doCapture;
    $('btnRetryCam').onclick=startCamera;
    $('btnUpload').onclick=()=>$('fileInput').click();
    $('fileInput').onchange=e=>{ if(e.target.files[0]){ doUpload(e.target.files[0]); e.target.value=''; } };
    // 手动/收集表 应用
    $('btnManApply').onclick=applyManual;
    $('btnManApply2').onclick=applyManual;

    // 视角
    document.querySelectorAll('.viewBtn').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.viewBtn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); STATE.view=b.dataset.view; renderEffect();
    });
    // 质感
    document.querySelectorAll('.seg[data-tex]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.seg[data-tex]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); STATE.texture=b.dataset.tex; renderEffect();
    });
    // 光线
    document.querySelectorAll('.seg[data-light]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.seg[data-light]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); STATE.lighting=b.dataset.light; renderEffect();
    });
    // 细分色
    document.querySelectorAll('.qc').forEach(b=>b.onclick=()=>setColor(b.dataset.c));
    // 滑块
    $('lenSlider').oninput=e=>{ STATE.lengthSlider=parseFloat(e.target.value);
      $('lenVal').textContent= STATE.lengthSlider<0.34?'短':STATE.lengthSlider<0.67?'中':'长'; renderEffect(); };
    $('curlSlider').oninput=e=>{ STATE.curlSlider=parseFloat(e.target.value);
      $('curlVal').textContent= STATE.curlSlider<0.34?'直':STATE.curlSlider<0.67?'自然':'卷'; renderEffect(); };
    // 收藏
    $('btnFavorite').onclick=()=>toggleFav(STATE.selectedStyleId);
    // 筛选
    document.querySelectorAll('.flt').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.flt').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); STATE.filterTag=b.dataset.tag; refreshRecommend();
    });
    // 真人试发开关
    $('toggleTryOn').onchange=e=>{ STATE.tryOn=e.target.checked; renderEffect(); };
    // 贴合微调滑块
    $('fitScale').oninput=e=>setFit({scale:parseFloat(e.target.value)});
    $('fitDx').oninput=e=>setFit({dx:parseFloat(e.target.value)});
    $('fitDy').oninput=e=>setFit({dy:parseFloat(e.target.value)});
    $('fitRot').oninput=e=>setFit({rot:parseFloat(e.target.value)*Math.PI/180});
    if($('fitOpacity')) $('fitOpacity').oninput=e=>setFit({opacity:parseFloat(e.target.value)});
    $('btnFitReset').onclick=resetFit;
    bindFitGestures();
    // 截图（保存到唯一试戴画布）
    $('btnShot').onclick=()=>{ downloadCanvas($('realtimeCanvas'), '发型AR效果_'+Date.now()); };
    $('btnBarber').onclick=()=>{ downloadCanvas(buildBarberCard(), '理发师沟通卡_'+Date.now()); };

    // 顶部页面导航
    document.querySelectorAll('.navtab').forEach(t=>t.onclick=()=>switchPage(t.dataset.page));
    // 发质问卷分段按钮（单选）
    ['qHairType','qStyleTime','qPerm'].forEach(gid=>{
      document.querySelectorAll('#'+gid+' .seg').forEach(b=>b.onclick=()=>{
        document.querySelectorAll('#'+gid+' .seg').forEach(x=>x.classList.remove('active'));
        b.classList.add('active'); readQuiz();
      });
    });
    $('btnQuiz').onclick=applyQuiz;
    // 季节专题切换
    document.querySelectorAll('.stab').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.stab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); STATE.seasonKey=b.dataset.s; renderSeason();
    });
    // 存档
    $('btnArchive').onclick=archiveCurrent;
    // 季节专题切换
    document.querySelectorAll('.stab').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.stab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); STATE.seasonKey=b.dataset.s; renderSeason();
    });
    // 存档
    $('btnArchive').onclick=archiveCurrent;

  }

  /* ---------- 温柔寄语：情绪安抚 / 缓解容貌焦虑 ---------- */
  // 不评判、不医疗化、不预设用户处境；用温柔的话把注意力从“外表”拉回“人本身”。
  const WARM_WORDS = [
    '发型只是外在的修饰。你眼里的光、你说话的温度，才是别人真正会记得的。',
    '镜子里的你，值得被温柔以待。今天哪怕什么都不改变，你也已经很好了。',
    '头发会生长，也会落去；可你面对生活的那份勇气，一直都在。',
    '如果这段日子对你而言格外难熬——也许是身体的，也许是心里的——请记得：你比任何发型都更值得被爱。',
    '不必为镜中的自己焦虑。你本来的样子，就足够动人。',
    '变美是为了取悦自己，而不是为了符合谁的标准。',
    '你不需要完美。柔软、疲惫、脆弱，也都是真实而可爱的你。',
    '愿你对自己多一点耐心，像对待最好的朋友那样。',
    '外在会变化，但你心里的善良与坚韧，谁也拿不走。',
    '慢慢来。今天先好好喝一杯水、对自己笑一下，就很好。',
    '无论镜子里的你是什么模样，你的价值都不长在那面镜子里。',
    '可以试着挑选喜欢的样子，但别让“好不好看”替你定义自己。',
    '你已经在用自己的方式撑过很多事了，这本身就很了不起。',
    '想换发型就换，不想换也行——你的决定，都值得被尊重。',
    '把头发当作一种表达，而不是一种考核。轻松一点，没关系的。',
    '此刻的你或许很累，但累着还在往前走的人，本就闪闪发光。',
    '别人的目光会散去，但你对自己温柔一点，会一直留下。',
    '你不必为了变得“更好看”才配被喜欢。现在的你，已经值得。'
  ];
  let _warmIdx = -1;
  function renderWarmWord(){
    const el = $('warmWord'); if(!el) return;
    let i;
    do { i = Math.floor(Math.random()*WARM_WORDS.length); } while(WARM_WORDS.length>1 && i===_warmIdx);
    _warmIdx = i;
    el.textContent = WARM_WORDS[i];
    // 轻微淡入，强化“被轻轻安抚”的观感
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'warmFade .9s ease';
  }

  /* ---------- 初始化 ---------- */
  function init(){
    $('dbCount').textContent=HAIRSTYLES.length;
    const _dcs=$('dbCountStudio'); if(_dcs) _dcs.textContent=HAIRSTYLES.length;
    // 脸型下拉
    const mf=$('manFace'); FACE_SHAPES.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; mf.appendChild(o); });
    // 性别下拉
    const mg=$('manGender');
    [['female','女'],['male','男'],['all','不限']].forEach(([v,t])=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; mg.appendChild(o); });
    buildColors();
    bind();
    readQuiz();
    syncGenderUI();
    displayMetrics();
    renderEffect();
    refreshRecommend();
    refreshPlans();
    renderAllStyles();
    updateFavUI();
    bindBackendDot();
    // 温柔寄语：首屏一句 + 缓慢轮播（约 11 秒，不打扰）
    renderWarmWord();
    setInterval(renderWarmWord, 11000);
    const warmBtn = $('btnWarmNext');
    if(warmBtn) warmBtn.onclick = renderWarmWord;
    // 仅在摄像头模式下启动（避免手动模式下浪费设备资源）
    if(STATE.mode==='camera') startCamera();
    // 页面可见性：切到后台时暂停摄像头+检测，回来时恢复
    document.addEventListener('visibilitychange', ()=>{
      if(document.hidden){ stopCamera(); }
      else if(STATE.mode==='camera' && !STATE.origCanvasEl){ startCamera(); }
      else if(STATE.mode==='camera' && !autoDetect.active && !autoDetect.detected){ startAutoDetect(); }
    });
    // 预加载AI模型，拍照时无需等待
    if(typeof FaceAnalyzer!=='undefined'){ FaceAnalyzer.init().catch(()=>{}); }
    // 静默预加载全部 31 张真发 PNG
    preloadAllHairImgs();
    // 构建版本徽标（运行时注入，不改前端结构）：右下角显示当前部署版本，便于核对是否为最新
    try{
      const badge = document.createElement('div');
      badge.id = 'buildBadge';
      badge.textContent = 'build ' + BUILD_VERSION;
      badge.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:99999;'
        + 'font:10px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#9fb0ff;'
        + 'background:rgba(10,14,22,.62);padding:2px 7px;border-radius:7px;'
        + 'letter-spacing:.3px;pointer-events:none;user-select:none;';
      document.body.appendChild(badge);
    }catch(e){}
  }

  window.addEventListener('load', init);
  // 暴露性别切换到全局（onclick 调用）
  window.switchGender = switchGender;
})();
