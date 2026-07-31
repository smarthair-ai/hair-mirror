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
  function detect(video, tsMs){
    if(!ready || !landmarker) return null;
    try{
      let ts = tsMs != null ? tsMs : performance.now();
      if(ts <= lastTs) ts = lastTs + 1;   // detectForVideo 要求时间戳严格递增
      lastTs = ts;
      const res = landmarker.detectForVideo(video, ts);
      if(!res || !res.faceLandmarks || res.faceLandmarks.length === 0) return null;
      const lm = res.faceLandmarks[0];
      const matrix = (res.facialTransformationMatrixes && res.facialTransformationMatrixes.length)
        ? res.facialTransformationMatrixes[0].data : null;
      return { landmarks: lm, matrix };
    }catch(e){
      // 单帧异常（如时间戳/帧状态问题）不致命，下一帧重试
      return null;
    }
  }

  return {
    init,
    detect,
    get ready(){ return ready; },
    get failed(){ return failed; },
    get available(){ return ready; },
    get delegate(){ return delegateUsed; }
  };
})();

window.MPFace = MPFace;
