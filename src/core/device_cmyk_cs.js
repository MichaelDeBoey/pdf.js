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

import { assert } from "../shared/util.js";
import { CS } from "./cs.js";

// The coefficients below was found using numerical analysis: the method of
// steepest descent for the sum((f_i - color_value_i)^2) for r/g/b colors,
// where color_value is the tabular value from the table of sampled RGB colors
// from CMYK US Web Coated (SWOP) colorspace, and f_i is the corresponding
// CMYK color conversion using the estimation below:
//   f(A, B,.. N) = Acc+Bcm+Ccy+Dck+c+Fmm+Gmy+Hmk+Im+Jyy+Kyk+Ly+Mkk+Nk+255
function convertToRgb(src, srcOffset, srcScale, dest, destOffset) {
  const c = src[srcOffset] * srcScale;
  const m = src[srcOffset + 1] * srcScale;
  const y = src[srcOffset + 2] * srcScale;
  const k = src[srcOffset + 3] * srcScale;

  dest[destOffset] =
    255 +
    c *
      (-4.387332384609988 * c +
        54.48615194189176 * m +
        18.82290502165302 * y +
        212.25662451639585 * k +
        -285.2331026137004) +
    m *
      (1.7149763477362134 * m -
        5.6096736904047315 * y +
        -17.873870861415444 * k -
        5.497006427196366) +
    y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) +
    k * (-21.86122147463605 * k - 189.48180835922747);

  dest[destOffset + 1] =
    255 +
    c *
      (8.841041422036149 * c +
        60.118027045597366 * m +
        6.871425592049007 * y +
        31.159100130055922 * k +
        -79.2970844816548) +
    m *
      (-15.310361306967817 * m +
        17.575251261109482 * y +
        131.35250912493976 * k -
        190.9453302588951) +
    y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) +
    k * (-20.737325471181034 * k - 187.80453709719578);

  dest[destOffset + 2] =
    255 +
    c *
      (0.8842522430003296 * c +
        8.078677503112928 * m +
        30.89978309703729 * y -
        0.23883238689178934 * k +
        -14.183576799673286) +
    m *
      (10.49593273432072 * m +
        63.02378494754052 * y +
        50.606957656360734 * k -
        112.23884253719248) +
    y *
      (0.03296041114873217 * y + 115.60384449646641 * k + -193.58209356861505) +
    k * (-22.33816807309886 * k - 180.12613974708367);
}

/**
 * The default color is `new Float32Array([0, 0, 0, 1])`.
 */
class DeviceCmykCS extends CS {
  constructor() {
    super("DeviceCMYK", 4);
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'DeviceCmykCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    convertToRgb(src, srcOffset, 1, dest, destOffset);
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'DeviceCmykCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; i++) {
      convertToRgb(src, srcOffset, scale, dest, destOffset);
      srcOffset += 4;
      destOffset += 3 + alpha01;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return ((inputLength / 4) * (3 + alpha01)) | 0;
  }
}

export { DeviceCmykCS };
