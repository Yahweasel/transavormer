/*
 * Copyright (c) 2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import type * as LibAVT from "@libav.js/variant-webcodecs";
import * as lawc from "libavjs-webcodecs-bridge";
import type * as wcp from "libavjs-webcodecs-polyfill";

import * as cmdsM from "./commands";
import * as ifs from "./interfaces";

declare let AudioDecoder: typeof wcp.AudioDecoder;

/**
 * A stream of frames coming from the user.
 */
export class UserFrameStream implements ifs.FrameStream {
    constructor(
        la: LibAVT.LibAV,
        init: ifs.InitUserFrameStream
    ) {
        const streams: Promise<ifs.StreamParameters>[] = [];
        const streamRes: (((x:ifs.StreamParameters)=>void)|null)[] = [];
        for (const stream of init.streams) {
            streams.push(new Promise(res => streamRes.push(res)));
        }
        this.streams = Promise.all(streams);

        const rdr = init.input.getReader();

        this.stream = new ReadableStream({
            pull: async (controller) => {
                const rd = await rdr.read();

                if (rd.done) {
                    controller.close();
                    return;
                }

                for (const frame of rd.value!) {
                    const res = streamRes[frame.streamIndex];
                    if (!res) continue;

                    let spar: ifs.StreamParameters;

                    let laf: LibAVT.Frame;
                    if ((<wcp.VideoFrame> frame.frame).codedWidth) {
                        laf = await lawc.videoFrameToLAFrame(
                            <wcp.VideoFrame> frame.frame
                        );
                    } else if ((<wcp.AudioData> frame.frame).numberOfFrames) {
                        laf = await lawc.audioDataToLAFrame(
                            <wcp.AudioData> frame.frame
                        );
                    } else if (typeof frame.frame === "number") {
                        laf = await la.ff_copyout_frame(frame.frame);
                    } else {
                        laf = <LibAVT.Frame> frame.frame;
                    }

                    spar = {
                        codec_id: 0,
                        codec_type: laf.width ? la.AVMEDIA_TYPE_VIDEO : la.AVMEDIA_TYPE_AUDIO,
                        format: laf.format,
                        width: laf.width,
                        height: laf.height,
                        sample_rate: laf.sample_rate,
                        channel_layoutmask: laf.channel_layout,
                        channels: laf.channels,
                        time_base_num: laf.time_base_num || 1,
                        time_base_den: laf.time_base_den || 1000000
                    };

                    Object.assign(spar, init.streams[frame.streamIndex]);
                    res(spar);
                    streamRes[frame.streamIndex] = null;
                }

                controller.enqueue(rd.value!);
            }
        });
    }

    sendCommands(cmds: ifs.Command[]): Promise<ifs.CommandResult[]> {
        return Promise.resolve(cmdsM.addResults(cmds));
    }

    component: ifs.Component = "frame-stream";
    ptr: false = false;
    streams: Promise<ifs.StreamParameters[]>;
    streamType: "frame" = "frame";
    stream: ReadableStream<ifs.StreamFrame[]>;
}
