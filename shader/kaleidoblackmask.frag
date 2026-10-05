/* KaleidoBlackMask：Message 首玩异象的万花筒（kaleido）材质。移植自原版 HLSLCC 产物
   Hidden_KaleidoBlackMask.glsl（_analysis\shader_blob_c9_clean\）的 FRAGMENT 段。

   注意：这是**材质 shader**而非 post-effect pass —— 它采 _Normal / _TransMap 两张图
   算出扭曲，用 HSL→RGB 色相旋转上色，最后按中心圆形遮罩混合。
   vs_COLOR0 是顶点色：rgb 作底色混合，a 作整体透明度（203-205 行）。
   网页端这里把底色固定为黑（vec3(0)）、alpha 固定 1，
   因为原版这个材质是贴在 blackMask Image 上的，底色/透明度由外部 Image 参数给。

   ── 原版结构 ──────────────────────────────────────────────────
   ① 与 GlitchDog 完全相同的 45° 扇区极坐标域变形（116-141 行）——
      两个 shader 共用这段代码，说明是同一个人写的公共部分。
   ② 用 _Normal 图的 rg 通道做偏移场，_TransMap 按该偏移扭曲后采样（142-153 行）。
   ③ HSL 色相旋转（154-190 行）：先把 RGB 转成 YIQ，
      按 _ColorContrast 调整后转回 HSL，加 _ColorHueShift 转 hue，
      再转回 RGB 并按 _ColorSaturation 调整饱和度。
      HLSLCC 那一大堆 u_xlat16_2/3/4 变量搬运是 HLSL 编译器把
      RGB↔HSL 的分支展开后的结果，下面按标准 HSL 公式重写（等价但可读）。
   ④ 中心圆形遮罩（191-202 行）：smoothstep(Radius - Smoothness, Radius, dist)，
      smoothstep 展开成 x²(3-2x)。 */
precision highp float;
uniform sampler2D u_normal;     // _Normal
uniform sampler2D u_transMap;   // _TransMap
uniform vec4  u_time;           // _Time
uniform vec2  u_normalST;       // _Normal_ST
uniform vec2  u_normalSTOff;    // _Normal_ST.zw
uniform vec2  u_transST;        // _TransMap_ST
uniform vec2  u_transSTOff;     // _TransMap_ST.zw
uniform float u_normalStrength; // _NormalStrength
uniform vec2  u_normalMoveDir;  // _NormalMoveDir
uniform float u_normalMoveSpeed;// _NormalMoveSpeed
uniform vec2  u_transMoveDir;   // _TransMoveDir
uniform float u_transMoveSpeed; // _TransMoveSpeed
uniform float u_colorHueShift;  // _ColorHueShift
uniform float u_colorContrast;  // _ColorContrast
uniform float u_colorSaturation;// _ColorSaturation
uniform float u_colorMixStrength;// _ColorMixStrength  ← 报告 §4.2 里被驱动的那个
uniform float u_centerMaskRadius;// _CenterMaskRadius
uniform float u_centerMaskSmooth;// _CenterMaskSmoothness
varying vec2 v_uv;

/* 原版 199-202：smoothstep(0,1,x) 展开成 x²(3-2x) */
float sstep01(float x) {
    float t = x * -2.0 + 3.0;
    return x * x * t;
}

/* 标准 RGB<->HSL（分支式，与 HLSLCC 展开的那堆 movc 等价）。
   HLSL 编译器把 HSL2RGB 的三分支内联成了选择链，这里用显式分支重写。 */
