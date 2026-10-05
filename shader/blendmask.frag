/* blackMask 合成：src 与 rgba 做 alpha 混合，等价 Unity 里那层 UI Image。
   异象的 bgAlpha 曲线驱动 alpha（RGB 由游戏代码硬编码为 0，即纯黑）。
   alpha <= 0 时主调度会整条跳过，所以这里不再判断。

   混合用 straight alpha（Unity UI Image 的默认 SrcAlpha/OneMinusSrcAlpha）。 */
precision highp float;
uniform sampler2D u_src;
uniform vec4 u_rgba;      // rgb 硬编码 + a 来自 bgAlpha 曲线
varying vec2 v_uv;
void main() {
    vec4 c = texture2D(u_src, v_uv);
    gl_FragColor = vec4(mix(c.rgb, u_rgba.rgb, u_rgba.a), c.a);
}