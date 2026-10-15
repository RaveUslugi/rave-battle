import { CHUNK_SIZE } from "@rave/shared/client";
import { BufferImageSource, GlProgram, MeshGeometry, Shader, type TextureSource, UniformGroup } from "pixi.js";
import { COLOR_ROWS, type EffectTables } from "./effect-tables";

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

/** Mirrored by `shadeCell` in effect-tables.ts: keep the two in step. */
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uIndex;
uniform sampler2D uColors;
uniform sampler2D uParams;
uniform sampler2D uPhases;
uniform vec2 uOrigin;
const int SIZE = ${CHUNK_SIZE};
vec4 paletteColor(int id, int row) { return texelFetch(uColors, ivec2(id, row), 0); }
void main() {
  // Whole cells only: the colour is the same across a cell at any zoom.
  ivec2 cell = clamp(ivec2(floor(vUV * float(SIZE))), ivec2(0), ivec2(SIZE - 1));
  int id = int(texelFetch(uIndex, cell, 0).r * 255.0 + 0.5);
  vec4 p = texelFetch(uParams, ivec2(id, 0), 0);
  vec4 c;
  if (p.x < 0.5) {
    c = paletteColor(id, 0);
  } else {
    float u = texelFetch(uPhases, ivec2(id, 0), 0).r;
    if (p.x > 1.5) {
      vec2 world = uOrigin + vec2(cell);
      u += world.x * p.z + world.y * p.w;
    }
    int count = int(p.y + 0.5);
    float pos = fract(u) * float(count);
    int i = min(int(floor(pos)), count - 1);
    c = mix(paletteColor(id, 1 + i), paletteColor(id, 1 + (i + 1) % count), pos - float(i));
  }
  fragColor = vec4(c.rgb * c.a, c.a);
}`;

/** Compiles and links the shaders directly, so an unsupported GPU is caught before any chunk is drawn. */
export function effectsSupported(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined): boolean {
  if (!gl || typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return false;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return false;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  if (!ok) console.error("Canvas effect shader failed:", gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return ok;
}

const dataSource = (resource: Uint8Array | Float32Array, height: number, format: "rgba8unorm" | "rgba32float" | "r32float") =>
  new BufferImageSource({ resource, width: 256, height, format, scaleMode: "nearest", alphaMode: "no-premultiply-alpha" });

/** Palette textures shared by every chunk; `update` re-uploads them when the palette or the phases change. */
export class EffectPalette {
  readonly colors: BufferImageSource;
  readonly params: BufferImageSource;
  readonly phases: BufferImageSource;
  readonly phaseValues = new Float32Array(256);

  constructor(tables: EffectTables) {
    this.colors = dataSource(tables.colors, COLOR_ROWS, "rgba8unorm");
    this.params = dataSource(tables.params, 1, "rgba32float");
    this.phases = dataSource(this.phaseValues, 1, "r32float");
  }

  setTables(tables: EffectTables): void {
    this.colors.resource = tables.colors;
    this.params.resource = tables.params;
    this.colors.update();
    this.params.update();
  }

  destroy(): void {
    this.colors.destroy();
    this.params.destroy();
    this.phases.destroy();
  }
}

/** One chunk square in local pixels 0..CHUNK_SIZE; shared by all chunk meshes. */
export function chunkGeometry(): MeshGeometry {
  const s = CHUNK_SIZE;
  return new MeshGeometry({
    positions: new Float32Array([0, 0, s, 0, s, s, 0, s]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

/** An r8 texture straight over the chunk's index bytes: a changed cell is one changed byte. */
export function indexSource(colors: Uint8Array): BufferImageSource {
  return new BufferImageSource({ resource: colors, width: CHUNK_SIZE, height: CHUNK_SIZE, format: "r8unorm", scaleMode: "nearest" });
}

let program: GlProgram | null = null;

export function chunkShader(index: TextureSource, palette: EffectPalette, cx: number, cy: number): Shader {
  program ??= GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "chunk-effects" });
  return new Shader({
    glProgram: program,
    resources: {
      uIndex: index,
      uColors: palette.colors,
      uParams: palette.params,
      uPhases: palette.phases,
      chunk: new UniformGroup({ uOrigin: { value: new Float32Array([cx * CHUNK_SIZE, cy * CHUNK_SIZE]), type: "vec2<f32>" } }),
    },
  });
}
