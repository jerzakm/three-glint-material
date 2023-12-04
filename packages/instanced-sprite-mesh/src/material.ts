import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  Material,
  RGBAFormat,
  RepeatWrapping,
  Vector2,
  Vector4,
} from "three";

//@ts-ignore
import { createDerivedMaterial } from "troika-three-utils";

/** replace base UVs with the altered spritesheet UV.
 * Should allow for supporting of most THREE base materials
 * TODO needs improvements
 */
const replaceUVs = (text: string, replacement: string) => {
  const lines = text.split("\n");
  const matUVs = /vMapUv|vAlphaMapUv|vNormalMapUv/g;

  const modifiedLines = lines.map((line) => {
    if (!line.includes("varying") && !line.includes("uniform")) {
      return line.replace(matUVs, replacement);
    }
    return line;
  });

  return modifiedLines.join("\n");
};

// TODO TYPE GENERICS
export const constructSpriteMaterial = (
  baseMaterial: Material,
  triGeometry: boolean | undefined
): Material => {
  const defines: Record<string, any> = {
    USE_UV: "",
  };

  if (triGeometry) {
    defines["TRI_GEOMETRY"] = "";
  }

  const customMaterial = createDerivedMaterial(baseMaterial, {
    defines,
    uniforms: {
      /** active animation */
      animationId: { value: 0 },
      /* Repeat animation in a loop */
      billboarding: { value: 0 },
      /** timer in s */
      time: { value: 0 },
      /** used for non looped animation. Animation starts at this time and plays only once, then stays at the last frame */
      startTime: { value: 0 },
      /** per instance time offset, can be used so that all of the animations aren't perfectly synced */
      offset: { value: 0 },
      /** flip uvs on x */
      flipX: { value: 0 },
      /** flip uvs on y */
      flipY: { value: 0 },
      /**
       * How many different animations there are.
       * Needed to determine number of rows there are in DataTexture
       */
      fps: { value: 0 },
      /* Repeat animation in a loop */
      loop: { value: 1 },
      /**
       * DataArrayTexture - data stored in columns. Rows are:
       * 0 - Frames declaration - RGBA[x,y,w,h]
       * 1 - Animation lengths RGBA[length,0,0,0]
       * 2 - Animation0 - RGBA [id,duration, 0,0]
       * 3 - Animation1 - RGBA [id,duration, 0,0]
       * ....etc
       */
      spritesheetData: { value: null },
      /**util for reading data texture in spritesheetData */
      dataSize: { value: new Vector2(0, 0) },
      /**
       * Tinting - Vector4 (enabled 0/1, H (0-3), S (0-1), V(0-1))
       */
      tint: { value: new Vector4(0, 0, 0, 0) },
    },

    /**
     *
     * VERTEX
     * - billboarding
     *
     * */
    vertexDefs: /*glsl*/ `
    uniform float billboarding;
    `,

    vertexMainOutro: /*glsl*/ `
    if(billboarding == 1.){
      vec3 instancePosition = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

      vec3 cameraRight_worldspace = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
      vec3 cameraUp_worldspace = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
  
      vec2 BillboardSize = vec2 (1.,1.);
  
      vec3 vertexPosition_worldspace = instancePosition
        + cameraRight_worldspace * position.x * BillboardSize.x
        + cameraUp_worldspace * position.y * BillboardSize.y;
        //wip billboarding
      gl_Position = projectionMatrix * modelViewMatrix * vec4(vertexPosition_worldspace, 1.0);
    }   
    `,
    /**
     *
     * FRAGMENT REWRITER
     *
     * */
    customRewriter: ({ vertexShader, fragmentShader }: any) => {
      // uniforms etc
      const header = /*glsl*/ `
			uniform sampler2D spritesheetData;
			uniform float animationId;
      uniform float startTime;
			uniform float time;
			uniform float flipX;
			uniform float flipY;
			uniform float offset;
			uniform float fps;
      uniform float loop;
			uniform vec2 dataSize;
      uniform vec4 tint;
			`;

      // read spritesheet metadata
      const readData = /*glsl*/ `
			vec4 readData(float col, float row) {
				float wStep = 1.f / dataSize.x;
				float wHalfStep = wStep * 0.5f;
				float hStep = 1.f / dataSize.y;
				float hHalfStep = 1.f / dataSize.y * 0.5f;
				return texture2D(spritesheetData, vec2(col * wStep + wHalfStep, row * hStep + hHalfStep));
			}     

      vec2 zoomUV(vec2 uv, vec2 zoomCenter, float zoomFactor) {
        // Shift UVs so that the zoom center is the origin
        vec2 shiftedUV = uv - zoomCenter;
    
        // Scale (zoom) the UV coordinates
        shiftedUV *= zoomFactor;
    
        // Shift back
        shiftedUV += zoomCenter;
    
        return shiftedUV;
    }
			`;

      // calculate sprite UV
      const spriteUv = /*glsl*/ `


			float animLength = readData(animationId, 1.f).r;
			float totalTime = animLength / fps;

			float frameTimedId = mod(time + offset, totalTime) / totalTime;
      // frameTimedId = time / totalTime;
      if(loop == 0.){
        frameTimedId = clamp((time - startTime) / totalTime, 0.,1.);
      }

			float frameId = floor(animLength * frameTimedId);

			float spritesheetFrameId = readData(frameId, 2.f + animationId).r;
      
     
			// x,y,w,h
			vec4 frameMeta = readData(spritesheetFrameId, 0.f);

			vec2 fSize = frameMeta.zw;
			vec2 fOffset = vec2(frameMeta.xy);

      vec2 transformedPlaneUv = vUv + vec2(0.,0.);

      if(flipX == 1.){
        transformedPlaneUv.x = 1. - transformedPlaneUv.x;
      }
      if(flipY == 1.){
        transformedPlaneUv.y = 1. - transformedPlaneUv.y;
      }           
      
			vec2 spriteUv = fSize * transformedPlaneUv + fOffset ;

      #ifdef TRI_GEOMETRY
        // Shift UVs if mesh uses triangle geometry
        // TODO optimize ugly math
        if(vUv.y>0.5 || vUv.x<0.25 || vUv.x>0.75){
          discard;
        }  

        vec2 zoomCenter = vec2(fSize.x * 0.5,0.) + fOffset;
        float zoomFactor = 2.;
        vec2 shiftedUV = spriteUv - zoomCenter; 
        shiftedUV *= zoomFactor;
        shiftedUV += zoomCenter; 
        spriteUv = shiftedUV;
      #endif

   

			`;
      fragmentShader = fragmentShader.replace(
        `void main() {`,
        `void main() {${spriteUv}`
      );

      fragmentShader = `
			${header}
			${readData}
			${fragmentShader}
			`;

      fragmentShader = fragmentShader.replace(
        `vec4 sampledDiffuseColor = texture2D( map, vMapUv );`,
        /*glsl*/ `
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        if(tint.w == 1.){    
          vec3 hue_term = 1.0 - min(abs(vec3(tint.x) - vec3(0,2.0,1.0)), 1.0);
          hue_term.x = 1.0 - dot(hue_term.yz, vec2(1));
          vec3 res = vec3(dot(sampledDiffuseColor.xyz, hue_term.xyz), dot(sampledDiffuseColor.xyz, hue_term.zxy), dot(sampledDiffuseColor.xyz, hue_term.yzx));
          res = mix(vec3(dot(res, vec3(0.2, 0.5, 0.3))), res, tint.y);
          res = res * tint.z;        
  
          sampledDiffuseColor = vec4(res, sampledDiffuseColor.a);
        }        
      `
      );

      fragmentShader = replaceUVs(fragmentShader, "spriteUv");
      return { vertexShader, fragmentShader };
    },
  });
  return customMaterial;
};

