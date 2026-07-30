/* =========================================================================
 * analysis.js — 人脸检测 / 关键点提取 / 面部分析
 * 使用本地 face-api.js 模型，所有计算在浏览器内完成，照片不上传。
 * ========================================================================= */

const FaceAnalyzer = (() => {
  let modelsLoaded = false;
  let loadPromise = null;

  async function init() {
    if (modelsLoaded) return true;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (typeof faceapi === 'undefined') throw new Error('face-api.js 未加载');
      const MODEL_URL = 'js/models';
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      modelsLoaded = true;
      return true;
    })();
    return loadPromise;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // 由 68 关键点判定脸型（中文标签）
  function classifyFaceShape(pts) {
    const W = (() => { // 颧骨/面中宽度：取 1..15 最外 x 差
      let minX = Infinity, maxX = -Infinity;
      for (const i of [1,2,3,4,5,6,7,9,10,11,12,13,14,15]) {
        minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
      }
      return maxX - minX;
    })();
    const FW = dist(pts[18], pts[25]);      // 额头宽（眉外缘）
    const JW = dist(pts[4], pts[12]);       // 下颌宽（下颌角）
    const topY = Math.min(...pts.slice(17,27).map(p => p.y)); // 发际线附近
    const L = dist(pts[8], { x: pts[27].x, y: topY });        // 脸长
    const LWR = L / W, fwR = FW / W, jwR = JW / W;

    if (LWR >= 1.55 && fwR >= 0.92) return '长脸';
    if (fwR > jwR + 0.07 && jwR < 0.86) return '心形脸';
    if (fwR < 0.9 && jwR < 0.9 && W >= JW && W >= FW) return '菱形脸';
    if (LWR >= 1.38 && jwR < 0.95) return '鹅蛋脸';
    if (LWR <= 1.28 && fwR > 0.92 && jwR > 0.9) return '圆脸';
    if (Math.abs(fwR - 1) < 0.09 && Math.abs(jwR - 1) < 0.11) return '方脸';
    return '鹅蛋脸';
  }

  // 由图像采样额头肤色 → 冷暖调
  function sampleSkinTone(ctx, pts, Wimg, Himg) {
    const topY = Math.min(...pts.slice(17,27).map(p => p.y));
    const browY = Math.max(...pts.slice(17,27).map(p => p.y));
    const cx = pts[27].x;
    const x0 = Math.max(0, cx - Wimg * 0.06), x1 = Math.min(Wimg, cx + Wimg * 0.06);
    const y0 = Math.max(0, topY + 2), y1 = Math.min(Himg, browY - (browY - topY) * 0.25);
    let r = 0, g = 0, b = 0, n = 0;
    try {
      const img = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      for (let i = 0; i < img.length; i += 4) { r += img[i]; g += img[i+1]; b += img[i+2]; n++; }
    } catch (e) { /* 跨域或被限制时忽略 */ }
    if (n === 0) return { tone: 'neutral', color: '#e8c9a8' };
    r = Math.round(r/n); g = Math.round(g/n); b = Math.round(b/n);
    let tone = 'neutral';
    if (r - b >= 12) tone = 'warm';
    else if (b - r >= 4) tone = 'cool';
    // 渲染用肤色：稍微提亮
    const lift = c => Math.min(255, Math.round(c + (255 - c) * 0.18));
    const color = `rgb(${lift(r)},${lift(g)},${lift(b)})`;
    return { tone, color, raw: [r,g,b] };
  }

  // 主分析：传入 <video> 或 <img>，返回面部指标
  async function analyze(mediaEl) {
    await init();
    const Wimg = mediaEl.videoWidth || mediaEl.naturalWidth || mediaEl.width;
    const Himg = mediaEl.videoHeight || mediaEl.naturalHeight || mediaEl.height;
    if (!Wimg || !Himg) throw new Error('无法读取图像尺寸');

    const detectOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const detection = await faceapi.detectSingleFace(mediaEl, detectOpts)
      .withFaceLandmarks();
    if (!detection) throw new Error('未检测到人脸，请正对摄像头或切换手动模式');

    const pts = detection.landmarks.positions;
    const faceShape = classifyFaceShape(pts);

    // 像素采样需把媒体画到离屏 canvas
    const off = document.createElement('canvas');
    off.width = Wimg; off.height = Himg;
    const octx = off.getContext('2d');
    octx.drawImage(mediaEl, 0, 0, Wimg, Himg);
    const skin = sampleSkinTone(octx, pts, Wimg, Himg);

    // 基础脸型测量：长宽比、颧骨宽、额头宽、下颌宽
    const W = (() => { let a=Infinity,b=-Infinity; for(const i of [1,2,3,4,5,6,7,9,10,11,12,13,14,15]){a=Math.min(a,pts[i].x);b=Math.max(b,pts[i].x);} return b-a; })();
    const topY = Math.min(...pts.slice(17,27).map(p=>p.y));
    const L = dist(pts[8], {x:pts[27].x,y:topY});
    const FW = dist(pts[17], pts[26]);
    const JW = dist(pts[4], pts[12]);
    const metrics = {
      faceLength: Math.round(L), faceWidth: Math.round(W), cheekWidth: Math.round(W),
      foreheadWidth: Math.round(FW), jawWidth: Math.round(JW),
      LWR: +(L / W).toFixed(2)
    };

    // 性别估算（基于面部几何特征）
    const genderEst = estimateGender(pts);

    return {
      hasDetection: true,
      faceShape,
      skinTone: skin.tone,
      skinColor: skin.color,
      metrics,
      landmarks: pts,
      genderEstimate: genderEst  // { gender, confidence, method }
    };
  }

  // 由 68 关键点估算性别（基于面部几何特征：下颌宽/颧骨宽比、眉间距/脸宽比、脸长宽比等）
  // 返回 { gender: 'male'|'female', confidence: 0~1, method: 'landmark' }
  function estimateGender(pts) {
    // ① 下颌角宽（pts 4-12）与颧骨宽比：男性下颌更宽方
    const jawW = dist(pts[4], pts[12]);
    let minX = Infinity, maxX = -Infinity;
    for (const i of [1,2,3,4,5,6,7,9,10,11,12,13,14,15]) {
      minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    }
    const cheekW = maxX - minX;
    const jawRatio = jawW / Math.max(1, cheekW);  // 男性 ≈0.93，女性 ≈0.78

    // ② 眉间距（pts 22-27 内眉内缘）与脸宽比：男性眉间距相对脸宽更窄
    const browInnerDist = dist(pts[22], pts[27]);
    const browRatio = browInnerDist / Math.max(1, cheekW);  // 男性 ≈0.22，女性 ≈0.31

    // ③ 脸长宽比：男性脸更长
    const topY = Math.min(...pts.slice(17,27).map(p => p.y));
    const faceL = dist(pts[8], { x: pts[27].x, y: topY });
    const LWR = faceL / Math.max(1, cheekW);  // 男性 ≈1.42，女性 ≈1.25

    // ④ 下颌角到下巴的距离比（男性下颌角位置更低、更突出）
    const jaw4Y = pts[4].y, jaw12Y = pts[12].y;
    const jawDrop = ((jaw4Y + jaw12Y) / 2 - topY) / Math.max(1, faceL);

    // 综合评分：正数倾向男性，负数倾向女性
    // 权重经调优：jawRatio×35 + browRatio×50 + LWR×20 + jawDrop×8
    let score = 0;
    score += (jawRatio - 0.85) * 35;   // 下颌比阈值 0.85
    score += (0.27 - browRatio) * 50;  // 眉间距阈值 0.27
    score += (LWR - 1.30) * 20;        // 长宽比阈值 1.30
    score += (jawDrop - 0.74) * 8;     // 下颌角阈值 0.74

    // sigmoid → 0~1 概率
    const prob = 1 / (1 + Math.exp(-score));
    const gender = prob >= 0.5 ? 'male' : 'female';
    const confidence = Math.abs(prob - 0.5) * 2;  // 0~1，越高越确定

    return { gender, confidence: Math.min(1, Math.max(0.1, confidence)), method: 'landmark' };
  }

  return { init, analyze, classifyFaceShape, estimateGender };
})();
