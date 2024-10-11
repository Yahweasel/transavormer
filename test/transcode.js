/*
 * This (un)license applies only to this sample code, and not to TransAVormer as
 * a whole:
 *
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or distribute
 * this software, either in source code form or as a compiled binary, for any
 * purpose, commercial or non-commercial, and by any means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors of
 * this software dedicate any and all copyright interest in the software to the
 * public domain. We make this dedication for the benefit of the public at
 * large and to the detriment of our heirs and successors. We intend this
 * dedication to be an overt act of relinquishment in perpetuity of all present
 * and future rights to this software under copyright law.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const fs = require("fs/promises");

const LibAV = require("@libav.js/variant-webm-vp9");
const wcb = require("libavjs-webcodecs-bridge");
const tav = require("../dist/transavormer.js");

async function main() {
    const la = await LibAV.LibAV();
    const fh = await fs.open(process.argv[2]);
    const trans = new TransformStream({
        transform: (chunk, controller) => {
            controller.enqueue(new Uint8Array(chunk));
        },
        flush: () => {
            fh.close();
        }
    });
    fh.readableWebStream().pipeThrough(trans);
    const out = await tav.build(la, wcb, {
        type: "muxer",
        format: "matroska",
        input: {
            type: "encoder",
            videoConfig: {
                codec: "vp8"
            },
            audioConfig: {
                codec: "opus"
            },
            input: trans.readable
        }
    });

    const rdr = out.stream.getReader();
    const ofh = await fs.open(process.argv[3], "w");
    while (true) {
        const rd = await rdr.read();
        if (rd.done) break;
        await ofh.write(rd.value.data);
    }
    await ofh.close();
}

main();
