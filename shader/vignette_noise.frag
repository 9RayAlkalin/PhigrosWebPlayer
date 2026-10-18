/* PostEffects/VignettePlus 噪声生成趟 —— 原版第 1 条 program
   （_analysis\vignetteplus_clean.txt 行 399–461 逐行转写，4.0.1 GLES3 blob）。

   原版结构（Renderer @0x1CD21EC 反编译复核，2026-10-18）：
     noiseBrightness <= 0 → 只 blit 应用趟，不建 RT；
     noiseBrightness > 0  → GetTemporary((int)(w*sampleRate), (int)(h*sampleRate))，
                            先 blit 本趟（pass1）写 RT，再 blit 应用趟（pass0）。
   ★ 每帧都重画 —— 所以噪声幅度跟着 noiseBrightness 曲线走（不是开局烘一次）。
     （这正是 2026-10-18 之前把噪声画成「低调云斑」的根因：那是照视频目测的形状，
      不是这里的 hash 场；视频里的细雪颗粒、亮度随 0.36→0.8→1.5 抬升，全部对得上。）

   数学 = 三段 Dave Hoskins「Hash without Sine」hash12 变体
        （fract(u*0.1031 + K) 链）→ rgb2hsv（Kogelnik 的 mix/step 写法）
        → hsv2rgb(h, sat*_NoiseSaturation, val) → × val × _NoiseBrightness → clamp。
   逐像素 hash 场：相邻像素独立 ⇒ 半分辨率 RT 放大 2× 后是 ~2px 粒度的细噪声，
   与视频里扫描线之间的闪烁细雪一致。

   变量名尽量保留 HLSLCC 的 u_xlatN 语义（u0/u1/u2 = 三条 hash 链的中间量）：
     cr = u0.x（第三链）、cg = u1.y（第二链）、cb = u1.x（第一链）→ HSV。
   注：原版 u_xlat16_* 是 mediump（真机 fp16）；这里写 highp —— 桌面浏览器
       的 mediump 本来就是 highp，且参与量都在 [0,1]，fp16 也只有 ~1e-3 差。 */
precision highp float;
uniform float u_time;         // 秒；_SinTime.xy = (sin(t/8), sin(t/4))
uniform float u_noiseBright;  // _NoiseBrightness（帧内幅度）
uniform float u_noiseSat;     // _NoiseSaturation（饱和上限）
varying vec2 v_uv;

void main() {
    vec2 ST = vec2(sin(u_time * 0.125), sin(u_time * 0.25));   // _SinTime.xy
    vec2 fc = gl_FragCoord.xy;

    // u_xlat0 = FragCoord.xyyx * _SinTime.xyyx
    vec4 u0 = vec4(fc.x * ST.x, fc.y * ST.y, fc.y * ST.y, fc.x * ST.x);
    // 两条 hash 输入（K 常量照抄：0.1031 = hash12 的魔数）
    vec4 u1 = u0 * 0.103100002 + vec4(6.09623432, 8.60783958, 8.60783958, 6.09623432);
    u0 = u0.wzwz * 0.103100002 + vec4(1.52148008, 7.41844368, 4.41411209, 2.25424623);
    u0 = fract(u0);
    u1 = fract(u1);
    u1 += vec4(0.322998047, 0.322998047, 33.6529999, 33.6529999);
    float d1 = dot(u1.xyx, u1.zww);
    u1.xy += d1;
    u1.x *= u1.x + u1.y;

    // u_xlat2 = u_xlat0.zwwz + K3（u0 是上面 fract 过的）
    vec4 u2 = u0.zwwz + vec4(0.374389648, 0.374389648, 33.7043915, 33.7043915);
    u0 = u0.xyyx + vec4(0.124023438, 0.124023438, 33.4540253, 33.4540253);
    float d2 = dot(u2.xyx, u2.zww);
    u2.xy += d2;
    u1.y = u2.x * (u2.x + u2.y);
    u1.xy = fract(u1.xy);

    // 第三链（给 hsv 的 r 分量用）
    float d3 = dot(u0.xyx, u0.zww);
    u0.xy += d3;
    float hx = fract(u0.x * (u0.x + u0.y));

    // --- rgb2hsv(c = (cr, cg, cb))，逐句对 GLSL 行 419–446 ---
    float cr = hx;        // u_xlat0.x
    float cg = u1.y;      // u_xlat1.y
    float cb = u1.x;      // u_xlat1.x

    float b11 = (cg >= cb) ? 1.0 : 0.0;              // step(cb, cg)
    vec4 p2;                                          // u_xlat16_2
    p2.x = b11 * (cg - cb) + cb;
    p2.y = b11 * (cb - cg) + cg;
    p2.z = b11 * 1.0 - 1.0;                           // u_xlat16_3.x=1 / .z=-1 的乘加
    p2.w = b11 * (-1.0) + 0.666666687;

    // u_xlat16_1.xyz = -u_xlat16_2.xyw；.w = -hx
    vec4 t1;
    t1.x = -p2.x;  t1.y = -p2.y;  t1.z = -p2.w;  t1.w = -hx;

    // u_xlat16_3 = u_xlat16_1 + u_xlat16_2.yzx（其中 .x 换成 +hx）
    vec4 q;                                           // u_xlat16_3
    q.x = t1.x + hx;
    q.y = t1.y + p2.y;
    q.z = t1.z + p2.z;
    q.w = t1.w + p2.x;

    float b5 = (hx >= p2.x) ? 1.0 : 0.0;              // step(p.x, c.r)
    q.xyz = vec3(b5) * q.xyz + p2.xyw;
    float qw = b5 * q.w + hx;

    float mn  = min(q.y, qw);
    float dv  = q.x - mn;
    float hue = (qw - q.y) / (dv * 6.0 + 1.00000001e-10) + q.z;
    float val = q.x;
    float sat = dv / (q.x + 1.00000001e-10);

    // --- hsv2rgb：p = |fract(h+K)*6-3|，clamp(p-1) → sat'*(p-1)+1，再 ×val×NB ---
    vec3 tt = abs(fract(vec3(abs(hue)) + vec3(1.0, 0.666666687, 0.333333343)) * 6.0 - 3.0);
    tt = clamp(tt - 1.0, 0.0, 1.0) - 1.0;
    vec3 rgb = (sat * u_noiseSat) * tt + vec3(1.0);
    gl_FragColor = vec4(clamp(val * u_noiseBright * rgb, 0.0, 1.0), 1.0);
}
