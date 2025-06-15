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

declare let AudioEncoder: typeof wcp.AudioEncoder;

type Frame = LibAVT.Frame | wcp.VideoFrame | wcp.AudioData;
type LibAVEncoder = [number, number, number, number, number];

/**
 * A multi-encoder, consisting of encoders for any number of streams.
 */
export class Encoder implements ifs.PacketStream {
    constructor(
        /**
         * @private
         * libav.js instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * Initializer for this encoder (for configurations).
         */
        private _init: ifs.InitEncoder,

        /**
         * @private
         * Demuxed input.
         */
        private _inputP: Promise<ifs.FrameStreamAny>
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
        const streams: Promise<ifs.StreamParameters>[] = [];

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
                    la, this._init.videoConfig, streamIndex, inputStream,
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
                    la, this._init.audioConfig, streamIndex, inputStream,
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
            let codecpar: ifs.EncoderAVCodecConfig;
            if (inputStream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
                if (this._init.libavVideoConfig) {
                    codecpar = <any> this._init.libavVideoConfig;
                } else if (this._init.videoConfig) {
                    const config = this._init.videoConfig;
                    const str = await lawc.configToVideoStream(la, config);
                    codecpar = await la.ff_copyout_codecpar(str[0]);
                    await la.avcodec_parameters_free_js(str[0]);
                    if (config.bitrate) {
                        const br = la.f64toi64(config.bitrate);
                        codecpar.bit_rate = br[0];
                        codecpar.bit_ratehi = br[1];
                    }
                } else
                    throw new Error("Video stream with no video configuration");
            } else {
                if (this._init.libavAudioConfig) {
                    codecpar = <any> this._init.libavAudioConfig;
                } else if (this._init.audioConfig) {
                    const config = this._init.audioConfig;
                    const str = await lawc.configToAudioStream(la, config);
                    codecpar = await la.ff_copyout_codecpar(str[0]);
                    await la.avcodec_parameters_free_js(str[0]);
                    if (config.bitrate) {
                        const br = la.f64toi64(config.bitrate);
                        codecpar.bit_rate = br[0];
                        codecpar.bit_ratehi = br[1];
                    }
                } else
                    throw new Error("Audio stream with no audio configuration");
            }
            if (typeof codecpar === "number")
                codecpar = await la.ff_copyout_codecpar(codecpar);

            const laei = await la.avcodec_find_encoder(codecpar.codec_id);

            // Convert to codec context
            const ctx: LibAVT.AVCodecContextProps = {};
            let options: Record<string, string> = Object.create(null);
            for (const key in codecpar) {
                if (la[`AVCodecContext_${key}_s`])
                    ctx[key] = codecpar[key];
            }
            if (codecpar.options)
                options = codecpar.options;
            if (inputStream.codec_type === la.AVMEDIA_TYPE_VIDEO) {
                if (!("pix_fmt" in ctx))
                    ctx.pix_fmt = la.AV_PIX_FMT_YUV420P; // FIXME
                if (!ctx.width)
                    ctx.width = inputStream.width;
                if (!ctx.height)
                    ctx.height = inputStream.height;
            } else {
                if (!("sample_fmt" in ctx))
                    ctx.sample_fmt = await la.AVCodec_sample_fmts_a(laei, 0);
                if (!ctx.sample_rate)
                    ctx.sample_rate = inputStream.sample_rate;
                if (!ctx.channel_layout)
                    ctx.channel_layout = inputStream.channel_layoutmask;
            }
            if (ctx.level < 0)
                delete ctx.level;
            if (ctx.profile < 0)
                delete ctx.profile;

            // Open the encoder
            const lae = await la.ff_init_encoder(
                await la.AVCodec_name(laei),
                {
                    ctx, options,
                    time_base: [1, 1000000]
                }
            );
            encoders.push(lae);
            destructors.push(async () => {
                await la.ff_free_encoder(lae[1], lae[2], lae[3]);
            });

            // Get the codec parameters from it
            const codecparPtr = await la.avcodec_parameters_alloc();
            await la.avcodec_parameters_from_context(codecparPtr, lae[1]);
            const spar = <ifs.StreamParameters>
                await la.ff_copyout_codecpar(codecparPtr);
            spar.time_base_num = await la.AVCodecContext_time_base_num(lae[1]);
            spar.time_base_den = await la.AVCodecContext_time_base_den(lae[1]);
            streams.push(Promise.resolve(spar));
            await la.avcodec_parameters_free_js(codecparPtr);
        }
        this.streams = Promise.all(streams);

