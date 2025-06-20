/*
 * Copyright (c) 2024, 2025 Yahweasel
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

declare let AudioDecoder: typeof wcp.AudioDecoder;

type Frame = LibAVT.Frame | wcp.VideoFrame | wcp.AudioData;
type LibAVDecoder = [LibAVT.LibAV, [number, number, number, number]];
type AnyDecoder = LibAVDecoder | wcp.VideoDecoder | wcp.AudioDecoder;

export const isFirefox =
    (typeof navigator !== "undefined") &&
    navigator.userAgent &&
    (navigator.userAgent.indexOf("Firefox") >= 0);

/**
 * A multi-decoder, consisting of decoders for any number of streams.
 */
export class Decoder implements ifs.FrameStream {
    constructor(
        ptr: boolean,

        /**
         * @private
         * libav.js instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * Optional libav.js constructor.
         */
        private _LibAV: LibAVT.LibAVWrapper | undefined,

        /**
         * @private
         * Demuxed input.
         */
        private _inputP: Promise<ifs.PacketStreamAny>
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
        const decoders: (AnyDecoder | null)[] = [];

        // Get decoders for each stream
        for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
            const stream = streams[streamIndex];
            if (stream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
                const wcd = await tryVideoDecoder(
                    la, streamIndex, stream, decodeQueue, setDecodeErr
                );
                if (wcd) {
                    if (isFirefox) {
                        /* Firefox has a bug that the decoder can only be safely
                         * closed once all the frames have been closed. Thus, we
                         * have to keep a reference count and make sure the
                         * frames are closed before closing the decoder. */
                        const wcdFix = <any> wcd;
                        wcdFix.tavClose = wcdFix.close;
                        wcdFix.tavCount = 0;
                        wcdFix.tavTryClose = false;
                        wcdFix.close = function() {
                            if (this.tavCount <= 0)
                                this.tavClose();
                            else
                                this.tavTryClose = true;
                        };
                    }

                    decoders.push(wcd);
                    destructors.push(async () => {
                        try {
                            wcd.close();
                        } catch (ex) {}
                    });
                    continue;
                }

            } else if (stream.codec_type === la.AVMEDIA_TYPE_AUDIO) {
                const wcd = await tryAudioDecoder(
                    la, streamIndex, stream, decodeQueue, setDecodeErr
                );
                if (wcd) {
                    decoders.push(wcd);
                    destructors.push(async () => {
                        try {
                            wcd.close();
                        } catch (ex) {}
                    });
                    continue;
                }

            } else {
                // Unsupported stream type
                decoders.push(null);
                continue;

            }

            /* If we were given the ability to load new libavs, check if we need
             * to for this stream. */
            let streamLA = la;
            if (this._LibAV) {
                let decoder = 0;
                try {
                    decoder = await la.avcodec_find_decoder(stream.codec_id);
                } catch (ex) {}
                if (!decoder) {
                    const desc = await la.avcodec_descriptor_get(stream.codec_id);
                    if (desc) {
                        const name = await la.AVCodecDescriptor_name(desc);
                        streamLA = await this._LibAV.LibAV({
                            variant: `decoder-${name}`
                        });
                    }
                }
            }

            // Initialize the decoder
            const lad = await streamLA.ff_init_decoder(stream.codec_id, {
                codecpar: stream,
                time_base: [stream.time_base_num, stream.time_base_den]
            });
            decoders.push([streamLA, lad]);
            destructors.push(async () => {
                await streamLA.ff_free_decoder(lad[1], lad[2], lad[3]);
                if (streamLA !== la)
                    streamLA.terminate();
            });
        }