vec3 rgb2hsl(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float l = (mx + mn) * 0.5;
    float h = 0.0, s = 0.0;
    float d = mx - mn;
    if (d > 0.0) {
        s = l > 0.5 ? d / max(2.0 - mx - mn, 1e-10) : d / max(mx + mn, 1e-10);
        if (mx == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
        else                h = (c.r - c.g) / d + 4.0;
        h /= 6.0;
    }
    return vec3(h, s, l);
}
float hue2rgb(float p, float q, float h) {
    if (h < 0.0) h += 1.0;
    if (h > 1.0) h -= 1.0;
    if (h < 1.0 / 6.0) return p + (q - p) * 6.0 * h;
    if (h < 0.5)       return q;
    if (h < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - h) * 6.0;
    return p;
}
vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    if (s <= 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

void main() {
    /* ① 45° 扇区极坐标域变形（原版 116-141，与 GlitchDog 同一段） */
    vec2 c0 = vec2(v_uv.y, v_uv.x) - 0.5;
    float rmax = max(abs(c0.y), abs(c0.x));
    float rmin = min(abs(c0.y), abs(c0.x));
    float diag = rmin / rmax;
    float t = diag * diag;
    float f = t * 0.0208350997 + -0.0851330012;
    f = t * f + 0.180141002;
    f = t * f + -0.330299497;
    float fr = t * f + 0.999866009;
    float ang = fr * diag * -2.0 + 1.57079637;
    ang = (abs(c0.y) < abs(c0.x)) ? ang : 0.0;
    float a = fr * diag + ang + ((c0.y < -c0.y) ? -3.14159274 : 0.0);
    float mnx = min(c0.y, c0.x);
    float mxx = max(c0.y, c0.x);
    vec2 pc = c0;
    pc.y = ((mnx < -mnx) && (mxx >= -mxx)) ? -a : a;
    /* 原版 137-138 还算了 dot(c0,c0) 再 sqrt = |c0|，遮罩用 */
    float r0 = length(c0);

    /* ② 偏移场扭曲（原版 142-153） */
    vec2 tuv = pc * u_transST + u_transSTOff;
    vec2 nuv = pc * u_normalST + u_normalSTOff;
    vec2 mv = vec2(u_time.y * u_normalMoveSpeed, u_time.y * u_transMoveSpeed);
    tuv = u_transMoveDir * mv.y + tuv;
    nuv = u_normalMoveDir * mv.x + nuv;
    vec2 nOff = texture2D(u_normal, nuv).xy * 2.0 - 1.0;
    tuv = nOff * u_normalStrength + tuv;
    float dist0 = nOff.x * u_normalStrength + r0;

    vec3 trans = texture2D(u_transMap, tuv).xyz;
    vec3 rgb = trans - 0.5;
    rgb = rgb * u_colorContrast + 0.5;

    /* ③ 色相旋转 + 饱和度（原版 154-190） */
    vec3 hsl = rgb2hsl(rgb);
    hsl.x = fract(hsl.x + u_colorHueShift);
    vec3 outc = hsl2rgb(hsl);
    /* 饱和度：对照原版 HLSLCC 尾段（_kaleido_frag_orig.txt 132-135 行）：
         c    = u_xlat16_8 * u_xlat16_2.x        // 重建出的 HSL 颜色（=上面 outc）
         luma = dot(c, W)
         outc = _ColorSaturation * (c - luma) + luma   ← 即标准 mix(luma, c, sat)
       ⚠ 2026-10-05 修正：之前错读成 tmp=sat*c+(1-sat)/luma=dot(tmp*sat,..) 两段式，
       在 _ColorSaturation=10（材质静态值）下会算出几百的垃圾值，整帧 clamp 成白屏
       （Message t>=134 全白就是它）。标准式下 sat=10 只是把高饱和色推到过曝裁剪，
       灰色/低饱和区不受影响，与原版 framebuffer clamp 行为一致。 */
    float luma = dot(outc, vec3(0.212500006, 0.715399981, 0.0720999986));
    outc = vec3(u_colorSaturation) * (outc - vec3(luma)) + vec3(luma);
    /* 原版 190：整体乘 _ColorMixStrength —— 这就是被 kaleidoMix 曲线驱动的那个值 */
    outc *= u_colorMixStrength;

    /* ④ 中心圆形遮罩（原版 191-202） */
    float lo = max(u_centerMaskRadius - u_centerMaskSmooth, 0.0);
    float hi = max(lo + 9.99999975e-06, u_centerMaskRadius);
    float mask = sstep01(clamp((abs(dist0) - lo) / (hi - lo), 0.0, 1.0));

    /* 203-205：与顶点色混合（本移植固定底色黑、alpha 1） */
    vec3 base = vec3(0.0);
    gl_FragColor = vec4(outc * mask + base, 1.0);
}