/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  assert,
  FormatError,
  info,
  shadow,
  unreachable,
  warn,
} from "../shared/util.js";
import { CS, isDefaultDecode } from "./cs.js";
import { Dict, Name, Ref } from "./primitives.js";
import { AlternateCS } from "./alternate_cs.js";
import { CalGrayCS } from "./cal_gray_cs.js";
import { CalRGBCS } from "./cal_rgb_cs.js";
import { DeviceCmykCS } from "./device_cmyk_cs.js";
import { DeviceGrayCS } from "./device_gray_cs.js";
import { DeviceRgbCS } from "./device_rgb_cs.js";
import { IndexedCS } from "./indexed_cs.js";
import { MissingDataException } from "./core_utils.js";
import { PatternCS } from "./pattern_cs.js";

class ColorSpace {
  constructor() {
    if (this.constructor === ColorSpace) {
      unreachable("Cannot initialize ColorSpace.");
    }
  }

  /**
   * @private
   */
  static _cache(cacheKey, xref, localColorSpaceCache, parsedColorSpace) {
    if (!localColorSpaceCache) {
      throw new Error(
        'ColorSpace._cache - expected "localColorSpaceCache" argument.'
      );
    }
    if (!parsedColorSpace) {
      throw new Error(
        'ColorSpace._cache - expected "parsedColorSpace" argument.'
      );
    }
    let csName, csRef;
    if (cacheKey instanceof Ref) {
      csRef = cacheKey;

      // If parsing succeeded, we know that this call cannot throw.
      cacheKey = xref.fetch(cacheKey);
    }
    if (cacheKey instanceof Name) {
      csName = cacheKey.name;
    }
    if (csName || csRef) {
      localColorSpaceCache.set(csName, csRef, parsedColorSpace);
    }
  }

  static getCached(cacheKey, xref, localColorSpaceCache) {
    if (!localColorSpaceCache) {
      throw new Error(
        'ColorSpace.getCached - expected "localColorSpaceCache" argument.'
      );
    }
    if (cacheKey instanceof Ref) {
      const localColorSpace = localColorSpaceCache.getByRef(cacheKey);
      if (localColorSpace) {
        return localColorSpace;
      }

      try {
        cacheKey = xref.fetch(cacheKey);
      } catch (ex) {
        if (ex instanceof MissingDataException) {
          throw ex;
        }
        // Any errors should be handled during parsing, rather than here.
      }
    }
    if (cacheKey instanceof Name) {
      const localColorSpace = localColorSpaceCache.getByName(cacheKey.name);
      if (localColorSpace) {
        return localColorSpace;
      }
    }
    return null;
  }

