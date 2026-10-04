precision highp float;
uniform sampler2D u_src;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_src, v_uv); }