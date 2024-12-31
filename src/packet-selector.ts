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

import * as cmdsM from "./commands";
import * as ifs from "./interfaces";
import * as sel from "./selector";

/**
 * Packet selector.
 */
export class PacketSelector implements ifs.PacketStream {
    constructor(
        /**
         * @private
         * LibAV instance.
         */
        private _libav: LibAVT.LibAV,

        /**
         * @private
         * Input stream.
         */
        private _inputP: Promise<ifs.PacketStreamAny>,

        /**
         * @private
         * Stream selection.
         */
        private _sel: ifs.Selection | ifs.Selection[]
    ) {
        this.ptr = false;
        this.stream = new ReadableStream({});
        this.streams = Promise.resolve([]);
        this._mapping = [];
    }

    /**
     * @private
     * Packet selectors must be initialized.
     */
    private async _init() {
        const la = this._libav;
        const input = await this._inputP;
        this.ptr = <false> input.ptr;
        const streams = await input.streams;
        const mapping = this._mapping = await sel.mkMapping(streams, this._sel);
        const rdr = input.stream.getReader();

        const outStreams: ifs.StreamParameters[] = [];
        for (let i = 0; i < mapping.length; i++) {
            if (mapping[i] >= 0)
                outStreams.push(streams[mapping[i]]);
        }
        this.streams = Promise.resolve(outStreams);

        this.stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    const rd = await rdr.read();
                    if (rd.done) {
                        controller.close();
                        break;
                    }

                    const outPackets: LibAVT.Packet[] = [];
                    for (const packet of rd.value!) {
                        let streamIndex = -1;
                        if (typeof packet === "number")
                            streamIndex = await la.AVPacket_stream_index(packet);
                        else
                            streamIndex = packet.stream_index||0;

                        const outStreamIndex = this._mapping[streamIndex];

                        if (outStreamIndex < 0) {
                            if (typeof packet === "number")
                                await la.av_packet_free_js(packet);
                            continue;
                        }
                        if (typeof packet === "number")
                            await la.AVPacket_stream_index_s(packet, outStreamIndex);
                        else
                            packet.stream_index = outStreamIndex;
                        outPackets.push(<LibAVT.Packet> packet);
                    }

                    if (outPackets.length) {
                        controller.enqueue(outPackets);
                        break;
                    }
                }
            }
        });
    }

    async sendCommands(cmds: ifs.Command[]): Promise<ifs.CommandResult[]> {
        const cmdsR = cmdsM.addResults(cmds);

        for (const cmd of cmdsR) {
            if (cmd.c === "reselect" && !cmd.ran) {
                const reselect = <ifs.ReselectCommandResult> cmd;
                this._mapping = sel.mkMapping(
                    await this.streams, reselect.selection
                );
                cmd.ran = true;
                cmd.success = true;
            }
        }

        const input = await this._inputP;
        return input.sendCommands(cmds);
    }

    /**
     * Build a packet selector.
     */
    static async build(
        libav: LibAVT.LibAV, init: ifs.InitPacketSelector,
        input: Promise<ifs.PacketStreamAny>
    ): Promise<ifs.PacketStreamAny> {
        const ret = new PacketSelector(
            libav, input, init.selection
        );
        await ret._init();
        return <any> ret;
    }

    component: ifs.Component = "packet-selector";
    streamType: "packet" = "packet";
    ptr: false;

    /**
     * Stream of packets.
     */
    stream: ReadableStream<LibAVT.Packet[]>;

    /**
     * LibAV streams in the file.
     */
    streams: Promise<ifs.StreamParameters[]>;

    /**
     * Mapping of input streams to output streams.
     */
    private _mapping: number[];
}