  static async parseAsync({
    cs,
    xref,
    resources = null,
    pdfFunctionFactory,
    localColorSpaceCache,
  }) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        !this.getCached(cs, xref, localColorSpaceCache),
        "Expected `ColorSpace.getCached` to have been manually checked " +
          "before calling `ColorSpace.parseAsync`."
      );
    }
    const parsedColorSpace = this._parse(
      cs,
      xref,
      resources,
      pdfFunctionFactory
    );

    // Attempt to cache the parsed ColorSpace, by name and/or reference.
    this._cache(cs, xref, localColorSpaceCache, parsedColorSpace);

    return parsedColorSpace;
  }

  static parse({
    cs,
    xref,
    resources = null,
    pdfFunctionFactory,
    localColorSpaceCache,
  }) {
    const cachedColorSpace = this.getCached(cs, xref, localColorSpaceCache);
    if (cachedColorSpace) {
      return cachedColorSpace;
    }
    const parsedColorSpace = this._parse(
      cs,
      xref,
      resources,
      pdfFunctionFactory
    );

    // Attempt to cache the parsed ColorSpace, by name and/or reference.
    this._cache(cs, xref, localColorSpaceCache, parsedColorSpace);

    return parsedColorSpace;
  }

  /**
   * @private
   */
  static _parse(cs, xref, resources = null, pdfFunctionFactory) {
    cs = xref.fetchIfRef(cs);
    if (cs instanceof Name) {
      switch (cs.name) {
        case "G":
        case "DeviceGray":
          return this.singletons.gray;
        case "RGB":
        case "DeviceRGB":
          return this.singletons.rgb;
        case "CMYK":
        case "DeviceCMYK":
          return this.singletons.cmyk;
        case "Pattern":
          return new PatternCS(/* baseCS = */ null);
        default:
          if (resources instanceof Dict) {
            const colorSpaces = resources.get("ColorSpace");
            if (colorSpaces instanceof Dict) {
              const resourcesCS = colorSpaces.get(cs.name);
              if (resourcesCS) {
                if (resourcesCS instanceof Name) {
                  return this._parse(
                    resourcesCS,
                    xref,
                    resources,
                    pdfFunctionFactory
                  );
                }
                cs = resourcesCS;
                break;
              }
            }
          }
          throw new FormatError(`Unrecognized ColorSpace: ${cs.name}`);
      }
    }
    if (Array.isArray(cs)) {
      const mode = xref.fetchIfRef(cs[0]).name;
      let params, numComps, baseCS, whitePoint, blackPoint, gamma;

      switch (mode) {
        case "G":
        case "DeviceGray":
          return this.singletons.gray;
        case "RGB":
        case "DeviceRGB":
          return this.singletons.rgb;
        case "CMYK":
        case "DeviceCMYK":
          return this.singletons.cmyk;
        case "CalGray":
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray("WhitePoint");
          blackPoint = params.getArray("BlackPoint");
          gamma = params.get("Gamma");
          return new CalGrayCS(whitePoint, blackPoint, gamma);
        case "CalRGB":
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray("WhitePoint");
          blackPoint = params.getArray("BlackPoint");
          gamma = params.getArray("Gamma");
          const matrix = params.getArray("Matrix");
          return new CalRGBCS(whitePoint, blackPoint, gamma, matrix);
        case "ICCBased":
          const stream = xref.fetchIfRef(cs[1]);
          const dict = stream.dict;
          numComps = dict.get("N");
          const alt = dict.get("Alternate");
          if (alt) {
            const altCS = this._parse(alt, xref, resources, pdfFunctionFactory);
            // Ensure that the number of components are correct,
            // and also (indirectly) that it is not a PatternCS.
            if (altCS.numComps === numComps) {
              return altCS;
            }
            warn("ICCBased color space: Ignoring incorrect /Alternate entry.");
          }
          if (numComps === 1) {
            return this.singletons.gray;
          } else if (numComps === 3) {
            return this.singletons.rgb;
          } else if (numComps === 4) {
            return this.singletons.cmyk;
          }
          break;
        case "Pattern":
          baseCS = cs[1] || null;
          if (baseCS) {
            baseCS = this._parse(baseCS, xref, resources, pdfFunctionFactory);
          }
          return new PatternCS(baseCS);
        case "I":
        case "Indexed":
          baseCS = this._parse(cs[1], xref, resources, pdfFunctionFactory);
          const hiVal = xref.fetchIfRef(cs[2]) + 1;
          const lookup = xref.fetchIfRef(cs[3]);
          return new IndexedCS(baseCS, hiVal, lookup);
        case "Separation":
        case "DeviceN":
          const name = xref.fetchIfRef(cs[1]);
          numComps = Array.isArray(name) ? name.length : 1;
          baseCS = this._parse(cs[2], xref, resources, pdfFunctionFactory);
          const tintFn = pdfFunctionFactory.create(cs[3]);
          return new AlternateCS(numComps, baseCS, tintFn);
        case "Lab":
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray("WhitePoint");
          blackPoint = params.getArray("BlackPoint");
          const range = params.getArray("Range");
          return new LabCS(whitePoint, blackPoint, range);
        default:
          throw new FormatError(`Unimplemented ColorSpace object: ${mode}`);
      }
    }
    throw new FormatError(`Unrecognized ColorSpace object: ${cs}`);
  }

  /**
   * Checks if a decode map matches the default decode map for a color space.
   * This handles the general decode maps where there are two values per
   * component, e.g. [0, 1, 0, 1, 0, 1] for a RGB color.
   * This does not handle Lab, Indexed, or Pattern decode maps since they are
   * slightly different.
   * @param {Array} decode - Decode map (usually from an image).
   * @param {number} numComps - Number of components the color space has.
   */
  static isDefaultDecode(decode, numComps) {
    return isDefaultDecode(decode, numComps);
  }

  static get singletons() {
    return shadow(this, "singletons", {
      get gray() {
        return shadow(this, "gray", new DeviceGrayCS());
      },
      get rgb() {
        return shadow(this, "rgb", new DeviceRgbCS());
      },
      get cmyk() {
        return shadow(this, "cmyk", new DeviceCmykCS());
      },
    });
  }
}

/**
 * LabCS: Based on "PDF Reference, Sixth Ed", p.250
 *
 * The default color is `new Float32Array([0, 0, 0])`.
 */
