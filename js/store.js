/* =========================================================================
 * store.js — 方案存档存储层
 * 优先调用后端 HTTP 接口；后端不可用时自动降级到 localStorage。
 * 人脸图片绝不经过这里，只存方案文本。
 * ========================================================================= */
const PlanStore = (() => {
  // 后端基址：同源部署时留空即可（相对路径）；跨源时可设为 http://host:3000
  const API_BASE = (window.HAIR_API_BASE || '').replace(/\/$/, '');
  const LS_KEY = 'hairPlans';
  let backendOK = null;               // null=未知, true=在线, false=降级
  const listeners = [];

  function onStatus(fn){ listeners.push(fn); if(backendOK!==null) fn(backendOK); }
  function setStatus(ok){ backendOK = ok; listeners.forEach(fn=>fn(ok)); }

  async function ping(){
    try{
      const r = await fetch(API_BASE + '/api/health', { method:'GET' });
      const j = await r.json();
      setStatus(!!(j && j.ok));
      return backendOK;
    }catch(e){ setStatus(false); return false; }
  }

  /* ---- localStorage 降级实现 ---- */
  function lsAll(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); }catch(e){ return []; } }
  function lsSave(arr){ localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0,200))); }
  function lsAdd(plan){
    const arr = lsAll();
    const row = Object.assign({ id: Date.now(), created_at: new Date().toLocaleString(), _local:true }, normalize(plan));
    arr.unshift(row); lsSave(arr); return row;
  }
  function lsDel(id){ lsSave(lsAll().filter(p=>String(p.id)!==String(id))); }

  // 把前端 camelCase 字段规整成与后端一致的下划线字段（便于统一渲染）
  function normalize(p){
    return {
      customer:p.customer||'', face_shape:p.faceShape||'', skin_tone:p.skinTone||'',
      gender:p.gender||'', style_id:p.styleId||null, style_name:p.styleName||'',
      color_name:p.colorName||'', length:p.length||'', scene:p.scene||'',
      cut_key:p.cutKey||'', care_tip:p.careTip||'', home_tip:p.homeTip||'',
      avoid_tip:p.avoidTip||'', quiz:p.quiz?JSON.stringify(p.quiz):null,
      note:p.note||''
    };
  }

  /* ---- 对外 API ---- */
  async function save(plan){
    if(backendOK !== false){
      try{
        const r = await fetch(API_BASE + '/api/plans', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(plan)
        });
        const j = await r.json();
        if(j && j.ok){ setStatus(true); return { ok:true, plan:j.plan, source:'backend' }; }
        throw new Error(j && j.error || '保存失败');
      }catch(e){ setStatus(false); /* 落到本地 */ }
    }
    const row = lsAdd(plan);
    return { ok:true, plan:row, source:'local' };
  }

  async function list(){
    if(backendOK !== false){
      try{
        const r = await fetch(API_BASE + '/api/plans');
        const j = await r.json();
        if(j && j.ok){ setStatus(true); return { plans:j.plans, source:'backend' }; }
        throw new Error('读取失败');
      }catch(e){ setStatus(false); }
    }
    return { plans: lsAll(), source:'local' };
  }

  async function remove(id, isLocal){
    if(!isLocal && backendOK !== false){
      try{
        const r = await fetch(API_BASE + '/api/plans/' + id, { method:'DELETE' });
        const j = await r.json();
        if(j && j.ok){ return true; }
      }catch(e){ setStatus(false); }
    }
    lsDel(id); return true;
  }

  return { ping, save, list, remove, onStatus, get isOnline(){ return backendOK===true; } };
})();
