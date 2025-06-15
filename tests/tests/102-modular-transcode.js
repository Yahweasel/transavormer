/*
 * Copyright (C) 2025 Yahweasel and contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

const avi = await h.readFile("files/bbb_input.avi");
const type = await h.avguess(avi);
const demuxer = await h.LibAV({
    variant: `demuxer-${type.format}`
});

const out = await h.TAV({
    type: "muxer",
    format: "webm",
    input: {
        type: "encoder",
        videoConfig: {
            codec: "vp8",
            bitrate: 10000000
        },
        audioConfig: {
            codec: "opus",
            bitrate: 128000
        },
        input: {
            type: "decoder",
            libav: demuxer,
            LibAV: h.LibAVW(),
            input: {
                type: "demuxer",
                libav: demuxer,
                input: new Blob([avi])
            }
        }
    }
});
const rdr = await out.stream.getReader();
const parts = [];
while (true) {
    const rd = await rdr.read();
    if (rd.done) break;
    parts.push(rd.value.data);
}
demuxer.terminate();

const demux = await h.TAV({
    type: "demuxer",
    input: new Blob(parts)
});
const streams = await demux.streams;

if (
    streams.length !== 2 ||
    streams[0].width !== 1280 ||
    streams[0].height !== 720 ||
    streams[1].sample_rate !== 48000
) {
    throw new Error("Incorrect streams in output");
}