const LabCS = (function LabCSClosure() {
  // Function g(x) from spec
  function fn_g(x) {
    let result;
    if (x >= 6 / 29) {
      result = x ** 3;
    } else {
      result = (108 / 841) * (x - 4 / 29);
    }
    return result;
  }

  function decode(value, high1, low2, high2) {
    return low2 + (value * (high2 - low2)) / high1;
  }

  // If decoding is needed maxVal should be 2^bits per component - 1.
  function convertToRgb(cs, src, srcOffset, maxVal, dest, destOffset) {
    // XXX: Lab input is in the range of [0, 100], [amin, amax], [bmin, bmax]
    // not the usual [0, 1]. If a command like setFillColor is used the src
    // values will already be within the correct range. However, if we are
    // converting an image we have to map the values to the correct range given
    // above.
    // Ls,as,bs <---> L*,a*,b* in the spec
    let Ls = src[srcOffset];
    let as = src[srcOffset + 1];
    let bs = src[srcOffset + 2];
    if (maxVal !== false) {
      Ls = decode(Ls, maxVal, 0, 100);
      as = decode(as, maxVal, cs.amin, cs.amax);
      bs = decode(bs, maxVal, cs.bmin, cs.bmax);
    }

    // Adjust limits of 'as' and 'bs'
    if (as > cs.amax) {
      as = cs.amax;
    } else if (as < cs.amin) {
      as = cs.amin;
    }
    if (bs > cs.bmax) {
      bs = cs.bmax;
    } else if (bs < cs.bmin) {
      bs = cs.bmin;
    }

    // Computes intermediate variables X,Y,Z as per spec
    const M = (Ls + 16) / 116;
    const L = M + as / 500;
    const N = M - bs / 200;

    const X = cs.XW * fn_g(L);
    const Y = cs.YW * fn_g(M);
    const Z = cs.ZW * fn_g(N);

    let r, g, b;
    // Using different conversions for D50 and D65 white points,
    // per http://www.color.org/srgb.pdf
    if (cs.ZW < 1) {
      // Assuming D50 (X=0.9642, Y=1.00, Z=0.8249)
      r = X * 3.1339 + Y * -1.617 + Z * -0.4906;
      g = X * -0.9785 + Y * 1.916 + Z * 0.0333;
      b = X * 0.072 + Y * -0.229 + Z * 1.4057;
    } else {
      // Assuming D65 (X=0.9505, Y=1.00, Z=1.0888)
      r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
      g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
      b = X * 0.0557 + Y * -0.204 + Z * 1.057;
    }
    // Convert the color values to the [0,255] range (clamping is automatic).
    dest[destOffset] = Math.sqrt(r) * 255;
    dest[destOffset + 1] = Math.sqrt(g) * 255;
    dest[destOffset + 2] = Math.sqrt(b) * 255;
  }

  // eslint-disable-next-line no-shadow
  class LabCS extends CS {
    constructor(whitePoint, blackPoint, range) {
      super("Lab", 3);

      if (!whitePoint) {
        throw new FormatError(
          "WhitePoint missing - required for color space Lab"
        );
      }
      blackPoint = blackPoint || [0, 0, 0];
      range = range || [-100, 100, -100, 100];

      // Translate args to spec variables
      this.XW = whitePoint[0];
      this.YW = whitePoint[1];
      this.ZW = whitePoint[2];
      this.amin = range[0];
      this.amax = range[1];
      this.bmin = range[2];
      this.bmax = range[3];

      // These are here just for completeness - the spec doesn't offer any
      // formulas that use BlackPoint in Lab
      this.XB = blackPoint[0];
      this.YB = blackPoint[1];
      this.ZB = blackPoint[2];

      // Validate vars as per spec
      if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
        throw new FormatError(
          "Invalid WhitePoint components, no fallback available"
        );
      }

      if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
        info("Invalid BlackPoint, falling back to default");
        this.XB = this.YB = this.ZB = 0;
      }

      if (this.amin > this.amax || this.bmin > this.bmax) {
        info("Invalid Range, falling back to defaults");
        this.amin = -100;
        this.amax = 100;
        this.bmin = -100;
        this.bmax = 100;
      }
    }

    getRgbItem(src, srcOffset, dest, destOffset) {
      if (
        typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || TESTING")
      ) {
        assert(
          dest instanceof Uint8ClampedArray,
          'LabCS.getRgbItem: Unsupported "dest" type.'
        );
      }
      convertToRgb(this, src, srcOffset, false, dest, destOffset);
    }

    getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
      if (
        typeof PDFJSDev === "undefined" ||
        PDFJSDev.test("!PRODUCTION || TESTING")
      ) {
        assert(
          dest instanceof Uint8ClampedArray,
          'LabCS.getRgbBuffer: Unsupported "dest" type.'
        );
      }
      const maxVal = (1 << bits) - 1;
      for (let i = 0; i < count; i++) {
        convertToRgb(this, src, srcOffset, maxVal, dest, destOffset);
        srcOffset += 3;
        destOffset += 3 + alpha01;
      }
    }

    getOutputLength(inputLength, alpha01) {
      return ((inputLength * (3 + alpha01)) / 3) | 0;
    }

    isDefaultDecode(decodeMap, bpc) {
      // XXX: Decoding is handled with the lab conversion because of the strange
      // ranges that are used.
      return true;
    }

    get usesZeroToOneRange() {
      return shadow(this, "usesZeroToOneRange", false);
    }
  }
  return LabCS;
})();

export { ColorSpace };
