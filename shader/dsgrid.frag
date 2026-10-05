/* Hidden/DsGrid —— DesultorySignals 首玩异象的背景网格（加法合成）。

   移植自原版编译产物 _analysis\shader_blob_c9\Hidden_DsGrid.glsl（HLSLCC ES 3.00，
   从 c85f89d0….bundle / data.unity3d 的 compressedBlob LZ4 解出；导出的
   .shader 全是 DummyShaderTextExporter 占位符，真身只在 blob 里）。
   Render State（_analysis\kaleido_state.txt）：Blend = SrcAlpha/One（加法）、
   QUEUE=Transparent、zTest=Disabled。挂在 Background 层 effect Canvas 的
   2000x2000 Image（Grid）上，画在判定线/note 之下、黑幕之后。

   原版逐行语义（对照 dsgrid_clean.glsl）：
     p = fract(_Time.y * _ScaleSpeed)          // 脉冲相位，_ScaleSpeed 材质默认 1
     e = exp2(-p)                               // 内层缩放 e∈(0.5,1]，外层 2e
     uvIn  = (uv-0.5)*e  + 0.5，再乘 _MainTex_ST（材质里 10,10，即 FrameBase_0 平铺 10 次）
     uvOut = (uv-0.5)*2e + 0.5，同 ST
     每层取贴图 .xy：x=网格线（R），y=辉光（G）
     layer = t.x*_GridColor*_GridBrightness + t.y*_BloomColor*_BloomBrightness^3
     G(t)  = 1-(1-t.x*_GridBrightness)*(1-t.y*clamp(_BloomBrightness*10,0,1))
             —— 「线强度」，clamp 后同时当 alpha 用
     最终 rgb = lerp(内层 G·layer, 外层 G·layer, p)，
         a    = lerp(内 G, 外 G, p) * 顶点色a           // 顶点色 = Image.color，
                                                        //   a 来自 gridOpacity 曲线
     dst' = dst + rgb * a                               // SrcAlpha/One，在 shader 里做

   freeze：DesultorySignalsLevelEffects 在 nowTime >= freezeTime 时一次性
   SetFloat(_GridScaleSpeed, 0)（dump.cs 私有静态字段 _GridScaleSpeed），
   此后 p=fract(0)=0 ⇒ 脉冲定格；JS 侧按状态谓词喂 u_scaleSpeed=0（可逆）。 */
precision highp float;
uniform sampler2D u_src;       // 背景层当前内容
uniform sampler2D u_mainTex;   // _MainTex = FrameBase_0.png（R=网格线 G=辉光）
uniform vec2  u_mainTexST;     // _MainTex_ST.xy（材质 10,10；zw 恒 0）
uniform vec3  u_gridColor;     // 材质 (0.8066038, 0.990657, 1)
uniform vec3  u_bloomColor;    // 材质 (0.514151, 0.5749958, 1)
uniform float u_gridBright;    // 材质 0.57
uniform float u_bloomBright;   // 材质 0.59
uniform float u_scaleSpeed;    // 材质 1；freeze 后 0
uniform float u_time;          // _Time.y
uniform float u_opacity;       // Image.color.a = gridOpacity 曲线
varying vec2 v_uv;

void main() {
    vec4 base = texture2D(u_src, v_uv);

    float p = fract(u_time * u_scaleSpeed);
    float e = exp2(-p);
    vec2 c = v_uv - 0.5;
    vec2 uvIn = (c * e + 0.5) * u_mainTexST;
    vec2 uvOut = (c * (e + e) + 0.5) * u_mainTexST;

    vec2 t1 = texture2D(u_mainTex, uvIn).xy;
    vec2 t5 = texture2D(u_mainTex, uvOut).xy;

    float bb3 = u_bloomBright * u_bloomBright * u_bloomBright;
    vec3 layerIn = t1.x * u_gridColor * u_gridBright + t1.y * u_bloomColor * bb3;
    vec3 layerOut = t5.x * u_gridColor * u_gridBright + t5.y * u_bloomColor * bb3;

    float b10 = clamp(u_bloomBright * 10.0, 0.0, 1.0);
    float g1 = clamp(1.0 - (1.0 - t1.x * u_gridBright) * (1.0 - t1.y * b10), 0.0, 1.0);
    float g5 = clamp(1.0 - (1.0 - t5.x * u_gridBright) * (1.0 - t5.y * b10), 0.0, 1.0);

    vec3 rgb = mix(layerIn * g1, layerOut * g5, p);
    float a = mix(g1, g5, p) * u_opacity;

    // Blend SrcAlpha/One（fx pass 统一关着 BLEND，加法在 shader 里做）
    gl_FragColor = vec4(base.rgb + rgb * a, base.a);
}
