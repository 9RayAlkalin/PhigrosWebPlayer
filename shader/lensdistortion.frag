/* LensDistortion：桶形畸变，三首异象都用。移植自原版 HLSLCC 产物
   PostEffects_LensDistortion.glsl（_analysis\shader_blob_c9_clean\）的 FRAGMENT 段。

   原版逐条（hlslcc 变量 -> 这里）：
     // 先算出"画面在该点对应的归一化半径"，作为畸变基准
     half = max(1 - _Center, _Center)          // 1-Center 与 Center 取大者 = 外侧边距
     base = length(vec2(half.y*_Aspect, half.x)) * _Size      // 外接半径
     d    = uv - _Center
     r    = length(vec2(d.x*_Aspect, d.y)) / max(base, 1e-5)    // 归一化半径 0..1
     k    = 1 - r*r * _Convergence                            // 桶形：r 越大缩得越多
     uvw  = d * k + _Center

     // 越界判定（两个边分别算，取较严的那个）
     o = min(1 - uvw, uvw)          // 逐分量
     e = clamp(min(o.x, o.y) / max(_EdgeSmoothness, 1e-5), 0, 1)
     e = e*e*(3-2e)                  // smoothstep

     out = texture(_MainTex, uvw) * e

   _Convergence = 0 时无畸变；正数 = 桶形（画面边缘向内收）；
   负数 = 枕形。三个 settings 里它都由 conv/convergence 曲线驱动。 */
precision highp float;
uniform sampler2D u_src;      // _MainTex
uniform vec2  u_center;       // _Center
uniform float u_size;         // _Size
uniform float u_convergence;  // _Convergence
uniform float u_aspect;       // _Aspect
uniform float u_edgeSmooth;   // _EdgeSmoothness
varying vec2 v_uv;

void main() {
    // 基准半径：画面外接框（考虑宽高比）的大小
    vec2 half_ = max(vec2(1.0) - u_center, u_center);
    float base = length(vec2(half_.y * u_aspect, half_.x)) * u_size;
    base = max(base, 9.99999975e-06);

    // 当前点相对中心的偏移与其归一化半径
    vec2 d = v_uv - u_center;
    float r = length(vec2(d.x * u_aspect, d.y)) / base;

    // 桶形缩放
    float k = 1.0 - r * r * u_convergence;
    vec2 uvw = d * k + u_center;

    // 越界平滑（把畸变后落到画面外的部分淡出，避免硬边）
    vec2 o = min(vec2(1.0) - uvw, uvw);
    float e = clamp(min(o.x, o.y) / max(u_edgeSmooth, 9.99999975e-06), 0.0, 1.0);
    e = e * e * (e * -2.0 + 3.0);

    gl_FragColor = texture2D(u_src, uvw) * vec4(e);
}