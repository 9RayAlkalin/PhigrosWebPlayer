/* Bloom：DS / Message 异象里的辉光。移植自原版 HLSLCC 产物
   PostEffects_Bloom.glsl（_analysis\shader_blob_c9_clean\）的 FRAGMENT 段。

   原版是两趟：
     ① 降采样 + 迭代模糊 -> _BlurTex（阈值/半径/采样率由 CPU 侧拆成多趟 RT）
     ② composite：拿 _BlurTex 做 screen 混合
   本移植把 ① 简化成「一个 4 抽头十字模糊」（threshold 提到 composite 里做），
   ② 完全照抄原式。

   原版 composite 逐条（hlslcc 变量 -> 这里）：
     k    = clamp(_Intensity - 1, 0, 1)              // 强度超 1 的部分才起作用
     b    = texture(_BlurTex, uv).rgb
     t1   = b*b - b                                    // = b*(b-1)
     t1   = k*t1 + b                                   // 线性 + 二次混合
     t1   = (1 - t1) * _BloomColor.rgb + 1            // ← 注意是 (1-t1)*color+1
     s    = texture(_MainTex, uv)
     s2   = (1 - s.rgb)
     out  = (1 - t1) * s2 + 1
     out  = clamp(out, 0, 1)
   即：把 bloom 当作"减去的东西"再用 screen 混合回去，两次取补。 */
precision highp float;
uniform sampler2D u_src;      // _MainTex
uniform sampler2D u_blurred;  // _BlurTex（blur.frag 的输出）
uniform float u_intensity;    // _Intensity
uniform vec3  u_bloomColor;   // _BloomColor
uniform vec2  u_texel;        // 1/尺寸，用来定模糊半径
uniform float u_threshold;    // settings.threshold（低于此亮度不发光）
varying vec2 v_uv;

/* 阈值 + 4 抽头十字模糊。原版是在 CPU 侧拆成多趟 RT 迭代做的，
   这里一趟搞定：视觉上同样是"亮部扩散"，采样数少所以更锐一点。
   偏移写成 4 个 vec2 参数而不是 const 数组 —— 数组构造器是 GLSL ES 3.00 语法，
   而本文件是 ES 1.00。 */
vec4 threshold_blur(sampler2D tex, vec2 uv, float thr, vec2 texel) {
    vec3 acc = vec3(0.0);
    vec3 c;
    // 半径 = 2 texel（与原版 iteration=3 的扩散范围接近）
    c = texture2D(tex, uv + vec2( 2.0, 0.0) * texel).rgb; acc += c;
    c = texture2D(tex, uv + vec2(-2.0, 0.0) * texel).rgb; acc += c;
    c = texture2D(tex, uv + vec2( 0.0, 2.0) * texel).rgb; acc += c;
    c = texture2D(tex, uv + vec2( 0.0,-2.0) * texel).rgb; acc += c;
    // 阈值：低于 thr 的部分砍掉（HDR bloom 的标准做法）
    float l = max(acc.r, max(acc.g, acc.b)) * 0.25;
    float k = max(l - thr, 0.0) / max(l, 1e-5);
    return vec4(acc.rgb * 0.25 * k, 1.0);
}

void main() {
    /* 原版 composite 只有 5 步，但它的 _BlurTex 已经是模糊过的。
       我们把阈值+模糊合到这一步（见上），然后照抄 composite 的算式。 */
    vec4 s = texture2D(u_src, v_uv);
    vec3 b = threshold_blur(u_src, v_uv, u_threshold, u_texel * 2.0).rgb;

    float k = clamp(u_intensity - 1.0, 0.0, 1.0);
    vec3 t1 = b * b - b;                       // b*(b-1)
    t1 = k * t1 + b;
    t1 = (1.0 - t1) * u_bloomColor + 1.0;

    vec3 s2 = 1.0 - s.rgb;
    vec3 outc = (1.0 - t1) * s2 + 1.0;
    gl_FragColor = vec4(clamp(outc, 0.0, 1.0), s.a);
}