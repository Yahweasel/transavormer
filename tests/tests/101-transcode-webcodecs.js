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

const videoCodecs = [];
const audioCodecs = ["opus", "mp4a.40.2"];

for (const codec of [
    "vp8", "vp09.00.10.08.03.1.1.1.0", "av01.0.15M.08",
    "avc1.42403e"
]) {
    try {
        const supp = await VideoEncoder.isConfigSupported({
            codec,
            width: 1280, height: 720
        });
        if (supp.supported)
            videoCodecs.push(codec);
    } catch (ex) {}
}

console.log("Video codecs supported by WebCodecs:", videoCodecs);

for (const video of videoCodecs) {
    for (const audio of audioCodecs) {
        let format = "matroska";
        switch (video.replace(/\..*/, "") + ":" + audio.replace(/\..*/, "")) {
            case "vp8:opus":
            case "vp09:opus":
            case "av01:opus":
                format = "webm";
                break;

            case "av01:mp4a":
            case "avc1:mp4a":
                format = "mp4";
                break;
        }

        const out = await h.TAV({
            type: "muxer",
            format,
            randomAccess: true,
            input: {
                type: "encoder",
                videoConfig: {
                    codec: video,
                    bitrate: 10000000
                },
                audioConfig: {
                    codec: audio,
                    bitrate: 128000
                },
                input: new Blob([await h.readFile("files/bbb_input.webm")])
            }
        });
        const rdr = await out.stream.getReader();
        let u8 = new Uint8Array(0);
        while (true) {
            const rd = await rdr.read();
            if (rd.done) break;
            const sz = rd.value.position + rd.value.data.length;
            if (u8.length < sz) {
                const nu8 = new Uint8Array(sz);
                nu8.set(u8);
                u8 = nu8;
            }
            u8.set(rd.value.data, rd.value.position);
        }

        const demux = await h.TAV({
            type: "demuxer",
            input: new Blob([u8])
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
    }
}
