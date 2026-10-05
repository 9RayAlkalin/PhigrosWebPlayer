#version 300 es

/* 本 shader 升到 GLSL ES 3.00：dFdx/dFdy 在 ES 1.00 需 OES_standard_derivatives
   扩展，而 ES 3.00 上下文里 getExtension 反而返回 false（已是内建），
   两套写法互相别扭。与 GlitchDog 一样直接对齐原版 #version 300 es，
   配套用 fx30.vert。 */

/* DimensionSlash：DesultorySignals 首玩异象的「维度切口」。移植自原版 HLSLCC 产物
   PostEffects_DimensionSlash.glsl（_analysis\shader_blob_c9_clean\）的 FRAGMENT 段。

   原版把 for(i=0;i<_SlashCount;i++) 完全展开成 5 段重复代码（看 u_xlat[0..4] 五个下标），
   这里是等价的循环写法。逐条的语义（以第 i 条为例）：

     p    = uv + accumulatedOffset - _SlashPosition[i].xy   // 先减去切口位置
     s    = dot(p, _SlashNormal[i].xy)                        // 沿法线的有符号距离
     sign = s < 0 ? -1 : 1                                    // 取绝对值用的符号
     accum= sign * _SlashOffset[i].xy + (上一步的 accum)      // 折射偏移，只在该侧生效
     fall = exp2(-abs(s) * _SlashLightFalloff * 1.44269502)   // exp2(x)=exp(x*ln2)，原版这么写
     lit += _SlashLightColor * (fall * _SlashStrength[i].x * _SlashLightStrength)

   ★ 注意「折射只加法线一侧」：sign 由当前条的 s 决定，accum 单向叠加，
     所以多条切口会依次把采样点推歪 —— 这是原版的核心观感，别简化成对称偏移。

   最后的三角形波折射（原版 168-178 行）：
     u = abs(accum) * 0.5 ; fract(u) ; 按 sign 取正负 ; *2-1 ; 1-abs(...)
   等价于 tri(x) = 1 - |2*fract(|x|/2) - 1|，即周期 1 的三角波。
   原版用 textureGrad（带梯度）而非 texture2D，是因为折射后导数无意义、
   必须用未扭曲坐标的屏幕空间导数来选 mip，避免高光带里出现 mip 接缝。

   _SlashCount 门控：不足 count 的槽位贡献 0（strength=0 即等价），
   这里显式跳过，既省算力也避免读到未初始化的槽位。 */
precision highp float;
uniform sampler2D u_src;
uniform vec2  u_slashPos[5];      // _SlashPosition[i].xy 切口位置
uniform vec2  u_slashNormal[5];   // _SlashNormal[i].xy  切口法线
uniform vec2  u_slashOffset[5];   // _SlashOffset[i].xy  折射量
uniform float u_slashStrength[5]; // _SlashStrength[i].x  该切口强度
uniform int   u_slashCount;       // _SlashCount        有效条数
uniform float u_lightStrength;    // _SlashLightStrength 全局强度
uniform float u_lightFalloff;     // _SlashLightFalloff  衰减系数
uniform vec3  u_lightColor;       // _SlashLightColor
in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 accum = vec2(0.0);
    vec3 lit = vec3(0.0);

    // 原版是展开的 5 段，这里循环；u_slashCount 之外原版贡献恒 0，等价跳过
    for (int i = 0; i < 5; i++) {
        if (i >= u_slashCount) break;

        vec2 p = accum + (-u_slashPos[i]);              // uv - 切口位置
        float s = dot(p, u_slashNormal[i]);
        float sign = s < 0.0 ? -1.0 : 1.0;

        accum = vec2(sign) * u_slashOffset[i] + accum;   // 只在该侧推，累加

        float fall = exp2(-abs(s) * u_lightFalloff * 1.44269502);
        lit += u_lightColor * (fall * u_slashStrength[i] * u_lightStrength);
    }

    // 三角形波折射：tri(x) = 1 - |2*fract(|x|/2) - 1|，周期 1
    vec2 tri = abs(accum) * 0.5;
    tri = fract(tri);
    tri = tri * 2.0 - 1.0;
    tri = -abs(tri) + 1.0;

    /* 原版用 textureGrad（带屏幕空间导数取 mip），避免折射带里出现 mip 接缝。
       ES 3.00 原生就有 textureGrad，直接照抄原版的做法：传未扭曲坐标 v_uv 的
       屏幕空间导数当梯度（不能用 tri 的导数 —— 那正是被扭曲的部分）。 */
    vec4 c = textureGrad(u_src, tri, dFdx(v_uv), dFdy(v_uv));

    fragColor = vec4(lit + c.rgb, c.a);
}