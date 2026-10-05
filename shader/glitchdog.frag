#version 300 es

/* GlitchDog：DesultorySignals 首玩异象的核心 pass。移植自原版 HLSLCC 产物
   PostEffects_GlitchDog.glsl（_analysis\shader_blob_c9_clean\）的 FRAGMENT 段。

   ★ GLSL ES 3.00（需要 WebGL2）：_WireNoiseArray 是 sampler2DArray，
     ES 1.00 里没这个类型。原版本身也是 #version 300 es（HLSLCC 产物），
     所以直接对齐原版版本号。
     没有 WebGL2 时 fx_init 不会编译这个 program（见 fx_anomaly_available），
     GlitchDog 整条 pass 跳过 —— 而不是退化成固定帧，因为 ES 1.00 根本
     编译不过这个 shader。

   ── 原版结构 ──────────────────────────────────────────────────
   ① 极坐标域变形（136-161）：uv 取 (y,x) 相对 0.5，折叠到 45° 扇区，
      对半径做三次多项式重映射 f(r)，按象限加 ±pi 偏移。
   ② 位移采样（162-180）：_DisplaceMap 采 .x 映射成位移量。
   ③ 噪声演化（181-223）：_WireNoiseArray 是 sampler2DArray，
      算当前帧号 fract(t*evolve/frameCount)，采 floor 帧与 floor+1 帧，
      用 _SeamBlend 做帧间平滑过渡。
   ④ 掩膜 + 上色（224-250）：中心/边缘两个 smoothstep 距离掩膜，
      按 _ColorBlend 在 _CenterColor / _EdgeColor 间插值。
   ⑤ 块状遮罩叠加（251-263）：_GlitchMap 做对比度遮罩，叠到原图。

   数值一律照抄原版（含那些看着莫名其妙的常数），只做两件事：
     · 把重复的坐标变换提成函数（等价，HLSLCC 是展开的）
     · 去掉 hlslcc_movcTemp 那种逐分量 select 的搬运写法 */
precision highp float;
precision highp int;

uniform sampler2D u_src;           // _MainTex
uniform sampler2D u_displaceMap;   // _DisplaceMap
uniform sampler2D u_glitchMap;     // _GlitchMap
uniform highp sampler2DArray u_wireNoise; // _WireNoiseArray
in vec2 v_uv;
out vec4 fragColor;
uniform vec4  u_time;              // _Time (x: 时间；y: 演化用时间)
uniform vec2  u_noiseTexelSize;    // _WireNoiseArray_TexelSize.xy
uniform float u_noiseFrameCount;   // _NoiseFrameCount
uniform float u_noiseMoveSpeed;    // _NoiseMoveSpeed
uniform float u_noiseEvolveSpeed;  // _NoiseEvolveSpeed
uniform vec2  u_noiseScale;        // _NoiseScale
uniform vec2  u_noiseOffset;       // _NoiseOffset
uniform float u_seamBlend;         // _SeamBlend
uniform float u_centerMaskRadius;  // _CenterMaskRadius
uniform float u_centerMaskSmooth;  // _CenterMaskSmoothness
uniform float u_edgeMaskRadius;    // _EdgeMaskRadius
uniform float u_edgeMaskSmooth;    // _EdgeMaskSmoothness
uniform float u_displaceStrength;  // _DisplaceStrength
uniform vec2  u_displaceMapOffset; // _DisplaceMapOffset
uniform vec2  u_displaceMapScale;  // _DisplaceMapScale
uniform float u_displaceSpeed;     // _DisplaceSpeed
uniform float u_glitchMapBright;   // _GlitchMapBrightness
uniform float u_glitchMapContrast; // _GlitchMapContrast
uniform vec2  u_glitchMapOffset;   // _GlitchMapOffset
uniform vec2  u_glitchMapScale;    // _GlitchMapScale
uniform vec3  u_centerColor;       // _CenterColor
uniform vec3  u_edgeColor;         // _EdgeColor
uniform float u_colorBlend;        // _ColorBlend

/* 原版 HLSLCC 里的 movc 模式（166-176 / 187-196）合成的坐标变换：
     p = (uv + off - 0.5) * scale + 0.5      // 居中 + 缩放
     s = sign(p)                            // 记下原符号
     p = abs(p) * 0.5 ; p = fract(p)         // 折叠到 0..0.5 再取小数部分
     p = s < 0 ? -p : p                      // 按原符号还原
     p = 1 - abs(p * 2 - 1)                  // 三角波
   s 必须在 abs 之前取，所以单独传进来。 */
vec2 wrap_tri(vec2 p0) {
    vec2 s = step(0.0, p0);          // >=0 为 1，否则 0（原版用 >=/< 反向 select）
    vec2 p = abs(p0) * 0.5;
    p = fract(p);
    p = mix(-p, p, s);
    return -abs(p * 2.0 - 1.0) + 1.0;
}

/* 原版手写的 smoothstep(0,1,x) 展开：x²(3-2x) */
float sstep01(float x) {
    float t = x * -2.0 + 3.0;
    float x2 = x * x;
    return x2 * t;
}

