precision highp float;
uniform sampler2D u_src;
uniform float u_radius;
uniform float u_smooth;
uniform float u_darkness;
uniform vec2 u_center;
varying vec2 v_uv;
void main() {
    vec4 c = texture2D(u_src, v_uv);
    float f = clamp((length(v_uv - u_center) - u_radius) / max(u_smooth, 1e-6), 0.0, 1.0);
    f = f * f * (3.0 - 2.0 * f);
    gl_FragColor = vec4(c.rgb * (1.0 - f * u_darkness), c.a);
}