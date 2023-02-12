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
  shadow,
  unreachable,
  warn,
} from "../shared/util.js";
import { Dict, Name, Ref } from "./primitives.js";
import { AlternateCS } from "./alternate_cs.js";
import { CalGrayCS } from "./cal_gray_cs.js";
import { CalRGBCS } from "./cal_rgb_cs.js";
import { DeviceCmykCS } from "./device_cmyk_cs.js";
import { DeviceGrayCS } from "./device_gray_cs.js";
import { DeviceRgbCS } from "./device_rgb_cs.js";
import { IndexedCS } from "./indexed_cs.js";
import { isDefaultDecode } from "./cs.js";
import { LabCS } from "./lab_cs.js";
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

export { ColorSpace };
