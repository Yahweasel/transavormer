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

import * as demuxer from "./demuxer";
import * as decoder from "./decoder";
import * as norm from "./normalizer";
import * as encoder from "./encoder";
import * as muxer from "./muxer";
import * as ifs from "./interfaces";

export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitDemuxer): Promise<ifs.PacketStream>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitDemuxerPtr): Promise<ifs.PacketStreamPtr>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitDecoder): Promise<ifs.FrameStream>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitDecoderPtr): Promise<ifs.FrameStreamPtr>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitFrameNormalizer): Promise<ifs.LibAVFrameStream>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitFrameNormalizerPtr): Promise<ifs.LibAVFrameStream>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitEncoder): Promise<ifs.PacketStream>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitEncoderPtr): Promise<ifs.PacketStreamPtr>;
export function build(libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | unknown, init: ifs.InitMuxer): Promise<ifs.FileStream>;

/**
 * Create a transavormer for the requested task.
 * @param init  Task description (initializer).
 */
export function build(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<any> {
    switch (init.type) {
        case "demuxer":
            return buildDemuxer(libav, init);

        case "decoder":
            return buildDecoder(libav, lawc, init);

        case "frame-normalizer":
            return buildNormalizer(libav, lawc, init);

        case "encoder":
            return buildEncoder(libav, lawc, init);

        case "muxer":
            return buildMuxer(libav, lawc, init);
    }

    throw new Error(`Unrecognized initializer type ${(<any> init).type}`);
}

function buildDemuxer(libav: LibAVT.LibAV, init: any): Promise<ifs.PacketStream> {
    if (init.then)
        return init;
    if (init.streamType === "packet")
        return Promise.resolve(init);

    if (init.type !== "demuxer") {
        return buildDemuxer(libav, <ifs.InitDemuxerPtr> {
            type: "demuxer",
            ptr: true,
            input: init
        });
    }

    return demuxer.Demuxer.build(libav, init);
}

function buildDecoder(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<ifs.FrameStream> {
    if (init.then)
        return init;
    if (
        init.streamType === "frame" ||
        init.streamType === "libav-frame" ||
        init.streamType === "webcodecs-frame"
    )
        return Promise.resolve(init);

    if (init.type !== "decoder") {
        const ptr = init.ptr;
        init.ptr = true;
        return buildDecoder(libav, lawc, <ifs.InitDecoder> {
            type: "decoder",
            ptr,
            input: init
        });
    }

    return decoder.Decoder.build(
        libav, lawc, init, buildDemuxer(libav, init.input)
    );
}

function buildNormalizer(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<ifs.LibAVFrameStream> {
    if (init.then)
        return init;
    if (init.component === "libav-frame")
        return Promise.resolve(init);

    if (init.type !== "frame-normalizer") {
        const ptr = init.ptr;
        init.ptr = true;
        return buildNormalizer(libav, lawc, <ifs.InitFrameNormalizer> {
            type: "frame-normalizer",
            ptr,
            input: init
        });
    }

    return norm.FrameNormalizer.build(
        libav, lawc, init, buildDecoder(libav, lawc, init.input)
    );
}

function buildFrameStream(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<ifs.FrameStream> {
    if (init.then)
        return init;
    if (
        init.streamType === "frame" ||
        init.streamType === "libav-frame" ||
        init.streamType === "webcodecs-frame"
    )
        return Promise.resolve(init);

    if (init.type === "filter") {
        throw new Error("lolwhoops no filters yet");
    } else if (init.type === "frame-normalizer") {
        return buildNormalizer(libav, lawc, init);
    } else {
        return buildDecoder(libav, lawc, init);
    }
}

function buildEncoder(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<ifs.PacketStream> {
    if (init.then)
        return init;
    if (init.streamType === "packet")
        return Promise.resolve(init);

    if (init.type !== "encoder") {
        const ptr = init.ptr;
        init.ptr = true;
        return buildEncoder(libav, lawc, <ifs.InitEncoder> {
            type: "encoder",
            ptr,
            videoConfig: <wcp.VideoEncoderConfig> {
                codec: "vp09.00.10.08.03.1.1.1.0",
                width: 0,
                height: 0
            },
            audioConfig: <wcp.AudioEncoderConfig> {
                codec: "opus"
            },
            input: init
        });
    }

    return encoder.Encoder.build(
        libav, lawc, init, buildFrameStream(libav, lawc, init.input)
    );
}

function buildPacketStream(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<ifs.PacketStream> {
    if (init.then)
        return init;
    if (init.streamType === "packet")
        return Promise.resolve(init);

    if (init.type === "filter" ||
        init.type === "frame-normalizer" ||
        init.type === "encoder") {
        return buildEncoder(libav, lawc, init);
    } else {
        return buildDemuxer(libav, init);
    }
}

function buildMuxer(
    libav: LibAVT.LibAV, lawc: typeof LibAVWebCodecsBridge | undefined,
    init: any
): Promise<ifs.FileStream> {
    if (init.then)
        return init;
    if (init.streamType === "file")
        return Promise.resolve(init);

    if (init.type !== "muxer") {
        init.ptr = true;
        return buildMuxer(libav, lawc, <ifs.InitMuxer> {
            type: "muxer",
            format: "matroska",
            input: init
        });
    }

    return muxer.Muxer.build(
        libav, init, buildPacketStream(libav, lawc, init.input)
    );
}
