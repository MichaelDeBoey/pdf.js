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

import { assert, FormatError, info, warn } from "../shared/util.js";
import { CS } from "./cs.js";

function convertToRgb(cs, src, srcOffset, dest, destOffset, scale) {
  // A represents a gray component of a calibrated gray space.
  // A <---> AG in the spec
  const A = src[srcOffset] * scale;
  const AG = A ** cs.G;

  // Computes L as per spec. ( = cs.YW * AG )
  // Except if other than default BlackPoint values are used.
  const L = cs.YW * AG;
  // http://www.poynton.com/notes/colour_and_gamma/ColorFAQ.html, Ch 4.
  // Convert values to rgb range [0, 255].
  const val = Math.max(295.8 * L ** 0.3333333333333333 - 40.8, 0);
  dest[destOffset] = val;
  dest[destOffset + 1] = val;
  dest[destOffset + 2] = val;
}

/**
 * CalGrayCS: Based on "PDF Reference, Sixth Ed", p.245
 *
 * The default color is `new Float32Array([0])`.
 */
class CalGrayCS extends CS {
  constructor(whitePoint, blackPoint, gamma) {
    super("CalGray", 1);

    if (!whitePoint) {
      throw new FormatError(
        "WhitePoint missing - required for color space CalGray"
      );
    }
    blackPoint = blackPoint || [0, 0, 0];
    gamma = gamma || 1;

    // Translate arguments to spec variables.
    this.XW = whitePoint[0];
    this.YW = whitePoint[1];
    this.ZW = whitePoint[2];

    this.XB = blackPoint[0];
    this.YB = blackPoint[1];
    this.ZB = blackPoint[2];

    this.G = gamma;

    // Validate variables as per spec.
    if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
      throw new FormatError(
        `Invalid WhitePoint components for ${this.name}` +
          ", no fallback available"
      );
    }

    if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
      info(`Invalid BlackPoint for ${this.name}, falling back to default.`);
      this.XB = this.YB = this.ZB = 0;
    }

    if (this.XB !== 0 || this.YB !== 0 || this.ZB !== 0) {
      warn(
        `${this.name}, BlackPoint: XB: ${this.XB}, YB: ${this.YB}, ` +
          `ZB: ${this.ZB}, only default values are supported.`
      );
    }

    if (this.G < 1) {
      info(
        `Invalid Gamma: ${this.G} for ${this.name}, ` +
          "falling back to default."
      );
      this.G = 1;
    }
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalGrayCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    convertToRgb(this, src, srcOffset, dest, destOffset, 1);
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalGrayCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 1 / ((1 << bits) - 1);

    for (let i = 0; i < count; ++i) {
      convertToRgb(this, src, srcOffset, dest, destOffset, scale);
      srcOffset += 1;
      destOffset += 3 + alpha01;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01);
  }
}

export { CalGrayCS };
