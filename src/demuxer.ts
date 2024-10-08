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
export class Demuxer implements ifs.Demuxer {
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
            la.onblockread =
                async (name: string, pos: number, len: number) => {
                    const f = tavFiles[name];
                    if (!f) {
                        await la.ff_block_reader_dev_send(name, pos, null);
                        return;
                    }
                    await la.ff_block_reader_dev_send(
                        name, pos, await f(pos, len)
                    );
                };
        }

        const filename = (fnCounter++) + ".in";

        let f = this._input;
        let stream = false;
        if ((<Blob> f).arrayBuffer) {
            // It's a Blob
            await la.mkreadaheadfile(filename, <Blob> f);

        } else if ((<ReadableStream> f).getReader) {
            // It's a ReadableStream of Uint8Arrays
            const rdr = (<ReadableStream<Uint8Array>> f).getReader();
            stream = true;
            let buf: Uint8Array | null = null;
            f = <ifs.StreamFile> {
                async read(len) {
                    while (true) {
                        if (buf) {
                            if (buf.length < len) {
                                const ret = buf;
                                buf = null;
                                return ret;
                            } else {
                                const ret = buf.slice(0, len);
                                buf = buf.subarray(len);
                                return ret;
                            }
                        }

                        const rd = await rdr.read();
                        if (rd.done)
                            return null;
                        buf = rd.value!;
                    }
                }
            };

        } else if (typeof (<ifs.RAFile> f).size === "number") {
            // It's a random-access file
            la.tavFiles[filename] = (<ifs.RAFile> f).read;
            await la.mkblockreaderdev(filename, (<ifs.RAFile> f).size);

        } else {
            // It's a stream file
            await la.mkreaderdev(filename);
            stream = true;

        }

        // Open the file
        const demuxP = la.ff_init_demuxer_file(filename);
        if (stream) {
            while (await la.ff_reader_dev_waiting()) {
                await la.ff_reader_dev_send(
                    filename, 
                    await (<ifs.StreamFile> f).read(chunkSize)
                );
            }
        }
        const [fmtCtx, streams] = await demuxP;

        // Get the codec info
        const codecpars: LibAVT.CodecParameters[] = [];
        for (const stream of streams)
            codecpars.push(await la.ff_copyout_codecpar(stream.codecpar));
        this.streams = Promise.resolve(codecpars);

        const pkt = await la.av_packet_alloc();

        // Create the packet stream
        this.stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    // Read a chunk
                    const readP = la.ff_read_frame_multi(fmtCtx, pkt, {
                        limit: chunkSize,
                        unify: true,
                        copyoutPacket: <any> (this.ptr ? "ptr" : "default")
                    });
                    if (stream) {
                        while (await la.ff_reader_dev_waiting()) {
                            await la.ff_reader_dev_send(
                                filename,
                                await (<ifs.StreamFile> f).read(chunkSize)
                            );
                        }
                    }
                    const [res, packets] = await readP;

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

    static async build(libav: LibAVT.LibAV, init: ifs.InitDemuxer): Promise<ifs.Demuxer>;
    static async build(libav: LibAVT.LibAV, init: ifs.InitDemuxerPtr): Promise<ifs.DemuxerPtr>;

    /**
     * Build a demuxer.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitDemuxer | ifs.InitDemuxerPtr
    ): Promise<ifs.Demuxer | ifs.DemuxerPtr> {
        const ret = new Demuxer(
            init.ptr, libav, init.input
        );
        await ret._init();
        return <any> ret;
    }

    component: "demuxer" = "demuxer";
    ptr: false;

    /**
     * Stream of packets.
     */
    stream: ReadableStream<LibAVT.Packet[]>;

    /**
     * LibAV streams in the file.
     */
    streams: Promise<LibAVT.CodecParameters[]>;
}
