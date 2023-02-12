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

import { assert, shadow, unreachable, warn } from "../shared/util.js";

/**
 * Resizes an RGB image with 3 components.
 * @param {TypedArray} src - The source buffer.
 * @param {TypedArray} dest - The destination buffer.
 * @param {number} w1 - Original width.
 * @param {number} h1 - Original height.
 * @param {number} w2 - New width.
 * @param {number} h2 - New height.
 * @param {number} alpha01 - Size reserved for the alpha channel.
 */
function resizeRgbImage(src, dest, w1, h1, w2, h2, alpha01) {
  const COMPONENTS = 3;
  alpha01 = alpha01 !== 1 ? 0 : alpha01;
  const xRatio = w1 / w2;
  const yRatio = h1 / h2;
  let newIndex = 0,
    oldIndex;
  const xScaled = new Uint16Array(w2);
  const w1Scanline = w1 * COMPONENTS;

  for (let i = 0; i < w2; i++) {
    xScaled[i] = Math.floor(i * xRatio) * COMPONENTS;
  }
  for (let i = 0; i < h2; i++) {
    const py = Math.floor(i * yRatio) * w1Scanline;
    for (let j = 0; j < w2; j++) {
      oldIndex = py + xScaled[j];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      newIndex += alpha01;
    }
  }
}

function isDefaultDecode(decode, numComps) {
  if (!Array.isArray(decode)) {
    return true;
  }
  if (numComps * 2 !== decode.length) {
    warn("The decode map is not the correct length");
    return true;
  }
  for (let i = 0, ii = decode.length; i < ii; i += 2) {
    if (decode[i] !== 0 || decode[i + 1] !== 1) {
      return false;
    }
  }
  return true;
}

class CS {
  constructor(name, numComps) {
    if (this.constructor === CS) {
      unreachable("Cannot initialize CS.");
    }
    this.name = name;
    this.numComps = numComps;
  }

  /**
   * Converts the color value to the RGB color. The color components are
   * located in the src array starting from the srcOffset. Returns the array
   * of the rgb components, each value ranging from [0,255].
   */
  getRgb(src, srcOffset) {
    const rgb = new Uint8ClampedArray(3);
    this.getRgbItem(src, srcOffset, rgb, 0);
    return rgb;
  }

  /**
   * Converts the color value to the RGB color, similar to the getRgb method.
   * The result placed into the dest array starting from the destOffset.
   */
  getRgbItem(src, srcOffset, dest, destOffset) {
    unreachable("Should not call CS.getRgbItem");
  }

  /**
   * Converts the specified number of the color values to the RGB colors.
   * The colors are located in the src array starting from the srcOffset.
   * The result is placed into the dest array starting from the destOffset.
   * The src array items shall be in [0,2^bits) range, the dest array items
   * will be in [0,255] range. alpha01 indicates how many alpha components
   * there are in the dest array; it will be either 0 (RGB array) or 1 (RGBA
   * array).
   */
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    unreachable("Should not call CS.getRgbBuffer");
  }

  /**
   * Determines the number of bytes required to store the result of the
   * conversion done by the getRgbBuffer method. As in getRgbBuffer,
   * |alpha01| is either 0 (RGB output) or 1 (RGBA output).
   */
  getOutputLength(inputLength, alpha01) {
    unreachable("Should not call CS.getOutputLength");
  }

  /**
   * Returns true if source data will be equal the result/output data.
   */
  isPassthrough(bits) {
    return false;
  }

  /**
   * Refer to the `isDefaultDecode` function above.
   */
  isDefaultDecode(decodeMap, bpc) {
    return isDefaultDecode(decodeMap, this.numComps);
  }

  /**
   * Fills in the RGB colors in the destination buffer.  alpha01 indicates
   * how many alpha components there are in the dest array; it will be either
   * 0 (RGB array) or 1 (RGBA array).
   */
  fillRgb(
    dest,
    originalWidth,
    originalHeight,
    width,
    height,
    actualHeight,
    bpc,
    comps,
    alpha01
  ) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CS.fillRgb: Unsupported "dest" type.'
      );
    }
    const count = originalWidth * originalHeight;
    let rgbBuf = null;
    const numComponentColors = 1 << bpc;
    const needsResizing = originalHeight !== height || originalWidth !== width;

    if (this.isPassthrough(bpc)) {
      rgbBuf = comps;
    } else if (
      this.numComps === 1 &&
      count > numComponentColors &&
      this.name !== "DeviceGray" &&
      this.name !== "DeviceRGB"
    ) {
      // Optimization: create a color map when there is just one component and
      // we are converting more colors than the size of the color map. We
      // don't build the map if the colorspace is gray or rgb since those
      // methods are faster than building a map. This mainly offers big speed
      // ups for indexed and alternate colorspaces.
      //
      // TODO it may be worth while to cache the color map. While running
      // testing I never hit a cache so I will leave that out for now (perhaps
      // we are reparsing colorspaces too much?).
      const allColors =
        bpc <= 8
          ? new Uint8Array(numComponentColors)
          : new Uint16Array(numComponentColors);
      for (let i = 0; i < numComponentColors; i++) {
        allColors[i] = i;
      }
      const colorMap = new Uint8ClampedArray(numComponentColors * 3);
      this.getRgbBuffer(
        allColors,
        0,
        numComponentColors,
        colorMap,
        0,
        bpc,
        /* alpha01 = */ 0
      );

      if (!needsResizing) {
        // Fill in the RGB values directly into |dest|.
        let destPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          dest[destPos++] = colorMap[key];
          dest[destPos++] = colorMap[key + 1];
          dest[destPos++] = colorMap[key + 2];
          destPos += alpha01;
        }
      } else {
        rgbBuf = new Uint8Array(count * 3);
        let rgbPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          rgbBuf[rgbPos++] = colorMap[key];
          rgbBuf[rgbPos++] = colorMap[key + 1];
          rgbBuf[rgbPos++] = colorMap[key + 2];
        }
      }
    } else {
      if (!needsResizing) {
        // Fill in the RGB values directly into |dest|.
        this.getRgbBuffer(
          comps,
          0,
          width * actualHeight,
          dest,
          0,
          bpc,
          alpha01
        );
      } else {
        rgbBuf = new Uint8ClampedArray(count * 3);
        this.getRgbBuffer(comps, 0, count, rgbBuf, 0, bpc, /* alpha01 = */ 0);
      }
    }

    if (rgbBuf) {
      if (needsResizing) {
        resizeRgbImage(
          rgbBuf,
          dest,
          originalWidth,
          originalHeight,
          width,
          height,
          alpha01
        );
      } else {
        let destPos = 0,
          rgbPos = 0;
        for (let i = 0, ii = width * actualHeight; i < ii; i++) {
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          destPos += alpha01;
        }
      }
    }
  }

  /**
   * True if the colorspace has components in the default range of [0, 1].
   * This should be true for all colorspaces except for lab color spaces
   * which are [0,100], [-128, 127], [-128, 127].
   */
  get usesZeroToOneRange() {
    return shadow(this, "usesZeroToOneRange", true);
  }
}

export { CS, isDefaultDecode };
