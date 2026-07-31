/* =========================================================================
 * mpface.js — MediaPipe FaceMesh（468/478 关键点 + 3D 变换矩阵）封装
 * 用于实时 AR 试戴的人脸追踪：替代旧 face-api 单一检测框，提供
 *   - 478 个归一化关键点（x,y ∈ [0,1]，z 为相对深度）
 *   - 头部 3D 变换矩阵（facialTransformationMatrixes，含俯仰/偏航/滚转）
 * 设计为 ES Module，加载后挂载到 window.MPFace，供 app.js / render.js 使用。
 * 若 CDN / 模型加载失败，ready=false、failed=true，由调用方回退到 face-api。
 * ========================================================================= */
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/vision_bundle.mjs";

const MPFace = (() => {
  let landmarker = null;
  let ready = false;
  let failed = false;
  let loadPromise = null;
  let lastTs = 0;
  let broken = false;        // 初始化成功但推理持续抛错（"假就绪"）
  let errStreak = 0;         // 连续推理异常次数
  let lastError = '';
  const ERR_LIMIT = 3;       // 连续 3 次异常即判定不可用

  const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm";
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  let delegateUsed = '';

  async function create(vision, delegate){
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true   // ★ 输出 4×4 头部姿态矩阵
    });
  }

  async function init(){
    if(ready) return true;
    if(failed) return false;
    if(loadPromise) return loadPromise;
    loadPromise = (async () => {
      let vision;
      try{
        vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      }catch(e){
        console.error('[MPFace] WASM 运行时加载失败（回退 face-api）：', e);
        failed = true; return false;
      }
      // 优先 GPU；部分集显/旧驱动/无 WebGL2 环境会失败，自动降级 CPU 再试一次
      for(const d of ['GPU', 'CPU']){
        try{
          landmarker = await create(vision, d);
          ready = true; delegateUsed = d;
          console.log('[MPFace] FaceLandmarker 就绪，推理后端：' + d);
          return true;
        }catch(e){
          console.warn('[MPFace] ' + d + ' 后端初始化失败：', e && e.message ? e.message : e);
        }
      }
      console.error('[MPFace] GPU/CPU 均不可用，回退 face-api 68 点');
      failed = true;
      return false;
    })();
    return loadPromise;
  }

  // 在 <video> 当前帧检测。返回 null 表示无人脸；否则 { landmarks, matrix }。
  // landmarks: 归一化 [{x,y,z}]（x,y∈[0,1]，图像原生坐标，未镜像）
  // matrix: Float32Array(16) | null（列主序 4×4 头部变换矩阵）
  //
  // ★ 关于 broken 标志（"假就绪"防御）：
  //   即便选用 CPU 推理后端，MediaPipe 的图像预处理仍依赖 WebGL 上下文。
  //   在硬件加速被禁用 / 显卡驱动异常 / WebGL 被企业策略屏蔽的机器上，
  //   createFromOptions 会正常返回（ready=true），但每次 detectForVideo 都抛
  //   "Cannot read properties of undefined (reading 'activeTexture')" 之类的异常。
  //   若把这类异常一律当作"本帧无脸"吞掉，调用方会永远等不到人脸、也永远不降级，
  //   表现为"画面正常但发型永不出现"。因此连续异常达阈值即判定引擎不可用，
  //   置 broken=true 让调用方立刻切换到 face-api。
  function detect(video, tsMs){
    if(!ready || !landmarker || broken) return null;
    try{
      let ts = tsMs != null ? tsMs : performance.now();
      if(ts <= lastTs) ts = lastTs + 1;   // detectForVideo 要求时间戳严格递增
      lastTs = ts;
      const res = landmarker.detectForVideo(video, ts);
      errStreak = 0;                       // 成功一次即清零，避免偶发抖动误判
      if(!res || !res.faceLandmarks || res.faceLandmarks.length === 0) return null;
      const lm = res.faceLandmarks[0];
      const matrix = (res.facialTransformationMatrixes && res.facialTransformationMatrixes.length)
        ? res.facialTransformationMatrixes[0].data : null;
      return { landmarks: lm, matrix };
    }catch(e){
      lastError = (e && e.message) ? e.message : String(e);
      if(++errStreak >= ERR_LIMIT){
        broken = true;
        console.error('[MPFace] 推理连续失败 ' + errStreak + ' 次，判定引擎不可用（多为缺少 WebGL/硬件加速），'
                      + '降级 face-api 68 点。末次错误：' + lastError);
      }
      return null;
    }
  }

  return {
    init,
    detect,
    get ready(){ return ready; },
    get failed(){ return failed; },
    // available：调用方唯一该依赖的判据 —— 已就绪【且】推理确实能跑
    get available(){ return ready && !broken; },
    get broken(){ return broken; },
    get lastError(){ return lastError; },
    get delegate(){ return delegateUsed; },
    get landmarker(){ return landmarker; }   // 调试/扩展用（正常业务请用 detect()）
  };
})();

window.MPFace = MPFace;
