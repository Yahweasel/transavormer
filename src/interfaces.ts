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
import type * as LibAVWebCodecsBridgeT from "libavjs-webcodecs-bridge";
import type * as wcp from "libavjs-webcodecs-polyfill";

/**
 * File data being read from a stream. Only readable in order.
 */
export interface StreamFile {
    /**
     * Read this many bytes. Returns null on EOF.
     */
    read: (len: number) => Promise<Uint8Array | null>;
}

/**
 * File data being read from a random access source.
 */
export interface RAFile {
    /**
     * Total size of the file.
     */
    size: number;

    /**
     * Read this many bytes from this position. Returns null on EOF.
     * @param pos  Position in the file to read from.
     * @param len  Maximum number of bytes to read.
     */
    read: (pos: number, len: number) => Promise<Uint8Array | null>;
}

/**
 * An input file in any supported form.
 */
export type InputFile = Blob | ReadableStream<Uint8Array> | StreamFile | RAFile;


/**
 * Data with an associated stream index.
 */
export interface WithStream<D> {
    streamIndex: number;
    frame: D;
}

export type WebCodecsStreamFrame = WithStream<wcp.VideoFrame | wcp.AudioData>;
export type LibAVStreamFrame = WithStream<LibAVT.Frame>;
export type LibAVStreamFramePtr = WithStream<number>;
export type StreamFrame = WebCodecsStreamFrame | LibAVStreamFrame;
export type StreamFramePtr = WebCodecsStreamFrame | LibAVStreamFramePtr;


/**
 * Supertype of everything that has multiple streams.
 */
export interface WithStreams {
    streams: Promise<LibAVT.CodecParameters[]>;
}


/**
 * A demuxer, as created by this library.
 */
export interface Demuxer extends WithStreams {
    component: "demuxer";
    ptr: false;
    stream: ReadableStream<LibAVT.Packet[]>;
}

/**
 * A demuxer outputting raw pointers instead of JS-level packets.
 */
export interface DemuxerPtr extends WithStreams {
    component: "demuxer";
    ptr: true;
    stream: ReadableStream<number[]>;
}

/**
 * A decoder, as created by this library.
 */
export interface Decoder extends WithStreams {
    component: "decoder";
    ptr: false;
    stream: ReadableStream<StreamFrame[]>;
}

/**
 * A decoder outputting raw pointers instead of JS-level frames.
 */
export interface DecoderPtr extends WithStreams {
    component: "decoder";
    ptr: true;
    stream: ReadableStream<StreamFramePtr[]>;
}

/**
 * A filter. Filters always output frames in LibAV format, so a frame normalizer
 * is also a filter.
 */
export interface Filter extends WithStreams {
    component: "filter";
    ptr: false;
    stream: ReadableStream<LibAVStreamFrame[]>;
}

/**
 * A filter. Filters always output frames in LibAV format, so a frame normalizer
 * is also a filter.
 */
export interface FilterPtr extends WithStreams {
    component: "filter";
    ptr: true;
    stream: ReadableStream<LibAVStreamFramePtr[]>;
}

/**
 * An encoder, as created by this library.
 */
export interface Encoder extends WithStreams {
    component: "encoder";
    ptr: false;
    stream: ReadableStream<LibAVT.Packet[]>;
}

/**
 * An encoder outputting raw pointers instead of JS-level packets.
 */
export interface EncoderPtr extends WithStreams {
    component: "encoder";
    ptr: true;
    stream: ReadableStream<number[]>;
}

/**
 * A stream muxer, as created by this library.
 */
export interface Muxer {
    component: "muxer";
    randomAccess: boolean;
    stream: ReadableStream<{position: number, data: Uint8Array}>;
}


/**
 * Initializer for a demuxer.
 */
export interface InitDemuxer {
    type: "demuxer";
    ptr?: false;
    input: InputFile;
}

/**
 * Initializer for a pointer-based demuxer.
 */
export interface InitDemuxerPtr {
    type: "demuxer";
    ptr: true;
    input: InputFile;
}

export type DemuxerLike =
    InitDemuxer | InitDemuxerPtr |
    Demuxer | DemuxerPtr |
    Promise<Demuxer> | Promise<DemuxerPtr>;

/**
 * Initializer for a decoder.
 */
export interface InitDecoder {
    type: "decoder";
    ptr?: false;
    input: DemuxerLike;
}

/**
 * Initializer for a pointer-based decoder.
 */
export interface InitDecoderPtr {
    type: "decoder";
    ptr: true;
    input: DemuxerLike;
}

export type DecoderLike =
    DemuxerLike |
    InitDecoder | InitDecoderPtr |
    Decoder | DecoderPtr |
    Promise<Decoder> | Promise<DecoderPtr>;

/**
 * Initializer for a normalizer.
 */
export interface InitFrameNormalizer {
    type: "frame-normalizer",
    ptr?: false,
    input: DecoderLike
}

/**
 * Initializer for a pointer-based normalizer.
 */
export interface InitFrameNormalizerPtr {
    type: "frame-normalizer",
    ptr: true,
    input: DecoderLike
}

export type FilterLike =
    DemuxerLike |
    DecoderLike |
    InitFrameNormalizer | InitFrameNormalizerPtr |
    Filter | FilterPtr |
    Promise<Filter> | Promise<FilterPtr>;

/**
 * Initializer for an encoder.
 */
export interface InitEncoder {
    type: "encoder",
    ptr?: false,
    input: FilterLike,
    videoConfig?: wcp.VideoEncoderConfig | LibAVT.CodecParameters | number,
    audioConfig?: wcp.AudioEncoderConfig | LibAVT.CodecParameters | number
}

/**
 * Initializer for a pointer-based encoder.
 */
export interface InitEncoderPtr {
    type: "encoder",
    ptr: true,
    input: FilterLike,
    videoConfig?: wcp.VideoEncoderConfig | LibAVT.CodecParameters | number,
    audioConfig?: wcp.AudioEncoderConfig | LibAVT.CodecParameters | number
}

type EncoderLike =
    FilterLike |
    InitEncoder | InitEncoderPtr |
    Encoder | EncoderPtr |
    Promise<Encoder> | Promise<EncoderPtr>;

/**
 * Initializer for a muxer.
 */
export interface InitMuxer {
    type: "muxer",
    format: string | number,
    randomAccess?: boolean,
    input: EncoderLike
};


/**
 * All initializers.
 */
export type Init =
    InitDemuxer | InitDemuxerPtr |
    InitDecoder | InitDecoderPtr |
    InitFrameNormalizer | InitFrameNormalizerPtr |
    InitEncoder | InitEncoderPtr |
    InitMuxer;
