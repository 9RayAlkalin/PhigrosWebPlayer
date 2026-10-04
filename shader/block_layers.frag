/* ≈ Unlit/DisabledBlock —— 把 disabled（含 ready）的加法体先烘进场景
   （HANDOFF §6 / §3.8 / §7-6）

   原版这是一个 WorldSpace Canvas 上的 UI Image（Blend One/One 纯加法），由相机当普通
   几何渲进 CameraTarget —— 所以场景快照 sceneColorRT 里**已经含它**，而 active 方块
   是在 BeforeImageEffects 的命令缓冲里后画的、快照里没有它（§8-6）。web 没有第二条渲染
   路径，就在 apply 之前把这一层加进场景纹理，之后 apply 的 hue 源（scene6）自然也含它。

   覆盖取 compose 的 **G 通道 = Disabled ∪ Ready**（§7-2 的通道语义）：ready 段那会儿还没有
   disabled 覆盖，G 不含 ready 的话这一层就是空的。

   公式照抄 Unlit/DisabledBlock（GLSL 95–121，§3.5）：
     discard 若 covD < 1e-4
     rgb = covD × (avg×sparkTex×_SparkTint×_SparkMapOpacity + _FillColor×_FillOpacity)
     a   = vs_COLOR0.w（UI Image = 1），Blend One/One ⇒ 纯加法，alpha 不动
   位移无网格量化：DisabledBlock 里压根没有 _BackgroundPixelScale ⇒ disp_avg 的 snap = 0。
   （_FillOpacity 乘的是颜色不是 alpha，所以直接烘进 RGB。）
*/
precision highp float;
uniform sampler2D u_src;    // 场景（layers 之前）
uniform sampler2D u_cov;    // compose：.g = disabled∪ready 覆盖
uniform sampler2D u_spark;
uniform vec2 u_stD;
uniform float u_spD;
uniform float u_tx;
uniform vec3 u_fillD;
uniform float u_fillOpD;
uniform vec3 u_tintD;
uniform float u_sparkOpD;
uniform float u_sparkDispD;
uniform vec2 u_sparkSTD;
varying vec2 v_uv;
#include "block_disp"

void main() {
    vec3 src = texture2D(u_src, v_uv).rgb;
    float covD = texture2D(u_cov, v_uv).g;
    // 原版这里 discard；加法层 discard 与「加上 0」等价，直接早退省得白算位移
    if (covD < 1e-4) {
        gl_FragColor = vec4(src, 1.0);
        return;
    }

    vec2 offD;
    float avgD = disp_avg(v_uv, u_stD, u_spD, u_tx, 0.0, offD);
    float sD = texture2D(u_spark, v_uv * u_sparkSTD + offD * u_sparkDispD).r;
    vec3 fillD = u_fillD * u_fillOpD + sD * u_tintD * u_sparkOpD * avgD;

    gl_FragColor = vec4(src + covD * fillD, 1.0);
}
