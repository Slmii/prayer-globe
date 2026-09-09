export const CONTINENT_VERTEX = `
layout(location=0) in vec2 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in float a_continent;
layout(location=3) in float a_id;
layout(location=4) in vec3 a_color;
layout(location=5) in float a_phase;
uniform vec3 u_pieces[7];
uniform vec2 u_viewport;
uniform vec2 u_center;
uniform float u_pixel_ratio;
uniform float u_radius;
uniform float u_highlight;
uniform float u_active;
uniform float u_hover;
uniform int u_kind;
uniform bool u_pick;
out vec3 v_normal;
out vec3 v_color;
flat out float v_continent;
flat out float v_id;
flat out float v_size;
flat out float v_phase;
void main() {
 #ifdef GLOBE
 vec4 point = interpolateProjection(a_position, a_normal, 0.0);
 #else
 vec4 point = projectTile(a_position);
 #endif
 vec3 piece = u_pieces[int(a_continent)];
 vec2 pixel = (point.xy / point.w * vec2(0.5,-0.5)+0.5)*u_viewport;
 pixel = u_center + (pixel-u_center)*piece.z+piece.xy;
 point.xy = (pixel/u_viewport-0.5)*vec2(2.0,-2.0)*point.w;
 gl_Position = point;
 float radius = u_pick ? 8.0 : (a_id==u_active || a_id==u_hover || (u_highlight>=0.0 && a_phase==u_highlight) ? 14.0 : u_radius+1.0);
 gl_PointSize = radius*2.0*u_pixel_ratio;
 v_size = radius;
 v_phase = a_phase;
 v_normal = a_normal;
 v_color = a_color;
 v_continent = a_continent;
 v_id = a_id;
}
`;

export const CONTINENT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 v_normal;
in vec3 v_color;
flat in float v_continent;
flat in float v_id;
flat in float v_size;
flat in float v_phase;
uniform vec3 u_sun;
uniform float u_progress;
uniform float u_selected;
uniform float u_hover_continent;
uniform float u_active;
uniform float u_hover;
uniform float u_radius;
uniform float u_highlight;
uniform int u_kind;
uniform bool u_pick;
out vec4 fragColor;
void main() {
 float distance = u_kind==2 ? length(gl_PointCoord-0.5)*v_size*2.0 : 0.0;
 if(u_kind==2 && distance > v_size) discard;
 if(u_pick) {
  if(u_kind==2 && distance>8.0) discard;
  float id = v_id;
  fragColor = vec4(mod(id,256.0),mod(floor(id/256.0),256.0),floor(id/65536.0),255.0)/255.0;
  return;
 }
 if(u_kind==0) {
  vec3 color=vec3(58.0,64.0,82.0)/255.0;
  if(v_continent==u_selected) color += vec3(36.0,31.0,24.0)/255.0*u_progress;
  float night = 1.0-smoothstep(-0.015,0.015,dot(normalize(v_normal),u_sun));
  color=mix(color,vec3(4.0,5.0,10.0)/255.0,night*0.7*(1.0-u_progress*0.5));
  fragColor=vec4(color,1.0);
 } else if(u_kind==1) {
  vec3 color=v_continent==u_hover_continent ? vec3(244.0,197.0,106.0) : v_continent==u_selected ? vec3(181.0,171.0,252.0) : vec3(112.0,117.0,139.0);
  fragColor=vec4(color/255.0,1.0);
 } else {
  float edge = max(fwidth(distance),0.4);
  float core = 1.0-smoothstep(u_radius-edge,u_radius+edge,distance);
  float outline = 1.0-smoothstep(u_radius+1.0-edge,u_radius+1.0+edge,distance);
  vec4 color=vec4(vec3(12.0,14.0,20.0)/255.0*0.8,0.8)*outline;
  color=mix(color,vec4(v_color*0.9,0.9),core);
  if(v_id==u_active || v_id==u_hover || (u_highlight>=0.0 && v_phase==u_highlight)) {
   float radius=v_id==u_active ? 13.0 : 10.0;
   float ring=1.0-smoothstep(0.5,1.5,abs(distance-radius));
   vec3 tint=v_id==u_active ? vec3(245.0,244.0,255.0)/255.0 : vec3(181.0,171.0,252.0)/255.0;
   color+=vec4(tint*ring,ring)*(1.0-color.a);
  }
  if(color.a<0.01) discard;
  fragColor=color;
 }
}
`;
