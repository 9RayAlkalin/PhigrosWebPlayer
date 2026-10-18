/* PostEffects/VignettePlus —— 应用趟（_analysis\vignetteplus_clean.txt 行 198–232 逐行）：
     col = src
     if (_NoiseBrightness > 0) col = max(col, noiseRT * 0.4)   ← 噪声只「提亮暗部」
     col += scanline * _LineOpacity
        scanline = smoothstep01(max(sin(uv.y*850)*2 - 1, 0))   ← 850 rad/UV ≈ 每 8px@1080 一条
     col *= abs(1 - smoothstep01(clamp((dist-_Radius)/_Smooth, 0, 1)) * _Darkness)

   噪声源 = vignette_noise.frag（原生成趟）逐帧烘进半分辨率 RT 的 hash 场。
   ★ 2026-10-18 修正：旧版这里画的是「目测复刻的云斑」——错。原版 Renderer
     （0x1CD21EC）在 noiseBrightness>0 时每次都先 blit 生成趟再 blit 本趟，
     噪声是逐像素 hash 细雪、幅度随 noiseBrightness 曲线（0.36→0.8→1.5）变。
   注意应用趟自己**不**乘 _NoiseBrightness，只拿它当开关：
   幅度已经烘在 RT 里（生成趟 × val × NB）。 */
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_noiseTex;   // _NoiseCol（半分辨率噪声 RT）
uniform float u_radius;
uniform float u_smooth;
uniform float u_darkness;
uniform vec2 u_center;
uniform float u_noiseBright;    // _NoiseBrightness（>0 才吃噪声）
uniform float u_lineOpacity;    // _LineOpacity
varying vec2 v_uv;

void main() {
    vec4 src = texture2D(u_src, v_uv);
    vec3 c = src.rgb;

    if (u_noiseBright > 0.0)
        c = max(c, texture2D(u_noiseTex, v_uv).xyz * 0.4);

    float sl = max(sin(v_uv.y * 850.0) * 2.0 - 1.0, 0.0);
    sl = sl * sl * (3.0 - 2.0 * sl);
    c += vec3(sl * u_lineOpacity);

    float f = clamp((length(v_uv - u_center) - u_radius) / max(u_smooth, 1e-6), 0.0, 1.0);
    f = f * f * (3.0 - 2.0 * f);
    c = abs(1.0 - f * u_darkness) * c;

    gl_FragColor = vec4(c, src.a);
}
