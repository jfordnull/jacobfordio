#version 300 es
precision highp float;

#define PI 3.14159265

in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSpectrum; // 1 x uBins R8 amplitude texture
uniform float uBins;
uniform vec2 uAspect;

// Exponential remap [0,1], higher k should expand low bins.
float exp01(float f01, float k){
    return (exp(f01 * k) - 1.0) / (exp(k) - 1.0);
}

float sampleSpectrum(float bin){
    bin = clamp(bin, 1.0, uBins - 1.0); // Avoid DC bias at bin 0

    // The 1 x N texture has texel centers at (N - 0.5) / N
    float uC = (bin + 0.5) / uBins;
    float uL = (bin - 1.0 + 0.5) / uBins;
    float uR = (bin + 1.0 + 0.5) / uBins;

    float c = texture(uSpectrum, vec2(uC, 0.5)).r;
    float l = texture(uSpectrum, vec2(uL, 0.5)).r;
    float r = texture(uSpectrum, vec2(uR, 0.5)).r;

    // 1-2-1 kernel for smooth sampling
    float smoothSample = (l + 2.0 * c + r) * 0.25;
    smoothSample = max(smoothSample - 0.01, 0.0); // Noise gate
    return smoothSample;
}

float rangeRings(float radius, float count){
    // Example: count = 5, radius * count runs 0->5. 
    // fract() keeps only the fractional part.
    // So t repeats 0->1 five times as radius goes 0->1.
    float t = fract(radius * count);

    // Sharp peak at 0 gives us our ring. Smoothstep to anti-alias.
    float ring = smoothstep(0.02, 0.0, min(t, 1.0 - t));

    // Fade rings as radius approaches 1.0.
    return ring * smoothstep(1.0, 0.0, radius);
}

void main(){
    // Convert UVs to polar coordinates.
    vec2 polarUV = vUV * 2.0 - 1.0;
    polarUV.x *= (uAspect.x / max(1.0, uAspect.y)); // Scale S by aspect.

    // Circular mask
    float radius = length(polarUV);
    if (radius > 1.0) discard;

    // Find angle and map to frequency bin
    float angle = atan(polarUV.y, polarUV.x) - PI * 0.5; // [-PI, PI], rotated so 0 = Y+
    angle = angle < 0.0 ? angle + 2.0 * PI : angle; // [0, 2PI]
    float angle01 = angle * 0.5 / PI; // [0, 1]
    float k = 3.0;
    float f01 = exp01(angle01, k);
    float bin = f01 * (uBins - 1.0);

    // Sample spectrum and apply a high-frequency tilt
    float amp = sampleSpectrum(bin);
    float tilt = pow((bin + 1.0) / uBins, 0.5);
    amp *= mix(0.7, 2.0, tilt);
    
    // Shading the fragment
    float gain = pow(amp, 1.5);
    vec3 base = vec3(0.05, 0.08, 0.06);
    vec3 glow = vec3(0.25, 1.0, 0.55) * gain;
    fragColor = vec4(base + glow, 1.0) + rangeRings(radius, 5.0);
}