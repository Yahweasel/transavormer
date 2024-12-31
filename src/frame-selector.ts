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
import type * as wcp from "libavjs-webcodecs-polyfill";

import * as cmdsM from "./commands";
import * as ifs from "./interfaces";
import * as sel from "./selector";

/**
 * Frame selector.
 */
export class FrameSelector implements ifs.FrameStream {
    constructor(
        /**
         * @private
         * LibAV instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * Input stream.
         */
        private _inputP: Promise<ifs.FrameStreamAny>,

        /**
         * @private
         * Stream selection.
         */
        private _sel: ifs.Selection | ifs.Selection[]
    ) {
        this.ptr = false;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
        this._mapping = [];
    }

    /**
     * @private
     * Frame selectors must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const input = await this._inputP;
        this.ptr = <false> input.ptr;
        const streams = await input.streams;
        const mapping = this._mapping = await sel.mkMapping(streams, this._sel);
        const rdr = input.stream.getReader();

        const outStreams: ifs.StreamParameters[] = [];
        for (let i = 0; i < mapping.length; i++) {
            if (mapping[i] >= 0)
                outStreams.push(streams[mapping[i]]);
        }
        this.streams = Promise.resolve(outStreams);

        this.stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    const rd = await rdr.read();
                    if (rd.done) {
                        controller.close();
                        break;
                    }

                    const outFrames: ifs.StreamFrame[] = [];
                    for (const frame of rd.value!) {
                        const outStreamIndex = this._mapping[frame.streamIndex];

                        if (outStreamIndex < 0) {
                            if (typeof frame.frame === "number")
                                await la.av_frame_free_js(frame.frame);
                            else if ((<wcp.VideoFrame> frame.frame).close)
                                (<wcp.VideoFrame> frame.frame).close();
                            continue;
                        }

                        frame.streamIndex = outStreamIndex;
                        outFrames.push(<ifs.StreamFrame> frame);
                    }

                    if (outFrames.length) {
                        controller.enqueue(outFrames);
                        break;
                    }
                }
            }
        });
    }

    async sendCommands(cmds: ifs.Command[]): Promise<ifs.CommandResult[]> {
        const cmdsR = cmdsM.addResults(cmds);

        for (const cmd of cmdsR) {
            if (cmd.c === "reselect" && !cmd.ran) {
                const reselect = <ifs.ReselectCommandResult> cmd;
                this._mapping = sel.mkMapping(
                    await this.streams, reselect.selection
                );
                cmd.ran = true;
                cmd.success = true;
            }
        }

        const input = await this._inputP;
        return input.sendCommands(cmds);
    }

    /**
     * Build a frame selector.
     */
    static async build(
        libav: LibAVT.LibAV, init: ifs.InitFrameSelector,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.FrameStreamAny> {
        const ret = new FrameSelector(
            libav, input, init.selection
        );
        await ret._init();
        return <any> ret;
    }

    component: ifs.Component = "frame-selector";
    streamType: "frame" = "frame";
    ptr: false;

    /**
     * Stream of frames.
     */
    stream: ReadableStream<ifs.StreamFrame[]>;

    /**
     * LibAV streams in the file.
     */
    streams: Promise<ifs.StreamParameters[]>;

    /**
     * Mapping of input streams to output streams.
     */
    private _mapping: number[];
}
