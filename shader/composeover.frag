/* composeover：分层合成 pass —— note 层（over，straight alpha）盖在背景层（base）上。
   等价 canvas2D 的 source-over：out = over.rgb*a + base.rgb*(1-a)。
   两张贴图都走 UNPACK_PREMULTIPLY_ALPHA_WEBGL=false 上传（straight alpha）；
   背景层 alpha 恒 1（曲绘铺满整幅，黑幕/kaleido 也都输出 a=1）。
   为什么需要它：原版把 blackMask/kaleido/网格挂在 Background sorting layer 的
   effect Canvas 上（画在判定线/note 之下），Web 端拆成两张画布走 GL，
   这一趟把 GL 里处理过的背景和 note 层合回一帧，后续后处理链照旧整帧跑。 */
precision highp float;
uniform sampler2D u_base;   // 背景层（曲绘 ± 黑幕/kaleido/网格）
uniform sampler2D u_over;   // 判定线 + note + 打击特效（透明底）
varying vec2 v_uv;
void main() {
    vec4 b = texture2D(u_base, v_uv);
    vec4 o = texture2D(u_over, v_uv);
    float ia = 1.0 - o.a;
    gl_FragColor = vec4(o.rgb * o.a + b.rgb * ia, o.a + b.a * ia);
}
