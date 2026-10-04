/* 位移量 = pow(len*_Deform, _Radius)，_Radius 是指数：越大位移越小 */
precision highp float;
uniform sampler2D u_src;
uniform float u_radius;
uniform float u_deform;
uniform vec2 u_center;
varying vec2 v_uv;
void main() {
    vec2 d = v_uv - u_center;
    float len = length(d);
    vec2 off = len > 1e-6 ? (d / len) * pow(len * u_deform, u_radius) : vec2(0.0);
    gl_FragColor = vec4(
        texture2D(u_src, v_uv).r,
        texture2D(u_src, v_uv - off * 0.33).g,
        texture2D(u_src, v_uv - off * 0.66).b,
        1.0);
}