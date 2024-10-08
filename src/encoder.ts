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

declare let AudioEncoder: typeof wcp.AudioEncoder;

type Frame = LibAVT.Frame | wcp.VideoFrame | wcp.AudioData;
type LibAVEncoder = [number, number, number, number, number];

/**
 * A multi-encoder, consisting of encoders for any number of streams.
 */
export class Encoder implements ifs.Encoder {
    constructor(
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
         * Initializer for this encoder (for configurations).
         */
        private _init: ifs.InitEncoder,

        /**
         * @private
         * Demuxed input.
         */
        private _inputP: Promise<
            ifs.Decoder | ifs.DecoderPtr | ifs.Filter | ifs.FilterPtr
        >
    ) {
        this.ptr = <false> !!_init.ptr;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
    }

    /**
     * @private
     * Encoders must be initialized.
     */
    private async _initialize() {
        const la = this._libav;
        const lawc = this._lawc;
        const input = await this._inputP;
        const inputStreams = await input.streams;
        const frameStream = input.stream.getReader();
        let frameEOF = false;

        const destructors: (()=>Promise<unknown>)[] = [];
        async function cleanup() {
            for (const destructor of destructors)
                await destructor();
        }

        // Queue of encoded packets
        const encodeQueue: LibAVT.Packet[] = [];
        let encodeErr: any = null;
        function setEncodeErr(x: any) { encodeErr = x; }

        /* We can only fill in codec parameters once we've read a bit, so keep
         * all of them as promises. */
        const streams: Promise<LibAVT.CodecParameters>[] = [];

        // Encoders, per stream
        const encoders: (
            LibAVEncoder | wcp.VideoEncoder | wcp.AudioEncoder | null
        )[] = [];
        const filters: Record<number, [number, number, number]> = {};

        // Get encoders for each stream
        for (let streamIndex = 0; streamIndex < inputStreams.length; streamIndex++) {
            const inputStream = inputStreams[streamIndex];

            // Try WebCodecs first
            if (inputStream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
                const wce = await tryVideoEncoder(
                    la, lawc, this._init.videoConfig, streamIndex, inputStream,
                    encodeQueue, setEncodeErr
                );
                if (wce) {
                    streams.push(wce[0]);
                    encoders.push(wce[1]);
                    destructors.push(async () => wce[1].close());
                    continue;
                }

            } else if (inputStream.codec_type === la.AVMEDIA_TYPE_AUDIO) {
                const wce = await tryAudioEncoder(
                    la, lawc, this._init.audioConfig, streamIndex, inputStream,
                    encodeQueue, setEncodeErr
                );
                if (wce) {
                    streams.push(wce[0]);
                    encoders.push(wce[1]);
                    destructors.push(async () => wce[1].close());
                    continue;
                }

            } else {
                // Unsupported stream type
                encoders.push(null);
                continue;

            }

            // Perhaps convert the config

            // Try libav.js
            const laei = await la.avcodec_find_encoder(inputStream.codec_id);
            if (laei < 0)
                throw new Error(`Failed to find an encoder for codec ${inputStream.codec_id}`);
            const lad = await la.ff_init_encoder(
                await la.avcodec_get_name(laei),
                {
                    ctx: inputStream,
                    time_base: [1, 1000000]
                }
            );
            encoders.push(lad);
            destructors.push(async () => {
                await la.ff_free_encoder(lad[1], lad[2], lad[3]);
            });

            // Get the codec parameters from it
            const codecparPtr = await la.avcodec_parameters_alloc();
            await la.avcodec_parameters_from_context(codecparPtr, lad[1]);
            const codecpar = await la.ff_copyout_codecpar(codecparPtr);
            streams.push(Promise.resolve(codecpar));
        }
        this.streams = Promise.all(streams);

        // Create the stream
        this.stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    if (encodeErr) {
                        await cleanup();
                        controller.error(encodeErr);
                        break;
                    }

                    if (encodeQueue.length) {
                        controller.enqueue(
                            encodeQueue.splice(0, encodeQueue.length)
                        );
                        break;
                    }

                    if (frameEOF) {
                        await cleanup();
                        controller.close();
                        break;
                    }

                    // Get some data to encode
                    const inFrames = await frameStream.read();
                    if (inFrames.done) {
                        frameEOF = true;

                        // Flush all the encoders
                        for (let i = 0; i < encoders.length; i++) {
                            const enc = encoders[i];
                            if (!enc)
                                continue;
                            if ((<LibAVEncoder> enc).length) {
                                let pkts: LibAVT.Packet[];
                                const [, c, frame, pkt] = <LibAVEncoder> enc;
                                if (filters[i]) {
                                    const [, bufferSrc, bufferSink] = filters[i];
                                    const ffs = await la.ff_filter_multi(
                                        bufferSrc, bufferSink, frame, [], {
                                            fin: true,
                                            copyoutFrame: "ptr"
                                        }
                                    );
                                    pkts = await la.ff_encode_multi(
                                        c, frame, pkt, ffs
                                    );
                                }
                                pkts.push.apply(pkts, await la.ff_encode_multi(
                                    c, frame, pkt, [], true
                                ));
                                for (const packet of pkts) {
                                    packet.stream_index = i;
                                    encodeQueue.push(packet);
                                }

                            } else {
                                const wcd = <wcp.VideoEncoder | wcp.AudioEncoder> enc;
                                await wcd.flush();

                            }
                        }
                        continue;
                    }

                    // Group frames by stream
                    const framesByStr: Record<
                        number,
                        (number | LibAVT.Frame | wcp.VideoFrame | wcp.AudioData)[]
                    > = {};
                    for (const frame of inFrames.value!) {
                        const streamIndex = frame.streamIndex;
                        if (!encoders[streamIndex])
                            continue;
                        framesByStr[streamIndex] = framesByStr[streamIndex] || [];
                        framesByStr[streamIndex].push(frame.frame);
                    }

                    // Encode
                    for (let i = 0; i < streams.length; i++) {
                        if (!framesByStr[i] || !encoders[i])
                            continue;
                        const frames = framesByStr[i];
                        const enc = encoders[i];
                        if ((<LibAVEncoder> enc).length) {
                            // libav.js encoder
                            await libavifyFrames(la, lawc, frames);
                            if (!filters[i]) {
                                filters[i] = await mkFilter(
                                    la, await streams[i], <any> frames[0]
                                );
                                destructors.push(async () => {
                                    await la.avfilter_graph_free_js(filters[i][0]);
                                });
                            }
                            const [, bufferSrc, bufferSink] = filters[i];
                            const [, c, frame, pkt] = <LibAVEncoder> enc;
                            const ffs = await la.ff_filter_multi(
                                bufferSrc, bufferSink, frame, <LibAVT.Frame[]> frames, {
                                    copyoutFrame: "ptr"
                                }
                            );
                            const res = await la.ff_encode_multi(
                                c, frame, pkt, ffs, /* FIXME {
                                    copyoutFrame: <any> (this.ptr ? "ptr" : "default")
                                } */
                            );
                            encodeQueue.push.apply(encodeQueue, res);

                        } else {
                            // WebCodecs encoder
                            const wce = <wcp.VideoEncoder | wcp.AudioEncoder> enc;
                            await webcodecsifyFrames(la, lawc, frames);
                            for (const frame of <any[]> frames) {
                                wce.encode(frame);
                                while (wce.encodeQueueSize > 3)
                                    await new Promise(res => wce.ondequeue = res);
                            }
                        }
                    }
                }
            }
        });
    }

    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitEncoder, input: Promise<
            ifs.Decoder | ifs.DecoderPtr |
            ifs.Filter | ifs.FilterPtr
        >
    ): Promise<ifs.Encoder>;
    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitEncoderPtr, input: Promise<
            ifs.Decoder | ifs.DecoderPtr |
            ifs.Filter | ifs.FilterPtr
        >
    ): Promise<ifs.EncoderPtr>;

    /**
     * Build a encoder.
     */
    static async build(
        libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
        init: ifs.InitEncoder | ifs.InitEncoderPtr,
        input: Promise<
            ifs.Decoder | ifs.DecoderPtr |
            ifs.Filter | ifs.FilterPtr
        >
    ): Promise<ifs.Encoder | ifs.EncoderPtr> {
        const ret = new Encoder(
            libav, lawc, <ifs.InitEncoder> init, input
        );
        await ret._initialize();
        return <any> ret;
    }

    component: "encoder" = "encoder";
    ptr: false;

    /**
     * Stream of encoded frames.
     */
    stream: ReadableStream<LibAVT.Packet[]>;

    /**
     * Streams to which the frames belong.
     */
    streams: Promise<LibAVT.CodecParameters[]>;
}

