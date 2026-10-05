/* LightBand：Message 首玩异象的横向光带。移植自原版 HLSLCC 产物
   PostEffects_LightBand.glsl（_analysis\shader_blob_c9_clean\）的 FRAGMENT 段。

   原版逐条对应（hlslcc 变量名 -> 这里）：
     u_xlat0.xy = uv - _BandPos                      -> d
     u_xlat0.x  = dot(d.xy, _BandNormal)             -> signed 沿带法线的有符号距离
     u_xlat0.x  = -_BandWidth*0.5 + abs(signed)      -> 到带中心的距离
     u_xlat4    = max(_BandSmoothness, 1e-5)         -> 避免除零（smoothstep 宽度）
     u_xlat0.x  = clamp(s / smooth, 0, 1)            -> 平滑衰减 0..1
     u_xlat4    = x*-2+3; x = x*x
     u_xlat0.x  = -u_xlat4*x + 1                     -> 1-(3x²-2x³)，即 x²(3-2x) 补光
     u_xlat4    = x*-2+1                            -> 亮度里的 (1-2x)
     x *= _BandBrightness; clamp(x,0,1)

   后面那几行是原版的"提亮补偿"：把颜色往 1-x 的方向推，再加回 luma 偏置，
   等价于用光带强度做屏幕混合。以下按原式照抄，未做化简。 */
precision highp float;
uniform sampler2D u_src;
uniform vec2  u_bandPos;       // _BandPos    带中心（uv 空间）
uniform vec2  u_bandNormal;    // _BandNormal 带法线
uniform float u_bandWidth;     // _BandWidth  半宽（除以 2 前的全宽）
uniform float u_bandSmooth;    // _BandSmoothness 边缘平滑
uniform float u_bandBright;    // _BandBrightness
varying vec2 v_uv;
void main() {
    vec2 d = v_uv - u_bandPos;
    float dist = -u_bandWidth * 0.5 + abs(dot(d, u_bandNormal));

    float w = max(u_bandSmooth, 0.00001);   // 原版 9.99999975e-06
    float x = dist / w;
    x = clamp(x, 0.0, 1.0);

    // 1 - (3x² - 2x³) = x²(3-2x)，原版这三步是折出来的补光项
    float t3 = x * -2.0 + 3.0;
    float x2 = x * x;
    x = (-t3) * x2 + 1.0;

    float lum01 = x * -2.0 + 1.0;          // 原版 u_xlat4 = 1 - 2x

    x = x * u_bandBright;
    x = clamp(x, 0.0, 1.0);

    vec4 base = texture2D(u_src, v_uv);
    /* ⚠ 2026-10-05 修正：原版 49-51 行是
         inv  = (-src) + 1          = 1-src
         u_xlat3 = (-src) + inv     = 1-2src      ★
         lit  = band * u_xlat3 + src
       之前把第 50 行误读成 inv+src = 1，带内 lit = band*1 + src >= 1，
       配合 2luma-lit 的补偿式恒 >= 1 ⇒ 整屏无条件刷白且与输入无关
       （Message t>=bandWidth 1 时全白、kaleido 开关零 diff 就是它）。 */
    vec3 inv = 1.0 - base.rgb;              // 原版 49: (-src)+1
    vec3 sum = -base.rgb + inv;             // 原版 50: (-src)+(1-src) = 1-2src
    vec3 lit = vec3(x) * sum + base.rgb;    // 原版 51
    float luma = dot(lit, vec3(0.212500006, 0.715399981, 0.0720999986));
    vec3 shifted = lit + (-vec3(luma));     // 原版 lit + (-luma.xxx)，去 luma
    // 原版 u_xlat4 = 1-2I：带内 I=1 → -1（outc = 2luma-lit，暗底被推白、亮部反向），
    // 带外 I=0 → +1（outc = lit，直通）
    vec3 outc = vec3(lum01) * shifted + vec3(luma);
    gl_FragColor = vec4(outc, base.a);      // alpha 沿用原图（原版 SV_Target0 未改 .w）
}