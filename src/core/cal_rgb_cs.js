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

import { assert, FormatError, info } from "../shared/util.js";
import { CS } from "./cs.js";

// See http://www.brucelindbloom.com/index.html?Eqn_ChromAdapt.html for these
// matrices.
// prettier-ignore
const BRADFORD_SCALE_MATRIX = new Float32Array([
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296]);

// prettier-ignore
const BRADFORD_SCALE_INVERSE_MATRIX = new Float32Array([
  0.9869929, -0.1470543, 0.1599627,
  0.4323053, 0.5183603, 0.0492912,
  -0.0085287, 0.0400428, 0.9684867]);

// See http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html.
// prettier-ignore
const SRGB_D65_XYZ_TO_RGB_MATRIX = new Float32Array([
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252]);

const FLAT_WHITEPOINT_MATRIX = new Float32Array([1, 1, 1]);

const tempNormalizeMatrix = new Float32Array(3);
const tempConvertMatrix1 = new Float32Array(3);
const tempConvertMatrix2 = new Float32Array(3);

const DECODE_L_CONSTANT = ((8 + 16) / 116) ** 3 / 8.0;

function matrixProduct(a, b, result) {
  result[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  result[1] = a[3] * b[0] + a[4] * b[1] + a[5] * b[2];
  result[2] = a[6] * b[0] + a[7] * b[1] + a[8] * b[2];
}

function convertToFlat(sourceWhitePoint, LMS, result) {
  result[0] = (LMS[0] * 1) / sourceWhitePoint[0];
  result[1] = (LMS[1] * 1) / sourceWhitePoint[1];
  result[2] = (LMS[2] * 1) / sourceWhitePoint[2];
}

function convertToD65(sourceWhitePoint, LMS, result) {
  const D65X = 0.95047;
  const D65Y = 1;
  const D65Z = 1.08883;

  result[0] = (LMS[0] * D65X) / sourceWhitePoint[0];
  result[1] = (LMS[1] * D65Y) / sourceWhitePoint[1];
  result[2] = (LMS[2] * D65Z) / sourceWhitePoint[2];
}

function sRGBTransferFunction(color) {
  // See http://en.wikipedia.org/wiki/SRGB.
  if (color <= 0.0031308) {
    return adjustToRange(0, 1, 12.92 * color);
  }
  // Optimization:
  // If color is close enough to 1, skip calling the following transform
  // since calling Math.pow is expensive. If color is larger than
  // the threshold, the final result is larger than 254.5 since
  // ((1 + 0.055) * 0.99554525 ** (1 / 2.4) - 0.055) * 255 ===
  // 254.50000003134699
  if (color >= 0.99554525) {
    return 1;
  }
  return adjustToRange(0, 1, (1 + 0.055) * color ** (1 / 2.4) - 0.055);
}

function adjustToRange(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function decodeL(L) {
  if (L < 0) {
    return -decodeL(-L);
  }
  if (L > 8.0) {
    return ((L + 16) / 116) ** 3;
  }
  return L * DECODE_L_CONSTANT;
}

function compensateBlackPoint(sourceBlackPoint, XYZ_Flat, result) {
  // In case the blackPoint is already the default blackPoint then there is
  // no need to do compensation.
  if (
    sourceBlackPoint[0] === 0 &&
    sourceBlackPoint[1] === 0 &&
    sourceBlackPoint[2] === 0
  ) {
    result[0] = XYZ_Flat[0];
    result[1] = XYZ_Flat[1];
    result[2] = XYZ_Flat[2];
    return;
  }

  // For the blackPoint calculation details, please see
  // http://www.adobe.com/content/dam/Adobe/en/devnet/photoshop/sdk/
  // AdobeBPC.pdf.
  // The destination blackPoint is the default blackPoint [0, 0, 0].
  const zeroDecodeL = decodeL(0);

  const X_DST = zeroDecodeL;
  const X_SRC = decodeL(sourceBlackPoint[0]);

  const Y_DST = zeroDecodeL;
  const Y_SRC = decodeL(sourceBlackPoint[1]);

  const Z_DST = zeroDecodeL;
  const Z_SRC = decodeL(sourceBlackPoint[2]);

  const X_Scale = (1 - X_DST) / (1 - X_SRC);
  const X_Offset = 1 - X_Scale;

  const Y_Scale = (1 - Y_DST) / (1 - Y_SRC);
  const Y_Offset = 1 - Y_Scale;

  const Z_Scale = (1 - Z_DST) / (1 - Z_SRC);
  const Z_Offset = 1 - Z_Scale;

  result[0] = XYZ_Flat[0] * X_Scale + X_Offset;
  result[1] = XYZ_Flat[1] * Y_Scale + Y_Offset;
  result[2] = XYZ_Flat[2] * Z_Scale + Z_Offset;
}

function normalizeWhitePointToFlat(sourceWhitePoint, XYZ_In, result) {
  // In case the whitePoint is already flat then there is no need to do
  // normalization.
  if (sourceWhitePoint[0] === 1 && sourceWhitePoint[2] === 1) {
    result[0] = XYZ_In[0];
    result[1] = XYZ_In[1];
    result[2] = XYZ_In[2];
    return;
  }

  const LMS = result;
  matrixProduct(BRADFORD_SCALE_MATRIX, XYZ_In, LMS);

  const LMS_Flat = tempNormalizeMatrix;
  convertToFlat(sourceWhitePoint, LMS, LMS_Flat);

  matrixProduct(BRADFORD_SCALE_INVERSE_MATRIX, LMS_Flat, result);
}

function normalizeWhitePointToD65(sourceWhitePoint, XYZ_In, result) {
  const LMS = result;
  matrixProduct(BRADFORD_SCALE_MATRIX, XYZ_In, LMS);

  const LMS_D65 = tempNormalizeMatrix;
  convertToD65(sourceWhitePoint, LMS, LMS_D65);

  matrixProduct(BRADFORD_SCALE_INVERSE_MATRIX, LMS_D65, result);
}

function convertToRgb(cs, src, srcOffset, dest, destOffset, scale) {
  // A, B and C represent a red, green and blue components of a calibrated
  // rgb space.
  const A = adjustToRange(0, 1, src[srcOffset] * scale);
  const B = adjustToRange(0, 1, src[srcOffset + 1] * scale);
  const C = adjustToRange(0, 1, src[srcOffset + 2] * scale);

  // A <---> AGR in the spec
  // B <---> BGG in the spec
  // C <---> CGB in the spec
  const AGR = A === 1 ? 1 : A ** cs.GR;
  const BGG = B === 1 ? 1 : B ** cs.GG;
  const CGB = C === 1 ? 1 : C ** cs.GB;

  // Computes intermediate variables L, M, N as per spec.
  // To decode X, Y, Z values map L, M, N directly to them.
  const X = cs.MXA * AGR + cs.MXB * BGG + cs.MXC * CGB;
  const Y = cs.MYA * AGR + cs.MYB * BGG + cs.MYC * CGB;
  const Z = cs.MZA * AGR + cs.MZB * BGG + cs.MZC * CGB;

  // The following calculations are based on this document:
  // http://www.adobe.com/content/dam/Adobe/en/devnet/photoshop/sdk/
  // AdobeBPC.pdf.
  const XYZ = tempConvertMatrix1;
  XYZ[0] = X;
  XYZ[1] = Y;
  XYZ[2] = Z;
  const XYZ_Flat = tempConvertMatrix2;

  normalizeWhitePointToFlat(cs.whitePoint, XYZ, XYZ_Flat);

  const XYZ_Black = tempConvertMatrix1;
  compensateBlackPoint(cs.blackPoint, XYZ_Flat, XYZ_Black);

  const XYZ_D65 = tempConvertMatrix2;
  normalizeWhitePointToD65(FLAT_WHITEPOINT_MATRIX, XYZ_Black, XYZ_D65);

  const SRGB = tempConvertMatrix1;
  matrixProduct(SRGB_D65_XYZ_TO_RGB_MATRIX, XYZ_D65, SRGB);

  // Convert the values to rgb range [0, 255].
  dest[destOffset] = sRGBTransferFunction(SRGB[0]) * 255;
  dest[destOffset + 1] = sRGBTransferFunction(SRGB[1]) * 255;
  dest[destOffset + 2] = sRGBTransferFunction(SRGB[2]) * 255;
}

/**
 * CalRGBCS: Based on "PDF Reference, Sixth Ed", p.247
 *
 * The default color is `new Float32Array([0, 0, 0])`.
 */
class CalRGBCS extends CS {
  constructor(whitePoint, blackPoint, gamma, matrix) {
    super("CalRGB", 3);

    if (!whitePoint) {
      throw new FormatError(
        "WhitePoint missing - required for color space CalRGB"
      );
    }
    blackPoint = blackPoint || new Float32Array(3);
    gamma = gamma || new Float32Array([1, 1, 1]);
    matrix = matrix || new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    // Translate arguments to spec variables.
    const XW = whitePoint[0];
    const YW = whitePoint[1];
    const ZW = whitePoint[2];
    this.whitePoint = whitePoint;

    const XB = blackPoint[0];
    const YB = blackPoint[1];
    const ZB = blackPoint[2];
    this.blackPoint = blackPoint;

    this.GR = gamma[0];
    this.GG = gamma[1];
    this.GB = gamma[2];

    this.MXA = matrix[0];
    this.MYA = matrix[1];
    this.MZA = matrix[2];
    this.MXB = matrix[3];
    this.MYB = matrix[4];
    this.MZB = matrix[5];
    this.MXC = matrix[6];
    this.MYC = matrix[7];
    this.MZC = matrix[8];

    // Validate variables as per spec.
    if (XW < 0 || ZW < 0 || YW !== 1) {
      throw new FormatError(
        `Invalid WhitePoint components for ${this.name}` +
          ", no fallback available"
      );
    }

    if (XB < 0 || YB < 0 || ZB < 0) {
      info(
        `Invalid BlackPoint for ${this.name} [${XB}, ${YB}, ${ZB}], ` +
          "falling back to default."
      );
      this.blackPoint = new Float32Array(3);
    }

    if (this.GR < 0 || this.GG < 0 || this.GB < 0) {
      info(
        `Invalid Gamma [${this.GR}, ${this.GG}, ${this.GB}] for ` +
          `${this.name}, falling back to default.`
      );
      this.GR = this.GG = this.GB = 1;
    }
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'CalRGBCS.getRgbItem: Unsupported "dest" type.'
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
        'CalRGBCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 1 / ((1 << bits) - 1);

    for (let i = 0; i < count; ++i) {
      convertToRgb(this, src, srcOffset, dest, destOffset, scale);
      srcOffset += 3;
      destOffset += 3 + alpha01;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return ((inputLength * (3 + alpha01)) / 3) | 0;
  }
}

export { CalRGBCS };
