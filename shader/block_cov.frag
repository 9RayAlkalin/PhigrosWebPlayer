/* ≈ Unlit/BlockCompose —— 三趟 compose 压进一张 RGBA（HANDOFF §3.2 / §7-4）

   输入两张 mask canvas（原版那 6 个 w/8 mask RT 的打包）：
     u_mask  R = Active 覆盖、G = Disabled ∪ Ready 覆盖、B = Ready 覆盖
     u_sub   同上，但装的是减算块（isSubtract）的覆盖
   输出：
     .r = active 档覆盖（RUN0，**带位移**）
     .g = disabled∪ready 档覆盖（RUN1，**无位移**）
     .b = ready 档的 readyRaw（= readyNormal 与 readySubtract 的差，给 apply 算微光用）

   位移：off = 位移图两次采样（dir×t、perp×t）的平均 − 0.5，mask 按 off×_DisplaceStrength
   挪 uv。原版只有 BlockCompose 的 pass0 声明了 _DisplaceMap，pass1 没有 ⇒ 后两档
   uv 直取原 uv（u_strengthD 恒 0，见 main.js disp_uniforms 的说明）。

   减算必须过 SubtractBlockBlender（HANDOFF §5）——这是本文件唯一的非平凡差异：
     · active 档  out = band = [fade×c ≥ 0.9]   ⇒ 二值（step）
     · 其余档     y = raw<0.9 ? raw : 1         ⇒ 0.9 吸附（snap）
   原版 mask 里减算块的值还乘过 0.1（SpriteRenderer.color.a = 0.1），blender 的 0.09/0.12
   阈值、×10 回放都是在抵那个 0.1；本仓 canvas 存的是没乘 0.1 的 raw，所以阈值直接是 0.9。
*/
precision highp float;
uniform sampler2D u_mask;
uniform sampler2D u_sub;
uniform float u_strength;
uniform float u_strengthD;
uniform vec2 u_stA;
uniform float u_spA;
uniform vec2 u_stD;
uniform float u_spD;
uniform float u_tx;
varying vec2 v_uv;
#include "block_disp"

// SubtractBlockBlender pass1：raw < 0.9 留原值，否则弹到 1（原版 y = v×(band+1)×10 再 clamp）
float snap9(float x) { return x < 0.9 ? x : 1.0; }

void main() {
    vec2 offA, offD;
    disp_avg(v_uv, u_stA, u_spA, u_tx, 0.0, offA);
    disp_avg(v_uv, u_stD, u_spD, u_tx, 0.0, offD);

    vec2 uvA = v_uv + offA * u_strength;   // active 走位移后的 uv
    vec2 uvD = v_uv + offD * u_strengthD;  // disabled/ready 不位移（u_strengthD = 0）

    float subA = step(0.9, texture2D(u_sub, uvA).r);
    float subD = snap9(texture2D(u_sub, uvD).g);
    float subB = snap9(texture2D(u_sub, uvD).b);

    vec4 mA = texture2D(u_mask, uvA);
    vec4 mD = texture2D(u_mask, uvD);

    gl_FragColor = vec4(
        clamp(abs(mA.r - subA), 0.0, 1.0),
        clamp(abs(mD.g - subD), 0.0, 1.0),
        clamp(abs(mD.b - subB), 0.0, 1.0),
        0.0);
}