// CONTINUE HERE

/**
 * @private
 * Try to get a VideoEncoder instance for this stream.
 */
async function tryVideoEncoder(
    la: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    configAny: any, streamIndex: number,
    inStream: LibAVT.CodecParameters, encodeQueue: LibAVT.Packet[],
    encodeErr: (x: any) => void
): Promise<[Promise<LibAVT.CodecParameters>, wcp.VideoEncoder]> {
    if (
        !lawc || !configAny || !configAny.codec ||
        !configAny.width
    ) {
        return null;
    }

    try {
        let p: Promise<unknown> = Promise.all([]);
        const config = <wcp.VideoEncoderConfig> configAny;
        if (!config.width)
            config.width = inStream.width;
        if (!config.height)
            config.height = inStream.height;
        const stream = await lawc.configToVideoStream(la, config);
        // FIXME: What if there are no packets?
        let codecparRes: (x:LibAVT.CodecParameters)=>void | null = null;
        const codecparP = new Promise<LibAVT.CodecParameters>(
            res => codecparRes = res
        );
        const enc = new VideoEncoder({
            output: (chunk, metadata) => {
                // FIXME: Force waiting for the final promise
                p = p.then(async () => {
                    const pkt = await lawc.encodedVideoChunkToPacket(
                        la, chunk, metadata, stream, streamIndex
                    );
                    encodeQueue.push(pkt);

                    if (codecparRes) {
                        codecparRes(await la.ff_copyout_codecpar(stream[0]));
                        codecparRes = null;
                    }
                }).catch(encodeErr);
            },
            error: encodeErr
        });
        enc.configure(<any> config);
        return [
            codecparP,
            <wcp.VideoEncoder> <any> enc
        ];
    } catch (ex) {
        return null;
    }
}


