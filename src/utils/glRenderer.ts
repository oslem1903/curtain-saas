import { mat4 } from "gl-matrix";

export type AreaPoint = { x: number; y: number };

// Solves Ax = B for homography. 
function getPerspectiveTransform(src: number[], dst: number[]): number[] {
    const a = [];
    for (let i = 0; i < 4; i++) {
        const x = src[i * 2];
        const y = src[i * 2 + 1];
        const u = dst[i * 2];
        const v = dst[i * 2 + 1];
        a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
        a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }

    // Gaussian elimination
    for (let i = 0; i < 8; i++) {
        let maxRow = i;
        for (let j = i + 1; j < 8; j++) {
            if (Math.abs(a[j][i]) > Math.abs(a[maxRow][i])) {
                maxRow = j;
            }
        }
        const temp: number[] = a[i];
        a[i] = a[maxRow];
        a[maxRow] = temp;

        for (let j = i + 1; j < 8; j++) {
            const factor = a[j][i] / a[i][i];
            for (let k = i; k < 9; k++) {
                a[j][k] -= a[i][k] * factor;
            }
        }
    }

    const h = new Array(9);
    for (let i = 7; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < 8; j++) {
            sum += a[i][j] * h[j];
        }
        h[i] = (a[i][8] - sum) / a[i][i];
    }
    h[8] = 1;

    return [
        h[0], h[3], 0, h[6],
        h[1], h[4], 0, h[7],
        0,    0,    1, 0,
        h[2], h[5], 0, h[8]
    ];
}

const VERTEX_SHADER = `
attribute vec2 a_position;
uniform mat4 u_matrix;
varying vec2 v_uv;
varying vec2 v_pos;

void main() {
    // a_position is 0 to 1
    vec4 pos = u_matrix * vec4(a_position, 0.0, 1.0);
    gl_Position = vec4((pos.x / pos.w * 2.0 - 1.0), (1.0 - pos.y / pos.w * 2.0), 0.0, 1.0);
    v_uv = a_position;
    v_pos = a_position;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
varying vec2 v_pos;

  uniform sampler2D u_texture;
  uniform int u_product_type;
  uniform int u_exact_texture;
  uniform vec2 u_resolution;

void main() {
    // Default UV for texture
    vec2 tex_uv = u_exact_texture == 1 ? v_uv * vec2(2.0, 2.6) : v_uv * 4.0;
    
    float depth = 0.0;
    float light = 1.0;
    float opacity = u_exact_texture == 1 ? 0.96 : 0.85;

    // "stor" (0), "zebra" (1), "plicell" (2), "tul" (3), "fon" (4), "dikey" (5), "jalousie" (6)
    
    if (u_product_type == 3 || u_product_type == 4) { // Tül & Fon
        // Organic vertical folds
        float fold = sin(v_uv.x * 20.0) * 0.5 + sin(v_uv.x * 45.0) * 0.2;
        tex_uv.x += fold * 0.02;
        depth = fold;
        light = 1.0 + depth * 0.4;
        opacity = (u_product_type == 3) ? (u_exact_texture == 1 ? 0.72 : 0.6) : 0.95;
    } 
    else if (u_product_type == 2) { // Plicell
        float fold = sin(v_uv.y * 80.0);
        depth = fold;
        light = 1.0 + depth * 0.3;
        tex_uv.y += fold * 0.01;
        opacity = 0.75;
    }
    else if (u_product_type == 1) { // Zebra
        float stripe = sin(v_uv.y * 50.0);
        if (stripe > 0.0) {
            opacity = 0.4;
            light = 1.2;
        } else {
            opacity = 0.85;
            light = 0.8;
        }
    }
    else if (u_product_type == 6) { // Jalousie
        float panel = fract(v_uv.y * 30.0);
        if (panel > 0.9) {
            light = 0.2; // Shadow between panels
        } else {
            light = 1.0 - (panel - 0.5) * 0.3;
        }
        opacity = 0.9;
    }
    
    // Overall shading (edges darker)
    float edge_shadow = smoothstep(0.0, 0.1, v_uv.x) * smoothstep(1.0, 0.9, v_uv.x);
    light *= edge_shadow * 0.5 + 0.5;

    vec4 tex_color = texture2D(u_texture, tex_uv);
    
    // final color with lighting
    vec3 final_rgb = tex_color.rgb * light;
    if (u_exact_texture == 1) {
        final_rgb = mix(tex_color.rgb, final_rgb, 0.34);
    }
    
    // WebGL alpha is straight or premultiplied. We'll use straight alpha.
    gl_FragColor = vec4(final_rgb, opacity);
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function getProductTypeCode(type: string) {
    if (type === "stor") return 0;
    if (type === "zebra") return 1;
    if (type === "plicell") return 2;
    if (type === "tul") return 3;
    if (type === "fon") return 4;
    if (type === "dikey_tul" || type === "dikey_stor") return 5;
    if (type === "jalousie") return 6;
    return 0;
}

export function renderWebGLPreview(
    width: number,
    height: number,
    texImg: TexImageSource,
    points: AreaPoint[],
    productType: string,
    exactTexture = false
): HTMLCanvasElement | null {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    
    // Use webgl2 for full NPOT texture support (gl.REPEAT works on any image size)
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
    if (!gl) {
        console.warn("WebGL2 not supported, fallback needed");
        return null;
    }

    gl.viewport(0, 0, width, height);

    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program || !vs || !fs) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
        0, 1,
        1, 0
    ]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const fabricTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fabricTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texImg);
    // webgl2 supports REPEAT for NPOT!
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const texLoc = gl.getUniformLocation(program, "u_texture");
    const typeLoc = gl.getUniformLocation(program, "u_product_type");
    const exactLoc = gl.getUniformLocation(program, "u_exact_texture");
    const resLoc = gl.getUniformLocation(program, "u_resolution");
    const matLoc = gl.getUniformLocation(program, "u_matrix");

    gl.uniform1i(texLoc, 1);
    gl.uniform1i(typeLoc, getProductTypeCode(productType));
    gl.uniform1i(exactLoc, exactTexture ? 1 : 0);
    gl.uniform2f(resLoc, width, height);

    const srcCoords = [ 0, 0, 1, 0, 1, 1, 0, 1 ];
    const dstCoords = [
        (points[0].x / 100) * width, (points[0].y / 100) * height,
        (points[1].x / 100) * width, (points[1].y / 100) * height,
        (points[2].x / 100) * width, (points[2].y / 100) * height,
        (points[3].x / 100) * width, (points[3].y / 100) * height,
    ];
    
    const hMat = getPerspectiveTransform(srcCoords, dstCoords);
    const ortho = mat4.create();
    mat4.ortho(ortho, 0, width, height, 0, -1, 1);
    
    const finalMat = mat4.create();
    mat4.multiply(finalMat, ortho, hMat as any);
    
    gl.uniformMatrix4fv(matLoc, false, finalMat);

    // Enable blending for transparent background
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    return canvas;
}
