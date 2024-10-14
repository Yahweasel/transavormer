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

import * as ifs from "./interfaces";
import * as norm from "./normalizer";

/**
 * Frontend for libav filters.
 */
export class LAFilter implements ifs.LibAVFrameStream {
    constructor(
        /**
         * @private
         * libav.js instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * Initializers (for filtergraph descriptions).
         */
        private _init: ifs.InitLAFilter,

        /**
         * @private
         * Demuxed input.
         */
        private _rawInputP: Promise<ifs.FrameStreamAny>
    ) {
        this.ptr = <false> !!_init.ptr;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
    }

    /**
     * @private
     * Filters must be initialized.
     */
    private async _initialize() {
        const la = this._libav;
        const rawInput = await this._rawInputP;

        let input: ifs.LibAVFrameStreamAny;
        if (rawInput.streamType !== "libav-frame") {
            // Need to convert the frames to libav first
            input = await norm.FrameNormalizer.build(
                la, {
                    type: "frame-normalizer",
                    ptr: true,
                    input: rawInput
                }, this._rawInputP
            );
        } else {
            input = <ifs.LibAVFrameStreamAny> rawInput;
        }

        this.streams = input.streams;
        const streams = await input.streams;
        const frameStream = input.stream.getReader();

        const frame = await la.av_frame_alloc();

        const destructors: (()=>Promise<unknown>)[] = [];
        async function cleanup() {
            for (const destructor of destructors)
                await destructor();
        }
        destructors.push(async () => {
            await la.av_frame_free_js(frame);
        });

        // Filters, per stream
        const filters: Record<number, [number, number, number]> = {};

        // Create the stream
        this.stream = new ReadableStream({
            pull: async (controller) => {
                while (true) {
                    // Get some data to encode
                    const inFrameData = await frameStream.read();
                    const eof = inFrameData.done;
                    const inFrames = inFrameData.value || [];

                    // Group frames by stream
                    const framesByStr: Record<
                        number,
                        (number|LibAVT.Frame)[]
                    > = {};
                    for (const frame of inFrames) {
                        const streamIndex = frame.streamIndex;
                        framesByStr[streamIndex] = framesByStr[streamIndex] || [];
                        framesByStr[streamIndex].push(frame.frame);
                    }

                    let ret: ifs.LibAVStreamFrame[] = [];

                    // Filter
                    for (let i = 0; i < streams.length; i++) {
                        if (!framesByStr[i])
                            continue;
                        const frames = framesByStr[i];

                        if (!filters[i]) {
                            let descr: string;
                            let ios: Partial<LibAVT.FilterIOSettings>;
                            if (streams[i].codec_type === la.AVMEDIA_TYPE_VIDEO) {
                                descr = this._init.videoFilters || "null";
                                ios = this._init.videoIOSettings || {};
                            } else {
                                descr = this._init.audioFilters || "aresample";
                                ios = this._init.audioIOSettings || {};
                            }
                            filters[i] = await mkFilter(
                                la, descr, ios, streams[i], <any> frames[0]
                            );
                            destructors.push(async () => {
                                await la.avfilter_graph_free_js(filters[i][0]);
                            });
                        }
                        const [, bufferSrc, bufferSink] = filters[i];
                        const ffs = await la.ff_filter_multi(
                            bufferSrc, bufferSink, frame, <LibAVT.Frame[]> frames, {
                                fin: eof,
                                copyoutFrame: <"default"> (this._init.ptr ? "ptr" : "default")
                            }
                        );
                        ret.push.apply(ret, ffs.map(x => ({
                            streamIndex: i,
                            frame: x
                        })));
                    }

                    if (ret.length) {
                        // FIXME: Make sure they're still in temporal order
                        controller.enqueue(ret);
                    }

                    if (eof) {
                        controller.close();
                    }

                    if (ret.length || eof)
                        break;
                }
            }
        });
    }

    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitLAFilter, input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.LibAVFrameStream>
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitLAFilterPtr, input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.LibAVFrameStreamPtr>;

    /**
     * Build a encoder.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitLAFilter | ifs.InitLAFilterPtr,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.LibAVFrameStreamAny> {
        const ret = new LAFilter(
            libav, <ifs.InitLAFilter> init, input
        );
        await ret._initialize();
        return <any> ret;
    }

    component: ifs.Component = "la-filter";
    streamType: "libav-frame" = "libav-frame";
    ptr: false;

    /**
     * Stream of filtered frames.
     */
    stream: ReadableStream<ifs.LibAVStreamFrame[]>;

    /**
     * Streams to which the frames belong.
     */
    streams: Promise<ifs.StreamParameters[]>;
}

/**
 * @private
 * Make the given filter.
 */
async function mkFilter(
    la: LibAVT.LibAV, descr: string, ios: Partial<LibAVT.FilterIOSettings>,
    stream: LibAVT.CodecParameters, frameIn: number | LibAVT.Frame
) {
    let frame: LibAVT.Frame;
    if (typeof frameIn === "number")
        frame = await la.ff_copyout_frame(frameIn);
    else
        frame = frameIn;

    if (stream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
        const oios: LibAVT.FilterIOSettings = {
            type: la.AVMEDIA_TYPE_VIDEO,
            width: frame.width,
            height: frame.height,
            pix_fmt: frame.format,
            time_base: frame.time_base_num
                ? [frame.time_base_num, frame.time_base_den]
                : [1, 1000000]
        };
        Object.assign(oios, ios);
        return await la.ff_init_filter_graph(
            descr,
            {
                type: la.AVMEDIA_TYPE_VIDEO,
                width: frame.width,
                height: frame.height,
                pix_fmt: frame.format,
                time_base: frame.time_base_num
                    ? [frame.time_base_num, frame.time_base_den]
                    : void 0
            }, oios
        );
    } else {
        const oios: LibAVT.FilterIOSettings = {
            sample_rate: frame.sample_rate,
            channel_layout: frame.channel_layout,
            sample_fmt: frame.format,
            time_base: [1, frame.sample_rate!]
        };
        Object.assign(oios, ios);
        return await la.ff_init_filter_graph(
            descr,
            {
                sample_rate: frame.sample_rate,
                channel_layout: frame.channel_layout,
                sample_fmt: frame.format,
                time_base: frame.time_base_num
                    ? [frame.time_base_num, frame.time_base_den]
                    : void 0
            }, oios
        );
    }
}
