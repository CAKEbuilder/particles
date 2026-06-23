// WebGL2 renderer: instanced glowing ▽ particles drawn into a ping-pong framebuffer
// that fades each frame (trails), then composited additively over the dark background.

import { config } from "../config";
import { perf } from "../core/Profiler";
import { QUAD_STRIP } from "./geometry";
import { BLIT_FS, BLIT_VS, PARTICLE_FS, PARTICLE_VS } from "./shaders";
import type { ParticleSystem } from "../sim/ParticleSystem";

const INSTANCE_STRIDE = 6; // x, y, size, angle, hue, alpha

interface Fbo {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private cssW = 1;
  private cssH = 1;
  private bw = 1; // backing width (px)
  private bh = 1;

  private particleProg!: WebGLProgram;
  private blitProg!: WebGLProgram;
  private uResolution!: WebGLUniformLocation;
  private uBlitTex!: WebGLUniformLocation;
  private uBlitScale!: WebGLUniformLocation;
  private uBlitBg!: WebGLUniformLocation;
  private uBlitTonemap!: WebGLUniformLocation;
  private hdr = false;

  private quadBuf!: WebGLBuffer;
  private particleVao!: WebGLVertexArrayObject;
  private blitVao!: WebGLVertexArrayObject;
  private instanceBuf!: WebGLBuffer;
  private instanceData: Float32Array;

  private fboA: Fbo | null = null;
  private fboB: Fbo | null = null;
  private lost = false; // true while the GL context is lost

  constructor(canvas: HTMLCanvasElement, capacity: number) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not supported on this device/browser.");
    this.gl = gl;
    this.instanceData = new Float32Array(capacity * INSTANCE_STRIDE);

    // Survive a lost GL context (common on mobile under memory pressure) instead of the
    // page going black / reloading: rebuild all GL resources on restore.
    canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        this.lost = true;
      },
      false
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        this.initGL();
        this.disposeFbo(this.fboA);
        this.disposeFbo(this.fboB);
        this.fboA = this.createFbo(this.bw, this.bh);
        this.fboB = this.createFbo(this.bw, this.bh);
        this.lost = false;
      },
      false
    );

    this.initGL();
  }

  /** (Re)create all GL programs, buffers and VAOs. Safe to call again after restore. */
  private initGL(): void {
    const gl = this.gl;
    this.hdr = !!(
      gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float")
    );

    this.particleProg = this.link(PARTICLE_VS, PARTICLE_FS);
    this.blitProg = this.link(BLIT_VS, BLIT_FS);
    this.uResolution = this.loc(this.particleProg, "uResolution");
    this.uBlitTex = this.loc(this.blitProg, "uTex");
    this.uBlitScale = this.loc(this.blitProg, "uScale");
    this.uBlitBg = this.loc(this.blitProg, "uBg");
    this.uBlitTonemap = this.loc(this.blitProg, "uTonemap");

    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_STRIP, gl.STATIC_DRAW);

    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_STRIDE * 4;
    this.setupInstanceAttrib(1, 2, stride, 0);
    this.setupInstanceAttrib(2, 1, stride, 8);
    this.setupInstanceAttrib(3, 1, stride, 12);
    this.setupInstanceAttrib(4, 1, stride, 16);
    this.setupInstanceAttrib(5, 1, stride, 20);

    this.blitVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.blitVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  private setupInstanceAttrib(loc: number, size: number, stride: number, offset: number): void {
    const gl = this.gl;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, 1);
  }

  /** Wipe the trail accumulation buffers (e.g. when switching modes/levels). */
  clear(): void {
    const gl = this.gl;
    for (const fbo of [this.fboA, this.fboB]) {
      if (!fbo) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const gl = this.gl;
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.bw = Math.max(1, Math.round(this.cssW * dpr));
    this.bh = Math.max(1, Math.round(this.cssH * dpr));
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.width = this.bw;
    canvas.height = this.bh;

    this.disposeFbo(this.fboA);
    this.disposeFbo(this.fboB);
    this.fboA = this.createFbo(this.bw, this.bh);
    this.fboB = this.createFbo(this.bw, this.bh);
  }

  draw(system: ParticleSystem): void {
    const gl = this.gl;
    if (this.lost || !this.fboA || !this.fboB) return;
    const count = system.count;

    perf.begin("pack");
    this.packInstances(system, count);
    perf.end("pack");

    perf.begin("draw");
    gl.viewport(0, 0, this.bw, this.bh);

    // --- pass 1: fade previous accumulation (A) into B ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fb);
    gl.disable(gl.BLEND);
    const f = config.trailFade;
    this.blit(this.fboA.tex, f, f, f, f, false);

    // --- pass 2: draw particles additively on top (into B) ---
    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.particleProg);
      gl.uniform2f(this.uResolution, this.cssW, this.cssH);
      gl.bindVertexArray(this.particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, count * INSTANCE_STRIDE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    }

    // --- pass 3: tone-map B over the dark background, straight to screen ---
    // exposure (<1) baked into the blit scale gives dense clusters headroom before white.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    const ex = config.exposure;
    this.blit(this.fboB.tex, ex, ex, ex, 1, true);

    perf.end("draw");

    // swap
    const tmp = this.fboA;
    this.fboA = this.fboB;
    this.fboB = tmp;
  }

  private blit(
    tex: WebGLTexture,
    r: number,
    g: number,
    b: number,
    a: number,
    tonemap: boolean
  ): void {
    const gl = this.gl;
    gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uBlitTex, 0);
    gl.uniform4f(this.uBlitScale, r, g, b, a);
    const bg = config.background;
    gl.uniform3f(this.uBlitBg, bg[0], bg[1], bg[2]);
    gl.uniform1i(this.uBlitTonemap, tonemap ? 1 : 0);
    gl.bindVertexArray(this.blitVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private packInstances(system: ParticleSystem, count: number): void {
    const data = this.instanceData;
    const { px, py, size, angle, hue, alpha } = system;
    let o = 0;
    for (let i = 0; i < count; i++) {
      data[o] = px[i];
      data[o + 1] = py[i];
      data[o + 2] = size[i];
      data[o + 3] = angle[i];
      data[o + 4] = hue[i];
      data[o + 5] = alpha[i];
      o += INSTANCE_STRIDE;
    }
  }

  private createFbo(w: number, h: number): Fbo {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Blits are fullscreen and 1:1, so NEAREST is exact and avoids the
    // half-float-linear extension requirement on mobile GPUs.
    if (this.hdr) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    // clear to transparent black
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex };
  }

  private disposeFbo(fbo: Fbo | null): void {
    if (!fbo) return;
    this.gl.deleteFramebuffer(fbo.fb);
    this.gl.deleteTexture(fbo.tex);
  }

  private link(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("Program link failed: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("Shader compile failed: " + log);
    }
    return sh;
  }

  private loc(prog: WebGLProgram, name: string): WebGLUniformLocation {
    const l = this.gl.getUniformLocation(prog, name);
    if (!l) throw new Error("Missing uniform: " + name);
    return l;
  }
}
