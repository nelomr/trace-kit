/**
 * Source-level helpers over the GLSL constants. The precision suite models the vertex shader's X
 * arithmetic with `Math.fround`, which is only a faithful model of the GPU when the shader really
 * evaluates the expression in the modelled order; reading the expression back out of the shader
 * source is what binds the two together.
 */

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Body of `functionName`, found by brace matching from its signature, or `null`. */
export function extractFunctionBody(source: string, functionName: string): string | null {
  const signature = new RegExp(`\\b${functionName}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (signature === null) return null;
  let depth = 1;
  let index = signature.index + signature[0].length;
  const start = index;
  while (index < source.length && depth > 0) {
    const ch = source[index];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    index += 1;
  }
  return depth === 0 ? source.slice(start, index - 1) : null;
}

/**
 * The right-hand side assigned to `px` inside `projectXDevice`, whitespace removed. This is the
 * expression before the guard-band clamp, so a clamp refactor does not disturb the binding.
 */
export function extractXProjection(source: string): string | null {
  const body = extractFunctionBody(source, "projectXDevice");
  if (body === null) return null;
  const assignment = /\bfloat\s+px\s*=\s*([^;]+);/.exec(body);
  if (assignment === null) return null;
  return stripWhitespace(assignment[1] ?? "");
}
