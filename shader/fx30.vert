#version 300 es

/* ES 3.00 版全屏三角形，给首玩异象的 GlitchDog 用。
   与 fx.vert 逻辑完全一致，只是 varying/gl_VertexID 换成 ES 3.00 的 in/out ——
   GLSL ES 1.00 与 3.00 的 shader 不能混在同一个 program 里链接。 */
in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}