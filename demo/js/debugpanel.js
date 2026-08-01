/* AR 调试面板（需求八）：右下角可拖拽，实时读数 + 素材锚点/缩放/偏移/旋转微调 + 保存配置。
 * 与 render.js 的 normalizeHairMeta / buildRealtimeTransform 直接打通：
 *   滑块改的是 HAIR_META[当前款] 上的 hairScale / offsetX / offsetY / rotationOffset，
 *   下一帧 buildRealtimeTransform 立即消费，因此"所见即所得"；点「保存配置」把这些值
 *   持久化到 localStorage，并生成可粘贴进 hairmeta.js 的 JSON 片段。 */
window.ArDebugPanel = (function(){
  'use strict';
  const OVER_KEY = 'smarthair_hairmeta_overrides';
  let visible = false;
  let panel, toggle, head, readout, styleLabel;
  const els = {};
  let lastStyleId = null;
  let overrides = {};        // 当前会话已微调的素材字段（待保存/已保存）
  let dragging = false, dragDX = 0, dragDY = 0, flashT = null;

  function $(id){ return document.getElementById(id); }
  function loadOverrides(){
    try{ overrides = JSON.parse(localStorage.getItem(OVER_KEY) || '{}') || {}; }catch(e){ overrides = {}; }
  }
  function metaOf(id){ return (typeof HAIR_META === 'object' && HAIR_META) ? HAIR_META[id] : null; }
  function styleName(id){
    const s = (typeof getStyleById === 'function') ? getStyleById(id) : null;
    return s ? s.name : ('id=' + id);
  }
  function presetKey(id){
    const s = (typeof getStyleById === 'function') ? getStyleById(id) : null;
    if(!s) return '—';
    const cat = (s.curl === 'curly') ? 'curly' : (s.length === 'long' ? 'long' : 'short');
    return cat + '（' + s.length + '/' + s.curl + '）';
  }

  function syncSliders(id){
    const m = metaOf(id); if(!m) return;
    els.hairScale.value = (m.hairScale != null) ? m.hairScale : 1;
    els.offX.value = (m.offsetX != null) ? m.offsetX : 0;
    els.offY.value = (m.offsetY != null) ? m.offsetY : 0;
    els.rot.value = ((m.rotationOffset != null) ? m.rotationOffset : 0) * 180 / Math.PI;
    updateSliderLabels();
  }
  function updateSliderLabels(){
    els.vHairScale.textContent = (+els.hairScale.value).toFixed(3);
    els.vOffX.textContent = (+els.offX.value).toFixed(3);
    els.vOffY.textContent = (+els.offY.value).toFixed(3);
    els.vRot.textContent = (+els.rot.value).toFixed(1) + '°';
  }
  function applyToMeta(id){
    const m = metaOf(id); if(!m) return;
    m.hairScale     = +els.hairScale.value;
    m.offsetX       = +els.offX.value;
    m.offsetY       = +els.offY.value;
    m.rotationOffset = (+els.rot.value) * Math.PI / 180;
    overrides[id] = overrides[id] || {};
    overrides[id].hairScale = m.hairScale;
    overrides[id].offsetX = m.offsetX;
    overrides[id].offsetY = m.offsetY;
    overrides[id].rotationOffset = m.rotationOffset;
    if(m.hairAnchorX != null) overrides[id].hairAnchorX = m.hairAnchorX;
    if(m.hairAnchorY != null) overrides[id].hairAnchorY = m.hairAnchorY;
  }

  function row(k, v){ return '<div class="ar-dbg-row"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function push(T, meta, styleId){
    if(!visible) return;
    if(styleId !== lastStyleId){ lastStyleId = styleId; syncSliders(styleId); styleLabel.textContent = styleName(styleId); }
    if(!T){ readout.innerHTML = '<span class="muted">未贴合（无人脸 / 置信度低）</span>'; return; }
    const A = T.anchors || {};
    const hairW = meta ? (meta.w * T.sx) : 0;
    const hairH = meta ? (meta.h * T.sy) : 0;
    const mOffX = (meta && meta.offsetX != null) ? meta.offsetX : 0;
    const mOffY = (meta && meta.offsetY != null) ? meta.offsetY : 0;
    const mRot  = (meta && meta.rotationOffset != null) ? meta.rotationOffset : 0;
    const mAX   = (meta && meta.hairAnchorX != null) ? meta.hairAnchorX : 0;
    const mAY   = (meta && meta.hairAnchorY != null) ? meta.hairAnchorY : 0;
    readout.innerHTML =
      row('源', (A.source || '?') + ' · n=' + (A.n || '?')) +
      row('头宽/头高', T.headW.toFixed(0) + ' / ' + T.headH.toFixed(0) + ' px') +
      row('发宽/发高', hairW.toFixed(0) + ' / ' + hairH.toFixed(0) + ' px') +
      row('缩放 sx/sy', T.sx.toFixed(3) + ' / ' + T.sy.toFixed(3)) +
      row('偏移 offX/offY', mOffX.toFixed(3) + ' / ' + mOffY.toFixed(3)) +
      row('旋转补偿', (mRot * 180 / Math.PI).toFixed(1) + '°') +
      row('锚点 hX/hY', mAX.toFixed(3) + ' / ' + mAY.toFixed(3)) +
      row('yaw/pitch', T.pose.yaw.toFixed(2) + ' / ' + T.pose.pitch.toFixed(2)) +
      row('预设', presetKey(styleId));
  }

  function save(){
    try{ localStorage.setItem(OVER_KEY, JSON.stringify(overrides)); }catch(e){}
    const out = {}; for(const id in overrides) out[id] = overrides[id];
    console.log('%c[AR] 发型素材覆盖项已保存（' + Object.keys(out).length + ' 款）', 'color:#7cff00;font-weight:bold');
    console.log('将其合并进 demo/js/hairmeta.js 的 HAIR_META[id]：\n' + JSON.stringify(out, null, 2));
    if(els.json){ els.json.textContent = JSON.stringify(out, null, 2); els.json.hidden = false; }
    try{ if(navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(out, null, 2)); }catch(e){}
    flash('已保存 ' + Object.keys(out).length + ' 款 ✓');
  }
  function reset(id){
    const m = metaOf(id); if(!m) return;
    const bx = (m.box && m.box.length === 4) ? m.box : [0, 0, m.w, m.h];
    m.hairAnchorX = ((bx[0] + bx[2]) / 2) / m.w; m.hairAnchorY = bx[1] / m.h;
    m.hairScale = 1; m.offsetX = 0; m.offsetY = 0; m.rotationOffset = 0;
    delete overrides[id];
    try{ localStorage.setItem(OVER_KEY, JSON.stringify(overrides)); }catch(e){}
    syncSliders(id);
    flash('已重置 ' + id);
  }
  function flash(msg){
    if(!els.hint) return;
    const old = els.hint.dataset.t || els.hint.innerHTML;
    els.hint.innerHTML = '<b style="color:#7cff00">' + msg + '</b>';
    clearTimeout(flashT);
    flashT = setTimeout(function(){ els.hint.innerHTML = old; }, 1600);
  }

  function open(){ visible = true; panel.classList.remove('hidden'); toggle.classList.add('hidden'); }
  function close(){ visible = false; panel.classList.add('hidden'); toggle.classList.remove('hidden'); }
  function toggleP(){ if(visible) close(); else open(); }

  function init(){
    panel = $('arDbgPanel'); toggle = $('arDbgToggle'); head = $('arDbgHead');
    readout = $('arDbgReadout'); styleLabel = $('arDbgStyle');
    if(!panel) return;
    els.hairScale = $('dbgHairScale'); els.offX = $('dbgOffX'); els.offY = $('dbgOffY'); els.rot = $('dbgRot');
    els.vHairScale = $('vHairScale'); els.vOffX = $('vOffX'); els.vOffY = $('vOffY'); els.vRot = $('vRot');
    els.json = $('arDbgJson'); els.hint = $('arDbgHint');
    loadOverrides();
    // 拖动头部移动面板（脱离右下角锚定，改为 left/top 定位）
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
    [els.hairScale, els.offX, els.offY, els.rot].forEach(function(el){
      el.addEventListener('input', function(){ updateSliderLabels(); if(lastStyleId != null) applyToMeta(lastStyleId); });
    });
    $('dbgSave').addEventListener('click', save);
    $('dbgReset').addEventListener('click', function(){ if(lastStyleId != null) reset(lastStyleId); });
    $('arDbgClose').addEventListener('click', close);
    if(toggle) toggle.addEventListener('click', toggleP);
    // URL 带 ?ardebug=1 自动打开面板
    if(/[?&]ardebug=1/.test(location.search)) open();
  }

  return { init: init, push: push, get visible(){ return visible; }, open: open, close: close, toggle: toggleP };
})();
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.ArDebugPanel.init);
else window.ArDebugPanel.init();
