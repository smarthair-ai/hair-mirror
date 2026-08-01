/* =========================================================================
 * 【规格一·调试体系】AR 参数调试面板
 * -------------------------------------------------------------------------
 * 开启方式：URL 追加 ?ardebug=1（画面同时叠加颅顶红点 / 双眼锚点 / 头部包围框），
 *           或点击右下角 🛠 按钮手动开关。面板标题栏可拖拽到任意位置。
 *
 * 四个滑块（改的就是 HAIR_META[当前发型] 上的字段，下一帧立即生效，所见即所得）：
 *   横向偏移 offsetX   ×头宽，正=向右
 *   纵向偏移 offsetY   ×头高，正=向下
 *   缩放     scaleRate 素材基准缩放（映射到 scaleBase）
 *   旋转补偿 rotOffset 单位度，内部转弧度存入 rotFix
 *
 * ★ 每款发型参数完全独立：切换右侧发型卡片 → 面板自动加载该款配置；
 *   【重置】只清空当前选中发型，其它款式不受影响。
 * ★【复制配置】把当前款生成为可直接粘贴进 hairmeta.js → hairStyleOverrides 的代码行。
 * ========================================================================= */
window.ArDebugPanel = (function(){
  'use strict';
  const OVER_KEY = 'smarthair_hairmeta_overrides';
  let visible = false;
  let panel, toggle, head, readout, styleLabel;
  const els = {};
  let lastStyleId = null;
  let overrides = {};        // 各款已微调的字段（按发型 id 分桶，互不干扰）
  let dragging = false, dragDX = 0, dragDY = 0, flashT = null;

  function $(id){ return document.getElementById(id); }
  function loadOverrides(){
    try{ overrides = JSON.parse(localStorage.getItem(OVER_KEY) || '{}') || {}; }catch(e){ overrides = {}; }
  }
  function persist(){
    try{ localStorage.setItem(OVER_KEY, JSON.stringify(overrides)); }catch(e){}
  }
  function metaOf(id){ return (typeof HAIR_META === 'object' && HAIR_META) ? HAIR_META[id] : null; }
  function styleName(id){
    const s = (typeof getStyleById === 'function') ? getStyleById(id) : null;
    return s ? s.name : ('id=' + id);
  }
  /* 分组标签：与 render.js resolveHairGroup 保持一致 */
  const GROUP_CN = { wave:'大波浪', long:'长发', short:'短发', clavicle:'锁骨发' };
  function groupOf(id){
    const m = metaOf(id);
    if(m && m.group) return m.group;
    const s = (typeof getStyleById === 'function') ? getStyleById(id) : null;
    if(typeof resolveHairGroup === 'function') return resolveHairGroup(s);
    return 'clavicle';
  }
  function groupLabel(id){
    const s = (typeof getStyleById === 'function') ? getStyleById(id) : null;
    const g = groupOf(id);
    return (GROUP_CN[g] || g) + (s ? '（' + s.length + '/' + s.curl + '）' : '');
  }

  /* ---- 面板 ↔ HAIR_META 字段读写（新字段名为准，旧名同步） ---- */
  function readCfg(id){
    const m = metaOf(id);
    if(!m) return { scaleBase:1, offsetX:0, offsetY:0, rotFix:0, anchorX:0.5, anchorY:0 };
    const pick = (a, b, d) => (a != null && isFinite(a)) ? +a : ((b != null && isFinite(b)) ? +b : d);
    return {
      scaleBase: pick(m.scaleBase, m.hairScale, 1),
      offsetX:   pick(m.offsetX, null, 0),
      offsetY:   pick(m.offsetY, null, 0),
      rotFix:    pick(m.rotFix, m.rotationOffset, 0),
      anchorX:   pick(m.anchorX, m.hairAnchorX, 0.5),
      anchorY:   pick(m.anchorY, m.hairAnchorY, 0)
    };
  }

  /* 切换发型时自动加载该款预设到滑块（规格一·2） */
  function syncSliders(id){
    const c = readCfg(id);
    els.scaleRate.value = c.scaleBase;
    els.offX.value = c.offsetX;
    els.offY.value = c.offsetY;
    els.rot.value  = c.rotFix * 180 / Math.PI;
    updateSliderLabels();
  }
  function updateSliderLabels(){
    els.vScaleRate.textContent = (+els.scaleRate.value).toFixed(3);
    els.vOffX.textContent = (+els.offX.value).toFixed(3);
    els.vOffY.textContent = (+els.offY.value).toFixed(3);
    els.vRot.textContent  = (+els.rot.value).toFixed(1) + '°';
  }

  /* 滑块 → HAIR_META（新旧字段双写，保证引擎与历史代码都读得到） */
  function applyToMeta(id){
    const m = metaOf(id); if(!m) return;
    const scaleBase = +els.scaleRate.value;
    const offsetX   = +els.offX.value;
    const offsetY   = +els.offY.value;
    const rotFix    = (+els.rot.value) * Math.PI / 180;
    m.scaleBase = m.hairScale = scaleBase;
    m.offsetX = offsetX;
    m.offsetY = offsetY;
    m.rotFix = m.rotationOffset = rotFix;
    overrides[id] = {
      anchorX: m.anchorX, anchorY: m.anchorY,
      scaleBase: scaleBase, offsetX: offsetX, offsetY: offsetY, rotFix: rotFix
    };
  }

  function row(k, v){ return '<div class="ar-dbg-row"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function push(T, meta, styleId){
    if(!visible) return;
    // ★ 切换右侧发型卡片 → 自动加载对应发型预设
    if(styleId !== lastStyleId){
      lastStyleId = styleId; syncSliders(styleId);
      styleLabel.textContent = styleName(styleId);
    }
    if(!T){ readout.innerHTML = '<span class="muted">未贴合（无人脸 / 置信度低）</span>'; return; }
    const A = T.anchors || {};
    const c = T.cfg || readCfg(styleId);
    const hairW = meta ? (meta.w * T.sx) : 0;
    const hairH = meta ? (meta.h * T.sy) : 0;
    readout.innerHTML =
      row('源', (A.source || '?') + ' · n=' + (A.n || '?')) +
      row('分组预设', groupLabel(styleId)) +
      row('头宽/头高', T.headW.toFixed(0) + ' / ' + T.headH.toFixed(0) + ' px') +
      row('发宽/发高', hairW.toFixed(0) + ' / ' + hairH.toFixed(0) + ' px') +
      row('缩放 sx/sy', T.sx.toFixed(3) + ' / ' + T.sy.toFixed(3)) +
      row('偏移 offX/offY', (+c.offsetX).toFixed(3) + ' / ' + (+c.offsetY).toFixed(3)) +
      row('旋转补偿', ((+c.rotFix) * 180 / Math.PI).toFixed(1) + '°') +
      row('锚点 aX/aY', (+c.anchorX).toFixed(3) + ' / ' + (+c.anchorY).toFixed(3)) +
      row('yaw/pitch', T.pose.yaw.toFixed(2) + ' / ' + T.pose.pitch.toFixed(2)) +
      row('侧脸旋转钳制', T.rollGain != null ? (T.rollGain * 100).toFixed(0) + '%' : '—');
  }

  /* ★【规格一·3】一键复制配置文本 —— 输出可直接写入代码预设库的片段 */
  function buildConfigText(id){
    const cfg = (typeof getHairMetaConfig === 'function') ? getHairMetaConfig(id) : null;
    const c = cfg || Object.assign({ id: id }, readCfg(id));
    const f = (v, n) => (+v).toFixed(n == null ? 4 : n);
    return 'hairStyleOverrides[' + id + '] = { ' +
      'anchorX: ' + f(c.anchorX) + ', ' +
      'anchorY: ' + f(c.anchorY) + ', ' +
      'scaleBase: ' + f(c.scaleBase, 3) + ', ' +
      'offsetX: ' + f(c.offsetX) + ', ' +
      'offsetY: ' + f(c.offsetY) + ', ' +
      'rotFix: ' + f(c.rotFix) + ' }; // ' + styleName(id) + ' · ' + (GROUP_CN[groupOf(id)] || '');
  }
  function copyCfg(){
    if(lastStyleId == null) return flash('请先选择发型');
    const txt = buildConfigText(lastStyleId);
    if(els.json){ els.json.textContent = txt; els.json.hidden = false; }
    console.log('%c[AR] 配置文本（粘贴到 demo/js/hairmeta.js 的 hairStyleOverrides）', 'color:#7cff00;font-weight:bold');
    console.log(txt);
    let ok = false;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); ok = true; }
    }catch(e){}
    if(!ok){
      try{
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); ok = true;
      }catch(e){}
    }
    flash(ok ? '配置已复制 ✓' : '复制失败，见下方文本');
  }

  /* 保存：把所有已微调款式持久化（跨刷新保留） */
  function save(){
    persist();
    const n = Object.keys(overrides).length;
    const lines = Object.keys(overrides).map(buildConfigText).join('\n');
    if(els.json){ els.json.textContent = lines || '（暂无微调）'; els.json.hidden = false; }
    console.log('%c[AR] 已保存 ' + n + ' 款素材配置', 'color:#7cff00;font-weight:bold');
    console.log(lines);
    flash('已保存 ' + n + ' 款 ✓');
  }

  /* ★【规格一·2】重置：仅重置当前选中发型，其它款式互不干扰 */
  function reset(id){
    delete overrides[id];
    persist();
    if(typeof resetHairMetaOne === 'function'){
      resetHairMetaOne(id);                 // 回退到"系统缺省 + 分组预设"
    }else{
      const m = metaOf(id);
      if(m){
        const bx = (m.box && m.box.length === 4) ? m.box : [0, 0, m.w, m.h];
        m.anchorX = m.hairAnchorX = ((bx[0] + bx[2]) / 2) / m.w;
        m.anchorY = m.hairAnchorY = bx[1] / m.h;
        m.scaleBase = m.hairScale = 1;
        m.offsetX = 0; m.offsetY = 0;
        m.rotFix = m.rotationOffset = 0;
      }
    }
    syncSliders(id);
    flash('已重置「' + styleName(id) + '」');
  }

  function flash(msg){
    if(!els.hint) return;
    if(!els.hint.dataset.t) els.hint.dataset.t = els.hint.innerHTML;
    els.hint.innerHTML = '<b style="color:#7cff00">' + msg + '</b>';
    clearTimeout(flashT);
    flashT = setTimeout(function(){ els.hint.innerHTML = els.hint.dataset.t; }, 1800);
  }

  function open(){ visible = true; panel.classList.remove('hidden'); toggle.classList.add('hidden'); }
  function close(){ visible = false; panel.classList.add('hidden'); toggle.classList.remove('hidden'); }
  function toggleP(){ if(visible) close(); else open(); }

  function init(){
    panel = $('arDbgPanel'); toggle = $('arDbgToggle'); head = $('arDbgHead');
    readout = $('arDbgReadout'); styleLabel = $('arDbgStyle');
    if(!panel) return;
    els.scaleRate = $('dbgHairScale'); els.offX = $('dbgOffX'); els.offY = $('dbgOffY'); els.rot = $('dbgRot');
    els.vScaleRate = $('vHairScale'); els.vOffX = $('vOffX'); els.vOffY = $('vOffY'); els.vRot = $('vRot');
    els.json = $('arDbgJson'); els.hint = $('arDbgHint');
    loadOverrides();
    // 拖动标题栏移动面板（脱离右下角锚定，改为 left/top 定位）
    head.addEventListener('pointerdown', function(e){
      if(e.target.id === 'arDbgClose') return;
      dragging = true; panel.classList.add('dragging');
      const r = panel.getBoundingClientRect();
      dragDX = e.clientX - r.left; dragDY = e.clientY - r.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      try{ head.setPointerCapture(e.pointerId); }catch(_){}
    });
    head.addEventListener('pointermove', function(e){
      if(!dragging) return;
      panel.style.left = (e.clientX - dragDX) + 'px';
      panel.style.top  = (e.clientY - dragDY) + 'px';
    });
    head.addEventListener('pointerup', function(){ dragging = false; panel.classList.remove('dragging'); });
    [els.scaleRate, els.offX, els.offY, els.rot].forEach(function(el){
      el.addEventListener('input', function(){ updateSliderLabels(); if(lastStyleId != null) applyToMeta(lastStyleId); });
    });
    $('dbgSave').addEventListener('click', save);
    $('dbgReset').addEventListener('click', function(){ if(lastStyleId != null) reset(lastStyleId); });
    if($('dbgCopy')) $('dbgCopy').addEventListener('click', copyCfg);
    $('arDbgClose').addEventListener('click', close);
    if(toggle) toggle.addEventListener('click', toggleP);
    // URL 带 ?ardebug=1 自动打开面板
    if(/[?&]ardebug=1/.test(location.search)) open();
  }

  return {
    init: init, push: push, get visible(){ return visible; },
    open: open, close: close, toggle: toggleP, copyCfg: copyCfg
  };
})();
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.ArDebugPanel.init);
else window.ArDebugPanel.init();
