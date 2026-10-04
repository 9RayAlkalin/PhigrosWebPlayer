/* ≈ Unlit/ActiveBlock / ReadyBlock（disabled 已由 block_layers.frag 接管，§7-6）
   按覆盖把 active 的填色/描边/辉光与 ready 的呼吸微光加起来，再压到场景上。
   disabled 体不再在这儿画：layers 趟已把 covG×fillD 烘进 u_src（= scene 含 layers 的那张），
   hue 源 u_scene6 也是 layers 之后的快照 —— 双重曝光就是这么避免的（HANDOFF §10.1）。

   位移图（BlockNoise1）全程只当「坐标扰动 + 亮度调制」，不直接进画面 —— 这是关键，
   之前把它当可见噪声叠上去是错的。 */
precision highp float;
uniform sampler2D u_src;     // 场景（已含 layers 加法层）
uniform sampler2D u_scene6;  // /6 Point 快照 = 原版 sceneColorRT，hue 源（unit 5）
uniform sampler2D u_cov;
uniform sampler2D u_ring;    // effectRT：R=edge、G=glow（§8-1 双通道）
uniform sampler2D u_spark;
uniform vec2 u_ringRes;      // bring 实际尺寸（原版 _EffectRT_TexelSize），eA 格心 snap 用
uniform float u_strength;
uniform vec2 u_stA;
uniform float u_spA;
uniform float u_tx;
uniform float u_ty;
uniform vec3 u_fillA;
uniform float u_fillOpA;
uniform float u_fillStrA;
uniform vec3 u_edgeA;
uniform float u_edgeOpA;
uniform vec3 u_glowA;
uniform float u_glowIntA;
uniform vec3 u_tintA;
uniform float u_sparkOpA;
uniform float u_sparkDispA;
uniform float u_hueA;
uniform vec2 u_sparkSTA;
uniform float u_dispBlendA;
uniform vec3 u_shineCol;
uniform float u_shineBright;
uniform float u_shineSpeed;
varying vec2 v_uv;
#include "block_disp"
vec3 rgb2hsv(vec3 c) {
    /* abs(...) 在函数内部 —— 与原版 shader_glsl2 行 321 的 `abs(hue)` 等价，
       spark 分量加在函数外侧、顺序也一致 ⇒ item 7（hue abs）本文件天然满足。 */
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 overlay(vec3 b, vec3 s) {
    return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b));
}
void main() {
    vec4 cov = texture2D(u_cov, v_uv);
    float a = cov.r;
    // r = composeD × readyRaw：cov.g 是 composeD（disabled∪ready 的合成），
    // cov.b 是 readyRaw（§7-4 变成 |snap(sub.b) − mD.b|）—— 不是裸的 cov.b
    float r = cov.g * cov.b;

    /* eA 在**格心**采样（原版 _EffectRT_TexelSize 的非线性格心，§3.4 行 199–217）；
       gA 用原 uv。两者的 uv 不同，各采各的。 */
    vec2 uvRing = (floor(v_uv * u_ringRes) + 0.5) / u_ringRes;
    float eA = texture2D(u_ring, uvRing).r;
    float gA = texture2D(u_ring, v_uv).g;

    // 早退门只看 active 相关量（d 已由 layers 接管，不再参与）
    if (max(a, max(r, max(eA, gA))) < 0.002) {
        gl_FragColor = texture2D(u_src, v_uv);
        return;
    }

    vec2 offA;
    float avgA = disp_avg(v_uv, u_stA, u_spA, u_tx, 1.0, offA);
    // ---- Active：位移后的场景采样只用来给填色取色（hue / 火花），
    //      画面基准仍是未位移的原背景 —— 见下面 bg 处的说明 ----
    vec3 refr = texture2D(u_scene6, disp_snap(v_uv) + offA * u_strength).rgb;
    float sA = texture2D(u_spark, v_uv * u_sparkSTA + offA * u_sparkDispA).r;
    vec3 sparkA = sA * u_tintA * u_sparkOpA * avgA;
    vec3 hsv = rgb2hsv(refr) + sparkA * u_hueA;
    vec3 fillA = mix(u_fillA - avgA * u_dispBlendA, overlay(hsv2rgb(hsv), sparkA), u_fillStrA);

    /* ---- 描边/辉光（原版行 220–222、352、355–356）：
       edge  = eA × _EdgeOpacity
       glow  = gA × (1 − (eA + covA)) × _GlowIntensity   ← 差 (2)：漏乘的抑制项
       体分支总闸 = eA + covA + gA > 1e-4（行 219，不含 r、不含 touch）——
       不满足时体 = 0、alpha = 0，但下面的 r² 微光在体分支之外，照样加。 */
    float edge = eA * u_edgeOpA;
    float glow = gA * (1.0 - (eA + a)) * u_glowIntA;

    vec3 body = vec3(0.0);
    float alpha = 0.0;
    if (eA + a + gA > 1e-4) {
        body = a * fillA + edge * u_edgeA + glow * u_glowA;
        alpha = clamp(a * u_fillOpA + edge + glow, 0.0, 1.0);
    }

    /* ---- Ready 微光（原版行 363–371、545）：
       r_gate = r > 1e-4 ? r : 0；breath = sin(t×_ShineSpeed)×0.5+1 ∈ [0.5, 1.5]
       rgb = shine_setup × r_gate + body ⇒ r²、只进 rgb，alpha 此后不再被写。
       与 ReadyBlock 宿主那份同值 —— web 只算这一次，别双算（§6）。 */
    float r_gate = r > 1e-4 ? r : 0.0;
    float breath = sin(u_ty * u_shineSpeed) * 0.5 + 1.0;
    vec3 acc = body + (r_gate * breath * u_shineBright * u_shineCol) * r_gate;

    /* 原版这趟 pass 的输出里没有场景项（RGB 只有 填色*覆盖 + 描边 + 辉光 + 微光），
       背景是 alpha 混合时从帧缓冲拿的 —— 也就是未位移的场景。
       拿位移后的采样当底，会把方块内部整片背景挪走，边界上撕出一道接缝，
       描边/辉光看着就和外面错开了。位移只该体现在方块的轮廓与填色上。
       Blend One/OneMinusSrcAlpha（premult）⇒ dst = rgb + bg×(1−alpha)；
       直接这么写而不用 mix()，否则 alpha=0 时（只有微光、无体）微光会被 mix 吞掉。 */
    vec3 bg = texture2D(u_src, v_uv).rgb;
    gl_FragColor = vec4(acc + bg * (1.0 - alpha), 1.0);
}
