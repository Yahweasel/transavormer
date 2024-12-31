/*!
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

import * as ifs from "./interfaces";
import * as factory from "./build";

export type StreamFile = ifs.StreamFile;
export type RAFile = ifs.RAFile;
export type InputFile = ifs.InputFile;
export type WebCodecsStreamFrame = ifs.WebCodecsStreamFrame;
export type LibAVStreamFrame = ifs.LibAVStreamFrame;
export type LibAVStreamFramePtr = ifs.LibAVStreamFramePtr;
export type StreamFrame = ifs.StreamFrame;
export type StreamFramePtr = ifs.StreamFramePtr;
export type StreamParameters = ifs.StreamParameters;
export type Component = ifs.Component;
export type PacketStream = ifs.PacketStream;
export type PacketStreamPtr = ifs.PacketStreamPtr;
export type PacketStreamAny = ifs.PacketStreamAny;
export type LibAVFrameStream = ifs.LibAVFrameStream;
export type LibAVFrameStreamPtr = ifs.LibAVFrameStreamPtr;
export type LibAVFrameStreamAny = ifs.LibAVFrameStreamAny;
export type WebCodecsFrameStream = ifs.WebCodecsFrameStream;
export type FrameStream = ifs.FrameStream;
export type FrameStreamPtr = ifs.FrameStreamPtr;
export type FrameStreamAny = ifs.FrameStreamAny;
export type FileStream = ifs.FileStream;
export type InitDemuxer = ifs.InitDemuxer;
export type InitDemuxerPtr = ifs.InitDemuxerPtr;
export type Selection = ifs.Selection;
export type InitPacketSelector = ifs.InitPacketSelector;
export type InitDecoder = ifs.InitDecoder;
export type InitDecoderPtr = ifs.InitDecoderPtr;
export type InitFrameSelector = ifs.InitFrameSelector;
export type InitFrameNormalizer = ifs.InitFrameNormalizer;
export type InitFrameNormalizerPtr = ifs.InitFrameNormalizerPtr;
export type InitLAFilter = ifs.InitLAFilter;
export type InitLAFilterPtr = ifs.InitLAFilterPtr;
export type EncoderAVCodecConfig = ifs.EncoderAVCodecConfig;
export type InitEncoder = ifs.InitEncoder;
export type InitEncoderPtr = ifs.InitEncoderPtr;
export type InitMuxer = ifs.InitMuxer;
export type InitPacketStream = ifs.InitPacketStream;
export type InitFrameStream = ifs.InitFrameStream;
export type Init = ifs.Init;
export type Command = ifs.Command;
export type CommandResult = ifs.CommandResult;
export type ReselectCommand = ifs.ReselectCommand;
export type ReselectCommandResult = ifs.ReselectCommandResult;
export type SeekCommand = ifs.SeekCommand;
export type SeekCommandResult = ifs.SeekCommandResult;

export const build = factory.build;
