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
import type * as LibAVWebCodecsBridge from "libavjs-webcodecs-bridge";
import type * as wcp from "libavjs-webcodecs-polyfill";

import * as ifs from "./interfaces";

declare let AudioDecoder: typeof wcp.AudioDecoder;

type Frame = LibAVT.Frame | wcp.VideoFrame | wcp.AudioData;
type LibAVDecoder = [number, number, number, number];

/**
 * A multi-decoder, consisting of decoders for any number of streams.
 */
export class Decoder implements ifs.Decoder {
    constructor(
        ptr: boolean,

        /**
         * @private
         * libav.js instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * libavjs-webcodecs-bridge instance.
         */
        private _lawc: typeof LibAVWebCodecsBridge | undefined,

        /**
         * @private
         * Demuxed input.
         */
        private _inputP: Promise<ifs.Demuxer | ifs.DemuxerPtr>
    ) {
        this.ptr = <false> ptr;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
    }

    /**
     * @private
     * Decoders must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const lawc = this._lawc;
        const demuxer = await this._inputP;
        this.streams = demuxer.streams;
        const streams = await demuxer.streams;
        const demuxStream = demuxer.stream.getReader();
        let demuxEOF = false;

        const destructors: (()=>Promise<unknown>)[] = [];
        async function cleanup() {
            for (const destructor of destructors)
                await destructor();
        }

        // Queue of decoded packets
        const decodeQueue: ifs.StreamFrame[] = [];
        let decodeErr: any = null;
        function setDecodeErr(x: any) { decodeErr = x; }

        // Decoders, per stream
        const decoders: (
            LibAVDecoder | wcp.VideoDecoder | wcp.AudioDecoder | null
        )[] = [];

        // Get decoders for each stream
        for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
            const stream = streams[streamIndex];
            if (stream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
                const wcd = await tryVideoDecoder(
                    la, lawc, streamIndex, stream, decodeQueue, setDecodeErr
                );
                if (wcd) {
                    decoders.push(wcd);
                    destructors.push(async () => wcd.close());
                    continue;
                }

            } else if (stream.codec_type === la.AVMEDIA_TYPE_AUDIO) {
                const wcd = await tryAudioDecoder(
                    la, lawc, streamIndex, stream, decodeQueue, setDecodeErr
                );
                if (wcd) {
                    decoders.push(wcd);
                    destructors.push(async () => wcd.close());
                    continue;
                }

            } else {
                // Unsupported stream type
                decoders.push(null);
                continue;

            }

            const ladi = await la.avcodec_find_decoder(stream.codec_id);
            if (ladi < 0)
                throw new Error(`Failed to find a decoder for codec ${stream.codec_id}`);
            const codecpar = await la.avcodec_parameters_alloc();
            await la.ff_copyin_codecpar(codecpar, stream);
            const lad = await la.ff_init_decoder(ladi, codecpar);
            decoders.push(lad);
            destructors.push(async () => {
                await la.ff_free_decoder(lad[0], lad[1], lad[2]);
                await la.avcodec_parameters_free_js(codecpar);
            });
        }

        // Create the stream
        this.stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    if (decodeErr) {
                        await cleanup();
                        controller.error(decodeErr);
                        break;
                    }

                    if (decodeQueue.length) {
                        controller.enqueue(
                            decodeQueue.splice(0, decodeQueue.length)
                        );
                        break;
                    }

                    if (demuxEOF) {
                        await cleanup();
                        break;
                    }

                    // Get some data to decode
                    const inPackets = await demuxStream.read();
                    if (inPackets.done) {
                        demuxEOF = true;

                        // Flush all the decoders
                        for (let i = 0; i < decoders.length; i++) {
                            const dec = decoders[i];
                            if (!dec)
                                continue;
                            if ((<LibAVDecoder> dec).length) {
                                const [, c, pkt, frame] = <LibAVDecoder> dec;
                                const res = await la.ff_decode_multi(
                                    c, pkt, frame, [], {
                                        fin: true,
                                        copyoutFrame: <any> (this.ptr ? "ptr" : "default")
                                    }
                                );
                                decodeQueue.push.apply(decodeQueue, res.map(x => ({
                                    streamIndex: i,
                                    frame: x
                                })));

                            } else {
                                const wcd = <wcp.VideoDecoder | wcp.AudioDecoder> dec;
                                await wcd.flush();

                            }
                        }
                        continue;
                    }

                    // Group packets by stream
                    const laPackets: Record<number, (number | LibAVT.Packet)[]> = {};
                    const freePackets: number[] = [];
                    for (const packet of inPackets.value) {
                        let streamIndex = -1;
                        if (typeof packet === "number") {
                            // Pointer packet
                            streamIndex = await la.AVPacket_stream_index(packet);
                            freePackets.push(packet);
                        } else {
                            streamIndex = packet.stream_index!;
                        }

                        if (streamIndex < 0 || !decoders[streamIndex])
                            continue;

                        laPackets[streamIndex] = laPackets[streamIndex] || [];
                        laPackets[streamIndex].push(packet);
                    }

                    // Decode
                    for (let i = 0; i < streams.length; i++) {
                        if (!laPackets[i] || !decoders[i])
                            continue;
                        const stream = streams[i];
                        const packets = laPackets[i];
                        const dec = decoders[i];
                        if ((<LibAVDecoder> dec).length) {
                            // libav.js decoder
                            const [, c, pkt, frame] = <LibAVDecoder> dec;
                            const res = await la.ff_decode_multi(
                                c, pkt, frame, packets, {
                                    copyoutFrame: <any> (this.ptr ? "ptr" : "default")
                                }
                            );
                            decodeQueue.push.apply(decodeQueue, res.map(x => ({
                                streamIndex: i,
                                frame: x
                            })));

                        } else {
                            // WebCodecs decoder
                            const wcd = <wcp.VideoDecoder | wcp.AudioDecoder> dec;
                            for (let packet of packets) {
                                if (typeof packet === "number") {
                                    // Get the data out of libav.js
                                    packet = await la.ff_copyout_packet(packet);
                                }
                                if (stream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
                                    const evd = lawc!.packetToEncodedVideoChunk(
                                        packet, <any> packet
                                    );
                                    wcd.decode(evd);
                                } else {
                                    // Audio
                                    const ead = lawc!.packetToEncodedAudioChunk(
                                        packet, <any> packet
                                    );
                                    wcd.decode(ead);
                                }

                                while (wcd.decodeQueueSize > 3)
                                    await new Promise(res => wcd.ondequeue = res);
                            }
                        }
                    }

                    // Free packets that were temporary
                    for (const packet of freePackets)
                        await la.av_packet_free_js(packet);
                }
            }
        });
    }

    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitDecoder, input: Promise<ifs.Demuxer | ifs.DemuxerPtr>
    ): Promise<ifs.Decoder>;
    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitDecoderPtr, input: Promise<ifs.Demuxer | ifs.DemuxerPtr>
    ): Promise<ifs.DecoderPtr>;

    /**
     * Build a decoder.
     */
    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitDecoder | ifs.InitDecoderPtr,
        input: Promise<ifs.Demuxer | ifs.DemuxerPtr>
    ): Promise<ifs.Decoder | ifs.DecoderPtr> {
        const ret = new Decoder(
            init.ptr, libav, lawc, input
        );
        await ret._init();
        return <any> ret;
    }

    component: "decoder" = "decoder";
    ptr: false;

    /**
     * Stream of decoded frames.
     */
    stream: ReadableStream<ifs.StreamFrame[]>;

    /**
     * Streams to which the frames belong.
     */
    streams: Promise<LibAVT.CodecParameters[]>;
}

