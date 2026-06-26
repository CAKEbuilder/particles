// Probes the actual cause of a WebGL2 context failure so it can be logged and
// shown as a helpful message rather than a bare technical error.

export interface GlDiagnostic {
  webgl2Available: boolean;      // true if a minimal context succeeded on retry
  webgl1Available: boolean;      // true if WebGL1 is present (WebGL2 gap, not no-GL)
  softwareRenderer: boolean;     // true if a known software rasteriser is in use
  vendor: string;
  renderer: string;
  userAgent: string;
  suggestion: string;            // plain-English next step for the user
}

const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|microsoft basic render/i;
const STORAGE_KEY = "particles.gl.lastError";

export function diagnoseGlFailure(canvas: HTMLCanvasElement): GlDiagnostic {
  // Retry with minimal options — some drivers reject powerPreference:"high-performance"
  const retry = canvas.getContext("webgl2");
  if (retry) {
    // Clean up the extra context; the real renderer will create its own
    const ext = retry.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }

  // Check WebGL1 to distinguish "no GL at all" vs "WebGL2 not implemented"
  const gl1 = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl") as WebGLRenderingContext | null;

  let vendor = "";
  let renderer = "";
  if (gl1) {
    const dbg = gl1.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      vendor   = gl1.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string || "";
      renderer = gl1.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string || "";
    } else {
      vendor   = gl1.getParameter(gl1.VENDOR) as string || "";
      renderer = gl1.getParameter(gl1.RENDERER) as string || "";
    }
  }

  const softwareRenderer = SOFTWARE_RE.test(vendor) || SOFTWARE_RE.test(renderer);
  const webgl2Available  = !!retry;
  const webgl1Available  = !!gl1;

  let suggestion: string;
  if (webgl2Available) {
    // Retry worked — high-performance preference was the culprit; renderer can recover
    suggestion = "A graphics configuration issue was detected. Please reload the page.";
  } else if (!webgl1Available) {
    suggestion = "Your browser has WebGL disabled. In Chrome: Settings → Advanced → Use hardware acceleration. In Safari: Develop → Experimental Features → WebGL.";
  } else if (softwareRenderer) {
    suggestion = `Your device is using a software graphics renderer (${renderer}), which doesn't support WebGL2. Try a different browser or enable hardware acceleration.`;
  } else {
    suggestion = "Your browser doesn't support WebGL2. Try the latest Chrome, Firefox, or Safari.";
  }

  const diag: GlDiagnostic = {
    webgl2Available,
    webgl1Available,
    softwareRenderer,
    vendor,
    renderer,
    userAgent: navigator.userAgent,
    suggestion,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...diag, ts: Date.now() }));
  } catch {
    // storage unavailable — not critical
  }

  console.error("[particles] WebGL2 unavailable. Diagnostic:", diag);
  return diag;
}