void main() {
    /* ① 极坐标域变形（原版 136-161）
       注意原版取的是 (y, x)：u_xlat0.xy = vs_TEXCOORD0.yx - 0.5 */
    vec2 c0 = vec2(v_uv.y, v_uv.x) - 0.5;

    float rmax = max(abs(c0.y), abs(c0.x));      // 方框外接半径
    float rmin = min(abs(c0.y), abs(c0.x));
    float diag = rmin / rmax;                    // 归一化对角距离（rmax=0 时得 NaN，
                                                // 原版同样不保护，原点处本就无意义）

    /* f(r)：三次多项式（Horner 展开，原版 142-145） */
    float t = diag * diag;
    float f = t * 0.0208350997 + -0.0851330012;
    f = t * f + 0.180141002;
    f = t * f + -0.330299497;
    float fr = t * f + 0.999866009;

    /* 折叠到 45° 扇区：只有 |y| < |x|（上下三角）才加折角，否则为 0 */
    float ang = fr * diag * -2.0 + 1.57079637;
    ang = (abs(c0.y) < abs(c0.x)) ? ang : 0.0;
    float a = fr * diag + ang;

    /* y < 0 先加 -pi，再看是否第三象限取负 */
    float a2 = (c0.y < -c0.y) ? -3.14159274 : 0.0;
    a += a2;

    float mnx = min(c0.y, c0.x);
    float mxx = max(c0.y, c0.x);
    bool flip = (mnx < -mnx) && (mxx >= -mxx);
    vec2 pc = c0;
    pc.y = flip ? -a : a;

    /* ② 位移采样（原版 162-180） */
    vec2 dp = pc + u_time.x * u_displaceSpeed + u_displaceMapOffset;
    dp = (dp - 0.5) * u_displaceMapScale + 0.5;
    float disp = texture(u_displaceMap, wrap_tri(dp)).x - 0.5;
    float dispAmt = disp * u_displaceStrength;
    vec2 shifted = vec2(dispAmt) + pc;

    /* ③ 噪声演化（原版 181-223）
       噪声坐标还要把位移量加进去（原版 184 的 + u_xlat12.xx） */
    vec2 np = pc + u_time.x * u_noiseMoveSpeed + u_noiseOffset;
    np = (np - 0.5) * u_noiseScale + vec2(dispAmt);
    np = (np + 0.5) * 1.0;                 // 原版 *scale 后 +0.5
    vec2 nuv = wrap_tri(np);

    /* texel 映射（原版 197-199）：
       uv * (1 - texelSize) + texelSize/2 —— 从像素坐标映回 0..1 的居中采样 */
    vec2 texuv = nuv * ((-u_noiseTexelSize) + 1.0) + u_noiseTexelSize * 0.5;

    /* 帧号：保号 fract，再乘 frameCount 后拆 floor/fract */
    float ft = u_time.y * u_noiseEvolveSpeed / u_noiseFrameCount;
    float fs = fract(abs(ft));
    fs = (ft >= -ft) ? fs : -fs;
    fs *= u_noiseFrameCount;
    float layer = floor(fs);
    float lf = fract(fs);
    float layerNext = layer + 1.0;
    bool wrapNext = layerNext >= u_noiseFrameCount;

    /* 逐层采样：layer 与 layer+1 帧混合（层数到顶就绕回首层，
       对应原版 wrapNext ? 1.0 : layerNext） */
    float n0 = texture(u_wireNoise, vec3(texuv, layer)).x;
    float n1 = texture(u_wireNoise, vec3(texuv, wrapNext ? 1.0 : layerNext)).x;
    float noise = lf * (n1 - n0) + n0;

    /* 帧间混合（原版 216-223）：以 _SeamBlend*pi 为半宽做 smoothstep。
       帧号接近整数（lf 接近 0）时权重偏向旧帧，过渡平滑无跳变。 */
    float sb = 1.0 / (u_seamBlend * 3.14159274);
    noise *= sstep01(clamp(sb * lf, 0.0, 1.0));

    /* ④ 掩膜 + 上色（原版 224-250） */
    vec2 rot = vec2(sin(shifted.y), cos(shifted.y));
    float rm = length(vec2(shifted.x) * vec2(rot.x, rot.y));

    float mC = (rm - u_centerMaskRadius) / max(u_centerMaskSmooth, 9.99999975e-06);
    float mE = (rm - u_edgeMaskRadius)   / max(u_edgeMaskSmooth,   9.99999975e-06);
    mC = min(clamp(mC, 0.0, 1.0), 1.0);
    mE = min(clamp(mE, 0.0, 1.0), 1.0);

    /* 原版这段用的是 mediump vec3 u_xlat16_5，但只赋过 .x（另两个分量从未写入）。
       原版随后按 .xxx 取用 —— 语义就是「标量广播成三通道」，
       所以这里直接用标量 mask 再 broadcast()，等价且更清楚。 */
    float mask = clamp(noise * sstep01(mE) + sstep01(mC), 0.0, 1.0);

    vec3 tint = (-u_centerColor) + u_edgeColor;
    tint = vec3(u_colorBlend) * tint + u_centerColor;
    tint = vec3(mask) * tint + (-vec3(mask));
    tint = vec3(clamp(u_colorBlend, 0.0, 1.0)) * tint + vec3(mask);

    /* ⑤ 块状遮罩叠加（原版 251-263） */
    vec4 base = texture(u_src, v_uv);
    vec3 diff = abs((-tint) + base.rgb) - base.rgb;

    vec2 guv = v_uv + u_glitchMapOffset;
    guv = (guv - 0.5) * u_glitchMapScale + 0.5;
    float g = (texture(u_glitchMap, guv).x - 0.5) * u_glitchMapContrast + 0.5;
    float gc = clamp(g * u_glitchMapBright, 0.0, 1.0);

    fragColor = vec4(vec3(gc) * diff + base.rgb, base.a);
}