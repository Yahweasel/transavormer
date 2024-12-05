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

import * as cmdsM from "./commands";
import * as ifs from "./interfaces";

/**
 * LibAV extended with our own reader.
 */
type LibAVDemux = LibAVT.LibAV & {
    tavFiles?: Record<
        string,
        (pos: number, len: number) => Promise<Uint8Array | null>
    >;
}

/**
 * A global counter for unique filenames.
 */
let fnCounter = 0;

/**
 * A generic demuxer.
 */
export class Demuxer implements ifs.PacketStream {
    constructor(
        ptr: boolean,

        /**
         * @private
         * LibAV instance.
         */
        private _libav: LibAVDemux,

        /**
         * @private
         * Input file.
         */
        private _input: ifs.InputFile,

        /**
         * @private
         * Chunk size to read.
         */
        private _chunkSize = 65536
    ) {
        this.ptr = <false> ptr;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
    }

    /**
     * @private
     * Demuxers must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const chunkSize = this._chunkSize;

        if (!la.tavFiles) {
            const tavFiles = la.tavFiles = Object.create(null);
            la.onread =
                async (name: string, pos: number, len: number) => {
                    const f = tavFiles[name];
                    la.ff_reader_dev_send(name, f ? await f(pos, len) : null);
                };
            la.onblockread =
                async (name: string, pos: number, len: number) => {
                    const f = tavFiles[name];
                    la.ff_block_reader_dev_send(
                        name, pos, f ? await f(pos, len) : null
                    );
                };
        }

        const filename = (fnCounter++) + ".in";

        let f = this._input;
        if ((<Blob> f).arrayBuffer) {
            // It's a Blob
            await la.mkreadaheadfile(filename, <Blob> f);

        } else if ((<ReadableStream> f).getReader) {
            // It's a ReadableStream of Uint8Arrays
            const rdr = (<ReadableStream<Uint8Array>> f).getReader();
            la.tavFiles[filename] = async (pos: number, len: number) => {
                const rd = await rdr.read();
                return rd.done ? null : rd.value!;
            };
            await la.mkreaderdev(filename);

        } else if (typeof (<ifs.RAFile> f).size === "number") {
            // It's a random-access file
            la.tavFiles[filename] = (<ifs.RAFile> f).read;
            await la.mkblockreaderdev(filename, (<ifs.RAFile> f).size);

        } else {
            // It's a stream file
            la.tavFiles[filename] = (pos: number, len: number) => {
                return (<ifs.StreamFile> f).read(len);
            };
            await la.mkreaderdev(filename);

        }

        // Open the file
        const [fmtCtx, streams] = await la.ff_init_demuxer_file(filename);
        this._fmtCtx = fmtCtx;

        // Get the codec info
        const spars: ifs.StreamParameters[] = [];
        for (const stream of streams) {
            const spar: ifs.StreamParameters =
                <ifs.StreamParameters> await la.ff_copyout_codecpar(stream.codecpar);
            spar.time_base_num = stream.time_base_num;
            spar.time_base_den = stream.time_base_den;
            spars.push(spar);
        }
        this.streams = Promise.resolve(spars);

        const pkt = await la.av_packet_alloc();

        // Create the packet stream
        this.stream = new ReadableStream({
            pull: async (controller) => {
                while (true) {
                    // Read a chunk
                    const [res, packets] = await la.ff_read_frame_multi(
                        fmtCtx, pkt,
                        {
                            limit: chunkSize,
                            unify: true,
                            copyoutPacket: <any> (this.ptr ? "ptr" : "default")
                        }
                    );

                    // If we seeked, tell the next step
                    if (this._seeked) {
                        controller.enqueue([]);
                        this._seeked = false;
                    }

                    // Pass it thru
                    let hadPackets = false;
                    if (packets[0] && packets[0].length) {
                        hadPackets = true;
                        controller.enqueue(packets[0]);
                    }

                    // Maybe we're done
                    if (res === la.AVERROR_EOF) {
                        controller.close();
                        break;
                    } else if (res !== 0 && res !== -la.EAGAIN) {
                        controller.error(
                            new Error(await la.ff_error(res))
                        );
                        break;
                    } else if (hadPackets)
                        break;
                }
            }
        });
    }

    async sendCommands(cmds: ifs.Command[]): Promise<ifs.CommandResult[]> {
        const cmdsR = cmdsM.addResults(cmds);

        for (const cmd of cmdsR) {
            if (cmd.c === "seek") {
                const seek = <ifs.SeekCommandResult> cmd;

                let time = seek.time;
                let min = seek.min || 0;
                let max = (typeof seek.max === "number") ? seek.max : time;

                // Convert times
                if (!seek.streamTimebase) {
                    let timeBase = [1, 1000000]; // Default is microseconds
                    if (typeof seek.stream === "number") {
                        const streams = await this.streams;
                        timeBase = [
                            streams[seek.stream].time_base_num || 1,
                            streams[seek.stream].time_base_den || 1000000
                        ];
                    }

                    time = Math.round(time * timeBase[1] / timeBase[0]);
                    min = Math.round(min * timeBase[1] / timeBase[0]);
                    max = Math.round(max * timeBase[1] / timeBase[0]);
                }

                const time32 = this._libav.f64toi64(time);
                const min32 = this._libav.f64toi64(min);
                const max32 = this._libav.f64toi64(max);

                const res = await this._libav.avformat_seek_file(
                    this._fmtCtx,
                    (typeof seek.stream === "number") ? seek.stream : -1,
                    min32[0], min32[1],
                    time32[0], time32[1],
                    max32[0], max32[1],
                    this._libav.AVSEEK_FLAG_BACKWARD
                );
                this._seeked = true;

                seek.ran = true;
                if (res >= 0) {
                    seek.success = seek.success && true;
                } else {
                    seek.success = false;
                    seek.diagnostic.push(await this._libav.ff_error(res));
                }
            }
        }

        return cmdsR;
    }

    static async build(libav: LibAVT.LibAV, init: ifs.InitDemuxer): Promise<ifs.PacketStream>;
    static async build(libav: LibAVT.LibAV, init: ifs.InitDemuxerPtr): Promise<ifs.PacketStreamPtr>;

    /**
     * Build a demuxer.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitDemuxer | ifs.InitDemuxerPtr
    ): Promise<ifs.PacketStreamAny> {
        const ret = new Demuxer(
            !!init.ptr, libav, init.input
        );
        await ret._init();
        return <any> ret;
    }

    component: ifs.Component = "demuxer";
    streamType: "packet" = "packet";
    ptr: false;

    /**
     * @private
     * Set when we've seeked to know to indicate that to the next step.
     */
    _seeked = false;

    /**
     * @private
     * The libav format context.
     */
    _fmtCtx = 0;

    /**
     * Stream of packets.
     */
    stream: ReadableStream<LibAVT.Packet[]>;

    /**
     * LibAV streams in the file.
     */
    streams: Promise<ifs.StreamParameters[]>;
}
