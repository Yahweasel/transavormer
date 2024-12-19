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
 * Class for normalizing frames in various formats into LibAV.
 */
export class FrameNormalizer implements ifs.LibAVFrameStream {
    constructor(
        ptr: boolean,

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
        this.ptr = <false> ptr;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
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

        this.stream = new ReadableStream({
            pull: async (controller) => {
                const rd = await packetStream.read();
                if (rd.done) {
                    controller.close();
                    return;
                }

                const outFrames: ifs.LibAVStreamFrame[] = [];

                const pushFrame = async (
                    streamIndex: number, frame: LibAVT.Frame | number
                ) => {
                    if (typeof frame === "number") {
                        // Already a libav pointer
                        if (!this.ptr) {
                            outFrames.push({
                                streamIndex,
                                frame: await la.ff_copyout_frame(frame)
                            });
                            await la.av_frame_free_js(frame);
                        } else {
                            outFrames.push({
                                streamIndex,
                                frame: <any> frame
                            });
                        }

                    } else {
                        // Already a libav frame
                        if (this.ptr) {
                            const frm = await la.av_frame_alloc();
                            await la.ff_copyin_frame(frm, frame);
                            outFrames.push({
                                streamIndex,
                                frame: <any> frm
                            });
                        } else {
                            outFrames.push({
                                streamIndex,
                                frame
                            });
                        }

                    }
                };

                for (const streamFrame of rd.value) {
                    const frame = streamFrame.frame;
                    if ((<wcp.VideoFrame> frame).codedWidth) {
                        const vf = <wcp.VideoFrame> frame;
                        const laFrame = await lawc.videoFrameToLAFrame(vf);
                        vf.close();
                        await pushFrame(streamFrame.streamIndex, laFrame);

                    } else if ((<wcp.AudioData> frame).sampleRate) {
                        const af = <wcp.AudioData> frame;
                        const laFrame = await lawc.audioDataToLAFrame(af);
                        af.close();
                        await pushFrame(streamFrame.streamIndex, laFrame);

                    } else {
                        await pushFrame(streamFrame.streamIndex, <any> frame);

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
        init: ifs.InitFrameNormalizer,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.LibAVFrameStream>;
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitFrameNormalizerPtr,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.LibAVFrameStreamPtr>;

    /**
     * Build a normalizer.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitFrameNormalizer | ifs.InitFrameNormalizerPtr,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.LibAVFrameStreamAny> {
        const ret = new FrameNormalizer(
            !!init.ptr, libav, input,
        );
        await ret._init();
        return <any> ret;
    }

    component: ifs.Component = "frame-normalizer";
    streamType: "libav-frame" = "libav-frame";
    ptr: false;

    /**
     * Stream of frames.
     */
    stream: ReadableStream<ifs.LibAVStreamFrame[]>;

    /**
     * Stream data.
     */
    streams: Promise<ifs.StreamParameters[]>;
}
