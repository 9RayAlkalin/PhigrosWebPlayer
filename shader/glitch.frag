/* 三通道各自沿独立方向位移，(noise-0.5)*_GlitchRange 是位移量，
   uvG 从 uvR 累加、uvB 从 uvG 累加 —— 和 PostEffects_Glitch.glsl 一致。

   噪声图按原版材质的导入设置采样：Point + Repeat（filterMode 0 / wrapU,V 2）。
   线性过滤会把逐像素的位移抹成平滑扭曲，丢掉 glitch 该有的细碎块状感。 */
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_noise;
uniform float u_range;
uniform vec3 u_dirA;
uniform vec3 u_dirB;
uniform vec3 u_dirC;
varying vec2 v_uv;
void main() {
    vec3 d = (texture2D(u_noise, v_uv).rgb - 0.5) * u_range;
    vec2 uvR = v_uv + d.x * u_dirA.xy * u_dirA.z;
    vec2 uvG = uvR + d.y * u_dirB.xy * u_dirB.z;
    vec2 uvB = uvG + d.z * u_dirC.xy * u_dirC.z;
    gl_FragColor = vec4(
        texture2D(u_src, uvR).r,
        texture2D(u_src, uvG).g,
        texture2D(u_src, uvB).b,
        1.0);
}