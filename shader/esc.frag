precision highp float;
uniform sampler2D u_src;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_contrast;
uniform vec3 u_average;
varying vec2 v_uv;
void main() {
    vec4 c = texture2D(u_src, v_uv);
    float lum = dot(c.rgb, vec3(0.2125, 0.7154, 0.0721));
    vec3 rgb = lum + u_saturation * (c.rgb - lum);
    rgb = u_average + u_contrast * (rgb - u_average);
    gl_FragColor = vec4(rgb * u_brightness, c.a);
}