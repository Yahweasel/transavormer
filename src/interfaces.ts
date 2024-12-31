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

export type WebCodecsStreamFrame = WithStream<
    wcp.VideoFrame | VideoFrame | wcp.AudioData
>;
export type LibAVStreamFrame = WithStream<LibAVT.Frame>;
export type LibAVStreamFramePtr = WithStream<number>;
export type StreamFrame = WebCodecsStreamFrame | LibAVStreamFrame;
export type StreamFramePtr = WebCodecsStreamFrame | LibAVStreamFramePtr;


/**
 * Stream info is provided as CodecParameters plus time base.
 */
export type StreamParameters = LibAVT.CodecParameters & {
    time_base_num: number,
    time_base_den: number
};

/**
 * All component types.
 */
export type Component =
    "packet-stream" | "demuxer" |
    "packet-selector" |
    "frame-stream" | "decoder" |
    "frame-selector" |
    "frame-normalizer" | "play-normalizer" | "la-filter" |
    "encoder" |
    "file-stream" | "muxer";

/**
 * Every transformer sets at least `component` and `streamType`, and allows
 * commands.
 */
export interface Transformer {
    component: Component;
    streamType: string;
    sendCommands(cmds: Command[]): Promise<CommandResult[]>;
}

/**
 * Supertype of every streaming type.
 */
export interface WithStreams<StreamType extends string, StreamElem> extends Transformer {
    streamType: StreamType;
    streams: Promise<StreamParameters[]>;
    stream: ReadableStream<StreamElem[]>;
}

/**
 * Supertype of streaming types that have pointer and non-pointer versions.
 */
export interface WithStreamsPtr<StreamType extends string, StreamElem, Ptr>
    extends WithStreams<StreamType, StreamElem> {
    ptr: Ptr;
}


// All of the normal stream types
export type PacketStream = WithStreamsPtr<"packet", LibAVT.Packet, false>;
export type PacketStreamPtr = WithStreamsPtr<"packet", number, true>;
export type PacketStreamAny = PacketStream | PacketStreamPtr;
export type LibAVFrameStream = WithStreamsPtr<
    "libav-frame", LibAVStreamFrame, false
>;
export type LibAVFrameStreamPtr = WithStreamsPtr<
    "libav-frame", LibAVStreamFramePtr, true
>;
export type LibAVFrameStreamAny = LibAVFrameStream | LibAVFrameStreamPtr;
export type WebCodecsFrameStream = WithStreams<
    "webcodecs-frame", WebCodecsStreamFrame
> & {ptr: false};
export type FrameStream = WithStreamsPtr<
    "frame" | "libav-frame" | "webcodecs-frame",
    StreamFrame, false
>;
export type FrameStreamPtr = WithStreamsPtr<
    "frame" | "libav-frame" | "webcodecs-frame",
    StreamFramePtr, true
>;
export type FrameStreamAny = FrameStream | FrameStreamPtr;

