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

import type * as LibAVT from "@libav.js/types";
import * as lawc from "libavjs-webcodecs-bridge";
import type * as wcp from "libavjs-webcodecs-polyfill";

import * as ifs from "./interfaces";

/**
 * Class for normalizing frames into the formats most suitable for playback.
 */
export class PlaybackNormalizer implements ifs.FrameStream {
    constructor(
        /**
         * @private
         * Playback sample rate.
         */
        private _sampleRate: number,

        /**
         * @private
         * Optional number of output channels.
         */
        private _channels: number | undefined,

        /**
         * @private
         * LibAV instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * Input frames.
         */
        private _inputP: Promise<ifs.FrameStreamAny>
    ) {
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
        this._frame = 0;
        this._outFrame = 0;
    }

    /**
     * @private
     * Normalizers must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const input = await this._inputP;
        const packetStream = input.stream.getReader();
        this.streams = input.streams;

        this._frame = await la.av_frame_alloc();
        this._outFrame = await la.av_frame_alloc();

        this.stream = new ReadableStream({
            pull: async (controller) => {
                const rd = await packetStream.read();
                if (rd.done) {
                    controller.close();

                    // Clean up our allocations
                    await la.av_frame_free_js(this._frame);
                    await la.av_frame_free_js(this._outFrame);
                    for (const idx in this._filterGraph)
                        await la.avfilter_graph_free_js(this._filterGraph[idx]);
                    for (const idx in this._sws)
                        await la.sws_freeContext(this._sws[idx]);

                    return;
                }

                const outFrames: ifs.StreamFrame[] = [];

                // Converters to fltp
                const toFLTP = async (
                    idx: number,
                    frame: LibAVT.Frame
                ) => {
                    if (
                        frame.format === la.AV_SAMPLE_FMT_FLTP &&
                        frame.sample_rate === this._sampleRate
                    ) {
                        outFrames.push({
                            streamIndex: idx,
                            frame: frame
                        });
                        return;
                    }

                    let graph = this._filterGraph[idx];
                    if (!graph) {
                        let channelLayout = 4;
                        if (frame.channel_layout)
                            channelLayout = frame.channel_layout;
                        else if (frame.channels && frame.channels !== 1)
                            channelLayout = (1 << frame.channels) - 1;
                        let outChannelLayout = 4;
                        if (this._channels) {
                            outChannelLayout = la.ff_channel_layout({
                                channels: this._channels
                            });
                        } else {
                            outChannelLayout = channelLayout;
                        }
                        const [filterGraph, src, sink] =
                            await la.ff_init_filter_graph(
                                "aresample",
                                {
                                    type: la.AVMEDIA_TYPE_AUDIO,
                                    sample_fmt: frame.format,
                                    sample_rate: frame.sample_rate,
                                    channel_layout: channelLayout,
                                    time_base: frame.time_base_num
                                        ? [frame.time_base_num, frame.time_base_den]
                                        : void 0
                                },
                                {
                                    type: la.AVMEDIA_TYPE_AUDIO,
                                    sample_fmt: la.AV_SAMPLE_FMT_FLTP,
                                    sample_rate: this._sampleRate,
                                    channel_layout: outChannelLayout,
                                    time_base: [1, this._sampleRate]
                                }
                            );

                        this._filterGraph[idx] = graph = filterGraph;
                        this._bufferSource[idx] = src;
                        this._bufferSink[idx] = sink;
                    }

                    const src = this._bufferSource[idx];
                    const sink = this._bufferSink[idx];

                    const fframes = await la.ff_filter_multi(
                        src, sink, this._frame, [frame]
                    );

                    for (const frame of fframes) {
                        outFrames.push({
                            streamIndex: idx,
                            frame
                        });
                    }
                };

                for (const streamFrame of rd.value) {
                    const frame = streamFrame.frame;
                    if ((<wcp.VideoFrame> frame).codedWidth) {
                        // Video frames are already playable
                        outFrames.push(<ifs.WebCodecsStreamFrame> streamFrame);

                    } else if ((<wcp.AudioData> frame).sampleRate) {
                        /* AudioData needs to be converted into an appropriate
                         * libav format. */
                        const af = <wcp.AudioData> frame;
                        const laFrame = await lawc.audioDataToLAFrame(af);
                        await toFLTP(streamFrame.streamIndex, laFrame);

                    } else { 
                        // Already a libav frame, but might be a pointer
                        let laFrame = <LibAVT.Frame> frame;
                        if (typeof frame === "number") {
                            laFrame = await la.ff_copyout_frame(frame);
                            await la.av_frame_unref(frame);
                        }

                        if (laFrame.width) {
                            /* Video frame. Either convert to a VideoFrame (if
                             * the host supports it) or to an ImageBitmap
                             * otherwise. */
                            if (typeof VideoFrame !== "undefined") {
                                const vf = await lawc.laFrameToVideoFrame(
                                    laFrame, {transfer: true}
                                );
                                outFrames.push({
                                    streamIndex: streamFrame.streamIndex,
                                    frame: vf
                                });

                            } else {
                                /* Only universally drawable format is
                                 * ImageBitmap, which has to be RGBA. */
                                let sws = this._sws[streamFrame.streamIndex];
                                if (!sws) {
                                    // Create a scalar instance
                                    sws = await la.sws_getContext(
                                        laFrame.width, laFrame.height, laFrame.format,
                                        laFrame.width, laFrame.height, la.AV_PIX_FMT_RGBA,
                                        0, 0, 0, 0
                                    );
                                    this._sws[streamFrame.streamIndex] = sws;
                                }

                                await la.av_frame_unref(this._frame);
                                await la.av_frame_unref(this._outFrame);
                                await la.ff_copyin_frame(this._frame, laFrame);
                                // FIXME: Check for errors
                                await la.sws_scale_frame(sws, this._outFrame, this._frame);
                                await la.av_frame_unref(this._frame);
                                const id = await la.ff_copyout_frame_video_imagedata(
                                    this._outFrame
                                );
                                await la.av_frame_unref(this._outFrame);
                                laFrame.data = await createImageBitmap(id);

                                outFrames.push({
                                    streamIndex: streamFrame.streamIndex,
                                    frame: laFrame
                                });

                            }

                        } else {
                            // Audio frame
                            await toFLTP(streamFrame.streamIndex, laFrame);

                        }

                    }
                }

                controller.enqueue(outFrames);
            }
        });
    }

    async sendCommands(cmds: ifs.Command[]): Promise<ifs.CommandResult[]> {
        const input = await this._inputP;
        return input.sendCommands(cmds);
    }

    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitPlaybackNormalizer,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.FrameStream>;

    /**
     * Build a playback normalizer.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitPlaybackNormalizer,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.FrameStream> {
        const ret = new PlaybackNormalizer(
            init.sampleRate, init.channels, libav, input
        );
        await ret._init();
        return ret;
    }

    component: ifs.Component = "play-normalizer";
    streamType: "frame" = "frame";
    ptr: false = false;

    /**
     * @private
     * Filtergraphs for audio conversion.
     */
    private _filterGraph: Record<number, number> = {};
    private _bufferSource: Record<number, number> = {};
    private _bufferSink: Record<number, number> = {};

    /**
     * @private
     * Software scaler instances.
     */
    private _sws: Record<number, number> = {};

    /**
     * @private
     * Frame pointer as a temporary.
     */
    private _frame: number;
    private _outFrame: number;

    /**
     * Stream of frames.
     */
    stream: ReadableStream<ifs.StreamFrame[]>;

    /**
     * Stream data.
     */
    streams: Promise<ifs.StreamParameters[]>;
}