/**
 * @private
 * Try to get a VideoDecoder instance for this stream.
 */
async function tryVideoDecoder(
    la: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    streamIndex: number,
    stream: LibAVT.CodecParameters, decodeQueue: ifs.StreamFrame[],
    decodeErr: (x: any) => void
) {
    if (!lawc)
        return null;

    try {
        const config = await lawc.videoStreamToConfig(la, stream);
        const dec = new VideoDecoder({
            output: x => decodeQueue.push({
                streamIndex: streamIndex,
                frame: <wcp.VideoFrame> <any> x
            }),
            error: x => decodeErr(x)
        });
        dec.configure(<VideoDecoderConfig> <any> config);
        return <wcp.VideoDecoder> <any> dec;
    } catch (ex) {
        return null;
    }
}

/**
 * @private
 * Try to get an AudioDecoder instance for this stream.
 */
async function tryAudioDecoder(
    la: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    streamIndex: number,
    stream: LibAVT.CodecParameters, decodeQueue: ifs.StreamFrame[],
    decodeErr: (x: any) => void
) {
    if (!lawc)
        return null;

    try {
        const config = await lawc.audioStreamToConfig(la, stream);
        const dec = new AudioDecoder({
            output: x => decodeQueue.push({
                streamIndex: streamIndex,
                frame: x
            }),
            error: x => decodeErr(x)
        });
        dec.configure(config);
        return dec;
    } catch (ex) {
        return null;
    }
}
