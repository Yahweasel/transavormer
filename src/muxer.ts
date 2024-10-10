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

/**
 * LibAV extended with our own writer.
 */
type LibAVDemux = LibAVT.LibAV & {
    tavOutputs?: Record<
        string,
        (pos: number, buf: Uint8Array) => unknown
    >;
}

/**
 * A global counter for unique filenames.
 */
let fnCounter = 0;

/**
 * A generic muxer.
 */
export class Muxer implements ifs.FileStream {
    constructor(
        public randomAccess: boolean,

        /**
         * @private
         * LibAV instance.
         */
        private _libav: LibAVDemux,

        /**
         * @private
         * Input packet stream.
         */
        private _inputP: Promise<ifs.PacketStreamAny>,

        /**
         * @private
         * Output format to write.
         */
        private _format: string | number
    ) {
        this.stream = new ReadableStream({});
    }

    /**
     * @private
     * Muxers must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const input = await this._inputP;
        const streams = await input.streams;
        const rdr = input.stream.getReader();

        if (!la.tavOutputs) {
            const tavOutputs = la.tavOutputs = Object.create(null);
            la.onwrite =
                (name: string, position: number, buffer: Uint8Array | Int8Array) => {
                    const f = tavOutputs[name];
                    if (!f)
                        return;
                    f(
                        position,
                        new Uint8Array(
                            buffer.buffer, buffer.byteOffset, buffer.byteLength
                        )
                    );
                };
        }

        const filename = (fnCounter++) + ".out";
        if (this.randomAccess)
            await la.mkwriterdev(filename);
        else
            await la.mkstreamwriterdev(filename);

        // Buffer for output
        const outBuf: [number, Uint8Array][] = [];
        la.tavOutputs[filename] = (position: number, data: Uint8Array) => {
            outBuf.push([position, data]);
        };
        let eof = false;

        // Load each of the stream parameters
        const muxStreams: [number, number, number][] = [];
        for (const stream of streams) {
            const codecpar = await la.avcodec_parameters_alloc();
            await la.ff_copyin_codecpar(codecpar, stream);
            muxStreams.push([codecpar, 1, 1000000]);
        }
        const [fmtCtx, , pb, outStreams] = await la.ff_init_muxer({
            oformat: (typeof this._format === "number")
                ? this._format : void 0,
            format_name: (typeof this._format === "string")
                ? this._format : void 0,
            filename,
            open: true,
            codecpars: true
        }, muxStreams);
        await la.avformat_write_header(fmtCtx, 0);
        const pkt = await la.av_packet_alloc();

        // Create the data stream
        this.stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    if (outBuf.length) {
                        while (outBuf.length) {
                            const buf = outBuf.shift();
                            controller.enqueue({
                                position: buf[0],
                                data: buf[1]
                            });
                        }
                        break;
                    }

                    if (eof) {
                        controller.close();
                        break;
                    }

                    const packets = await rdr.read();
                    if (packets.done) {
                        eof = true;
                        await la.av_write_trailer(fmtCtx);
                        await la.ff_free_muxer(fmtCtx, pb);
                        await la.av_packet_free_js(pkt);
                        continue;
                    }

                    await la.ff_write_multi(
                        fmtCtx, pkt, packets.value
                    );
                }
            }
        });
    }

    /**
     * Build a muxer.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitMuxer,
        input: Promise<ifs.PacketStreamAny>
    ): Promise<ifs.FileStream> {
        const ret = new Muxer(
            !!init.randomAccess, libav, input, init.format
        );
        await ret._init();
        return ret;
    }

    streamType: "file" = "file";

    /**
     * Stream of output data.
     */
    stream: ReadableStream<{position: number, data: Uint8Array}>;
}