export interface FileStream extends Transformer {
    streamType: "file";
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

export interface SelectionFull {
    type?: "video" | "audio" | "all";
    selection?: number | "all" | "none";
}

/**
 * Selector descriptions for packet selectors.
 */
export type Selection = string | number | SelectionFull;

/**
 * Initializer for a packet stream selector.
 */
export interface InitPacketSelector {
    type: "packet-selector";
    selection: Selection | Selection[];
    input: InitPacketStream;
}

/**
 * Initializer for a decoder.
 */
export interface InitDecoder {
    type: "decoder";
    ptr?: false;
    input: InitPacketStream;
}

/**
 * Initializer for a pointer-based decoder.
 */
export interface InitDecoderPtr {
    type: "decoder";
    ptr: true;
    input: InitPacketStream;
}

/**
 * Initializer for a frame-level stream selector.
 */
export interface InitFrameSelector {
    type: "frame-selector";
    selection: Selection | Selection[];
    input: InitFrameStream;
}

/**
 * Initializer for a normalizer.
 */
export interface InitFrameNormalizer {
    type: "frame-normalizer";
    ptr?: false;
    input: InitFrameStream;
}

/**
 * Initializer for a pointer-based normalizer.
 */
export interface InitFrameNormalizerPtr {
    type: "frame-normalizer";
    ptr: true;
    input: InitFrameStream;
}

/**
 * Initializer for a playback normalizer.
 */
export interface InitPlaybackNormalizer {
    type: "play-normalizer";
    sampleRate: number;
    channels?: number;
    input: InitFrameStream;
}

/**
 * Initializer for a libav.js filter.
 */
export interface InitLAFilter {
    type: "la-filter";
    ptr?: false;
    /**
     * Video filter(graph) description.
     */
    videoFilters?: string;
    /**
     * Video filter result settings.
     */
    videoIOSettings?: Partial<LibAVT.FilterIOSettings>;
    /**
     * Audio filter(graph) description.
     */
    audioFilters?: string;
    /**
     * Audio filter result settings.
     */
    audioIOSettings?: Partial<LibAVT.FilterIOSettings>;
    input: InitFrameStream;
}

/**
 * Initializer for a libav.js filter, pointer mode.
 */
export interface InitLAFilterPtr {
    type: "la-filter";
    ptr: true;
    videoFilters?: string;
    videoIOSettings?: Partial<LibAVT.FilterIOSettings>;
    audioFilters?: string;
    audioIOSettings?: Partial<LibAVT.FilterIOSettings>;
    input: InitFrameStream;
}

/**
 * Type used for codec context properties for encoders.
 */
export type EncoderAVCodecConfig = LibAVT.CodecParameters &
    LibAVT.AVCodecContextProps & {
        options?: Record<string, string>
    };

/**
 * Initializer for an encoder.
 */
export interface InitEncoder {
    type: "encoder";
    ptr?: false;
    input: InitFrameStream;
    videoConfig?: wcp.VideoEncoderConfig;
    libavVideoConfig?: EncoderAVCodecConfig | number;
    audioConfig?: wcp.AudioEncoderConfig;
    libavAudioConfig?: EncoderAVCodecConfig | number;
}

/**
 * Initializer for a pointer-based encoder.
 */
export interface InitEncoderPtr {
    type: "encoder";
    ptr: true;
    input: InitFrameStream;
    videoConfig?: wcp.VideoEncoderConfig;
    libavVideoConfig?: (LibAVT.CodecParameters & LibAVT.AVCodecContextProps) | number;
    audioConfig?: wcp.AudioEncoderConfig;
    libavAudioConfig?: (LibAVT.CodecParameters & LibAVT.AVCodecContextProps) | number;
}

/**
 * Initializer for a muxer.
 */
export interface InitMuxer {
    type: "muxer";
    format: string | number;
    randomAccess?: boolean;
    input: InitPacketStream;
};

/**
 * Initializer for a user-defined packet stream.
 */
export interface InitUserPacketStream {
    type: "packet-stream";
    streams: StreamParameters[];
    input: ReadableStream<(number|LibAVT.Packet)[]>;
}

/**
 * Initializer for a user-defined frame stream.
 */
export interface InitUserFrameStream {
    type: "frame-stream";
    streams: Partial<StreamParameters>[];
    input: ReadableStream<StreamFrame[]>;
}

/**
 * Initializer for a single-stream user-defined frame stream.
 */
export interface InitUserMonoFrameStream {
    type: "mono-frame-stream";
    stream: Partial<StreamParameters>;
    input: ReadableStream<(
        number | LibAVT.Frame |
        wcp.VideoFrame | VideoFrame | wcp.AudioData
    )[]>;
}

// Generic initializers
export type InitPacketStream =
    InputFile |
    InitDemuxer | InitDemuxerPtr |
    InitPacketSelector |
    InitEncoder | InitEncoderPtr |
    InitUserPacketStream |
    PacketStreamAny | Promise<PacketStreamAny>;

export type InitFrameStream =
    InitPacketStream |
    InitDecoder | InitDecoderPtr |
    InitFrameSelector |
    InitFrameNormalizer | InitFrameNormalizerPtr |
    InitPlaybackNormalizer |
    InitUserFrameStream | InitUserMonoFrameStream |
    FrameStreamAny | Promise<FrameStreamAny>;


/**
 * All initializers.
 */
export type Init =
    InitDemuxer | InitDemuxerPtr |
    InitDecoder | InitDecoderPtr |
    InitFrameNormalizer | InitFrameNormalizerPtr |
    InitPlaybackNormalizer |
    InitLAFilter | InitLAFilterPtr |
    InitEncoder | InitEncoderPtr |
    InitMuxer |
    InitUserPacketStream |
    InitUserFrameStream | InitUserMonoFrameStream;


/**
 * TransAVormer commands have a generic form so that you can write custom
 * commands.
 */
export interface Command {
    /**
     * The name of the command.
     */
    c: string;
}

/**
 * When you finish a command, the result is added to the command object.
 */
export interface CommandResult extends Command {
    /**
     * True if the command actually ran (one or more transformers interpreted it).
     */
    ran: boolean;

    /**
     * True if the command succeeded.
     */
    success: boolean;

    /**
     * Diagnostic information on the result.
     */
    diagnostic: any[];
}

/**
 * A seek command. Seeks to the specified time.
 */
export interface SeekCommand extends Command {
    c: "seek";

    /**
     * Time to seek to. By default in seconds, but can be in stream time units
     * (see below).
     */
    time: number;

    /**
     * Minimum time to seek to. If unset, 0.
     */
    min?: number;

    /**
     * Maximum time to seek to. If unset, same as time.
     */
    max?: number;

    /**
     * Stream to base seeking on. By default, let the demuxer decide.
     */
    stream?: number;

    /**
     * Set to use the stream timebase instead of seconds.
     */
    streamTimebase?: boolean;
}

/**
 * A seek command result.
 */
export type SeekCommandResult = SeekCommand & CommandResult;