        // Create the stream
        this.stream = new ReadableStream({
            pull: async (controller) => {
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
                        controller.close();
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
                                const [streamLA, [, c, pkt, frame]] =
                                    <LibAVDecoder> dec;
                                const res = await streamLA.ff_decode_multi(
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

                    /* Sending an empty array indicates seeking, so flush
                     * decoders */
                    if (inPackets.value.length === 0) {
                        for (const dec of decoders) {
                            if (!dec)
                                continue;
                            if ((<LibAVDecoder> dec).length) {
                                // LibAV decoder
                                const [streamLA, [, c]] = <LibAVDecoder> dec;
                                await streamLA.avcodec_flush_buffers(c);

                            } else {
                                // WebCodecs decoder
                                const wcd = <wcp.VideoDecoder | wcp.AudioDecoder> dec;
                                await wcd.flush();

                            }
                        }
                        controller.enqueue([]);
                        break;
                    }

                    // Group packets by stream
                    const laPackets: Record<number, (number | LibAVT.Packet)[]> = {};
                    for (const packet of inPackets.value) {
                        let streamIndex = -1;
                        if (typeof packet === "number") {
                            // Pointer packet
                            streamIndex = await la.AVPacket_stream_index(packet);
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
                            const [streamLA, [, c, pkt, frame]] =
                                <LibAVDecoder> dec;
                            const res = await streamLA.ff_decode_multi(
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
                                    const evd = lawc.packetToEncodedVideoChunk(
                                        packet, <any> packet
                                    );
                                    wcd.decode(evd);
                                } else {
                                    // Audio
                                    const ead = lawc.packetToEncodedAudioChunk(
                                        packet, <any> packet
                                    );
                                    wcd.decode(ead);
                                }

                                while (wcd.decodeQueueSize > 3)
                                    await new Promise(res => wcd.ondequeue = res);
                            }
                        }
                    }
                }
            }
        });
    }

    async sendCommands(cmds: ifs.Command[]): Promise<ifs.CommandResult[]> {
        const input = await this._inputP;
        return input.sendCommands(cmds);
    }

    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitDecoder, input: Promise<ifs.PacketStreamAny>
    ): Promise<ifs.FrameStream>;
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitDecoderPtr, input: Promise<ifs.PacketStreamAny>
    ): Promise<ifs.FrameStreamPtr>;

    /**
     * Build a decoder.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitDecoder | ifs.InitDecoderPtr,
        input: Promise<ifs.PacketStreamAny>
    ): Promise<ifs.FrameStreamAny> {
        const ret = new Decoder(
            !!init.ptr, libav, (<ifs.InitDecoder> init).LibAV, input
        );
        await ret._init();
        return <any> ret;
    }

    component: ifs.Component = "decoder";
    streamType: "frame" = "frame";
    ptr: false;

    /**
     * Stream of decoded frames.
     */
    stream: ReadableStream<ifs.StreamFrame[]>;

    /**
     * Streams to which the frames belong.
     */
    streams: Promise<ifs.StreamParameters[]>;
}

/**
 * @private
 * Try to get a VideoDecoder instance for this stream.
 */
async function tryVideoDecoder(
    la: LibAVT.LibAV,
    streamIndex: number,
    stream: LibAVT.CodecParameters, decodeQueue: ifs.StreamFrame[],
    decodeErr: (x: any) => void
) {
    try {
        const config = await lawc.videoStreamToConfig(la, stream);
        const support = await VideoDecoder.isConfigSupported(
            <VideoDecoderConfig> <any> config
        );
        if (!support.supported)
            return null;
        const dec = new VideoDecoder({
            output: frame => {
                if (isFirefox) {
                    // See the other "isFirefox" above to explain this.
                    const frameFix = <any> frame;
                    const decFix = <any> dec;
                    decFix.tavCount++;
                    frameFix.tavClose = frameFix.close;
                    frameFix.tavDecoder = dec;
                    frameFix.close = function() {
                        this.tavClose();
                        decFix.tavCount--;
                        if (decFix.tavTryClose && decFix.tavCount <= 0) {
                            try {
                                decFix.close();
                            } catch (ex) {}
                            decFix.tavTryClose = false;
                        }
                    };
                }

                decodeQueue.push({
                    streamIndex: streamIndex,
                    frame: <wcp.VideoFrame> <any> frame
                });
            },
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
    la: LibAVT.LibAV,
    streamIndex: number,
    stream: LibAVT.CodecParameters, decodeQueue: ifs.StreamFrame[],
    decodeErr: (x: any) => void
) {
    try {
        const config = await lawc.audioStreamToConfig(la, stream);
        const support = await AudioDecoder.isConfigSupported(config);
        if (!support.supported)
            return null;
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
