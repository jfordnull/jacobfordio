const canvas = document.getElementById('gl');

// 
// Rendering context
// 
/** @type {WebGL2RenderingContext} */
const context = canvas.getContext('webgl2', {alpha:false});
if (!context) throw new Error('WebGL2 not supported');

// 
// Utilities
// 
function compileShader(context, type, src){
    const shader = context.createShader(type);
    context.shaderSource(shader, src);
    context.compileShader(shader);
    if(!context.getShaderParameter(shader, context.COMPILE_STATUS)){
        const log = context.getShaderInfoLog(shader);
        context.deleteShader(shader);
        throw new Error(`Failed to compile shader:\n${log}`);
    }
    return shader;
}

function linkProgram(context, vs, fs){
    const program = context.createProgram();
    context.attachShader(program, vs);
    context.attachShader(program, fs);
    context.linkProgram(program);
    if(!context.getProgramParameter(program, context.LINK_STATUS)){
        const log = context.getProgramInfoLog(program);
        context.deleteProgram(program);
        throw new Error(`Failed to link gl program:\n${log}`);
    }
    return program;
}

function resizeCanvas(){
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2); 
    const width = Math.floor(canvas.clientWidth * devicePixelRatio);
    const height = Math.floor(canvas.clientHeight * devicePixelRatio);
    if(canvas.width !== width || canvas.height !== height){
        canvas.width = width;
        canvas.height = height;
        context.viewport(0, 0, width, height);
    }
}
const ro = new ResizeObserver(resizeCanvas);
ro.observe(canvas);

//
// Make the audio analyzer
//
async function initAudioAnalyzer(){
    console.log('Requesting mic access');
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});

    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    const mic = audioContext.createMediaStreamSource(stream);

    // Do a Fast Fourier Transform (FFT) to get the amplitude of each frequency bin. 
    // Each bin is a range of frequencies. The FFT resolution / 2 = number of bins.
    // Bin width is the sampleRate / fftSize (Hz/bin).
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 2048; // (Needs power of 2)

    mic.connect(analyzer);
    const bins = analyzer.frequencyBinCount;

    // A uint8 table of frequency amplitudes (0-255) for each bin.
    const spectrum = new Uint8Array(bins);

    return { analyzer, bins, spectrum };
}

//
// Create the audio spectrum texture
// 
function createSpectrumTexture(context, bins){
    const texture = context.createTexture();
    context.bindTexture(context.TEXTURE_2D, texture);

    // If bins % 4 != 0, we're not gl word-aligned. Just set it to 1.
    context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
    
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);

    // Allocate a 1 X N (R8) texture to hold the spectrum data.
    context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.R8,
        bins,
        1,
        0,
        context.RED,
        context.UNSIGNED_BYTE,
        null
    );
    context.bindTexture(context.TEXTURE_2D, null);
    return texture;
}

// 
// Quad VAO
// 
const vao = context.createVertexArray();
context.bindVertexArray(vao);

// x, y, u, v
const vertices = new Float32Array([
    -1, 1, 0, 1,
    -1,-1, 0, 0,
     1, 1, 1, 1,
     1,-1, 1, 0,
]);

const vbo = context.createBuffer();
context.bindBuffer(context.ARRAY_BUFFER, vbo);
context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);

// Position attribute
// 4 x 32-bit floats = 16 byte stride.
context.enableVertexAttribArray(0);
context.vertexAttribPointer(0, 2, context.FLOAT, false, 16, 0);

// UV attribute 
// Offset 8 bytes into the vertex. 
context.enableVertexAttribArray(1);
context.vertexAttribPointer(1, 2, context.FLOAT, false, 16, 8);

context.bindVertexArray(null);

// 
// Compile and load glsl program. Setup audio analyzer.
//
let program, analyzer, bins, spectrum, spectrumTexture, uSpectrum, uBins, uAspect;

(async function init() {
    const vsSrc = await (await fetch('./shaders/vs.glsl')).text();
    const fsSrc = await (await fetch('./shaders/fs.glsl')).text();

    const vs = compileShader(context, context.VERTEX_SHADER, vsSrc);
    const fs = compileShader(context, context.FRAGMENT_SHADER, fsSrc);
    program = linkProgram(context, vs, fs);

    context.deleteShader(vs);
    context.deleteShader(fs);

    const okButton = document.createElement('button');
    okButton.textContent = 'I\'ve given mic access';
    Object.assign(okButton.style, { position: 'absolute', top: '1rem', left: '1rem', zIndex: 10 });
    document.body.appendChild(okButton);

    okButton.addEventListener('click', async () => {
        try {
            ({ analyzer, bins, spectrum } = await initAudioAnalyzer());

            spectrumTexture = createSpectrumTexture(context, bins);
            context.useProgram(program);
            uSpectrum = context.getUniformLocation(program, 'uSpectrum');
            uBins = context.getUniformLocation(program, 'uBins');
            uAspect = context.getUniformLocation(program, 'uAspect');
            context.uniform1i(uSpectrum, 0);
            context.uniform1f(uBins, bins);
            context.uniform2f(uAspect, canvas.width, canvas.height);

            okButton.remove();
            requestAnimationFrame(render);
        } catch (exception) {
            console.error('Mic init failed:', exception);
            alert('Microphone permission or init failed. Check permissions.');
        }
    });
})().catch(console.error);

// 
// Frame loop
// 
function render(){
    resizeCanvas();

    // Update FFT and upload to GPU texture
    analyzer.getByteFrequencyData(spectrum);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, spectrumTexture);
    context.texSubImage2D(
        context.TEXTURE_2D, 
        0, 
        0, 0, 
        bins, 1, 
        context.RED, 
        context.UNSIGNED_BYTE, 
        spectrum
    );

    // Clear screen
    context.clearColor(0, 0, 0, 1);
    context.clear(context.COLOR_BUFFER_BIT);

    context.useProgram(program);
    context.bindVertexArray(vao);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    context.bindVertexArray(null);

    requestAnimationFrame(render);
}