/* 全屏三角形，顶点顺序无所谓，靠 a_pos 直接铺满 NDC。

   uv 不做翻转：上传时用 UNPACK_FLIP_Y_WEBGL=true，纹理 v=0 就是图片底边，
   和 GL 视口 / FBO 的窗口坐标一致（v=(y+1)/2）。这样每一趟 pass 都保持朝向，
   不会因为 FBO 趟数的奇偶（方块那趟是额外的一趟）把画面上下颠倒。
   uv 原点在左下角，也和 Unity 侧的一致。 */
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}