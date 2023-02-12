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

/**
 * The default color is `new Float32Array([0])`.
 */
class DeviceGrayCS extends CS {
  constructor() {
    super("DeviceGray", 1);
  }

  getRgbItem(src, srcOffset, dest, destOffset) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'DeviceGrayCS.getRgbItem: Unsupported "dest" type.'
      );
    }
    const c = src[srcOffset] * 255;
    dest[destOffset] = dest[destOffset + 1] = dest[destOffset + 2] = c;
  }

  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (
      typeof PDFJSDev === "undefined" ||
      PDFJSDev.test("!PRODUCTION || TESTING")
    ) {
      assert(
        dest instanceof Uint8ClampedArray,
        'DeviceGrayCS.getRgbBuffer: Unsupported "dest" type.'
      );
    }
    const scale = 255 / ((1 << bits) - 1);
    let j = srcOffset,
      q = destOffset;
    for (let i = 0; i < count; ++i) {
      const c = scale * src[j++];
      dest[q++] = c;
      dest[q++] = c;
      dest[q++] = c;
      q += alpha01;
    }
  }

  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01);
  }
}

export { DeviceGrayCS };
