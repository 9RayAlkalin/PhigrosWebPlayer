/* ≈ Unlit/EdgeMask + Unlit/GlowMask（HANDOFF §3.3 / §3.7 / §7-5）

   原版 RenderEffects 每帧：
     ClearRenderTexture(effectRT)
     → edge：edgeSize==1 ⇒ 直接 Blit(compose → effectRT, edgeMat, pass1)
              out.x = clamp(dilate9(_MainTex.x) − _ComposeRT.x, 0, 1)，y 写 0
     → glow：5 趟 ping-pong（pass0）把辉光一圈圈累加，最后 Blit(pingA → effectRT, pass1)
              out = (0, _MainTex.y)
   两条 Blit 都是覆盖混合（Blend One/Zero），但 **ColorMask 把两边隔开**：EdgeMask#1 只写 R
   （colMask 8）、GlowMask#1 只写 G（colMask 4）⇒ **effectRT = (R = edge, G = glow)**。
   这就是 §8-1 的裁决，旧记录「glow 把 edge 抹掉」是漏看 ColorMask。

   本文件把上面这套压成两种 mode：
     u_mode = 1   glow 趟（写进 pingA/pingB）：R = 膨胀工作通道、G = 辉光累积，
                  对应原版 GlowMask pass0 的 ColorMask 12 = R+G
     u_mode = 0   合成趟（写进 effectRT = bring）：R = dilate9(compose) − compose、
                  G = ping 的 .y、B/A = 0。等价于原版「edge 先写 R、glow 后写 G」的
                  最终状态（两边互不依赖，先后顺序不影响结果），顺带避开
                  「写 bring 的同时又采样 bring」这种 FBO 回读。

   步长 = 1 effectRT texel = **4 屏幕 px**（_DilateTexelSize = 1/effectRT 尺寸，而
   effectRT = w/4）。输入 compose 是 /8 Point 贴图：/4 的格心去点 /8 必然半格错位，
   +4px 落右半格、−4px 落左格 —— 这个非对称是原版行为，照抄，别"修正"。
   （EdgeMask/GlowMask 的输入只有 compose 的 R 通道：Unlit/DisabledBlock 压根没有描边/
     辉光项，Disabled 不参与，免得给 Disabled 也描一圈白边。）
*/
precision highp float;
uniform sampler2D u_cov;    // composedEnabled：/8 Point，只取 .r
uniform sampler2D u_main;   // mode1 = 上一趟 ping（首趟也是 compose）；mode0 = 刚算完的 ping
uniform vec2 u_texel;       // 1 / effectRT 尺寸
uniform float u_mode;       // 0 = 合成趟、1 = glow 膨胀趟
uniform float u_weight;     // 本趟权重 w(i) = pow(R−i, f) / Σ_{k=1..R} pow(k, f)
uniform float u_first;      // 首趟 = 1：只写 weight×shell，之后累加
varying vec2 v_uv;

/* dilate9 = 中心 + 8 邻取最大（原版 _DilateTexelSize 步长的 3×3 膨胀）。 */
float dil9_cov(vec2 uv) {
    vec2 d = u_texel;
    float m = texture2D(u_cov, uv).x;
    m = max(m, texture2D(u_cov, uv + vec2( d.x,  0.0)).x);
    m = max(m, texture2D(u_cov, uv + vec2(-d.x,  0.0)).x);
    m = max(m, texture2D(u_cov, uv + vec2(0.0,  d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2(0.0, -d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2( d.x,  d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2(-d.x, -d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2( d.x, -d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2(-d.x,  d.y)).x);
    return m;
}

float dil9_main(vec2 uv) {
    vec2 d = u_texel;
    float m = texture2D(u_main, uv).x;
    m = max(m, texture2D(u_main, uv + vec2( d.x,  0.0)).x);
    m = max(m, texture2D(u_main, uv + vec2(-d.x,  0.0)).x);
    m = max(m, texture2D(u_main, uv + vec2(0.0,  d.y)).x);
    m = max(m, texture2D(u_main, uv + vec2(0.0, -d.y)).x);
    m = max(m, texture2D(u_main, uv + vec2( d.x,  d.y)).x);
    m = max(m, texture2D(u_main, uv + vec2(-d.x, -d.y)).x);
    m = max(m, texture2D(u_main, uv + vec2( d.x, -d.y)).x);
    m = max(m, texture2D(u_main, uv + vec2(-d.x,  d.y)).x);
    return m;
}

void main() {
    if (u_mode > 0.5) {
        /* glow 趟（GlowMask pass0）：
             d      = dilate9(_MainTex.x)                       膨胀工作通道
             shell  = clamp(d − center.x, 0, 1) × (1 − compose) 只留新长出来的一圈，且不进方块内部
             y      = 首趟 weight×shell，之后 weight×shell + center.y（累加）
           首趟的 _MainTex 就是 compose 本身，之后是上一趟的 ping ⇒ ping.x 逐趟外扩，
           正好 5 趟 = 5 texel = 20 屏幕 px（权重 w(5) < 0.01 被阈值切掉，见 §3.3）。 */
        vec2 c = texture2D(u_main, v_uv).xy;
        float d = dil9_main(v_uv);
        float shell = clamp(d - c.x, 0.0, 1.0) * (1.0 - texture2D(u_cov, v_uv).x);
        float y = u_first > 0.5 ? u_weight * shell : u_weight * shell + c.y;
        gl_FragColor = vec4(d, y, 0.0, 0.0);
    } else {
        /* 合成趟：edge 一次到位，glow 把 ping 累积的 .y 搬过来。 */
        float c0 = texture2D(u_cov, v_uv).x;
        float edge = clamp(dil9_cov(v_uv) - c0, 0.0, 1.0);
        float glow = texture2D(u_main, v_uv).y;
        gl_FragColor = vec4(edge, glow, 0.0, 0.0);
    }
}
