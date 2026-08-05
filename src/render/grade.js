import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSaturation: { value: 0.68 },
    uContrast: { value: 1.08 },
    uTint: { value: new THREE.Vector3(0.93, 1.0, 0.95) },
    uShadowTint: { value: new THREE.Vector3(0.0, 0.014, 0.006) },
    uVignette: { value: 0.5 },
    uGrain: { value: 0.045 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uTint;
    uniform vec3 uShadowTint;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 color = base.rgb;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;
      color *= uTint;
      color += (1.0 - luma) * uShadowTint;

      float dist = distance(vUv, vec2(0.5));
      color *= 1.0 - uVignette * smoothstep(0.32, 0.85, dist);

      float noise = hash(vUv * (uTime + 1.0)) * 2.0 - 1.0;
      color += noise * uGrain * (0.55 + 0.45 * (1.0 - luma));

      gl_FragColor = vec4(color, base.a);
    }
  `,
};

export function createGradePass() {
  return new ShaderPass(GRADE_SHADER);
}
