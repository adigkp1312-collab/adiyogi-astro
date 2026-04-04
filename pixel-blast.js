/**
 * PixelBlast — Vanilla WebGL2 port
 * Dithered pixel noise with click ripples
 */

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;
uniform int   uShapeType;

const int MAX_CLICKS = 10;
uniform vec2  uClickPos[MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

float Bayer4(vec2 a) {
  return Bayer2(0.5 * a) * 0.25 + Bayer2(a);
}

float Bayer8(vec2 a) {
  return Bayer4(0.5 * a) * 0.25 + Bayer2(a);
}

float hash11(float n) {
  return fract(sin(n) * 43758.5453);
}

float vnoise(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0,0,0), vec3(1,57,113)));
  float n100 = hash11(dot(ip + vec3(1,0,0), vec3(1,57,113)));
  float n010 = hash11(dot(ip + vec3(0,1,0), vec3(1,57,113)));
  float n110 = hash11(dot(ip + vec3(1,1,0), vec3(1,57,113)));
  float n001 = hash11(dot(ip + vec3(0,0,1), vec3(1,57,113)));
  float n101 = hash11(dot(ip + vec3(1,0,1), vec3(1,57,113)));
  float n011 = hash11(dot(ip + vec3(0,1,1), vec3(1,57,113)));
  float n111 = hash11(dot(ip + vec3(1,1,1), vec3(1,57,113)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t) {
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < 5; i++) {
    sum  += amp * vnoise(p * freq);
    freq *= 1.25;
    amp  *= 1.0;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov) {
  float r = sqrt(cov) * 0.25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskDiamond(vec2 p, float cov) {
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy - uResolution * 0.5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / uPixelSize);
  vec2 pixelUV = fract(fragCoord / uPixelSize);

  float cellPixelSize = 8.0 * uPixelSize;
  vec2 cellCoord = floor(fragCoord / cellPixelSize) * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;
  float feed = base + (uDensity - 0.5) * 0.3;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; i++) {
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cps = 8.0 * uPixelSize;
      vec2 cuv = ((pos - uResolution * 0.5 - cps * 0.5) / uResolution) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = uRippleSpeed * t;
      float ring  = exp(-pow((r - waveR) / uRippleThickness, 2.0));
      float atten = exp(-1.0 * t) * exp(-10.0 * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(pixelId, vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;

  float M;
  if (uShapeType == 1) {
    M = maskCircle(pixelUV, coverage);
  } else if (uShapeType == 3) {
    M = maskDiamond(pixelUV, coverage);
  } else {
    M = coverage;
  }

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    M *= smoothstep(0.0, uEdgeFade, edge);
  }

  vec3 c = uColor;
  vec3 srgb = mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
  fragColor = vec4(srgb, M);
}`;

const SHAPE_MAP = { square: 0, circle: 1, triangle: 2, diamond: 3 };
const MAX_CLICKS = 10;

function hexToLinear(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const f = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return [f(r), f(g), f(b)];
}

function compile(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function createPixelBlast(container, opts = {}) {
  const {
    variant = "square",
    pixelSize = 4,
    color = "#EDABAB",
    patternScale = 2,
    patternDensity = 1,
    pixelSizeJitter = 0,
    enableRipples = true,
    rippleSpeed = 0.4,
    rippleThickness = 0.12,
    rippleIntensityScale = 1.5,
    speed = 0.5,
    edgeFade = 0.25,
  } = opts;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block";
  container.appendChild(canvas);

  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    console.warn("WebGL2 not supported");
    return null;
  }

  // Compile program
  const vs = compile(gl, VERT, gl.VERTEX_SHADER);
  const fs = compile(gl, FRAG, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Link error:", gl.getProgramInfoLog(prog));
    return null;
  }

  gl.useProgram(prog);

  // Fullscreen triangle (more efficient than quad)
  const posLoc = gl.getAttribLocation(prog, "position");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  3, -1,  -1, 3
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Enable blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // Get uniform locations
  const u = {};
  ["uColor","uResolution","uTime","uPixelSize","uScale","uDensity",
   "uPixelJitter","uEnableRipples","uRippleSpeed","uRippleThickness",
   "uRippleIntensity","uEdgeFade","uShapeType"].forEach(
    (n) => (u[n] = gl.getUniformLocation(prog, n))
  );

  const uClickPos = [];
  const uClickTimes = [];
  for (let i = 0; i < MAX_CLICKS; i++) {
    uClickPos.push(gl.getUniformLocation(prog, `uClickPos[${i}]`));
    uClickTimes.push(gl.getUniformLocation(prog, `uClickTimes[${i}]`));
  }

  // Set static uniforms
  const rgb = hexToLinear(color);
  gl.uniform3f(u.uColor, rgb[0], rgb[1], rgb[2]);
  gl.uniform1f(u.uScale, patternScale);
  gl.uniform1f(u.uDensity, patternDensity);
  gl.uniform1f(u.uPixelJitter, pixelSizeJitter);
  gl.uniform1i(u.uEnableRipples, enableRipples ? 1 : 0);
  gl.uniform1f(u.uRippleSpeed, rippleSpeed);
  gl.uniform1f(u.uRippleThickness, rippleThickness);
  gl.uniform1f(u.uRippleIntensity, rippleIntensityScale);
  gl.uniform1f(u.uEdgeFade, edgeFade);
  gl.uniform1i(u.uShapeType, SHAPE_MAP[variant] ?? 0);

  for (let i = 0; i < MAX_CLICKS; i++) {
    gl.uniform2f(uClickPos[i], -1, -1);
    gl.uniform1f(uClickTimes[i], 0);
  }

  // State
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let clickIx = 0;
  let raf = 0;
  const timeOffset = Math.random() * 1000;

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(u.uPixelSize, pixelSize * dpr);
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Click ripples — listen on the WHOLE document so clicks anywhere trigger ripples
  function onPointerDown(e) {
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) * dpr;
    const fy = (rect.height - (e.clientY - rect.top)) * dpr;
    const t = timeOffset + performance.now() / 1000 * speed;
    gl.useProgram(prog);
    gl.uniform2f(uClickPos[clickIx], fx, fy);
    gl.uniform1f(uClickTimes[clickIx], t);
    clickIx = (clickIx + 1) % MAX_CLICKS;
  }

  document.addEventListener("pointerdown", onPointerDown, { passive: true });

  // Render loop
  function render() {
    const t = timeOffset + performance.now() / 1000 * speed;

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = requestAnimationFrame(render);
  }

  raf = requestAnimationFrame(render);

  return {
    destroy() {
      ro.disconnect();
      document.removeEventListener("pointerdown", onPointerDown);
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      if (canvas.parentElement) canvas.remove();
    },
  };
}