        // Create the stream
        this.stream = new ReadableStream({
            pull: async (controller) => {
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
                                let ffs: number[];
                                if (filters[i]) {
                                    const [, bufferSrc, bufferSink] = filters[i];
                                    ffs = await la.ff_filter_multi(
                                        bufferSrc, bufferSink, frame, [], {
                                            fin: true,
                                            copyoutFrame: "ptr"
                                        }
                                    );
                                } else {
                                    ffs = [];
                                }
                                pkts = await la.ff_encode_multi(
                                    c, frame, pkt, ffs, {
                                        fin: true,
                                        copyoutPacket: <any> (this.ptr ? "ptr" : "default")
                                    }
                                );
                                for (const packet of pkts) {
                                    if (this.ptr)
                                        await la.AVPacket_stream_index_s(<number> <any> packet, i);
                                    else
                                        packet.stream_index = i;
                                    encodeQueue.push(packet);
                                }

                            } else {
                                const wce = <wcp.VideoEncoder | wcp.AudioEncoder> enc;
                                await wce.flush();

                            }
                        }
                        continue;
                    }

                    // Group frames by stream
                    const framesByStr: Record<
                        number,
                        (
                            number | LibAVT.Frame | wcp.VideoFrame |
                            VideoFrame | wcp.AudioData
                        )[]
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
                            const [, c, frame, pkt] = <LibAVEncoder> enc;
                            await libavifyFrames(la, frames);
                            if (!filters[i]) {
                                filters[i] = await mkFilter(
                                    la, c, await streams[i], <any> frames[0]
                                );
                                destructors.push(async () => {
                                    await la.avfilter_graph_free_js(filters[i][0]);
                                });
                            }
                            const [, bufferSrc, bufferSink] = filters[i];
                            const ffs = await la.ff_filter_multi(
                                bufferSrc, bufferSink, frame, <LibAVT.Frame[]> frames, {
                                    copyoutFrame: "ptr"
                                }
                            );
                            const res = await la.ff_encode_multi(
                                c, frame, pkt, ffs, {
                                    copyoutPacket: <any> (this.ptr ? "ptr" : "default")
                                }
                            );
                            for (const pkt of res) {
                                if (this.ptr)
                                    await la.AVPacket_stream_index_s(<number> <any> pkt, i);
                                else
                                    pkt.stream_index = i;
                                encodeQueue.push(pkt);
                            }

                        } else {
                            // WebCodecs encoder
                            const wce = <wcp.VideoEncoder | wcp.AudioEncoder> enc;
                            await webcodecsifyFrames(la, frames);
                            for (const frame of <any[]> frames) {
                                wce.encode(frame);
                                frame.close();
                                while (wce.encodeQueueSize > 3)
                                    await new Promise(res => wce.ondequeue = res);
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
        init: ifs.InitEncoder, input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.PacketStream>;
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitEncoderPtr, input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.PacketStreamPtr>;

    /**
     * Build a encoder.
     */
    static async build(
        libav: LibAVT.LibAV,
        init: ifs.InitEncoder | ifs.InitEncoderPtr,
        input: Promise<ifs.FrameStreamAny>
    ): Promise<ifs.PacketStreamAny> {
        const ret = new Encoder(
            libav, <ifs.InitEncoder> init, input
        );
        await ret._initialize();
        return <any> ret;
    }

    component: ifs.Component = "encoder";
    streamType: "packet" = "packet";
    ptr: false;

    /**
     * Stream of encoded frames.
     */
    stream: ReadableStream<LibAVT.Packet[]>;

    /**
     * Streams to which the frames belong.
     */
    streams: Promise<ifs.StreamParameters[]>;
}

/**
 * @private
 * Try to get a VideoEncoder instance for this stream.
 */
async function tryVideoEncoder(
    la: LibAVT.LibAV,
    configAny: any, streamIndex: number,
    inStream: LibAVT.CodecParameters, encodeQueue: LibAVT.Packet[],
    encodeErr: (x: any) => void
): Promise<[Promise<ifs.StreamParameters>, wcp.VideoEncoder]> {
    if (
        !configAny || !configAny.codec
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

        const supp = await VideoEncoder.isConfigSupported(<any> config);
        if (!supp || !supp.supported)
            return null;

        const stream = await lawc.configToVideoStream(la, config);
        // FIXME: What if there are no packets?
        let sparRes: (x:ifs.StreamParameters)=>void | null = null;
        const sparP = new Promise<ifs.StreamParameters>(
            res => sparRes = res
        );
        const enc = new VideoEncoder({
            output: (chunk, metadata) => {
                // FIXME: Force waiting for the final promise
                p = p.then(async () => {
                    const pkt = await lawc.encodedVideoChunkToPacket(
                        la, chunk, metadata, stream, streamIndex
                    );
                    encodeQueue.push(pkt);

                    if (sparRes) {
                        const spar = <ifs.StreamParameters>
                            await la.ff_copyout_codecpar(stream[0]);
                        spar.time_base_num = 1;
                        spar.time_base_den = 1000000;
                        sparRes(spar);
                        sparRes = null;
                    }
                }).catch(encodeErr);
            },
            error: encodeErr
        });
        enc.configure(<any> config);
        return [
            sparP,
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
    la: LibAVT.LibAV,
    configAny: any, streamIndex: number,
    inStream: LibAVT.CodecParameters, encodeQueue: LibAVT.Packet[],
    encodeErr: (x: any) => void
): Promise<[Promise<ifs.StreamParameters>, wcp.AudioEncoder]> {
    if (!configAny || !configAny.codec)
        return null;

    try {
        let p: Promise<unknown> = Promise.all([]);
        const config = <wcp.AudioEncoderConfig> configAny;
        if (!config.sampleRate)
            config.sampleRate = inStream.sample_rate;
        if (!config.numberOfChannels)
            config.numberOfChannels = inStream.channels;

        const supp = await AudioEncoder.isConfigSupported(config);
        if (!supp || !supp.supported)
            return null;

        const stream = await lawc.configToAudioStream(la, config);
        let sparRes: (x:ifs.StreamParameters)=>void | null = null;
        const sparP = new Promise<ifs.StreamParameters>(
            res => sparRes = res
        );
        const enc = new AudioEncoder({
            output: (chunk, metadata) => {
                // FIXME: Force waiting for the final promise
                p = p.then(async () => {
                    const pkt = await lawc.encodedAudioChunkToPacket(
                        la, chunk, metadata, stream, streamIndex
                    );
                    encodeQueue.push(pkt);

                    if (sparRes) {
                        const spar = <ifs.StreamParameters>
                            await la.ff_copyout_codecpar(stream[0]);
                        spar.time_base_num = 1;
                        spar.time_base_den = 1000000;
                        sparRes(spar);
                        sparRes = null;
                    }
                }).catch(encodeErr);
            },
            error: encodeErr
        });
        enc.configure(config);
        return [
            sparP,
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
    la: LibAVT.LibAV,
    frames: (
        number | LibAVT.Frame | wcp.VideoFrame | VideoFrame | wcp.AudioData
    )[]
) {
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if ((<wcp.VideoFrame> frame).codedWidth) {
            const vf = <wcp.VideoFrame> frame;
            frames[i] = await lawc.videoFrameToLAFrame(vf);
            vf.close();
        } else if ((<wcp.AudioData> frame).numberOfFrames) {
            const af = <wcp.AudioData> frame;
            frames[i] = await lawc.audioDataToLAFrame(af);
            af.close();
        }
    }
}

/**
 * @private
 * Convert these frames to all be in WebCodecs format.
 */
async function webcodecsifyFrames(
    la: LibAVT.LibAV,
    frames: (
        number | LibAVT.Frame | wcp.VideoFrame | VideoFrame | wcp.AudioData
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
    la: LibAVT.LibAV, c: number, stream: LibAVT.CodecParameters,
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
            "aresample",
            {
                sample_rate: frame.sample_rate,
                channel_layout: la.ff_channel_layout(frame),
                sample_fmt: frame.format,
                time_base: frame.time_base_num
                    ? [frame.time_base_num, frame.time_base_den]
                    : void 0
            }, {
                sample_rate: stream.sample_rate,
                channel_layout: stream.channel_layoutmask,
                sample_fmt: stream.format,
                time_base: [1, stream.sample_rate!],
                frame_size: await la.AVCodecContext_frame_size(c)
            }
        );
    }
}