/**
 * wip - basic aseprite json support
 * todo
 * */
export const parseAseprite = (json: any) => {
  const frames: [x: number, y: number, w: number, h: number][] = [];
  const frameDurations: number[] = [];
  const animations: Record<string, [frameId: number, duration: number][]> = {};
  const animationLengths: number[] = [];

  const w = json.meta.size.w;
  const h = json.meta.size.h;

  const sheetSize: [w: number, h: number] = [
    json.meta.size.w,
    json.meta.size.h,
  ];

  for (const fId in json.frames) {
    const f = json.frames[fId];
    frames.push([f.frame.x / w, f.frame.y / h, f.frame.w / w, f.frame.h / h]);
    frameDurations.push(f.duration);
  }
  for (const a of json.meta.frameTags) {
    animations[a.name] = [];
    for (let i = a.from; i <= a.to; i++) {
      animations[a.name].push([i, frameDurations[i]]);
    }
    animationLengths.push(animations[a.name].length);
  }

  return { frames, animations, sheetSize, animationLengths };
};

export type SpritesheetFormat = {
  frames: [x: number, y: number, w: number, h: number][];
  animations: Record<string, [frameId: number, duration: number][]>;
  sheetSize: [w: number, h: number];
  animationLengths: number[];
};

export const makeDataTexture = (data: SpritesheetFormat) => {
  const { frames, animationLengths, animations } = data;
  // find the longest array to determine data width uniform
  const dataWidth = Math.max(
    frames.length,
    animationLengths.length,
    ...Object.values(animations).map((a) => {
      return a.length;
    })
  );
  const dataHeight = 2 + Object.values(animations).length;

  // Flatten all rows if necessary and fill with 0 if too short (dataWidth)

  // row 0
  const framesRGBA = frames
    .flat()
    .concat(new Array((dataWidth - frames.length) * 4).fill(0));
  // row 1
  const animationLengthsRGBA = animationLengths
    .map((l) => {
      return [l, 0, 0, 0];
    })
    .flat()
    .concat(new Array((dataWidth - animationLengths.length) * 4).fill(0));

  // row 2+
  const animationsRGBA: number[] = [];
  const animMap: Map<string, number> = new Map();

  for (let i = 0; i < Object.keys(animations).length; i++) {
    const key = Object.keys(animations)[i];
    animMap.set(key, i);
    const aFrames = animations[key]
      .map((a) => {
        return [...a, 0, 0];
      })
      .flat()
      .concat(new Array((dataWidth - animations[key].length) * 4).fill(0));
    animationsRGBA.push(...aFrames);
  }

  const combinedData = [
    ...framesRGBA,
    ...animationLengthsRGBA,
    ...animationsRGBA,
  ];

  const combinedDataF32 = new Float32Array(combinedData);
  combinedDataF32.set(combinedData);

  //todo pow2 sized texture instead ?
  const dataTexture = new DataTexture(
    combinedDataF32,
    dataWidth,
    dataHeight,
    RGBAFormat,
    FloatType
  );
  dataTexture.type = FloatType;
  dataTexture.minFilter = LinearFilter;
  dataTexture.magFilter = LinearFilter;
  dataTexture.wrapS = ClampToEdgeWrapping;
  dataTexture.wrapT = RepeatWrapping;
  dataTexture.needsUpdate = true;

  return { dataTexture, dataWidth, dataHeight, animMap };
};