/**
 * @private
 * Try to get a AudioEncoder instance for this stream.
 */
async function tryAudioEncoder(
    la: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    configAny: any, streamIndex: number,
    inStream: LibAVT.CodecParameters, encodeQueue: LibAVT.Packet[],
    encodeErr: (x: any) => void
): Promise<[Promise<LibAVT.CodecParameters>, wcp.AudioEncoder]> {
    if (!lawc || !configAny || !configAny.codec)
        return null;

    try {
        let p: Promise<unknown> = Promise.all([]);
        const config = <wcp.AudioEncoderConfig> configAny;
        if (!config.sampleRate)
            config.sampleRate = inStream.sample_rate;
        if (!config.numberOfChannels)
            config.numberOfChannels = inStream.channels;
        const stream = await lawc.configToAudioStream(la, config);
        let codecparRes: (x:LibAVT.CodecParameters)=>void | null = null;
        const codecparP = new Promise<LibAVT.CodecParameters>(
            res => codecparRes = res
        );
        const enc = new AudioEncoder({
            output: (chunk, metadata) => {
                // FIXME: Force waiting for the final promise
                p = p.then(async () => {
                    const pkt = await lawc.encodedAudioChunkToPacket(
                        la, chunk, metadata, stream, streamIndex
                    );
                    encodeQueue.push(pkt);

                    if (codecparRes) {
                        codecparRes(await la.ff_copyout_codecpar(stream[0]));
                        codecparRes = null;
                    }
                }).catch(encodeErr);
            },
            error: encodeErr
        });
        enc.configure(config);
        return [
            codecparP,
            enc
        ];
    } catch (ex) {
        return null;
    }
}

/**
 * @private
 * Convert these frames to all be in libav format.
 */
async function libavifyFrames(
    la: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge,
    frames: (
        number | LibAVT.Frame | wcp.VideoFrame | wcp.AudioData
    )[]
) {
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if ((<wcp.VideoFrame> frame).codedWidth) {
            frame[i] = await lawc.videoFrameToLAFrame(<wcp.VideoFrame> frame);
        } else if ((<wcp.AudioData> frame).numberOfFrames) {
            frame[i] = await lawc.audioDataToLAFrame(<wcp.AudioData> frame);
        }
    }
}

/**
 * @private
 * Convert these frames to all be in WebCodecs format.
 */
async function webcodecsifyFrames(
    la: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge,
    frames: (
        number | LibAVT.Frame | wcp.VideoFrame | wcp.AudioData
    )[]
) {
    for (let i = 0; i < frames.length; i++) {
        let frame = frames[i];
        if (typeof frame === "number")
            frame = await la.ff_copyout_frame(frame);
        const laFrame = <LibAVT.Frame> frame;
        if (laFrame.data) {
            if (laFrame.width)
                frames[i] = lawc.laFrameToVideoFrame(laFrame);
            else
                frames[i] = lawc.laFrameToAudioData(laFrame);
        }
    }
}

/**
 * @private
 * Make a filter appropriate to handle this data.
 */
async function mkFilter(
    la: LibAVT.LibAV, stream: LibAVT.CodecParameters,
    frameIn: number | LibAVT.Frame
) {
    let frame: LibAVT.Frame;
    if (typeof frameIn === "number")
        frame = await la.ff_copyout_frame(frameIn);
    else
        frame = frameIn;

    if (stream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
        return await la.ff_init_filter_graph(
            "null",
            {
                type: la.AVMEDIA_TYPE_VIDEO,
                width: frame.width,
                height: frame.height,
                pix_fmt: frame.format,
                time_base: frame.time_base_num
                    ? [frame.time_base_num, frame.time_base_den]
                    : void 0
            }, {
                type: la.AVMEDIA_TYPE_VIDEO,
                width: stream.width,
                height: stream.height,
                pix_fmt: stream.format,
                time_base: [1, 1000000]
            }
        );
    } else {
        return await la.ff_init_filter_graph(
            "anull",
            {
                sample_rate: frame.sample_rate,
                channel_layout: frame.channel_layout,
                sample_fmt: frame.format,
                time_base: frame.time_base_num
                    ? [frame.time_base_num, frame.time_base_den]
                    : void 0
            }, {
                sample_rate: stream.sample_rate,
                channel_layout: stream.channel_layoutmask,
                sample_fmt: stream.format,
                time_base: [1, 1000000]
            }
        );
    }
}
